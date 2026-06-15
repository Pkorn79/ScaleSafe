/**
 * Launch-critical route tests: DISPUTE + EFW (early-fraud-warning) surfaces.
 *
 * These are the chargeback-defense endpoints where a missed deadline loses money.
 * The handlers are INLINE in the routers (no controller file), so we mount the
 * real routers on a minimal express app via supertest and mock everything below
 * the route layer: SSO/tenant middleware, merchant repo, supabase, the two Stripe
 * defense services, and the raw `stripe` SDK (used by the dispute "accept" path).
 *
 * Locks down, per route:
 *  - tenant scoping: the URL :merchantId must match the SSO tenant's merchant; the
 *    services are invoked with the resolved merchant UUID, never the raw URL value
 *  - GET list disputes / EFWs returns the rows for the scoped merchant
 *  - GET one dispute assembles an evidence packet for that dispute
 *  - POST submit evidence: success path calls submitEvidence + 500s on service throw
 *    (a silent failure here means a chargeback goes unanswered)
 *  - POST accept dispute: closes the Stripe dispute + marks outcome accepted
 *  - POST respond to EFW: validates action and routes to respondToEfw
 */

// ─── Mocks (must be declared before importing the routers) ──────────

// Bypass the real SSO/tenant middleware. Inject a fixed tenantContext so the
// route's requireMatchingMerchant() resolves the merchant via the repo mock.
jest.mock('../../src/middleware/ssoAuth', () => ({
  ssoAuth: (req: any, _res: any, next: any) => {
    req.tenantContext = { locationId: 'loc-1', companyId: 'comp-1', userId: 'u-1', email: '', role: 'admin' };
    next();
  },
}));

jest.mock('../../src/middleware/tenantContext', () => ({
  requireTenant: (_req: any, _res: any, next: any) => next(),
}));

const mockFindByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockFindByLocationId(...args),
  },
}));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const mockAssembleEvidencePacket = jest.fn();
const mockSubmitEvidence = jest.fn();
jest.mock('../../src/services/stripe-dispute.service', () => ({
  stripeDisputeService: {
    assembleEvidencePacket: (...args: any[]) => mockAssembleEvidencePacket(...args),
    submitEvidence: (...args: any[]) => mockSubmitEvidence(...args),
  },
}));

const mockRespondToEfw = jest.fn();
jest.mock('../../src/services/stripe-efw.service', () => ({
  stripeEfwService: {
    respondToEfw: (...args: any[]) => mockRespondToEfw(...args),
  },
}));

const mockDisputesClose = jest.fn().mockResolvedValue({});
jest.mock('stripe', () => jest.fn(() => ({
  disputes: { close: mockDisputesClose },
})));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test' },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import disputeRoutes from '../../src/routes/dispute.routes';
import efwRoutes from '../../src/routes/efw.routes';

const app = express();
app.use(express.json());
app.use('/api/disputes', disputeRoutes);
app.use('/api/efws', efwRoutes);

const MERCHANT_ID = 'merch-uuid-1';
const LOCATION_ID = 'loc-1';

const MERCHANT = { id: MERCHANT_ID, location_id: LOCATION_ID };

/**
 * Chainable Supabase query stub. Every builder method returns the same object,
 * which is awaitable (for `await ...select().eq()...`) and exposes .single().
 */
function query(result: { data: any; error?: any }) {
  const c: any = {};
  const res = { data: result.data, error: result.error ?? null };
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.order = jest.fn(() => c);
  c.limit = jest.fn(() => c);
  c.update = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(res));
  c.then = (resolve: any) => resolve(res); // awaitable terminal
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindByLocationId.mockResolvedValue(MERCHANT);
});

// ─── Dispute routes ──────────────────────────────────────────────────

describe('GET /api/disputes/:merchantId — list disputes', () => {
  it('returns the disputes scoped to the resolved merchant', async () => {
    const disputes = [{ id: 'd1', stripe_dispute_id: 'dp_1' }];
    const q = query({ data: disputes });
    mockFrom.mockReturnValueOnce(q);

    const res = await request(app).get(`/api/disputes/${MERCHANT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toEqual(disputes);
    expect(mockFrom).toHaveBeenCalledWith('dispute_events');
    expect(q.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
  });

  it('also accepts the locationId form of the tenant identifier in the URL', async () => {
    mockFrom.mockReturnValueOnce(query({ data: [] }));

    const res = await request(app).get(`/api/disputes/${LOCATION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toEqual([]);
  });

  it('403s when the URL merchant does not belong to the SSO tenant', async () => {
    const res = await request(app).get('/api/disputes/some-other-merchant');

    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('404s when no merchant exists for the authenticated tenant', async () => {
    mockFindByLocationId.mockResolvedValueOnce(null);

    const res = await request(app).get(`/api/disputes/${MERCHANT_ID}`);

    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('GET /api/disputes/:merchantId/:disputeId — single dispute', () => {
  it('returns the dispute with an assembled evidence packet', async () => {
    const dispute = { id: 'd1', stripe_dispute_id: 'dp_1' };
    const packet = { stripeDisputeId: 'dp_1', evidence: { customer_name: 'Jane' }, complete: true };
    mockFrom.mockReturnValueOnce(query({ data: dispute }));
    mockAssembleEvidencePacket.mockResolvedValueOnce(packet);

    const res = await request(app).get(`/api/disputes/${MERCHANT_ID}/d1`);

    expect(res.status).toBe(200);
    expect(res.body.dispute).toEqual(dispute);
    expect(res.body.evidencePacket).toEqual(packet);
    // packet assembled with the Stripe dispute id + the resolved merchant uuid
    expect(mockAssembleEvidencePacket).toHaveBeenCalledWith('dp_1', MERCHANT_ID);
  });

  it('404s when the dispute is not found for this merchant', async () => {
    mockFrom.mockReturnValueOnce(query({ data: null }));

    const res = await request(app).get(`/api/disputes/${MERCHANT_ID}/missing`);

    expect(res.status).toBe(404);
    expect(mockAssembleEvidencePacket).not.toHaveBeenCalled();
  });
});

describe('POST /api/disputes/:merchantId/:disputeId/submit — submit evidence', () => {
  it('assembles the packet and submits evidence to Stripe', async () => {
    const dispute = { id: 'd1', stripe_dispute_id: 'dp_1' };
    const packet = { evidence: { customer_name: 'Jane' } };
    mockFrom.mockReturnValueOnce(query({ data: dispute }));
    mockAssembleEvidencePacket.mockResolvedValueOnce(packet);
    mockSubmitEvidence.mockResolvedValueOnce({ success: true, staged: false });

    const res = await request(app)
      .post(`/api/disputes/${MERCHANT_ID}/d1/submit`)
      .send({ autoSubmit: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, staged: false });
    expect(mockSubmitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeDisputeId: 'dp_1',
        merchantId: MERCHANT_ID,
        evidence: packet.evidence,
        autoSubmit: true,
      }),
    );
  });

  it('defaults autoSubmit to true when the body omits it', async () => {
    mockFrom.mockReturnValueOnce(query({ data: { id: 'd1', stripe_dispute_id: 'dp_1' } }));
    mockAssembleEvidencePacket.mockResolvedValueOnce({ evidence: {} });
    mockSubmitEvidence.mockResolvedValueOnce({ success: true, staged: false });

    await request(app).post(`/api/disputes/${MERCHANT_ID}/d1/submit`).send({});

    expect(mockSubmitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ autoSubmit: true }),
    );
  });

  it('404s when the dispute does not exist (does not call submitEvidence)', async () => {
    mockFrom.mockReturnValueOnce(query({ data: null }));

    const res = await request(app).post(`/api/disputes/${MERCHANT_ID}/nope/submit`).send({});

    expect(res.status).toBe(404);
    expect(mockSubmitEvidence).not.toHaveBeenCalled();
  });

  it('500s when the submit service throws (chargeback would go unanswered)', async () => {
    mockFrom.mockReturnValueOnce(query({ data: { id: 'd1', stripe_dispute_id: 'dp_1' } }));
    mockAssembleEvidencePacket.mockResolvedValueOnce({ evidence: {} });
    mockSubmitEvidence.mockRejectedValueOnce(new Error('Stripe API down'));

    const res = await request(app).post(`/api/disputes/${MERCHANT_ID}/d1/submit`).send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to submit evidence');
  });
});

describe('POST /api/disputes/:merchantId/:disputeId/accept — accept dispute', () => {
  it('closes the Stripe dispute and marks the outcome accepted', async () => {
    const updateChain = query({ data: null });
    mockFrom
      .mockReturnValueOnce(query({ data: { id: 'd1', stripe_dispute_id: 'dp_1' } })) // dispute lookup
      .mockReturnValueOnce(query({ data: { stripe_user_id: 'acct_123' } }))         // merchant lookup
      .mockReturnValueOnce(updateChain);                                            // outcome update

    const res = await request(app).post(`/api/disputes/${MERCHANT_ID}/d1/accept`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, action: 'accepted' });
    expect(mockDisputesClose).toHaveBeenCalledWith('dp_1', { stripeAccount: 'acct_123' });
    expect(updateChain.update).toHaveBeenCalledWith({ outcome: 'accepted' });
  });

  it('400s when the merchant has no connected Stripe account', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: { id: 'd1', stripe_dispute_id: 'dp_1' } }))
      .mockReturnValueOnce(query({ data: { stripe_user_id: null } }));

    const res = await request(app).post(`/api/disputes/${MERCHANT_ID}/d1/accept`).send({});

    expect(res.status).toBe(400);
    expect(mockDisputesClose).not.toHaveBeenCalled();
  });

  it('404s when the dispute does not exist', async () => {
    mockFrom.mockReturnValueOnce(query({ data: null }));

    const res = await request(app).post(`/api/disputes/${MERCHANT_ID}/nope/accept`).send({});

    expect(res.status).toBe(404);
    expect(mockDisputesClose).not.toHaveBeenCalled();
  });
});

// ─── EFW routes ──────────────────────────────────────────────────────

describe('GET /api/efws/:merchantId — list EFWs', () => {
  it('returns the EFWs scoped to the resolved merchant', async () => {
    const efws = [{ id: 'e1', stripe_efw_id: 'issfr_1' }];
    const q = query({ data: efws });
    mockFrom.mockReturnValueOnce(q);

    const res = await request(app).get(`/api/efws/${MERCHANT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.efws).toEqual(efws);
    expect(mockFrom).toHaveBeenCalledWith('efw_events');
    expect(q.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
  });

  it('403s when the URL merchant does not belong to the SSO tenant', async () => {
    const res = await request(app).get('/api/efws/not-my-merchant');

    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('POST /api/efws/:merchantId/:efwId/respond — respond to EFW', () => {
  it('routes a refund response to respondToEfw with merchant scoping', async () => {
    mockRespondToEfw.mockResolvedValueOnce({ success: true, action: 'refund' });

    const res = await request(app)
      .post(`/api/efws/${MERCHANT_ID}/e1/respond`)
      .send({ action: 'refund' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, action: 'refund' });
    expect(mockRespondToEfw).toHaveBeenCalledWith({
      efwId: 'e1',
      merchantId: MERCHANT_ID,
      action: 'refund',
    });
  });

  it('routes a hold response to respondToEfw', async () => {
    mockRespondToEfw.mockResolvedValueOnce({ success: true, action: 'hold' });

    const res = await request(app)
      .post(`/api/efws/${MERCHANT_ID}/e1/respond`)
      .send({ action: 'hold' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('hold');
    expect(mockRespondToEfw).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hold', merchantId: MERCHANT_ID }),
    );
  });

  it('400s on an invalid action and never calls the service', async () => {
    const res = await request(app)
      .post(`/api/efws/${MERCHANT_ID}/e1/respond`)
      .send({ action: 'explode' });

    expect(res.status).toBe(400);
    expect(mockRespondToEfw).not.toHaveBeenCalled();
  });

  it('500s and surfaces the service error message when respondToEfw throws', async () => {
    mockRespondToEfw.mockRejectedValueOnce(new Error('EFW not found'));

    const res = await request(app)
      .post(`/api/efws/${MERCHANT_ID}/e1/respond`)
      .send({ action: 'refund' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('EFW not found');
  });
});
