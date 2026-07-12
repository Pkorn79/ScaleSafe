const mockSupabaseFrom = jest.fn();
const mockWhopConfigGet = jest.fn();
const mockDecryptWebhookSecret = jest.fn();
const mockVerifyStandardWebhook = jest.fn();
const mockIdempotencyExists = jest.fn();
const mockIdempotencyRecord = jest.fn();
const mockMerchantGetByLocationId = jest.fn();
const mockOfferFindById = jest.fn();
const mockHandleRecurringPaymentSuccess = jest.fn();
const mockHandleRecurringPaymentFailure = jest.fn();
const mockCompleteEnrollment = jest.fn();
const mockPaymentEventFindByTransactionId = jest.fn();
const mockPaymentEventCreate = jest.fn();
const mockTriggerFire = jest.fn();
const mockGhlPost = jest.fn();
const mockNotifyRefundProcessed = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({
    post: (...args: any[]) => mockGhlPost(...args),
  })),
}));

jest.mock('../../src/services/whop-config.service', () => ({
  whopConfigService: {
    get: (...args: any[]) => mockWhopConfigGet(...args),
    findByCompanyId: jest.fn(),
    decryptWebhookSecret: (...args: any[]) => mockDecryptWebhookSecret(...args),
  },
}));

jest.mock('../../src/services/whop.service', () => ({
  whopService: {
    verifyStandardWebhook: (...args: any[]) => mockVerifyStandardWebhook(...args),
  },
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    exists: (...args: any[]) => mockIdempotencyExists(...args),
    record: (...args: any[]) => mockIdempotencyRecord(...args),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockMerchantGetByLocationId(...args),
  },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: (...args: any[]) => mockOfferFindById(...args),
  },
}));

jest.mock('../../src/services/recurring-payment.service', () => ({
  handleRecurringPaymentSuccess: (...args: any[]) => mockHandleRecurringPaymentSuccess(...args),
  handleRecurringPaymentFailure: (...args: any[]) => mockHandleRecurringPaymentFailure(...args),
}));

jest.mock('../../src/services/phase2Enrollment.service', () => ({
  phase2EnrollmentService: {
    completeEnrollment: (...args: any[]) => mockCompleteEnrollment(...args),
  },
}));

jest.mock('../../src/repositories/paymentEvent.repository', () => ({
  paymentEventRepository: {
    findByTransactionId: (...args: any[]) => mockPaymentEventFindByTransactionId(...args),
    create: (...args: any[]) => mockPaymentEventCreate(...args),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockTriggerFire(...args),
  },
}));

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    notifyRefundProcessed: (...args: any[]) => mockNotifyRefundProcessed(...args),
  },
}));

import { handleWhopWebhook } from '../../src/controllers/whop-webhook.controller';

function queryBuilder(result: any = null) {
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    not: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn().mockResolvedValue({ data: result, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: result, error: null }),
  };
  return builder;
}

describe('handleWhopWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhopConfigGet.mockResolvedValue({
      location_id: 'loc_1',
      webhook_secret_encrypted: 'encrypted_secret',
    });
    mockDecryptWebhookSecret.mockReturnValue('whsec_test');
    mockVerifyStandardWebhook.mockReturnValue(true);
    mockIdempotencyExists.mockResolvedValue(false);
    mockIdempotencyRecord.mockResolvedValue(undefined);
    mockMerchantGetByLocationId.mockResolvedValue({ id: 'merchant_1' });
    mockOfferFindById.mockResolvedValue({
      id: 'offer_1',
      offer_name: 'Whop Installments',
      payment_type: 'installments',
      installment_frequency: 'weekly',
      num_payments: 5,
    });
    mockHandleRecurringPaymentSuccess.mockResolvedValue({ paymentEventId: 'pe_2', isFinal: false, newPaymentsMade: 2 });
    mockCompleteEnrollment.mockResolvedValue(undefined);
    mockPaymentEventFindByTransactionId.mockResolvedValue(null);
    mockPaymentEventCreate.mockResolvedValue({ id: 'pe_1' });
    mockGhlPost.mockResolvedValue({ data: { contact: { id: 'contact_from_ghl' } } });
    mockNotifyRefundProcessed.mockResolvedValue(undefined);
  });

  it('processes a Whop renewal payment by membership id as recurring, not as a new initial sale', async () => {
    const enrollment = {
      id: 'enr_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      status: 'enrolled',
      payment_type: 'installment',
      payments_made: 1,
      payments_total: 5,
      processor_type: 'whop',
      processor_subscription_id: 'mem_123',
      whop_membership_id: 'mem_123',
      selected_checkout_items: [
        { kind: 'base_offer', title: 'Whop Installments', amount: 2.2 },
        { kind: 'pre_payment_upsell', title: 'Upgrade', amount: 1 },
      ],
    };

    let enrollmentQueryCount = 0;
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'payment_events') return queryBuilder(null);
      if (table === 'enrollments') {
        enrollmentQueryCount += 1;
        // First enrollment query is membership lookup. Later update/select calls can safely return the same row.
        return queryBuilder(enrollment);
      }
      return queryBuilder(null);
    });

    const payload = {
      id: 'evt_renewal_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_renewal_1',
        amount: 2.2,
        membership_id: 'mem_123',
        metadata: {
          location_id: 'loc_1',
          line_items: JSON.stringify(enrollment.selected_checkout_items),
        },
      },
    };

    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_renewal_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(enrollmentQueryCount).toBeGreaterThan(0);
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      processorType: 'whop',
      transactionId: 'pay_renewal_1',
      amountCents: 220,
      source: 'whop_webhook',
      enrollment: expect.objectContaining({
        id: 'enr_1',
        processor_subscription_id: 'mem_123',
        payments_made: 1,
        payments_total: 5,
      }),
    }));
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
    expect(mockPaymentEventCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('creates a Whop quick-checkout enrollment with a resolved contact id from email metadata', async () => {
    const insertedEnrollment = {
      id: 'enr_quick_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_from_ghl',
      offer_id: 'offer_1',
      email: 'client@example.com',
      status: 'consent_captured',
      payment_type: 'installment',
      payments_made: 0,
      payments_total: 5,
      selected_checkout_items: [
        { type: 'base_offer', label: 'Whop Installments', amount: 5.5 },
        { type: 'order_bump', label: 'Bump', amount: 2 },
      ],
    };
    const insertedRows: any[] = [];
    let enrollmentLookupCount = 0;

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'payment_events') return queryBuilder(null);
      if (table === 'enrollments') {
        enrollmentLookupCount += 1;
        if (enrollmentLookupCount <= 3) return queryBuilder(null);
        const builder = queryBuilder(insertedEnrollment);
        builder.insert = jest.fn((row: any) => {
          insertedRows.push(row);
          return builder;
        });
        return builder;
      }
      return queryBuilder(null);
    });

    const payload = {
      id: 'evt_quick_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_quick_1',
        amount: 7.5,
        membership_id: 'mem_quick_1',
        metadata: {
          location_id: 'loc_1',
          offer_id: 'offer_1',
          checkout_mode: 'quick_checkout',
          contact_email: 'client@example.com',
          contact_name: 'Client Example',
          line_items: JSON.stringify(insertedEnrollment.selected_checkout_items),
        },
      },
    };

    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_quick_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(mockGhlPost).toHaveBeenCalledWith('/contacts/upsert', expect.objectContaining({
      email: 'client@example.com',
      locationId: 'loc_1',
    }));
    expect(insertedRows[0]).toEqual(expect.objectContaining({
      contact_id: 'contact_from_ghl',
      email: 'client@example.com',
      checkout_type: 'whop',
      processor_type: 'whop',
    }));
    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_quick_1',
      contactId: 'contact_from_ghl',
      contactEmail: 'client@example.com',
      processorType: 'whop',
    }));
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'contact_from_ghl',
      processor_transaction_id: 'pay_quick_1',
      processor_subscription_id: 'mem_quick_1',
      line_items: insertedEnrollment.selected_checkout_items,
    }));
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('records distinct partial refunds on one payment once each using the Whop refund id', async () => {
    const enrollment = {
      id: 'enr_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      processor_subscription_id: 'mem_123',
    };
    const insertedRefunds: any[] = [];
    const persistedRefundIds = new Set<string>();

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return queryBuilder(enrollment);
      if (table !== 'payment_events') return queryBuilder(null);

      const builder = queryBuilder(null);
      let transactionId = '';
      builder.eq = jest.fn((column: string, value: string) => {
        if (column === 'processor_transaction_id') transactionId = value;
        return builder;
      });
      builder.maybeSingle = jest.fn(async () => ({
        data: persistedRefundIds.has(transactionId) ? { id: `pe_${transactionId}` } : null,
        error: null,
      }));
      builder.insert = jest.fn(async (row: any) => {
        insertedRefunds.push(row);
        persistedRefundIds.add(row.processor_transaction_id);
        return { data: null, error: null };
      });
      return builder;
    });

    const refundPayload = (messageId: string, refundId: string, amount: number) => ({
      id: messageId,
      type: 'refund.created',
      company_id: 'biz_1',
      data: {
        id: refundId,
        amount,
        currency: 'usd',
        payment: {
          id: 'pay_original_1',
          metadata: { location_id: 'loc_1', enrollment_id: 'enr_1' },
        },
      },
    });
    const send = async (payload: any) => {
      const req: any = {
        rawBody: Buffer.from(JSON.stringify(payload)),
        body: payload,
        headers: { 'webhook-id': payload.id },
      };
      const res: any = {
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await handleWhopWebhook(req, res);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    };

    const firstRefund = refundPayload('msg_refund_1', 'rf_partial_1', 2.5);
    await send(firstRefund);
    await send(refundPayload('msg_refund_2', 'rf_partial_2', 1.25));
    await send(firstRefund);

    expect(insertedRefunds).toHaveLength(2);
    expect(insertedRefunds.map((row) => row.processor_transaction_id)).toEqual([
      'rf_partial_1',
      'rf_partial_2',
    ]);
    expect(insertedRefunds.map((row) => row.raw_webhook_payload.original_processor_transaction_id)).toEqual([
      'pay_original_1',
      'pay_original_1',
    ]);
    expect(mockNotifyRefundProcessed).toHaveBeenCalledTimes(2);
    expect(mockNotifyRefundProcessed).toHaveBeenNthCalledWith(
      1,
      'loc_1',
      'contact_1',
      expect.objectContaining({ transactionId: 'rf_partial_1', amount: 2.5 }),
    );
    expect(mockNotifyRefundProcessed).toHaveBeenNthCalledWith(
      2,
      'loc_1',
      'contact_1',
      expect.objectContaining({ transactionId: 'rf_partial_2', amount: 1.25 }),
    );
  });
});
