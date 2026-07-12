import {
  requireGhlWebhookSignature,
  verifyGhlWebhookRequest,
} from '../../src/middleware/ghlWebhookSignature';

function createReq(headers: Record<string, string> = {}, body: Record<string, unknown> = { type: 'OrderCompleted' }) {
  return {
    headers,
    body,
    path: '/webhooks/ghl/payment',
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
  } as any;
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
}

describe('GHL webhook signature middleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowUnsigned = process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS;
  const originalTriggerSecret = process.env.GHL_TRIGGER_SUBSCRIPTION_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalAllowUnsigned === undefined) {
      delete process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS;
    } else {
      process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS = originalAllowUnsigned;
    }

    if (originalTriggerSecret === undefined) {
      delete process.env.GHL_TRIGGER_SUBSCRIPTION_SECRET;
    } else {
      process.env.GHL_TRIGGER_SUBSCRIPTION_SECRET = originalTriggerSecret;
    }
  });

  it('reports missing signatures as invalid', () => {
    expect(verifyGhlWebhookRequest(createReq())).toMatchObject({
      ok: false,
      reason: 'Missing GHL webhook signature',
    });
  });

  it('rejects unsigned official GHL webhooks in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS;
    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
  });

  it('allows unsigned webhooks only with explicit override', () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS = 'true';
    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('ignores the unsigned webhook override in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS = 'true';
    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects unsigned GHL trigger subscription lifecycle callbacks without the configured secret', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS;
    delete process.env.GHL_TRIGGER_SUBSCRIPTION_SECRET;
    const req = createReq(
      {},
      {
        triggerData: {
          name: 'ScaleSafe App Event',
          eventType: 'CREATED',
          targetUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_123/workflow_123',
        },
        extras: { locationId: 'loc_123' },
      },
    );
    req.path = '/ghl/triggers';
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts an unsigned trigger subscription callback with the dedicated shared secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.GHL_TRIGGER_SUBSCRIPTION_SECRET = 'trigger-secret-value';
    const req = createReq(
      { 'x-scalesafe-trigger-secret': 'trigger-secret-value' },
      {
        triggerData: {
          name: 'ScaleSafe App Event',
          eventType: 'CREATED',
          targetUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_123/workflow_123',
        },
        extras: { locationId: 'loc_123' },
      },
    );
    req.path = '/ghl/triggers';
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects malformed signatures even outside production', () => {
    process.env.NODE_ENV = 'test';
    const req = createReq({ 'x-ghl-signature': 'not-valid-base64' });
    const res = createRes();
    const next = jest.fn();

    requireGhlWebhookSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
