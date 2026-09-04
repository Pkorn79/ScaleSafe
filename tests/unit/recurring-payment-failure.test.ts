const mockFrom = jest.fn();
const mockInitiateDunning = jest.fn();

let insertResult: any = { data: { id: 'pe_fail' }, error: null };

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: { initiateDunning: (...args: any[]) => mockInitiateDunning(...args) },
}));

jest.mock('../../src/clients/ghl.client', () => ({ ghlApi: jest.fn().mockResolvedValue({ put: jest.fn() }) }));
jest.mock('../../src/services/trigger.service', () => ({ triggerService: { fireTrigger: jest.fn() } }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: { logEvidence: jest.fn() } }));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { handleRecurringPaymentFailure } from '../../src/services/recurring-payment.service';

const enrollment = {
  id: 'enr_1', merchant_id: 'm_1', location_id: 'loc_1', contact_id: 'c_1',
  offer_id: 'offer_1', processor_subscription_id: 'sub_1',
};

function callFailure() {
  return handleRecurringPaymentFailure({
    enrollment,
    processorType: 'stripe',
    transactionId: 'txn_f',
    amountCents: 5000,
    errorMessage: 'card_declined',
    source: 'stripe_webhook',
    rawPayload: { stripe_invoice_id: 'in_1', stripe_account_id: 'acct_1' },
  });
}

let existingFailureResult: any = { data: null, error: null };
let duplicateAfterInsertResult: any = { data: null, error: null };
let failureLookupCount = 0;
const mockInsert = jest.fn();

describe('handleRecurringPaymentFailure dunning initiation (#6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertResult = { data: { id: 'pe_fail' }, error: null };
    existingFailureResult = { data: null, error: null };
    duplicateAfterInsertResult = { data: null, error: null };
    failureLookupCount = 0;
    mockFrom.mockImplementation(() => {
      const selectChain: any = {
        eq: jest.fn(() => selectChain),
        maybeSingle: jest.fn(() => Promise.resolve(
          failureLookupCount++ === 0 ? existingFailureResult : duplicateAfterInsertResult,
        )),
      };
      return {
        insert: (...args: any[]) => {
          mockInsert(...args);
          return { select: () => ({ single: () => Promise.resolve(insertResult) }) };
        },
        select: jest.fn(() => selectChain),
      };
    });
    mockInitiateDunning.mockResolvedValue(undefined);
  });

  test('does not duplicate the dunning sequence when the same processor object already failed', async () => {
    // Stripe Smart Retries fire invoice.payment_failed per attempt for ONE
    // invoice — each must not spawn its own independently retryable dunning row.
    existingFailureResult = { data: { id: 'pe_prev' }, error: null };

    const result = await callFailure();

    expect(result).toEqual({ paymentEventId: 'pe_prev', duplicate: true });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInitiateDunning).not.toHaveBeenCalled();
  });

  test('initiates dunning with the ledger event id on a normal insert', async () => {
    const result = await callFailure();
    expect(result).toEqual({ paymentEventId: 'pe_fail', duplicate: false });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      raw_webhook_payload: { stripe_invoice_id: 'in_1', stripe_account_id: 'acct_1' },
    }));
    expect(mockInitiateDunning).toHaveBeenCalledWith(expect.objectContaining({ paymentEventId: 'pe_fail' }));
  });

  test('fails without dunning when the failed-payment ledger insert fails', async () => {
    insertResult = { data: null, error: { message: 'DB down', code: '08006' } };

    await expect(callFailure()).rejects.toMatchObject({ code: '08006' });

    expect(mockInitiateDunning).not.toHaveBeenCalled();
  });

  test('fails without dunning when duplicate detection cannot read the ledger', async () => {
    existingFailureResult = { data: null, error: { message: 'DB timeout', code: '08006' } };

    await expect(callFailure()).rejects.toMatchObject({ code: '08006' });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInitiateDunning).not.toHaveBeenCalled();
  });

  test('resolves a unique-insert race to the existing row without starting dunning twice', async () => {
    insertResult = { data: null, error: { message: 'duplicate key', code: '23505' } };
    duplicateAfterInsertResult = { data: { id: 'pe_race_winner' }, error: null };

    const result = await callFailure();

    expect(result).toEqual({ paymentEventId: 'pe_race_winner', duplicate: true });
    expect(mockInitiateDunning).not.toHaveBeenCalled();
  });
});
