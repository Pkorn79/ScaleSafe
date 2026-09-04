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
const mockFinalizeWhopManualSale = jest.fn();

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

jest.mock('../../src/services/pay-first-enrollment.service', () => ({
  payFirstEnrollmentService: {
    finalizeWhopManualSale: (...args: any[]) => mockFinalizeWhopManualSale(...args),
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
    mockFinalizeWhopManualSale.mockResolvedValue({ success: true, status: 'paid_pending_enrollment' });
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
          payment_choice: 'pif',
          future_recurring_amount: 0,
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
      payment_type: 'pif',
      payments_total: null,
    }));
    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_quick_1',
      contactId: 'contact_from_ghl',
      contactEmail: 'client@example.com',
      processorType: 'whop',
      paymentType: 'pif',
      paymentsTotal: null,
    }));
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'contact_from_ghl',
      processor_transaction_id: 'pay_quick_1',
      processor_subscription_id: 'mem_quick_1',
      line_items: insertedEnrollment.selected_checkout_items,
    }));
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('keeps a Whop Quick Manual Sale paid pending until consent instead of completing enrollment', async () => {
    const enrollment = {
      id: 'enr_qms_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      status: 'payment_processing',
      payment_type: 'pif',
      payments_made: 0,
      payments_total: 1,
    };
    mockSupabaseFrom.mockImplementation((table: string) => (
      queryBuilder(table === 'enrollments' ? enrollment : null)
    ));

    const payload = {
      id: 'evt_qms_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_qms_1',
        amount: 1.5,
        membership_id: 'mem_qms_1',
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_qms_1',
          offer_id: 'offer_1',
          checkout_mode: 'quick_manual_sale',
          payment_choice: 'pif',
          send_enrollment: 'true',
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_qms_1' },
    };
    const res: any = { status: jest.fn(() => res), json: jest.fn() };

    await handleWhopWebhook(req, res);

    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: 'enr_qms_1',
      processor_transaction_id: 'pay_qms_1',
    }));
    expect(mockFinalizeWhopManualSale).toHaveBeenCalledWith({
      locationId: 'loc_1',
      enrollmentId: 'enr_qms_1',
      transactionId: 'pay_qms_1',
      amount: 1.5,
      paymentType: 'pif',
      sendEnrollment: true,
    });
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('keeps a full-enrollment PIF choice one-time when the offer also supports installments', async () => {
    const enrollment = {
      id: 'enr_pif_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      status: 'consent_captured',
      payment_type: 'pif',
      payments_made: 0,
      payments_total: null,
      selected_checkout_items: [
        { type: 'base_offer', label: 'Whop Installments', amount: 1.5 },
        { type: 'order_bump', label: 'Bump', amount: 1 },
      ],
    };
    const enrollmentUpdates: any[] = [];

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        const builder = queryBuilder(enrollment);
        builder.update = jest.fn((updates: any) => {
          enrollmentUpdates.push(updates);
          return builder;
        });
        return builder;
      }
      if (table === 'payment_events') return queryBuilder(null);
      return queryBuilder(null);
    });

    const payload = {
      id: 'evt_pif_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_pif_1',
        amount: 2.5,
        membership_id: 'mem_pif_1',
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_pif_1',
          offer_id: 'offer_1',
          checkout_mode: 'full_enrollment',
          payment_choice: 'pif',
          future_recurring_amount: 0,
          line_items: JSON.stringify(enrollment.selected_checkout_items),
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_pif_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_pif_1',
      paymentType: 'pif',
      paymentsTotal: null,
      paymentAmount: 2.5,
    }));
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: 'enr_pif_1',
      processor_transaction_id: 'pay_pif_1',
      processor_subscription_id: 'mem_pif_1',
      payments_total: null,
      payments_remaining: undefined,
      line_items: enrollment.selected_checkout_items,
    }));
    expect(enrollmentUpdates).toContainEqual(expect.objectContaining({
      payment_type: 'pif',
      payments_total: null,
      next_billing_date: null,
      billing_setup_status: 'ok',
      billing_completed_at: expect.any(String),
    }));
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('does not mistake a Whop payment id for a missing membership id', async () => {
    const enrollment = {
      id: 'enr_pif_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      status: 'consent_captured',
      payment_type: 'pif',
      payments_made: 0,
      payments_total: null,
    };
    const enrollmentUpdates: any[] = [];
    mockSupabaseFrom.mockImplementation((table: string) => {
      const builder = queryBuilder(table === 'enrollments' ? enrollment : null);
      if (table === 'enrollments') {
        builder.update = jest.fn((updates: any) => {
          enrollmentUpdates.push(updates);
          return builder;
        });
      }
      return builder;
    });

    const payload = {
      id: 'evt_pif_no_membership',
      type: 'payment.succeeded',
      data: {
        id: 'pay_without_membership',
        amount: 1.5,
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_pif_1',
          checkout_mode: 'full_enrollment',
          payment_choice: 'pif',
          future_recurring_amount: 0,
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_pif_no_membership' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(enrollmentUpdates[0]).toEqual(expect.objectContaining({
      whop_payment_id: 'pay_without_membership',
      whop_membership_id: null,
      processor_subscription_id: null,
    }));
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      processor_transaction_id: 'pay_without_membership',
      processor_subscription_id: null,
    }));
  });

  it('records an initial installment checkout with the selected payment count', async () => {
    const enrollment = {
      id: 'enr_inst_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      status: 'consent_captured',
      payment_type: 'installment',
      payments_made: 0,
      payments_total: 5,
    };
    mockSupabaseFrom.mockImplementation((table: string) => (
      queryBuilder(table === 'enrollments' ? enrollment : null)
    ));

    const payload = {
      id: 'evt_inst_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_inst_1',
        amount: 2.2,
        membership_id: 'mem_inst_1',
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_inst_1',
          offer_id: 'offer_1',
          checkout_mode: 'full_enrollment',
          payment_choice: 'installment',
          future_recurring_amount: 2.2,
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_inst_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_inst_1',
      paymentType: 'installment',
      paymentsTotal: 5,
      paymentAmount: 2.2,
    }));
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: 'enr_inst_1',
      payments_total: 5,
      payments_remaining: 4,
    }));
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
  });

  it('does not turn a one-time Whop access membership into recurring billing', async () => {
    const enrollment = {
      id: 'enr_pif_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      status: 'enrolled',
      payment_type: 'pif',
      next_billing_date: null,
      whop_membership_id: 'mem_pif_1',
    };
    const enrollmentUpdates: any[] = [];
    mockSupabaseFrom.mockImplementation((table: string) => {
      const builder = queryBuilder(table === 'enrollments' ? enrollment : null);
      if (table === 'enrollments') {
        builder.update = jest.fn((updates: any) => {
          enrollmentUpdates.push(updates);
          return builder;
        });
      }
      return builder;
    });

    const payload = {
      id: 'evt_member_active_1',
      type: 'membership.activated',
      data: {
        id: 'mem_pif_1',
        membership_id: 'mem_pif_1',
        renewal_period_end: '2026-08-13T00:00:00.000Z',
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_pif_1',
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_member_active_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(enrollmentUpdates).toHaveLength(1);
    expect(enrollmentUpdates[0]).toEqual(expect.objectContaining({
      whop_membership_id: 'mem_pif_1',
      processor_subscription_id: null,
      whop_reconciliation_status: 'membership_active',
    }));
    expect(enrollmentUpdates[0]).not.toHaveProperty('next_billing_date');
    expect(enrollmentUpdates[0]).not.toHaveProperty('status');
  });

  it('reconciles a duplicate PIF checkout without repeating enrollment or payment side effects', async () => {
    const enrollment = {
      id: 'enr_pif_1',
      merchant_id: 'merchant_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      status: 'enrolled',
      enrolled_at: '2026-07-13T12:00:00.000Z',
      payment_type: 'installment',
      payments_made: 1,
      payments_total: 5,
      next_billing_date: '2026-07-20',
      processor_subscription_id: 'mem_pif_1',
      whop_membership_id: 'mem_pif_1',
    };
    const existingSale = { id: 'pe_pif_1', event_type: 'sale', processor_transaction_id: 'pay_pif_1' };
    const enrollmentUpdates: any[] = [];

    mockIdempotencyExists.mockResolvedValue(true);
    mockPaymentEventFindByTransactionId.mockResolvedValue(existingSale);
    mockSupabaseFrom.mockImplementation((table: string) => {
      const builder = queryBuilder(table === 'enrollments' ? enrollment : existingSale);
      if (table === 'enrollments') {
        builder.update = jest.fn((updates: any) => {
          enrollmentUpdates.push(updates);
          return builder;
        });
      }
      return builder;
    });

    const payload = {
      id: 'evt_pif_1',
      type: 'payment.succeeded',
      data: {
        id: 'pay_pif_1',
        amount: 2.5,
        membership_id: 'mem_pif_1',
        metadata: {
          location_id: 'loc_1',
          enrollment_id: 'enr_pif_1',
          offer_id: 'offer_1',
          checkout_mode: 'full_enrollment',
          payment_choice: 'pif',
          future_recurring_amount: 0,
        },
      },
    };
    const req: any = {
      rawBody: Buffer.from(JSON.stringify(payload)),
      body: payload,
      headers: { 'webhook-id': 'evt_pif_1' },
    };
    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(),
    };

    await handleWhopWebhook(req, res);

    expect(enrollmentUpdates).toContainEqual(expect.objectContaining({
      payment_type: 'pif',
      payments_total: null,
      next_billing_date: null,
      billing_setup_status: 'ok',
    }));
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockPaymentEventCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
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
    const claimUpdates: any[] = [];

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return queryBuilder(enrollment);
      if (table === 'payment_refund_claims') {
        const builder = queryBuilder(null);
        let amountCents = 0;
        builder.eq = jest.fn((column: string, value: any) => {
          if (column === 'amount_cents') amountCents = Number(value);
          return builder;
        });
        builder.maybeSingle = jest.fn(async () => ({
          data: amountCents > 0 ? { id: `claim_${amountCents}` } : null,
          error: null,
        }));
        builder.update = jest.fn((row: any) => {
          claimUpdates.push(row);
          return builder;
        });
        return builder;
      }
      if (table !== 'payment_events') return queryBuilder(null);

      const builder = queryBuilder(null);
      let transactionId = '';
      let eventType = '';
      builder.eq = jest.fn((column: string, value: string) => {
        if (column === 'processor_transaction_id') transactionId = value;
        if (column === 'event_type') eventType = value;
        return builder;
      });
      builder.maybeSingle = jest.fn(async () => {
        if (transactionId === 'pay_original_1' && eventType !== 'refund') {
          return {
            data: {
              id: 'pe_original_1',
              merchant_id: 'merchant_1',
              contact_id: 'contact_1',
              enrollment_id: 'enr_1',
              offer_id: 'offer_1',
              processor_transaction_id: 'pay_original_1',
              processor_subscription_id: 'mem_123',
            },
            error: null,
          };
        }
        return {
          data: persistedRefundIds.has(transactionId) ? { id: `pe_${transactionId}` } : null,
          error: null,
        };
      });
      builder.insert = jest.fn((row: any) => {
        insertedRefunds.push(row);
        persistedRefundIds.add(row.processor_transaction_id);
        return queryBuilder({ id: `pe_${row.processor_transaction_id}` });
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
    expect(insertedRefunds.map((row) => row.raw_webhook_payload.original_payment_event_id)).toEqual([
      'pe_original_1',
      'pe_original_1',
    ]);
    expect(insertedRefunds.map((row) => row.raw_webhook_payload.refund_claim_id)).toEqual([
      'claim_250',
      'claim_125',
    ]);
    expect(claimUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'recorded',
        processor_refund_id: 'rf_partial_1',
        refund_payment_event_id: 'pe_rf_partial_1',
      }),
      expect.objectContaining({
        status: 'recorded',
        processor_refund_id: 'rf_partial_2',
        refund_payment_event_id: 'pe_rf_partial_2',
      }),
    ]));
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

describe('tenant resolution failure containment', () => {
  it('returns 500 instead of crashing the process when the config lookup throws', async () => {
    // Pre-fix, a rejected whopConfigService.get escaped the handler as an
    // unhandled promise rejection, killing the shared multi-tenant process.
    mockWhopConfigGet.mockRejectedValue(new Error('supabase timeout'));
    const payload = { type: 'payment.succeeded', data: { metadata: { location_id: 'loc_1' } } };
    const req: any = { rawBody: Buffer.from(JSON.stringify(payload)), body: payload, headers: {} };
    const res: any = { status: jest.fn(() => res), json: jest.fn() };

    await expect(handleWhopWebhook(req, res)).resolves.toBeUndefined();

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
