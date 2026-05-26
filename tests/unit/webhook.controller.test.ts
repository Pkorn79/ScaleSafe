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

jest.mock('../../src/services/notification.service', () => ({
  notificationService: { firePaymentFailed: jest.fn() },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

import { webhookController } from '../../src/controllers/webhook.controller';

function mockReqRes(body: Record<string, unknown>) {
  const req = { body, ip: '127.0.0.1', headers: {} } as any;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
  const next = jest.fn();
  return { req, res, next };
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

    expect(mockEnrollmentFindByConsentToken).toHaveBeenCalledWith('tok_abc');
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

describe('Webhook Controller - ghlUnified', () => {
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
  test('uses stable event id for identical payloads', async () => {
    const { evidenceService } = await import('../../src/services/evidence.service');
    (evidenceService.handleExternalEvent as jest.Mock).mockResolvedValue('external_session');

    const body = {
      source: 'calendly',
      event_type: 'session_completed',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      data: { session_date: '2026-04-30', duration: 60, topics: ['A', 'B'] },
    };
    const first = mockReqRes(body);
    const second = mockReqRes({ ...body, data: { duration: 60, topics: ['A', 'B'], session_date: '2026-04-30' } });

    await webhookController.external(first.req, first.res, first.next);
    await webhookController.external(second.req, second.res, second.next);

    const firstEventId = mockIdempotencyIsDuplicate.mock.calls[0][0];
    const secondEventId = mockIdempotencyIsDuplicate.mock.calls[1][0];
    expect(firstEventId).toBe(secondEventId);
    expect(firstEventId).toMatch(/^ext_calendly_session_completed_contact_1_[a-f0-9]{24}$/);
    expect(evidenceService.handleExternalEvent).toHaveBeenCalledTimes(2);
  });

  test('returns duplicate when stable external event id has already been seen', async () => {
    mockIdempotencyIsDuplicate.mockResolvedValue(true);

    const { req, res, next } = mockReqRes({
      source: 'zoom',
      event_type: 'session_completed',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      data: { session_date: '2026-04-30' },
    });

    await webhookController.external(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'duplicate',
      eventId: expect.stringMatching(/^ext_zoom_session_completed_contact_1_[a-f0-9]{24}$/),
    });
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
});
