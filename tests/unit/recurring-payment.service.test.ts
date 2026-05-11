const mockFrom = jest.fn();
const mockGhlPut = jest.fn();
const mockFireTrigger = jest.fn();
const mockLogEvidence = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({ put: mockGhlPut }),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => mockFireTrigger(...args) },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: (...args: any[]) => mockLogEvidence(...args) },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { handleRecurringPaymentSuccess } from '../../src/services/recurring-payment.service';

describe('recurring payment lifecycle', () => {
  const paymentEventInserts: any[] = [];
  const enrollmentUpdates: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    paymentEventInserts.length = 0;
    enrollmentUpdates.length = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'payment_events') {
        return {
          insert: jest.fn((payload: any) => {
            paymentEventInserts.push(payload);
            return {
              select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({ data: { id: 'pe_1' }, error: null }),
              })),
            };
          }),
        };
      }

      if (table === 'enrollments') {
        return {
          update: jest.fn((updates: any) => ({
            eq: jest.fn((column: string, id: string) => {
              enrollmentUpdates.push({ column, id, updates });
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('marks a final installment as billing complete without completing the program', async () => {
    const result = await handleRecurringPaymentSuccess({
      enrollment: {
        id: 'enr_1',
        merchant_id: 'merchant_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        payments_made: 1,
        payments_total: 2,
        payment_type: 'installment',
        processor_subscription_id: 'sub_1',
      },
      processorType: 'stripe',
      transactionId: 'ch_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'weekly',
      source: 'stripe_webhook',
    });

    expect(result.isFinal).toBe(true);
    expect(enrollmentUpdates[0].updates).toEqual(expect.objectContaining({
      payments_made: 2,
      next_billing_date: null,
    }));
    expect(enrollmentUpdates[0].updates.billing_completed_at).toEqual(expect.any(String));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('status');
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('completed_at');
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('pulse_cadence_enabled');

    expect(paymentEventInserts[0]).toEqual(expect.objectContaining({
      processor: 'stripe',
      processor_subscription_id: 'sub_1',
      payment_number: 2,
      payments_remaining: 0,
      source: 'stripe_webhook',
      is_recurring: true,
    }));
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.objectContaining({
      payments_remaining: 0,
      payment_kind: 'installment',
    }));
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_program_completed', expect.anything());
  });

  it('does not treat subscription payments as final program completion', async () => {
    const result = await handleRecurringPaymentSuccess({
      enrollment: {
        id: 'enr_sub',
        merchant_id: 'merchant_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        payments_made: 4,
        payments_total: 5,
        payment_type: 'subscription',
        processor_subscription_id: 'sub_live',
      },
      processorType: 'nmi',
      transactionId: 'txn_5',
      amountCents: 1000,
      offerName: 'Subscription Offer',
      installmentFrequency: 'monthly',
      source: 'nmi_silent_post',
    });

    expect(result.isFinal).toBe(false);
    expect(enrollmentUpdates[0].updates.payments_made).toBe(5);
    expect(enrollmentUpdates[0].updates.next_billing_date).toEqual(expect.any(String));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('billing_completed_at');
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_program_completed', expect.anything());
  });
});
