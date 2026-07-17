/**
 * Launch-critical test: payment-provider provisioning/repair controller.
 *
 * Covers the Settings-page NMI connect / test / disconnect / default-processor
 * flows in src/controllers/processor-config.controller.ts. A silent bug here
 * either leaks raw NMI credentials, mis-scopes a tenant, or lets a merchant set
 * a default processor they never connected.
 *
 * Invariants locked down:
 *  - createNmi: validates inputs, scopes the row by location_id/merchant_id, and
 *    NEVER persists the plaintext securityKey (it is encrypted before insert).
 *  - testNmi: forwards the NmiClient.testConnection() result for both success and
 *    failure, and never persists (one-shot client only).
 *  - disconnectNmi: deactivates active NMI configs for this merchant.
 *  - setDefaultProcessor: rejects anything other than 'nmi'/'stripe', refuses a
 *    processor that isn't connected, and writes merchants.default_processor.
 *
 * The real processorConfigService and the real field-encryption util run; only
 * the supabase client, the merchant repository, the NMI client, and tenant
 * resolution are mocked. This lets us assert the *actual* encrypted insert
 * payload instead of trusting a stubbed service.
 */

// Must be set before field-encryption runs. encrypt() reads it lazily per-call,
// so a top-level assignment is sufficient. 64 hex chars = 32 bytes.
process.env.PROCESSOR_ENCRYPTION_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

import { Request, Response } from 'express';
import { ValidationError } from '../../src/utils/errors';

// --- supabase client mock: a chainable builder we can inspect per-call ---
const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

// --- tenant resolution ---
let mockLocationId: string | null = 'loc-1';
jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: () => mockLocationId,
}));

// --- merchant repository ---
const mockGetByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockGetByLocationId(...args),
  },
}));

// --- NMI client: only testNmi instantiates one ---
const mockTestConnection = jest.fn();
const NmiClientCtor = jest.fn();
jest.mock('../../src/clients/nmi.client', () => ({
  NmiClient: class {
    constructor(cfg: any) {
      NmiClientCtor(cfg);
    }
    testConnection(...args: any[]) {
      return mockTestConnection(...args);
    }
  },
}));

import { processorConfigController } from '../../src/controllers/processor-config.controller';
import { decrypt } from '../../src/utils/field-encryption';

/**
 * Chainable Supabase query stub. Every builder method returns the same object,
 * which is awaitable and exposes .single()/.limit(). `result` is what the await
 * resolves to; `insertSpy`/`updateSpy` capture the payloads the controller path
 * actually writes.
 */
function query(result: { data: any; error?: any } = { data: null }) {
  const c: any = {};
  const res = { data: result.data, error: result.error ?? null };
  c.insert = jest.fn(() => c);
  c.update = jest.fn(() => c);
  c.upsert = jest.fn(() => c);
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.order = jest.fn(() => c);
  c.limit = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(res));
  c.maybeSingle = jest.fn(() => Promise.resolve(res));
  c.then = (resolve: any) => resolve(res);
  return c;
}

function mockReq(body: any = {}): Request {
  return { body, params: {} } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();
const merchant = { id: 'merch-1', default_processor: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationId = 'loc-1';
  mockGetByLocationId.mockResolvedValue({ ...merchant });
});

describe('createNmi', () => {
  it('blocks NMI setup for a Standard Marketplace merchant', async () => {
    mockGetByLocationId.mockResolvedValue({
      ...merchant,
      marketplace_plan_id: '6a5aaf8e77d47a4f4f207bcb',
      marketplace_plan_key: 'standard',
      marketplace_billing_status: 'complete',
      wholepay_approved_at: null,
      wholepay_approval_revoked_at: null,
    });

    await processorConfigController.createNmi(
      mockReq({ securityKey: 'security-key', tokenizationKey: 'tokenization-key' }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'MARKETPLACE_ENTITLEMENT_REQUIRED',
      statusCode: 403,
    }));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects when locationId cannot be resolved', async () => {
    mockLocationId = null;
    await processorConfigController.createNmi(
      mockReq({ securityKey: 's', tokenizationKey: 't' }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects when securityKey or tokenizationKey is missing', async () => {
    await processorConfigController.createNmi(
      mockReq({ securityKey: 'only-security' }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects when credentials are not strings', async () => {
    await processorConfigController.createNmi(
      mockReq({ securityKey: 123, tokenizationKey: 456 }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('encrypts the security key and scopes the row by merchant/location before persisting', async () => {
    const PLAINTEXT_SECURITY = 'sk_live_super_secret_security_key';
    const TOKENIZATION = 'tok_pub_key';

    // createNmiConfig: inspect existing routes, clearDefaults, then insert().select().single()
    const existingChain = query({ data: [] });
    const clearChain = query({ data: null });
    const insertChain = query({
      data: {
        id: 'cfg-1',
        processor_type: 'nmi',
        nmi_processor_id: null,
        is_default: true,
        is_active: true,
        created_at: '2026-06-15T00:00:00Z',
      },
    });
    // getOrCreateNmiWebhookConfig: select(...).single() returns an active config
    const webhookChain = query({
      data: {
        id: 'cfg-1',
        nmi_webhook_callback_url: 'http://localhost:3000/webhooks/nmi/silent-post',
        nmi_webhook_events: [],
        nmi_webhook_status: 'manual_setup_required',
        nmi_webhook_secret_encrypted: null,
      },
    });

    mockFrom
      .mockReturnValueOnce(existingChain) // existing NMI route inspection
      .mockReturnValueOnce(clearChain) // clearDefaults update
      .mockReturnValueOnce(insertChain) // insert config
      .mockReturnValueOnce(webhookChain) // webhook select
      .mockReturnValue(query({ data: null })); // any webhook patch update

    const res = mockRes();
    await processorConfigController.createNmi(
      mockReq({ securityKey: PLAINTEXT_SECURITY, tokenizationKey: TOKENIZATION }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();

    // The insert payload is the load-bearing assertion.
    const insertPayload = insertChain.insert.mock.calls[0][0];

    // Tenant scoping
    expect(insertPayload.merchant_id).toBe('merch-1');
    expect(insertPayload.location_id).toBe('loc-1');
    expect(insertPayload.processor_type).toBe('nmi');

    // SECURITY: the plaintext security key is NEVER written as-is.
    expect(insertPayload.nmi_security_key_encrypted).toBeDefined();
    expect(insertPayload.nmi_security_key_encrypted).not.toBe(PLAINTEXT_SECURITY);
    // And it round-trips back to the original via the real decrypt().
    expect(decrypt(insertPayload.nmi_security_key_encrypted)).toBe(PLAINTEXT_SECURITY);
    // No plaintext security key field is persisted under any obvious name.
    expect(insertPayload.nmi_security_key).toBeUndefined();
    expect(insertPayload.security_key).toBeUndefined();

    // Response never echoes the encrypted secret back to the client.
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.id).toBe('cfg-1');
    expect(body.nmi_security_key_encrypted).toBeUndefined();
  });
});

describe('testNmi', () => {
  it('rejects when credentials are missing', async () => {
    await processorConfigController.testNmi(
      mockReq({ securityKey: 's' }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(NmiClientCtor).not.toHaveBeenCalled();
  });

  it('returns the successful connection result without persisting', async () => {
    mockTestConnection.mockResolvedValue({ success: true, message: 'ok' });
    const res = mockRes();
    await processorConfigController.testNmi(
      mockReq({ securityKey: 'sk', tokenizationKey: 'tok' }),
      res,
      next,
    );
    expect(NmiClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ securityKey: 'sk', tokenizationKey: 'tok' }),
    );
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toEqual({ success: true, message: 'ok' });
    // one-shot: nothing is written to the DB
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('forwards a failed connection result (does not throw)', async () => {
    mockTestConnection.mockResolvedValue({ success: false, message: 'invalid security key' });
    const res = mockRes();
    await processorConfigController.testNmi(
      mockReq({ securityKey: 'bad', tokenizationKey: 'tok' }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('disconnectNmi', () => {
  it('deactivates active NMI configs for this merchant', async () => {
    // select active nmi configs -> two rows
    const selectChain = query({ data: [{ id: 'cfg-1' }, { id: 'cfg-2' }] });
    // service.deactivate -> update chain (called once per config)
    const deactivateChain = query({ data: null });

    mockFrom
      .mockReturnValueOnce(selectChain) // select configs
      .mockReturnValue(deactivateChain); // deactivate updates

    const res = mockRes();
    await processorConfigController.disconnectNmi(mockReq({}), res, next);

    expect(next).not.toHaveBeenCalled();
    // scoped to this merchant
    expect(selectChain.eq).toHaveBeenCalledWith('merchant_id', 'merch-1');
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toEqual({ success: true, deactivated: 2 });
  });
});

describe('setDefaultProcessor', () => {
  it('rejects an unsupported processor value', async () => {
    await processorConfigController.setDefaultProcessor(
      mockReq({ processor: 'paypal' }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('refuses to set a default for a processor that is not connected', async () => {
    // existing connected-config lookup returns empty
    mockFrom.mockReturnValueOnce(query({ data: [] }));
    const res = mockRes();
    await processorConfigController.setDefaultProcessor(
      mockReq({ processor: 'stripe' }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    // only the lookup ran; no merchants update
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('writes merchants.default_processor when the chosen processor is connected', async () => {
    const lookupChain = query({ data: [{ id: 'cfg-1' }] });
    const updateChain = query({ data: null });
    mockFrom
      .mockReturnValueOnce(lookupChain) // connected-config lookup
      .mockReturnValueOnce(updateChain); // merchants update

    const res = mockRes();
    await processorConfigController.setDefaultProcessor(
      mockReq({ processor: 'nmi' }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(updateChain.update).toHaveBeenCalledWith({ default_processor: 'nmi' });
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'merch-1');
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toEqual({ success: true, defaultProcessor: 'nmi' });
  });
});
