const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGhlPut = jest.fn();
const mockFireTrigger = jest.fn();
const mockLogEvidence = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom, rpc: mockRpc }),
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
            eq: jest.fn().mockReturnValue({
              eq: jest.fn((column: string, id: string) => {
                enrollmentUpdates.push({ column, id, updates });
                return Promise.resolve({ error: null });
              }),
            }),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    mockRpc.mockImplementation((_fn: string, params: any) => {
      const madeByEnrollment: Record<string, number> = {
        enr_1: 2,
        enr_sub: 5,
        enr_history: 2,
      };
      return Promise.resolve({
        data: [{ payments_made: madeByEnrollment[params.p_enrollment_id] || 1 }],
        error: null,
      });
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
      next_billing_date: null,
    }));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('payments_made');
    expect(enrollmentUpdates[0].updates.billing_completed_at).toEqual(expect.any(String));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('status');
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('completed_at');
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('pulse_cadence_enabled');

    expect(paymentEventInserts[0]).toEqual(expect.objectContaining({
      processor: 'stripe',
      processor_subscription_id: 'sub_1',
      payment_number: 2,
      payments_total: 2,
      source: 'stripe_webhook',
      is_recurring: true,
    }));
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.objectContaining({
      event_type: 'payment_received',
      contact_id: 'contact_1',
      contactId: 'contact_1',
      enrollment_id: 'enr_1',
      enrollmentId: 'enr_1',
      offer_id: 'offer_1',
      offerId: 'offer_1',
      processor: 'stripe',
      source: 'stripe_webhook',
      payment_number: 2,
      payments_total: 2,
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
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('payments_made');
    expect(enrollmentUpdates[0].updates.next_billing_date).toEqual(expect.any(String));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('billing_completed_at');
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_program_completed', expect.anything());
  });

  it('imports NMI history payments without firing a customer receipt workflow', async () => {
    const result = await handleRecurringPaymentSuccess({
      enrollment: {
        id: 'enr_history',
        merchant_id: 'merchant_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        payments_made: 1,
        payments_total: 3,
        payment_type: 'installment',
        processor_subscription_id: 'sub_nmi',
      },
      processorType: 'nmi',
      transactionId: '12061861902',
      amountCents: 3300,
      offerName: 'Imported Offer',
      installmentFrequency: 'daily',
      source: 'nmi_history_sync',
    });

    expect(result.paymentEventId).toBe('pe_1');
    expect(paymentEventInserts[0]).toEqual(expect.objectContaining({
      processor: 'nmi',
      processor_transaction_id: '12061861902',
      source: 'nmi_history_sync',
    }));
    expect(enrollmentUpdates[0].updates).not.toHaveProperty('payments_made');
    expect(mockGhlPut).not.toHaveBeenCalled();
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.anything());
  });
});
