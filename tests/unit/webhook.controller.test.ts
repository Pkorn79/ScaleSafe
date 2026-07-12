const mockPaymentEventFindByTxn = jest.fn();
const mockPaymentEventCreate = jest.fn();
const mockEnrollmentFindByConsentToken = jest.fn();
const mockEnrollmentFindByContactAndOffer = jest.fn();
const mockOfferListByLocation = jest.fn();
const mockCompleteEnrollment = jest.fn();
const mockHandleRecurring = jest.fn();
const mockHandleFailed = jest.fn();
const mockHandleRefund = jest.fn();
const mockSupabaseFrom = jest.fn();
const mockIdempotencyIsDuplicate = jest.fn().mockResolvedValue(false);
const mockGhlActivityHandleWebhook = jest.fn();
const mockTriggerUpsertSubscription = jest.fn();
const mockTriggerDeactivateSubscription = jest.fn();
const mockEnsureLegacyConnection = jest.fn();
const mockIngestLegacyEvidence = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    isDuplicate: (...args: any[]) => mockIdempotencyIsDuplicate(...args),
  },
}));

jest.mock('../../src/repositories/paymentEvent.repository', () => ({
  paymentEventRepository: {
    findByTransactionId: (...args: any[]) => mockPaymentEventFindByTxn(...args),
    create: (...args: any[]) => mockPaymentEventCreate(...args),
  },
}));

jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: {
    findByConsentToken: (...args: any[]) => mockEnrollmentFindByConsentToken(...args),
    findByContactAndOffer: (...args: any[]) => mockEnrollmentFindByContactAndOffer(...args),
  },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    listByLocation: (...args: any[]) => mockOfferListByLocation(...args),
  },
}));

jest.mock('../../src/repositories/trigger.repository', () => ({
  triggerRepository: {
    upsertSubscription: (...args: any[]) => mockTriggerUpsertSubscription(...args),
    deactivateSubscription: (...args: any[]) => mockTriggerDeactivateSubscription(...args),
  },
}));

const mockMerchantFindByLocationId = jest.fn();
const mockMerchantCreate = jest.fn();
const mockMerchantUpdate = jest.fn();
const mockAdoptCompanyAuthorization = jest.fn();
const mockProvisionMerchant = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantHasOAuthCredentials: (merchant: any) => Boolean(
    merchant?.ghl_access_token_encrypted || merchant?.ghl_access_token,
  ),
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockMerchantFindByLocationId(...args),
    create: (...args: any[]) => mockMerchantCreate(...args),
    update: (...args: any[]) => mockMerchantUpdate(...args),
    adoptCompanyAuthorization: (...args: any[]) => mockAdoptCompanyAuthorization(...args),
  },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    provisionMerchant: (...args: any[]) => mockProvisionMerchant(...args),
  },
}));

jest.mock('../../src/services/phase2Enrollment.service', () => ({
  phase2EnrollmentService: {
    completeEnrollment: (...args: any[]) => mockCompleteEnrollment(...args),
    handleRecurringPayment: (...args: any[]) => mockHandleRecurring(...args),
    handleFailedPayment: (...args: any[]) => mockHandleFailed(...args),
    handleRefund: (...args: any[]) => mockHandleRefund(...args),
  },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: {
    handleFormSubmission: jest.fn(),
    handleExternalEvent: jest.fn(),
    logEvidence: jest.fn(),
  },
}));

jest.mock('../../src/services/ghl-activity.service', () => ({
  ghlActivityService: {
    handleWebhook: (...args: any[]) => mockGhlActivityHandleWebhook(...args),
  },
}));

jest.mock('../../src/services/evidence-connection.service', () => ({
  evidenceConnectionService: {
    ensureLegacy: (...args: any[]) => mockEnsureLegacyConnection(...args),
  },
}));

jest.mock('../../src/services/evidence-connector.service', () => ({
  evidenceConnectorService: {
    ingestLegacy: (...args: any[]) => mockIngestLegacyEvidence(...args),
  },
}));

jest.mock('../../src/services/notification.service', () => ({
  notificationService: { firePaymentFailed: jest.fn() },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

import { webhookController } from '../../src/controllers/webhook.controller';

function mockReqRes(body: Record<string, unknown>) {
  const locationId = String((body as any).location_id || (body as any).locationId || '');
  const req = {
    body,
    ip: '127.0.0.1',
    headers: {},
    tenantContext: locationId ? { locationId, companyId: '', userId: '', email: '', role: 'user' } : undefined,
  } as any;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
  const next = jest.fn();
  return { req, res, next };
}

function makeEnrollmentListBuilder(data: any[]) {
  const builder: any = {
    filters: [] as Array<{ column: string; value: any }>,
    select: jest.fn(() => builder),
    eq: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    in: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(async () => ({ data, error: null })),
  };
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdempotencyIsDuplicate.mockResolvedValue(false);
  mockPaymentEventFindByTxn.mockResolvedValue(null);
  mockPaymentEventCreate.mockResolvedValue({ id: 'pe_1' });
  mockOfferListByLocation.mockResolvedValue([]);
  mockCompleteEnrollment.mockResolvedValue(undefined);
  mockHandleRecurring.mockResolvedValue(undefined);
  mockHandleFailed.mockResolvedValue(undefined);
  mockHandleRefund.mockResolvedValue(undefined);
  mockTriggerUpsertSubscription.mockResolvedValue({});
  mockTriggerDeactivateSubscription.mockResolvedValue(undefined);
  mockAdoptCompanyAuthorization.mockResolvedValue(null);
  mockProvisionMerchant.mockResolvedValue({ status: 'installed' });
  mockGhlActivityHandleWebhook.mockResolvedValue({
    status: 'matched',
    eventType: 'AppointmentCreate',
    sourceObject: 'appointment',
    actionTaken: 'appointment_evidence_created',
  });
  // Default: enrollment queries return no match via supabase
  mockSupabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                single: () => ({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
          }),
        }),
      }),
    }),
  });
});

describe('Webhook Controller - ghlPayment', () => {
  test('OrderCompleted with consent_token matches enrollment', async () => {
    mockEnrollmentFindByConsentToken.mockResolvedValue({
      id: 'enr_1',
      offer_id: 'offer_1',
      status: 'consent_captured',
    });

    const { req, res, next } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      orderId: 'ord_1',
      amount: 2997,
      items: [{ productId: 'prod_1', amount: 2997 }],
      metadata: { consent_token: 'tok_abc' },
    });

    await webhookController.ghlPayment(req, res, next);

    expect(mockEnrollmentFindByConsentToken).toHaveBeenCalledWith('tok_abc', 'loc_1');
    expect(mockCompleteEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: 'enr_1',
        paymentAmount: 2997,
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderCompleted' });
  });

  test('OrderCompleted without match logs unlinked payment event', async () => {
    mockEnrollmentFindByConsentToken.mockResolvedValue(null);
    mockEnrollmentFindByContactAndOffer.mockResolvedValue(null);

    const { req, res } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      orderId: 'ord_2',
      amount: 100,
      items: [],
      metadata: {},
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'payment_success',
        processor: 'ghl',
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderCompleted' });
  });

  test('OrderCompleted product match completes only when exactly one enrollment matches', async () => {
    mockEnrollmentFindByConsentToken.mockResolvedValue(null);
    mockOfferListByLocation.mockResolvedValue([{ id: 'offer_1', ghl_product_id: 'prod_1' }]);
    const enrollmentBuilder = makeEnrollmentListBuilder([{
      id: 'enr_product_1',
      offer_id: 'offer_1',
      status: 'consent_captured',
      payments_made: 0,
      payments_total: 1,
    }]);
    mockSupabaseFrom.mockReturnValue(enrollmentBuilder);

    const { req, res } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      orderId: 'ord_product_1',
      amount: 100,
      items: [{ productId: 'prod_1', amount: 100 }],
      metadata: {},
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
      { column: 'offer_id', value: 'offer_1' },
      { column: 'status', value: ['consent_captured', 'paid_pending_enrollment'] },
    ]));
    expect(mockEnrollmentFindByContactAndOffer).not.toHaveBeenCalled();
    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_product_1',
      paymentAmount: 100,
    }));
    expect(mockPaymentEventCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderCompleted' });
  });

  test('OrderCompleted ambiguous product match stays client-level', async () => {
    mockEnrollmentFindByConsentToken.mockResolvedValue(null);
    mockOfferListByLocation.mockResolvedValue([{ id: 'offer_1', ghl_product_id: 'prod_1' }]);
    mockSupabaseFrom.mockReturnValue(makeEnrollmentListBuilder([
      { id: 'enr_product_1', offer_id: 'offer_1', status: 'consent_captured' },
      { id: 'enr_product_2', offer_id: 'offer_1', status: 'consent_captured' },
    ]));

    const { req, res } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      orderId: 'ord_product_ambiguous',
      amount: 100,
      items: [{ productId: 'prod_1', amount: 100 }],
      metadata: {},
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(mockEnrollmentFindByContactAndOffer).not.toHaveBeenCalled();
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
    expect(mockPaymentEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'contact_1',
      event_type: 'payment_success',
      processor: 'ghl',
      processor_transaction_id: 'ord_product_ambiguous',
    }));
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderCompleted' });
  });

  test('duplicate transaction is skipped', async () => {
    mockPaymentEventFindByTxn.mockResolvedValue({ id: 'pe_existing' });

    const { req, res } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      transactionId: 'txn_dup',
      amount: 100,
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ status: 'duplicate', transactionId: 'txn_dup' });
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
  });

  test('SubscriptionPaymentFailed fires ss_payment_failed trigger', async () => {
    const { req, res } = mockReqRes({
      type: 'SubscriptionPaymentFailed',
      locationId: 'loc_1',
      contactId: 'contact_1',
      amount: 500,
      failureReason: 'card_declined',
      attemptCount: 2,
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(mockHandleFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'card_declined',
        attemptCount: 2,
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'SubscriptionPaymentFailed' });
  });

  test('OrderRefunded handles refund', async () => {
    const { req, res } = mockReqRes({
      type: 'OrderRefunded',
      locationId: 'loc_1',
      contactId: 'contact_1',
      amount: 2997,
      reason: 'customer_request',
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(mockHandleRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2997,
        reason: 'customer_request',
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderRefunded' });
  });

  test('always returns 200 even on internal error', async () => {
    mockPaymentEventFindByTxn.mockRejectedValue(new Error('DB down'));

    const { req, res } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      transactionId: 'txn_err',
      amount: 100,
    });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ status: 'ok', error: 'internal' });
  });

  test('missing type returns ok with skipped', async () => {
    const { req, res } = mockReqRes({ locationId: 'loc_1' });

    await webhookController.ghlPayment(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ status: 'ok', skipped: true });
  });
});

describe('Webhook Controller - GHL app lifecycle (INSTALL/UNINSTALL)', () => {
  test('per-location INSTALL creates a merchant stub when none exists', async () => {
    mockMerchantFindByLocationId.mockResolvedValue(null);
    mockMerchantCreate.mockResolvedValue({});
    const { req, res, next } = mockReqRes({
      type: 'INSTALL',
      appId: 'app_1',
      installType: 'Location',
      locationId: 'loc_new',
      companyId: 'comp_1',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockMerchantCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc_new',
        company_id: 'comp_1',
        ghl_access_token: '',
        ghl_refresh_token: '',
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('future-location INSTALL adopts a same-company agency authorization and provisions', async () => {
    mockMerchantFindByLocationId.mockResolvedValue(null);
    mockMerchantCreate.mockResolvedValue({});
    mockAdoptCompanyAuthorization.mockResolvedValue({
      location_id: 'loc_future',
      company_id: 'comp_1',
      snapshot_status: 'pending',
      ghl_access_token_encrypted: 'access',
      ghl_refresh_token_encrypted: 'refresh',
      config: { ghl_token_scope: 'company' },
    });
    const { req, res, next } = mockReqRes({
      type: 'INSTALL', locationId: 'loc_future', companyId: 'comp_1',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockAdoptCompanyAuthorization).toHaveBeenCalledWith('loc_future', 'comp_1');
    expect(mockProvisionMerchant).toHaveBeenCalledWith('loc_future');
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('per-location INSTALL reactivates an existing merchant without reusing stale credentials', async () => {
    mockMerchantFindByLocationId.mockResolvedValue({
      location_id: 'loc_new',
      company_id: 'comp_1',
      status: 'uninstalled',
      ghl_access_token_encrypted: 'stale-access',
      ghl_refresh_token_encrypted: 'stale-refresh',
      config: { ghl_token_scope: 'location', ghl_token_location_id: 'loc_new' },
    });
    mockMerchantUpdate.mockResolvedValue({ location_id: 'loc_new', company_id: 'comp_1', status: 'active' });
    const { req, res, next } = mockReqRes({
      type: 'INSTALL',
      locationId: 'loc_new',
      companyId: 'comp_1',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockMerchantCreate).not.toHaveBeenCalled();
    expect(mockMerchantUpdate).toHaveBeenCalledWith('loc_new', expect.objectContaining({
      status: 'active',
      ghl_access_token_encrypted: null,
      ghl_refresh_token_encrypted: null,
      config: expect.objectContaining({
        ghl_token_scope: null,
        location_access_token_encrypted: null,
      }),
    }));
    expect(mockAdoptCompanyAuthorization).toHaveBeenCalledWith('loc_new', 'comp_1');
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('company-level INSTALL (no locationId) is acknowledged without creating rows', async () => {
    const { req, res, next } = mockReqRes({
      type: 'INSTALL',
      installType: 'Company',
      companyId: 'comp_1',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockMerchantCreate).not.toHaveBeenCalled();
    expect(mockMerchantUpdate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('UNINSTALL marks the merchant uninstalled', async () => {
    mockMerchantFindByLocationId.mockResolvedValue({
      location_id: 'loc_gone',
      status: 'active',
      config: { ghl_token_scope: 'location' },
    });
    mockMerchantUpdate.mockResolvedValue({});
    const { req, res, next } = mockReqRes({
      type: 'UNINSTALL',
      locationId: 'loc_gone',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockMerchantUpdate).toHaveBeenCalledWith('loc_gone', expect.objectContaining({
      status: 'uninstalled',
      ghl_access_token_encrypted: null,
      ghl_refresh_token_encrypted: null,
      config: expect.objectContaining({ ghl_token_scope: null }),
    }));
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  test('a DB failure returns retryable 503 instead of losing the install event', async () => {
    mockMerchantFindByLocationId.mockResolvedValue(null);
    mockMerchantCreate.mockRejectedValue(new Error('db down'));
    const { req, res, next } = mockReqRes({
      type: 'INSTALL',
      locationId: 'loc_new',
      companyId: 'comp_1',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ received: false, retry: true });
  });
});

describe('Webhook Controller - ghlUnified', () => {
  test('routes trigger subscription callbacks from the default GHL webhook URL', async () => {
    const { req, res, next } = mockReqRes({
      triggerData: {
        name: 'ScaleSafe App Event',
        eventType: 'CREATED',
        subscriptionUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/274dtgl30b7x2HG8hn69/workflow_123',
      },
      extras: { locationId: '274dtgl30b7x2HG8hn69' },
    });

    await webhookController.ghlUnified(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTriggerUpsertSubscription).toHaveBeenCalledWith(
      '274dtgl30b7x2HG8hn69',
      'ss_app_event',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/274dtgl30b7x2HG8hn69/workflow_123',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('routes Chargeback Detected subscription callbacks with top-level url from the default GHL webhook URL', async () => {
    const { req, res, next } = mockReqRes({
      eventType: 'created',
      locationId: 'loc_chargeback',
      triggerData: {
        key: 'ChargebackDetected',
      },
      url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_chargeback/workflow_chargeback',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTriggerUpsertSubscription).toHaveBeenCalledWith(
      'loc_chargeback',
      'ss_chargeback_detected',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_chargeback/workflow_chargeback',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('routes appointment events from the default GHL webhook URL to activity processing', async () => {
    const body = {
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      appointment: {
        id: 'appt_1',
        contactId: 'contact_1',
        calendarId: 'cal_1',
      },
    };
    const { req, res, next } = mockReqRes(body);

    await webhookController.ghlUnified(req, res, next);

    expect(mockGhlActivityHandleWebhook).toHaveBeenCalledWith(body);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      status: 'matched',
      eventType: 'AppointmentCreate',
      sourceObject: 'appointment',
      actionTaken: 'appointment_evidence_created',
    });
  });

  test('routes payment events from the default GHL webhook URL to payment processing', async () => {
    mockEnrollmentFindByConsentToken.mockResolvedValue({
      id: 'enr_1',
      offer_id: 'offer_1',
      status: 'consent_captured',
    });

    const { req, res, next } = mockReqRes({
      type: 'OrderCompleted',
      locationId: 'loc_1',
      contactId: 'contact_1',
      orderId: 'ord_1',
      amount: 100,
      metadata: { consent_token: 'tok_abc' },
    });

    await webhookController.ghlUnified(req, res, next);

    expect(mockCompleteEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_1',
      paymentAmount: 100,
    }));
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', type: 'OrderCompleted' });
  });

  test('acknowledges unsupported default GHL webhook events without failing delivery', async () => {
    const { req, res, next } = mockReqRes({
      type: 'ContactUpdate',
      locationId: 'loc_1',
      contactId: 'contact_1',
      email: 'test@example.com',
    });

    await webhookController.ghlUnified(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockGhlActivityHandleWebhook).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', skipped: true, type: 'ContactUpdate' });
  });
});

describe('Webhook Controller - external', () => {
  test('routes authenticated legacy payloads through the durable connector ledger', async () => {
    const body = {
      source: 'calendly',
      event_type: 'session_completed',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      data: { session_date: '2026-04-30', duration: 60, topics: ['A', 'B'] },
    };
    const connection = { id: 'conn_1', location_id: 'loc_1', merchant_id: 'merchant_1' };
    mockEnsureLegacyConnection.mockResolvedValue(connection);
    mockIngestLegacyEvidence.mockResolvedValue({ duplicate: false, processingStatus: 'accepted', event: { id: 'event_1' } });
    const { req, res, next } = mockReqRes(body);

    await webhookController.external(req, res, next);

    expect(mockEnsureLegacyConnection).toHaveBeenCalledWith('loc_1', 'calendly');
    expect(mockIngestLegacyEvidence).toHaveBeenCalledWith(expect.objectContaining({ connection, payload: body }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ status: 'accepted', eventId: 'event_1' });
    expect(next).not.toHaveBeenCalled();
  });

  test('acknowledges duplicate ledger events without republishing evidence', async () => {
    const connection = { id: 'conn_1', location_id: 'loc_1', merchant_id: 'merchant_1' };
    mockEnsureLegacyConnection.mockResolvedValue(connection);
    mockIngestLegacyEvidence.mockResolvedValue({ duplicate: true, processingStatus: 'duplicate', event: { id: 'event_1' } });
    const { req, res, next } = mockReqRes({
      source: 'zoom',
      event_type: 'session_completed',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      data: { session_date: '2026-04-30' },
    });

    await webhookController.external(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'duplicate', eventId: 'event_1' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Webhook Controller - ghlCourseActivity', () => {
  test('maps GHL lesson completed workflow payload to module completion evidence', async () => {
    const { evidenceService } = await import('../../src/services/evidence.service');
    (evidenceService.handleExternalEvent as jest.Mock).mockResolvedValue('module_completion');

    const { req, res, next } = mockReqRes({
      locationId: 'loc_1',
      contactId: 'contact_1',
      eventType: 'Lesson Completed',
      courseName: 'Launch Course',
      lessonName: 'Module 1',
      occurredAt: '2026-06-01T15:00:00.000Z',
    });

    await webhookController.ghlCourseActivity(req, res, next);

    expect(mockIdempotencyIsDuplicate).toHaveBeenCalledWith(
      expect.stringMatching(/^ext_ghl_course_Lesson Completed_contact_1_[a-f0-9]{24}$/),
      'ghl_course',
      'loc_1',
    );
    expect(evidenceService.handleExternalEvent).toHaveBeenCalledWith(
      'module_completed',
      'loc_1',
      'contact_1',
      'ghl_course',
      expect.objectContaining({
        course_name: 'Launch Course',
        lesson_name: 'Module 1',
        module_name: 'Module 1',
        completion_date: '2026-06-01T15:00:00.000Z',
        progress_pct: 100,
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      rawEventType: 'Lesson Completed',
      evidenceType: 'module_completion',
    }));
  });

  test('rejects a course payload whose location differs from the authenticated tenant', async () => {
    const { req, res, next } = mockReqRes({
      locationId: 'loc_payload',
      contactId: 'contact_1',
      eventType: 'Lesson Completed',
    });
    req.tenantContext.locationId = 'loc_authenticated';

    await webhookController.ghlCourseActivity(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Webhook tenant does not match payload location',
    }));
    const { evidenceService } = await import('../../src/services/evidence.service');
    expect(evidenceService.handleExternalEvent).not.toHaveBeenCalled();
  });
});
