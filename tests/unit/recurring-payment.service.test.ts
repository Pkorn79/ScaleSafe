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

const baseEnrollment = {
  id: 'enr_1',
  merchant_id: 'merchant_1',
  location_id: 'loc_1',
  contact_id: 'contact_1',
  offer_id: 'offer_1',
  payments_made: 1,
  payments_total: 2,
  payment_type: 'installment',
  processor_subscription_id: 'sub_1',
  next_billing_date: '2026-06-01',
};

describe('recurring payment lifecycle (atomic record_recurring_payment)', () => {
  let rpcResult: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: a genuinely new, non-final payment.
    rpcResult = {
      is_duplicate: false,
      payment_event_id: 'pe_1',
      payments_made: 2,
      payments_total: 2,
      is_final: false,
      billing_completed_at: null,
      next_billing_date: '2026-07-01',
      next_billing_source: 'processor',
    };

    // The service should perform NO direct table writes for the ledger/enrollment -
    // the RPC is authoritative. Only the merchants lookup remains.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: { business_name: 'Biz', support_email: 'help@biz.com' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table write in handleRecurringPaymentSuccess: ${table}`);
    });

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'record_recurring_payment') {
        return Promise.resolve({ data: [rpcResult], error: null });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    });
  });

  it('records a new recurring payment atomically via the record_recurring_payment RPC', async () => {
    const result = await handleRecurringPaymentSuccess({
      enrollment: baseEnrollment,
      processorType: 'stripe',
      transactionId: 'ch_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'weekly',
      source: 'stripe_webhook',
    });

    expect(mockRpc).toHaveBeenCalledWith('record_recurring_payment', expect.objectContaining({
      p_enrollment_id: 'enr_1',
      p_location_id: 'loc_1',
      p_processor: 'stripe',
      p_transaction_id: 'ch_2',
      p_amount: 50,
      p_source: 'stripe_webhook',
    }));
    expect(result.paymentEventId).toBe('pe_1');
    expect(result.newPaymentsMade).toBe(2);
    expect(mockLogEvidence).toHaveBeenCalledWith(
      'payment_confirmation',
      'loc_1',
      'contact_1',
      'stripe_webhook',
      expect.objectContaining({
        enrollment_id: 'enr_1',
        payment_event_id: 'pe_1',
        processor: 'stripe',
        ghl_transaction_id: 'ch_2',
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.objectContaining({
      payment_number: 2,
      payments_remaining: 0,
      payment_kind: 'installment',
    }));
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact_1', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.offer_business_name': 'Biz',
        'contact.offer_name': 'Test Offer',
        'contact.offer_program_name': 'Test Offer',
        'contact.offer_support_email': 'help@biz.com',
        'contact.ss_last_payment_amount': '$50.00',
      }),
    }));
  });

  it('skips increment, evidence, contact sync, and triggers on a duplicate webhook delivery', async () => {
    rpcResult = {
      is_duplicate: true,
      payment_event_id: null,
      payments_made: 2,
      payments_total: 2,
      is_final: false,
      billing_completed_at: null,
      next_billing_date: '2026-07-01',
      next_billing_source: 'processor',
    };

    const result = await handleRecurringPaymentSuccess({
      enrollment: baseEnrollment,
      processorType: 'stripe',
      transactionId: 'ch_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'weekly',
      source: 'stripe_webhook',
    });

    expect(result.duplicate).toBe(true);
    expect(result.paymentEventId).toBeNull();
    expect(mockFireTrigger).not.toHaveBeenCalled();
    expect(mockLogEvidence).not.toHaveBeenCalled();
    expect(mockGhlPut).not.toHaveBeenCalled();
  });

  it('passes the processor-resolved next billing date and source to the RPC', async () => {
    await handleRecurringPaymentSuccess({
      enrollment: baseEnrollment,
      processorType: 'stripe',
      transactionId: 'ch_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'monthly',
      source: 'stripe_webhook',
      nextBillingDate: '2026-08-15',
    });

    expect(mockRpc).toHaveBeenCalledWith('record_recurring_payment', expect.objectContaining({
      p_next_billing_date: '2026-08-15',
      p_next_billing_source: 'processor',
    }));
  });

  it('falls back to an estimated source when no processor date is available', async () => {
    await handleRecurringPaymentSuccess({
      enrollment: baseEnrollment,
      processorType: 'nmi',
      transactionId: 'txn_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'monthly',
      source: 'nmi_silent_post',
    });

    expect(mockRpc).toHaveBeenCalledWith('record_recurring_payment', expect.objectContaining({
      p_next_billing_date: null,
      p_next_billing_source: 'estimated',
    }));
  });

  it('reports a final installment without firing program completion', async () => {
    rpcResult = { ...rpcResult, is_final: true, billing_completed_at: '2026-06-15T00:00:00Z', next_billing_date: null, next_billing_source: 'complete' };

    const result = await handleRecurringPaymentSuccess({
      enrollment: baseEnrollment,
      processorType: 'stripe',
      transactionId: 'ch_2',
      amountCents: 5000,
      offerName: 'Test Offer',
      installmentFrequency: 'weekly',
      source: 'stripe_webhook',
    });

    expect(result.isFinal).toBe(true);
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.anything());
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_program_completed', expect.anything());

  });

  it('does not fire a customer receipt for NMI history-sync imports', async () => {
    await handleRecurringPaymentSuccess({
      enrollment: { ...baseEnrollment, id: 'enr_history', payments_total: 3 },
      processorType: 'nmi',
      transactionId: '12061861902',
      amountCents: 3300,
      offerName: 'Imported Offer',
      installmentFrequency: 'daily',
      source: 'nmi_history_sync',
    });

    expect(mockGhlPut).not.toHaveBeenCalled();
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_payment_received', expect.anything());
  });
});
