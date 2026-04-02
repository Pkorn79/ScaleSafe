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

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    isDuplicate: jest.fn().mockResolvedValue(false),
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
  mockPaymentEventFindByTxn.mockResolvedValue(null);
  mockPaymentEventCreate.mockResolvedValue({ id: 'pe_1' });
  mockOfferListByLocation.mockResolvedValue([]);
  mockCompleteEnrollment.mockResolvedValue(undefined);
  mockHandleRecurring.mockResolvedValue(undefined);
  mockHandleFailed.mockResolvedValue(undefined);
  mockHandleRefund.mockResolvedValue(undefined);
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
