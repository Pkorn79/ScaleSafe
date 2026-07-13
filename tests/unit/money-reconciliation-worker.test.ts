const tableQueues: Record<string, any[]> = {};
const mockClaim = jest.fn();
const mockMarkRecorded = jest.fn().mockResolvedValue(undefined);
const mockScheduleRetry = jest.fn().mockResolvedValue(undefined);
const mockClaimRefunds = jest.fn();
const mockMarkRefundRecorded = jest.fn().mockResolvedValue(undefined);
const mockScheduleRefundRetry = jest.fn().mockResolvedValue(undefined);
const mockNotifyRefundProcessed = jest.fn().mockResolvedValue(undefined);

function chain(result: { data: any; error: any }) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'limit', 'order', 'in']) builder[method] = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(async () => result);
  builder.single = jest.fn(async () => result);
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const mockFrom = jest.fn((table: string) => {
  const next = tableQueues[table]?.shift();
  if (!next) throw new Error(`Unexpected query for ${table}`);
  return next;
});

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom, rpc: jest.fn() }),
}));

jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    claimReconciliation: (...args: any[]) => mockClaim(...args),
    markRecorded: (...args: any[]) => mockMarkRecorded(...args),
    scheduleReconciliationRetry: (...args: any[]) => mockScheduleRetry(...args),
  },
}));

jest.mock('../../src/services/refund-reconciliation.service', () => ({
  refundReconciliationService: {
    claim: (...args: any[]) => mockClaimRefunds(...args),
    markRecorded: (...args: any[]) => mockMarkRefundRecorded(...args),
    scheduleRetry: (...args: any[]) => mockScheduleRefundRetry(...args),
  },
}));

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    notifyRefundProcessed: (...args: any[]) => mockNotifyRefundProcessed(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { moneyReconciliationWorker } from '../../src/services/money-reconciliation-worker';

function queuedSelect(data: any, error: any = null) {
  return { select: jest.fn(() => chain({ data, error })) };
}

function queuedUpdate(data: any = null, error: any = null) {
  return { update: jest.fn(() => chain({ data, error })) };
}

function queuedInsert(data: any, error: any = null) {
  return { insert: jest.fn(() => chain({ data, error })) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkRecorded.mockResolvedValue(undefined);
  mockScheduleRetry.mockResolvedValue(undefined);
  mockClaimRefunds.mockResolvedValue([]);
  mockMarkRefundRecorded.mockResolvedValue(undefined);
  mockScheduleRefundRetry.mockResolvedValue(undefined);
  mockNotifyRefundProcessed.mockResolvedValue(undefined);
  for (const key of Object.keys(tableQueues)) delete tableQueues[key];
});

afterAll(() => moneyReconciliationWorker.stop());

test('repairs provider-accepted checkout state without calling the processor again', async () => {
  mockClaim.mockResolvedValue([{
    id: 'op_1', location_id: 'loc_1', merchant_id: 'merch_1',
    operation_type: 'checkout_charge', status: 'provider_accepted', provider_called: true,
    processor_type: 'stripe', processor_reference: 'pi_1', reconciliation_attempts: 1,
    request_payload: {
      contactId: 'contact_1', enrollmentId: 'enr_1', offerId: 'offer_1',
      amountCents: 5000, currency: 'usd', paymentMethod: 'card',
    },
    response_payload: { success: true, chargeId: 'pi_1' },
    reconciliation_payload: { status: 'approved' },
  }]);
  tableQueues.payment_events = [queuedSelect({ id: 'pe_1', contact_id: 'contact_1', enrollment_id: 'enr_1' })];
  tableQueues.enrollments = [
    queuedSelect({ id: 'enr_1', contact_id: 'contact_1', offer_id: 'offer_1', payment_type: 'pif' }),
    queuedUpdate(),
  ];
  tableQueues.transaction_mappings = [queuedSelect({ id: 'map_1' })];

  await moneyReconciliationWorker.runOnce();

  expect(mockMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({
    id: 'op_1',
    processorReference: 'pi_1',
    response: expect.objectContaining({ success: true }),
  }));
  expect(mockScheduleRetry).not.toHaveBeenCalled();
});

test('releases a failed local repair for a leased retry', async () => {
  mockClaim.mockResolvedValue([{
    id: 'op_2', location_id: 'loc_1', merchant_id: 'merch_1',
    operation_type: 'checkout_charge', status: 'provider_accepted', provider_called: true,
    processor_type: 'stripe', processor_reference: 'pi_2', reconciliation_attempts: 2,
    request_payload: { amountCents: 5000 }, response_payload: {}, reconciliation_payload: {},
  }]);
  tableQueues.payment_events = [queuedSelect(null, { message: 'database timeout' })];

  await moneyReconciliationWorker.runOnce();

  expect(mockMarkRecorded).not.toHaveBeenCalled();
  expect(mockScheduleRetry).toHaveBeenCalledWith(expect.objectContaining({
    id: 'op_2', locationId: 'loc_1', attempt: 2, error: 'database timeout',
  }));
});

test('repairs a created recurring subscription that failed local enrollment mapping', async () => {
  mockClaim.mockResolvedValue([{
    id: 'op_sub', location_id: 'loc_1', merchant_id: 'merch_1',
    operation_type: 'manual_sale_charge', status: 'provider_accepted', provider_called: true,
    processor_type: 'stripe', processor_reference: 'pi_initial', reconciliation_attempts: 1,
    request_payload: {
      contactId: 'contact_1', enrollmentId: 'enr_1', offerId: 'offer_1',
      amountCents: 5000, currency: 'usd', paymentMethod: 'card',
    },
    response_payload: { success: true, transactionId: 'pi_initial' },
    reconciliation_payload: {
      status: 'succeeded',
      processorSubscriptionId: 'sub_created_1',
      nextBillingDate: '2026-08-12',
    },
  }]);
  const enrollmentUpdate = jest.fn(() => chain({ data: null, error: null }));
  const subscriptionMappingInsert = jest.fn(() => chain({ data: null, error: null }));
  tableQueues.payment_events = [queuedSelect({ id: 'pe_1', contact_id: 'contact_1', enrollment_id: 'enr_1' })];
  tableQueues.enrollments = [
    queuedSelect({ id: 'enr_1', contact_id: 'contact_1', offer_id: 'offer_1', payment_type: 'installment' }),
    { update: enrollmentUpdate },
  ];
  tableQueues.transaction_mappings = [
    queuedSelect({ id: 'charge_map' }),
    queuedSelect(null),
    { insert: subscriptionMappingInsert },
  ];

  await moneyReconciliationWorker.runOnce();

  expect(enrollmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
    processor_subscription_id: 'sub_created_1',
    billing_setup_status: 'ok',
    next_billing_date: '2026-08-12',
  }));
  expect(subscriptionMappingInsert).toHaveBeenCalledWith(expect.objectContaining({
    processor_subscription_id: 'sub_created_1',
    contact_id: 'contact_1',
  }));
  expect(mockMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({ id: 'op_sub' }));
});

test('keeps a recovered recurring payment visible for subscription reconciliation when no subscription ID was saved', async () => {
  mockClaim.mockResolvedValue([{
    id: 'op_sub_unknown', location_id: 'loc_1', merchant_id: 'merch_1',
    operation_type: 'checkout_charge', status: 'provider_accepted', provider_called: true,
    processor_type: 'nmi', processor_reference: 'txn_initial', reconciliation_attempts: 1,
    request_payload: {
      contactId: 'contact_1', enrollmentId: 'enr_1', offerId: 'offer_1',
      amountCents: 5000, currency: 'usd', paymentMethod: 'card', paymentChoice: 'installments',
    },
    response_payload: { success: true, transactionId: 'txn_initial' },
    reconciliation_payload: { status: 'approved' },
  }]);
  const enrollmentUpdate = jest.fn(() => chain({ data: null, error: null }));
  tableQueues.payment_events = [queuedSelect({ id: 'pe_1', contact_id: 'contact_1', enrollment_id: 'enr_1' })];
  tableQueues.enrollments = [
    queuedSelect({ id: 'enr_1', contact_id: 'contact_1', offer_id: 'offer_1', payment_type: 'installment' }),
    { update: enrollmentUpdate },
  ];
  tableQueues.transaction_mappings = [queuedSelect({ id: 'charge_map' })];

  await moneyReconciliationWorker.runOnce();

  expect(enrollmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
    billing_setup_status: 'needs_reconciliation',
    next_billing_date: null,
  }));
  expect(mockMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({ id: 'op_sub_unknown' }));
});

test('repairs a provider-accepted refund without calling the processor again', async () => {
  mockClaim.mockResolvedValue([]);
  mockClaimRefunds.mockResolvedValue([{
    id: 'claim_1', location_id: 'loc_1', original_payment_event_id: 'pe_original',
    amount_cents: 2500, status: 'provider_accepted', processor: 'stripe',
    processor_refund_id: 're_1', reconciliation_attempts: 1,
  }]);
  const refundLookup = chain({ data: null, error: null });
  tableQueues.payment_events = [
    queuedSelect({
      id: 'pe_original', merchant_id: 'merch_1', location_id: 'loc_1',
      contact_id: 'contact_1', enrollment_id: 'enr_1', offer_id: null,
      processor: 'stripe', processor_transaction_id: 'pi_1', amount: 100,
      currency: 'usd', processor_subscription_id: null,
    }),
    { select: jest.fn(() => refundLookup) },
    queuedInsert({ id: 'pe_refund' }),
  ];

  await moneyReconciliationWorker.runOnce();

  expect(mockMarkRefundRecorded).toHaveBeenCalledWith(expect.objectContaining({
    claimId: 'claim_1',
    refundPaymentEventId: 'pe_refund',
  }));
  expect(mockNotifyRefundProcessed).toHaveBeenCalledWith(
    'loc_1',
    'contact_1',
    expect.objectContaining({ amount: 25, transactionId: 're_1', processor: 'stripe' }),
  );
  expect(refundLookup.eq).toHaveBeenCalledWith('event_type', 'refund');
  expect(mockScheduleRefundRetry).not.toHaveBeenCalled();
});

test('waits for a signed Whop refund event instead of synthesizing one from the payment id', async () => {
  mockClaim.mockResolvedValue([]);
  mockClaimRefunds.mockResolvedValue([{
    id: 'claim_whop', location_id: 'loc_1', original_payment_event_id: 'pe_original',
    amount_cents: 150, status: 'provider_accepted', processor: 'whop',
    processor_refund_id: null, reconciliation_attempts: 1,
  }]);
  const signedRefundLookup = chain({ data: [], error: null });
  tableQueues.payment_events = [
    queuedSelect({
      id: 'pe_original', merchant_id: 'merch_1', location_id: 'loc_1',
      contact_id: 'contact_1', enrollment_id: 'enr_1', offer_id: 'offer_1',
      processor: 'whop', processor_transaction_id: 'pay_original', amount: 1.5,
      currency: 'usd', processor_subscription_id: 'mem_1',
    }),
    { select: jest.fn(() => signedRefundLookup) },
  ];

  await moneyReconciliationWorker.runOnce();

  expect(signedRefundLookup.eq).toHaveBeenCalledWith('event_type', 'refund');
  expect(mockMarkRefundRecorded).not.toHaveBeenCalled();
  expect(mockNotifyRefundProcessed).not.toHaveBeenCalled();
  expect(mockScheduleRefundRetry).toHaveBeenCalledWith(expect.objectContaining({
    claimId: 'claim_whop',
    error: 'Awaiting signed Whop refund confirmation',
  }));
  expect(mockFrom).toHaveBeenCalledTimes(2);
});

test('links a signed Whop refund event without sending the refund workflow twice', async () => {
  mockClaim.mockResolvedValue([]);
  mockClaimRefunds.mockResolvedValue([{
    id: 'claim_whop', location_id: 'loc_1', original_payment_event_id: 'pe_original',
    amount_cents: 150, status: 'provider_accepted', processor: 'whop',
    processor_refund_id: null, reconciliation_attempts: 1,
  }]);
  tableQueues.payment_events = [
    queuedSelect({
      id: 'pe_original', merchant_id: 'merch_1', location_id: 'loc_1',
      contact_id: 'contact_1', enrollment_id: 'enr_1', offer_id: 'offer_1',
      processor: 'whop', processor_transaction_id: 'pay_original', amount: 1.5,
      currency: 'usd', processor_subscription_id: 'mem_1',
    }),
    queuedSelect([{
      id: 'pe_refund',
      processor_transaction_id: 'rf_1',
      raw_webhook_payload: {
        original_payment_event_id: 'pe_original',
        original_processor_transaction_id: 'pay_original',
      },
    }]),
  ];

  await moneyReconciliationWorker.runOnce();

  expect(mockMarkRefundRecorded).toHaveBeenCalledWith(expect.objectContaining({
    claimId: 'claim_whop',
    refundPaymentEventId: 'pe_refund',
  }));
  expect(mockNotifyRefundProcessed).not.toHaveBeenCalled();
  expect(mockScheduleRefundRetry).not.toHaveBeenCalled();
});
