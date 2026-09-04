const singleQueue: any[] = [];
const maybeSingleQueue: any[] = [];
const thenQueue: any[] = [];
const fromCalls: any[] = [];

function builder(table: string) {
  const ops: any = { table, chain: [] };
  fromCalls.push(ops);
  const b: any = {};
  ['select', 'insert', 'update', 'eq', 'in', 'is', 'limit', 'order'].forEach((m) => {
    b[m] = (...args: any[]) => { ops.chain.push([m, args]); return b; };
  });
  b.single = () => Promise.resolve(singleQueue.shift() ?? { data: null, error: null });
  b.maybeSingle = () => Promise.resolve(maybeSingleQueue.shift() ?? { data: null, error: null });
  b.then = (onF: any, onR: any) => Promise.resolve(thenQueue.shift() ?? { data: [], error: null }).then(onF, onR);
  return b;
}

const mockRpc = jest.fn();
const mockSupabase = { from: (t: string) => builder(t), rpc: (...a: any[]) => mockRpc(...a) };
const mockChargeStoredCard = jest.fn();
const mockPayInvoice = jest.fn();
const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockGhlPut = jest.fn().mockResolvedValue({});
const mockLogEvidence = jest.fn();
const mockMoneyBegin = jest.fn();
const mockMoneyMarkProviderStarted = jest.fn();
const mockMoneyMarkProviderAccepted = jest.fn();
const mockMoneyMarkRecorded = jest.fn();
const mockMoneyMarkUnknown = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => mockSupabase }));
jest.mock('../../src/clients/ghl.client', () => ({ ghlApi: jest.fn().mockResolvedValue({ put: (...a: any[]) => mockGhlPut(...a) }) }));
jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));
jest.mock('../../src/services/trigger.service', () => ({ triggerService: { fireTrigger: jest.fn().mockResolvedValue({}) } }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: { logEvidence: (...args: any[]) => mockLogEvidence(...args) } }));
jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    begin: (...args: any[]) => mockMoneyBegin(...args),
    markProviderStarted: (...args: any[]) => mockMoneyMarkProviderStarted(...args),
    markProviderAccepted: (...args: any[]) => mockMoneyMarkProviderAccepted(...args),
    markRecorded: (...args: any[]) => mockMoneyMarkRecorded(...args),
    markUnknown: (...args: any[]) => mockMoneyMarkUnknown(...args),
  },
}));
jest.mock('../../src/services/payment-methods.service', () => ({ collapseVisiblePaymentMethods: jest.fn(), archivePaymentMethod: jest.fn() }));
jest.mock('../../src/repositories/merchant.repository', () => ({ merchantRepository: { getByLocationId: jest.fn() } }));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { paymentLifecycleService } from '../../src/services/payment-lifecycle.service';

describe('dunning retry (#2 idempotency, #14 rounding)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    singleQueue.length = 0;
    maybeSingleQueue.length = 0;
    thenQueue.length = 0;
    fromCalls.length = 0;
    mockLogEvidence.mockResolvedValue({});
    mockMoneyBegin.mockResolvedValue({ action: 'execute', operation: { id: 'money-op-1' } });
    mockMoneyMarkProviderStarted.mockResolvedValue(undefined);
    mockMoneyMarkProviderAccepted.mockResolvedValue(undefined);
    mockMoneyMarkRecorded.mockResolvedValue(undefined);
    mockMoneyMarkUnknown.mockResolvedValue(undefined);
    mockResolveProcessor.mockResolvedValue({ config: { id: 'pc_nmi', processor_type: 'nmi' } });
    mockCreateProcessorClient.mockReturnValue({
      chargeStoredCard: (...args: any[]) => mockChargeStoredCard(...args),
    });
  });

  // success path: originalEvent + enrollment(offer_id) + offer(frequency) singles;
  // claim + resolve awaited updates; record_recurring_payment via rpc.
  function primeSuccess(amount: number) {
    singleQueue.push(
      { data: { id: 'pe1', merchant_id: 'm1', amount, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed', dunning_retry_count: 0, processor: 'nmi', processor_config_id: 'pc_nmi', processor_transaction_id: 'txn_failed' } },
      { data: { offer_id: 'offer_1' } },
      { data: { installment_frequency: 'monthly' } },
    );
    maybeSingleQueue.push({ data: { processor_type: 'nmi', nmi_customer_vault_id: 'vault1' } });
    thenQueue.push({ data: [{ id: 'pe1' }], error: null }, { data: [{ id: 'pe1' }], error: null });
    mockRpc.mockResolvedValue({ data: [{ is_duplicate: false, payment_event_id: 'pe_success', payments_made: 2 }], error: null });
    mockChargeStoredCard.mockResolvedValue({ success: true, transactionId: 'txn_new' });
  }

  it('rounds the retry amount to integer cents before charging', async () => {
    primeSuccess(19.99);

    await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(mockChargeStoredCard).toHaveBeenCalledTimes(1);
    const chargeArgs = mockChargeStoredCard.mock.calls[0][2];
    expect(chargeArgs.amount).toBe(1999); // Math.round(19.99 * 100), not 1998.9999...
  });

  it('records the recovered installment via record_recurring_payment so payments_made advances (#5)', async () => {
    primeSuccess(50);

    await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(mockRpc).toHaveBeenCalledWith('record_recurring_payment', expect.objectContaining({
      p_enrollment_id: 'enr_1',
      p_location_id: 'loc_1',
      p_transaction_id: 'txn_new',
      p_source: 'dunning_retry',
    }));
  });

  it('pays the open Stripe invoice instead of creating a new charge for invoice-originated dunning', async () => {
    // Charging outside the invoice leaves it open — Stripe Smart Retries later
    // collect the same installment again (double charge).
    mockPayInvoice.mockResolvedValue({
      success: true,
      outcome: 'succeeded',
      transactionId: 'pi_from_invoice',
      invoicePaymentId: 'inpay_123',
    });
    mockResolveProcessor.mockResolvedValueOnce({ config: { id: 'pc_stripe', processor_type: 'stripe', stripe_user_id: 'acct_original' } });
    mockCreateProcessorClient.mockReturnValueOnce({
      chargeStoredCard: (...a: any[]) => mockChargeStoredCard(...a),
      payInvoice: (...a: any[]) => mockPayInvoice(...a),
    });
    singleQueue.push(
      { data: {
        id: 'pe1', merchant_id: 'm1', amount: 50, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed',
        dunning_retry_count: 0, processor: 'stripe', processor_transaction_id: 'in_123',
        processor_config_id: 'pc_stripe',
        raw_webhook_payload: { stripe_invoice_id: 'in_123', stripe_account_id: 'acct_original' },
      } },
      { data: { offer_id: 'offer_1' } },
      { data: { installment_frequency: 'monthly' } },
    );
    thenQueue.push({ data: [{ id: 'pe1' }], error: null }, { data: [{ id: 'pe1' }], error: null });
    mockRpc.mockResolvedValue({ data: [{ is_duplicate: false, payment_event_id: 'pe_success', payments_made: 2 }], error: null });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result.success).toBe(true);
    expect(mockResolveProcessor).toHaveBeenCalledWith('m1', 'loc_1', {
      processor_override: 'stripe',
      processor_config_id: 'pc_stripe',
      nmi_processor_id: null,
      stripe_account_id: 'acct_original',
    });
    expect(mockPayInvoice).toHaveBeenCalledWith('in_123', {
      stripeAccountId: 'acct_original',
      idempotencyKey: 'dunning-pe1-1',
    });
    expect(mockChargeStoredCard).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('record_recurring_payment', expect.objectContaining({
      p_transaction_id: 'pi_from_invoice',
    }));
  });

  it('does not charge when the retry is already claimed by a concurrent request', async () => {
    singleQueue.push({ data: {
      id: 'pe1', merchant_id: 'm1', amount: 50, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed',
      dunning_retry_count: 0, processor: 'nmi', processor_transaction_id: 'txn_failed',
      processor_config_id: 'pc_nmi',
    } });
    maybeSingleQueue.push({ data: { processor_type: 'nmi', nmi_customer_vault_id: 'vault1' } });
    // claim returns 0 rows -> another request already claimed / already resolved
    thenQueue.push({ data: [], error: null });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(mockChargeStoredCard).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('does not reopen the retry after the processor accepts but the recurring ledger write fails', async () => {
    primeSuccess(50);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'ledger unavailable' } });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result).toEqual({
      success: false,
      error: 'Dunning recovery ledger write failed: ledger unavailable',
      reconciliationRequired: true,
    });
    expect(mockChargeStoredCard).toHaveBeenCalledTimes(1);
    expect(mockMoneyMarkProviderAccepted).toHaveBeenCalledTimes(1);
    expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
    const statusWrites = fromCalls
      .filter((call) => call.table === 'payment_events')
      .flatMap((call) => call.chain)
      .filter(([method]: any[]) => method === 'update')
      .map(([, args]: any[]) => args[0]);
    expect(statusWrites).not.toContainEqual(expect.objectContaining({ dunning_status: 'active' }));
  });

  it('keeps a recorded recovery successful when supplemental evidence logging fails', async () => {
    primeSuccess(50);
    mockLogEvidence.mockRejectedValue(new Error('evidence unavailable'));

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result).toEqual({ success: true });
    expect(mockChargeStoredCard).toHaveBeenCalledTimes(1);
    expect(mockMoneyMarkProviderAccepted).toHaveBeenCalledTimes(1);
    expect(mockMoneyMarkRecorded).toHaveBeenCalledTimes(1);
  });

  it('keeps an ambiguous Stripe result claimed and marks it for reconciliation', async () => {
    singleQueue.push({ data: {
      id: 'pe1', merchant_id: 'm1', amount: 50, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed',
      dunning_retry_count: 0, processor: 'stripe', processor_transaction_id: 'in_123',
      processor_config_id: 'pc_stripe',
      raw_webhook_payload: { stripe_invoice_id: 'in_123', stripe_account_id: 'acct_original' },
    } });
    thenQueue.push({ data: [{ id: 'pe1' }], error: null });
    mockResolveProcessor.mockResolvedValueOnce({ config: { id: 'pc_stripe', processor_type: 'stripe', stripe_user_id: 'acct_original' } });
    mockPayInvoice.mockResolvedValueOnce({
      success: false,
      outcome: 'unknown',
      errorMessage: 'Stripe response lost',
    });
    mockCreateProcessorClient.mockReturnValueOnce({ payInvoice: (...a: any[]) => mockPayInvoice(...a) });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result).toEqual({
      success: false,
      error: 'Stripe response lost',
      reconciliationRequired: true,
    });
    expect(mockMoneyMarkUnknown).toHaveBeenCalledWith(expect.objectContaining({
      id: 'money-op-1',
      processorType: 'stripe',
    }));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
  });

  it('fails closed before charging when the original Stripe account was not stored', async () => {
    singleQueue.push({ data: {
      id: 'pe1', merchant_id: 'm1', amount: 50, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed',
      dunning_retry_count: 0, processor: 'stripe', processor_transaction_id: 'in_123',
      processor_config_id: 'pc_stripe',
      raw_webhook_payload: { stripe_invoice_id: 'in_123' },
    } });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result).toEqual({ success: false, error: 'Stripe retry requires the exact stored connected account' });
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockPayInvoice).not.toHaveBeenCalled();
    expect(mockChargeStoredCard).not.toHaveBeenCalled();
  });

  it('does not resolve dunning when a duplicate RPC result cannot be verified as a successful sale', async () => {
    singleQueue.push(
      { data: {
        id: 'pe1', merchant_id: 'm1', amount: 50, currency: 'usd', enrollment_id: 'enr_1', event_type: 'payment_failed',
        dunning_retry_count: 0, processor: 'stripe', processor_transaction_id: 'in_123',
        processor_config_id: 'pc_stripe',
        raw_webhook_payload: { stripe_invoice_id: 'in_123', stripe_account_id: 'acct_original' },
      } },
      { data: { offer_id: 'offer_1' } },
      { data: { installment_frequency: 'monthly' } },
    );
    thenQueue.push({ data: [{ id: 'pe1' }], error: null });
    maybeSingleQueue.push({ data: null, error: null });
    mockResolveProcessor.mockResolvedValueOnce({ config: { id: 'pc_stripe', processor_type: 'stripe', stripe_user_id: 'acct_original' } });
    mockPayInvoice.mockResolvedValueOnce({
      success: true,
      outcome: 'succeeded',
      transactionId: 'pi_retry',
      invoicePaymentId: 'inpay_retry',
    });
    mockCreateProcessorClient.mockReturnValueOnce({ payInvoice: (...a: any[]) => mockPayInvoice(...a) });
    mockRpc.mockResolvedValueOnce({ data: [{ is_duplicate: true, payment_event_id: null }], error: null });

    const result = await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    expect(result).toEqual({
      success: false,
      error: 'Dunning recovery ledger did not contain a distinct successful payment record',
      reconciliationRequired: true,
    });
    expect(mockMoneyMarkProviderAccepted).toHaveBeenCalledTimes(1);
    expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
    const statusWrites = fromCalls
      .filter((call) => call.table === 'payment_events')
      .flatMap((call) => call.chain)
      .filter(([method]: any[]) => method === 'update')
      .map(([, args]: any[]) => args[0]);
    expect(statusWrites).not.toContainEqual(expect.objectContaining({ dunning_status: 'resolved' }));
    expect(statusWrites).not.toContainEqual(expect.objectContaining({ dunning_status: 'active' }));
  });

  it('selects an NMI payment method only for an NMI failure', async () => {
    primeSuccess(50);

    await paymentLifecycleService.retryPayment('m1', 'loc_1', 'contact_1', 'pe1');

    const methodLookup = fromCalls.find((call) => call.table === 'payment_methods');
    expect(methodLookup.chain).toContainEqual(['eq', ['processor_type', 'nmi']]);
    expect(mockResolveProcessor).toHaveBeenCalledWith('m1', 'loc_1', expect.objectContaining({
      processor_override: 'nmi',
      stripe_account_id: null,
    }));
  });
});
