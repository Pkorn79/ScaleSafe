/**
 * Payment service tests.
 * Verifies observe-only payment event routing and evidence logging.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({ error: null }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    put: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

// Mock evidence repository
const mockInsert = jest.fn().mockResolvedValue(undefined);
const mockGetCounts = jest.fn().mockResolvedValue({});
const mockGetLastDate = jest.fn().mockResolvedValue(null);

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    insert: mockInsert,
    getCounts: mockGetCounts,
    getLastEvidenceDate: mockGetLastDate,
  },
}));

import { paymentService } from '../../src/services/payment.service';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Payment Service - Event Routing', () => {
  test('logSuccessfulPayment logs payment_confirmation evidence', async () => {
    await paymentService.logSuccessfulPayment('loc_1', 'contact_1', {
      amount: 500,
      transactionId: 'txn_123',
      paymentsRemaining: 3,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      'payment_confirmation',
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        amount: 500,
      }),
    );
  });

  test('logFailedPayment logs failed_payment evidence', async () => {
    await paymentService.logFailedPayment('loc_1', 'contact_1', {
      amount: 500,
      declineReason: 'insufficient_funds',
      attemptCount: 1,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      'failed_payment',
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        reason_code: 'insufficient_funds',
      }),
    );
  });

  test('logRefund logs refund_activity evidence', async () => {
    await paymentService.logRefund('loc_1', 'contact_1', {
      amount: 250,
      refundType: 'partial',
      reason: 'Early termination',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      'refund_activity',
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        amount: 250,
        refund_type: 'partial',
      }),
    );
  });

  test('logSubscriptionChange logs pause action', async () => {
    await paymentService.logSubscriptionChange('loc_1', 'contact_1', 'subscription.paused', {
      reason: 'Vacation',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      'subscription_change',
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        action: 'paused',
      }),
    );
  });

  test('logSubscriptionChange logs cancel action', async () => {
    await paymentService.logSubscriptionChange('loc_1', 'contact_1', 'subscription.cancelled', {
      reason: 'Completed program',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      'subscription_change',
      expect.objectContaining({
        action: 'cancelled',
        reason: 'Completed program',
      }),
    );
  });
});

describe('Payment Service - Never Processes Payments', () => {
  test('payment service has no charge/process/create methods', () => {
    // ScaleSafe OBSERVES payments, never processes them
    expect((paymentService as any).chargeCard).toBeUndefined();
    expect((paymentService as any).processPayment).toBeUndefined();
    expect((paymentService as any).createSubscription).toBeUndefined();
    expect((paymentService as any).refundPayment).toBeUndefined();
  });
});
