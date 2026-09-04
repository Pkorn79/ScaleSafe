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
  });
}

let existingFailureResult: any = { data: null, error: null };
const mockInsert = jest.fn();

describe('handleRecurringPaymentFailure dunning initiation (#6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertResult = { data: { id: 'pe_fail' }, error: null };
    existingFailureResult = { data: null, error: null };
    mockFrom.mockImplementation(() => {
      const selectChain: any = {
        eq: jest.fn(() => selectChain),
        maybeSingle: jest.fn(() => Promise.resolve(existingFailureResult)),
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

    expect(result).toEqual({ paymentEventId: 'pe_prev' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockInitiateDunning).not.toHaveBeenCalled();
  });

  test('initiates dunning with the ledger event id on a normal insert', async () => {
    await callFailure();
    expect(mockInitiateDunning).toHaveBeenCalledWith(expect.objectContaining({ paymentEventId: 'pe_fail' }));
  });

  test('still initiates dunning when the failed-payment ledger insert fails', async () => {
    insertResult = { data: null, error: { message: 'DB down', code: '08006' } };

    await callFailure();

    expect(mockInitiateDunning).toHaveBeenCalledTimes(1);
    expect(mockInitiateDunning).toHaveBeenCalledWith(expect.objectContaining({ paymentEventId: null }));
  });
});
