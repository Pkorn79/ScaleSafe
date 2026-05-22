import crypto from 'crypto';

const mockSupabaseFrom = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockHandleRecurringPaymentSuccess = jest.fn();
const mockHandleRecurringPaymentFailure = jest.fn();
const mockDiagnosticCreate = jest.fn();
const mockDiagnosticUpdate = jest.fn();
const mockDecryptNmiWebhookSecret = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

jest.mock('../../src/services/processor.factory', () => ({
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

jest.mock('../../src/services/recurring-payment.service', () => ({
  handleRecurringPaymentSuccess: (...args: any[]) => mockHandleRecurringPaymentSuccess(...args),
  handleRecurringPaymentFailure: (...args: any[]) => mockHandleRecurringPaymentFailure(...args),
}));

jest.mock('../../src/services/nmi-diagnostic-log.service', () => ({
  nmiDiagnosticLogService: {
    create: (...args: any[]) => mockDiagnosticCreate(...args),
    update: (...args: any[]) => mockDiagnosticUpdate(...args),
  },
}));

jest.mock('../../src/services/processor-config.service', () => ({
  processorConfigService: {
    decryptNmiWebhookSecret: (...args: any[]) => mockDecryptNmiWebhookSecret(...args),
  },
}));

import {
  handleNmiWebhookEvent,
  processNmiOfficialWebhookRequest,
} from '../../src/controllers/nmi-webhook-events.controller';

const SECRET = 'webhook_secret';

const processorConfig = {
  id: 'config_1',
  merchant_id: 'merch_1',
  location_id: 'loc_1',
  processor_type: 'nmi',
  nmi_processor_id: null,
  nmi_security_key_encrypted: 'encrypted',
  nmi_webhook_secret_encrypted: 'encrypted_secret',
};

const enrollment = {
  id: '11111111-1111-4111-8111-111111111111',
  merchant_id: 'merch_1',
  location_id: 'loc_1',
  contact_id: 'contact_1',
  offer_id: 'offer_1',
  payments_made: 1,
  payments_total: 3,
  payment_type: 'installment',
  processor_subscription_id: 'sub_1',
  processor_type: 'nmi',
  billing_completed_at: null,
};

function queryBuilder(data: any, opts: { maybeData?: any; thenData?: any } = {}) {
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: opts.maybeData ?? data, error: null }),
    then: (resolve: any, reject: any) => Promise.resolve({ data: opts.thenData ?? data, error: null }).then(resolve, reject),
  };
  return builder;
}

function makeReqRes(payload: any, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const req = {
    params: { processorConfigId: 'config_1' },
    body: payload,
    rawBody: raw,
    get: jest.fn((name: string) => (name.toLowerCase() === 'signature' ? signature : undefined)),
  } as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return { req, res };
}

function makeReqResBase64Url(payload: any, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64url');
  const req = {
    params: { processorConfigId: 'config_1' },
    body: payload,
    rawBody: raw,
    get: jest.fn((name: string) => (name.toLowerCase() === 'signature' ? signature : undefined)),
  } as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return { req, res };
}

describe('NMI official webhook events', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockDecryptNmiWebhookSecret.mockReturnValue(SECRET);
    mockDiagnosticCreate.mockResolvedValue('log_1');
    mockDiagnosticUpdate.mockResolvedValue(undefined);
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'settled' }),
    });
    mockHandleRecurringPaymentSuccess.mockResolvedValue({ paymentEventId: 'pe_1', isFinal: false, newPaymentsMade: 2 });
    mockHandleRecurringPaymentFailure.mockResolvedValue({ paymentEventId: 'pe_fail' });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'processor_configs') return queryBuilder(processorConfig);
      if (table === 'nmi_silent_post_logs') return queryBuilder(null);
      if (table === 'enrollments') return queryBuilder(enrollment);
      if (table === 'payment_events') return queryBuilder(null);
      if (table === 'offers_mirror') return queryBuilder({ offer_name: 'Beta Tester 2', installment_frequency: 'daily' });
      return queryBuilder(null);
    });
  });

  it('verifies signed recurring sale events and records a live recurring payment', async () => {
    const { req, res } = makeReqRes({
      event_id: 'evt_1',
      event_type: 'transaction.sale.success',
      event_body: {
        transaction_id: '12089230192',
        subscription_id: 'sub_1',
        action: { source: 'recurring', amount: '0.33', response_code: '1' },
        merchant_defined_fields: { enrollment_id: enrollment.id },
      },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: enrollment.id }),
      processorType: 'nmi',
      transactionId: '12089230192',
      amountCents: 33,
      source: 'nmi_webhook_event',
    }));
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('log_1', expect.objectContaining({
      action: 'processed_success',
      payment_event_id: 'pe_1',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accepts NMI base64-url signatures', async () => {
    const { req, res } = makeReqResBase64Url({
      event_id: 'evt_base64url',
      event_type: 'transaction.sale.success',
      event_body: {
        transaction_id: '12089230193',
        subscription_id: 'sub_1',
        action: { source: 'recurring', amount: '0.33', response_code: '1' },
      },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: '12089230193',
      source: 'nmi_webhook_event',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses NMI transaction lookup metadata when a recurring sale webhook has no subscription id', async () => {
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({
        success: true,
        transactionId: '12090000001',
        status: 'settled',
        amount: 33,
        subscriptionId: 'sub_1',
        recurring: true,
        source: 'recurring',
        merchantDefinedFields: { merchant_defined_field_1: enrollment.id },
      }),
    });

    const { req, res } = makeReqRes({
      event_id: 'evt_no_sub',
      event_type: 'transaction.sale.success',
      event_body: {
        transaction_id: '12090000001',
        action: { amount: '0.33', response_code: '1' },
      },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: enrollment.id }),
      transactionId: '12090000001',
      amountCents: 33,
      source: 'nmi_webhook_event',
    }));
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('log_1', expect.objectContaining({
      processor_subscription_id: 'sub_1',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects invalid signatures before processing', async () => {
    const { req, res } = makeReqRes({
      event_id: 'evt_bad',
      event_type: 'transaction.sale.success',
      event_body: { transaction_id: 'txn_bad' },
    }, 'wrong_secret');

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      signature_verified: false,
      action: 'ignored_invalid_signature',
    }));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('logs invalid signed events even when no processor config is matched', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'processor_configs') return queryBuilder(null);
      return queryBuilder(null);
    });

    const { req, res } = makeReqRes({
      event_id: 'evt_bad_unmatched',
      event_type: 'transaction.sale.success',
      event_body: { transaction_id: 'txn_bad_unmatched' },
    }, 'wrong_secret');

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt_bad_unmatched',
      signature_verified: false,
      action: 'ignored_invalid_signature',
    }));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('deduplicates by NMI event_id', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'processor_configs') return queryBuilder(processorConfig);
      if (table === 'nmi_silent_post_logs') return queryBuilder({ id: 'existing_log', action: 'processed_success' });
      return queryBuilder(null);
    });

    const { req, res } = makeReqRes({
      event_id: 'evt_dupe',
      event_type: 'transaction.sale.success',
      event_body: { transaction_id: 'txn_dupe', action: { source: 'recurring', amount: '0.33' } },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
  });

  it('records failure events through the shared dunning path', async () => {
    const { req, res } = makeReqRes({
      event_id: 'evt_fail',
      event_type: 'transaction.sale.failure',
      event_body: {
        transaction_id: 'txn_fail',
        subscription_id: 'sub_1',
        action: { source: 'recurring', amount: '0.33', response_code: '200', response_text: 'Declined' },
      },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockHandleRecurringPaymentFailure).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: 'txn_fail',
      amountCents: 33,
      errorMessage: 'Declined',
      source: 'nmi_webhook_event',
    }));
  });

  it('does not process successful sale events without a transaction id', async () => {
    const { req, res } = makeReqRes({
      event_id: 'evt_missing_txn',
      event_type: 'transaction.sale.success',
      event_body: {
        subscription_id: 'sub_1',
        action: { source: 'recurring', amount: '0.33', response_code: '1' },
      },
    });

    await handleNmiWebhookEvent(req, res);

    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('log_1', expect.objectContaining({
      action: 'ignored_missing_transaction_id',
      verification_status: 'failed',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('processes official events on the generic existing NMI webhook URL by matching the signature key', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'processor_configs') return queryBuilder(processorConfig, { thenData: [processorConfig] });
      if (table === 'nmi_silent_post_logs') return queryBuilder(null);
      if (table === 'enrollments') return queryBuilder(enrollment);
      if (table === 'payment_events') return queryBuilder(null);
      if (table === 'offers_mirror') return queryBuilder({ offer_name: 'Beta Tester 2', installment_frequency: 'daily' });
      return queryBuilder(null);
    });

    const { req, res } = makeReqRes({
      event_id: 'evt_generic',
      event_type: 'transaction.sale.success',
      event_body: {
        transaction_id: '12090000000',
        subscription_id: 'sub_1',
        action: { source: 'recurring', amount: '0.33', response_code: '1' },
      },
    });
    req.params = {};

    await processNmiOfficialWebhookRequest(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: '12090000000',
      source: 'nmi_webhook_event',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('logs official events that cannot be matched to a processor config', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'processor_configs') return queryBuilder(null, { thenData: [] });
      if (table === 'enrollments') return queryBuilder(null);
      return queryBuilder(null);
    });

    const { req, res } = makeReqRes({
      event_id: 'evt_unmatched_config',
      event_type: 'transaction.sale.success',
      event_body: {
        transaction_id: 'txn_unmatched_config',
        subscription_id: 'missing_sub',
        action: { source: 'recurring', amount: '0.33', response_code: '1' },
      },
    });
    req.params = {};
    req.get = jest.fn(() => undefined);

    await processNmiOfficialWebhookRequest(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt_unmatched_config',
      action: 'ignored_unmatched_processor_config',
      matched: false,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true, matched: false });
  });
});
