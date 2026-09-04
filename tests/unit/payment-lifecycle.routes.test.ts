/**
 * Launch-critical route test: subscription lifecycle API
 *   POST /lifecycle/subscription/pause
 *   POST /lifecycle/subscription/resume
 *   POST /lifecycle/subscription/cancel
 *   POST /lifecycle/enrollment/status
 *
 * Handlers are INLINE in src/routes/payment-lifecycle.routes.ts, so we drive
 * them through a real express app via supertest (matching auth.routes.test.ts).
 *
 * Invariants locked down:
 *  - required-field validation (enrollmentId) returns 400 before the service is touched
 *  - the enrollment is resolved tenant-scoped (location_id) and filtered to the
 *    statuses each action allows; an enrollment outside those statuses 400s ("not found")
 *  - the correct lifecycle service method is invoked with merchant.id + the
 *    enrollment-derived contactId / offerId / processor fields (never raw body values)
 *  - a service throw propagates as an error response (not a 200 success)
 *  - /enrollment/status dispatches by action and rejects unknown actions
 */

// ── Mocks (declared before importing the router) ───────────────────

const mockPauseSubscription = jest.fn();
const mockResumeSubscription = jest.fn();
const mockCancelSubscription = jest.fn();
const mockCompleteEnrollment = jest.fn();

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    pauseSubscription: (...a: any[]) => mockPauseSubscription(...a),
    resumeSubscription: (...a: any[]) => mockResumeSubscription(...a),
    cancelSubscription: (...a: any[]) => mockCancelSubscription(...a),
    completeEnrollment: (...a: any[]) => mockCompleteEnrollment(...a),
  },
}));

const mockGetByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: { getByLocationId: (...a: any[]) => mockGetByLocationId(...a) },
}));

// Tenant middleware: ssoAuth injects context, requireTenant passes it through.
jest.mock('../../src/middleware/ssoAuth', () => ({
  ssoAuth: (req: any, _res: any, next: any) => {
    req.tenantContext = { locationId: 'loc-1' };
    next();
  },
}));
jest.mock('../../src/middleware/tenantContext', () => ({
  requireTenant: (_req: any, _res: any, next: any) => next(),
  resolveLocationId: (req: any) => req.tenantContext?.locationId || '',
}));

// Supabase stub used by getEnrollmentForLifecycleAction (maybeSingle) and
// the enrollment/status handler (single). The builder records the eq()/in()
// filters so we can assert tenant + status scoping.
let nextEnrollmentResult: { data: any; error?: any } = { data: null };
const lastQuery: any = { filters: {}, statuses: null };

function makeBuilder() {
  const b: any = {};
  b.select = jest.fn(() => b);
  b.eq = jest.fn((col: string, val: any) => { lastQuery.filters[col] = val; return b; });
  b.in = jest.fn((_col: string, vals: any[]) => { lastQuery.statuses = vals; return b; });
  b.maybeSingle = jest.fn(() => Promise.resolve({ data: nextEnrollmentResult.data, error: nextEnrollmentResult.error ?? null }));
  b.single = jest.fn(() => Promise.resolve({ data: nextEnrollmentResult.data, error: nextEnrollmentResult.error ?? null }));
  return b;
}
const mockFrom = jest.fn(() => makeBuilder());
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import lifecycleRoutes from '../../src/routes/payment-lifecycle.routes';

const app = express();
app.use(express.json());
app.use('/lifecycle', lifecycleRoutes);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.code, message: err.message });
});

const ENROLLMENT = {
  id: 'enr-1',
  contact_id: 'contact-1',
  offer_id: 'offer-1',
  processor_subscription_id: 'sub-1',
  processor_type: 'nmi',
  status: 'active',
  payment_type: 'subscription',
  payments_made: 1,
  payments_total: null,
  billing_completed_at: null,
  next_billing_date: '2026-09-30T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  nextEnrollmentResult = { data: null };
  lastQuery.filters = {};
  lastQuery.statuses = null;
  mockGetByLocationId.mockResolvedValue({ id: 'merch-1' });
  mockPauseSubscription.mockResolvedValue(undefined);
  mockResumeSubscription.mockResolvedValue(undefined);
  mockCancelSubscription.mockResolvedValue(undefined);
  mockCompleteEnrollment.mockResolvedValue(undefined);
});

describe('POST /lifecycle/subscription/pause', () => {
  it('400s when enrollmentId is missing, before touching the service', async () => {
    const res = await request(app).post('/lifecycle/subscription/pause').send({ contactId: 'contact-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(mockPauseSubscription).not.toHaveBeenCalled();
  });

  it('pauses an active enrollment scoped by location_id and only enrolled/active statuses', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT, status: 'active' } };
    const res = await request(app)
      .post('/lifecycle/subscription/pause')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1', reason: 'on vacation' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // tenant + record scoping
    expect(lastQuery.filters.location_id).toBe('loc-1');
    expect(lastQuery.filters.id).toBe('enr-1');
    expect(lastQuery.statuses).toEqual(['enrolled', 'active']);
    // service called with merchant id + enrollment-derived fields
    expect(mockPauseSubscription).toHaveBeenCalledTimes(1);
    expect(mockPauseSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merch-1',
      locationId: 'loc-1',
      contactId: 'contact-1',
      offerId: 'offer-1',
      enrollmentId: 'enr-1',
      reason: 'on vacation',
      processorSubscriptionId: 'sub-1',
      processorType: 'nmi',
    }));
  });

  it('400s ("not found") when the enrollment is not in an allowed status', async () => {
    nextEnrollmentResult = { data: null }; // filtered out by status .in()
    const res = await request(app)
      .post('/lifecycle/subscription/pause')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/i);
    expect(mockPauseSubscription).not.toHaveBeenCalled();
  });
});

describe('POST /lifecycle/subscription/resume', () => {
  it('resumes a paused enrollment (only paused status allowed) and calls resumeSubscription', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT, status: 'paused' } };
    const res = await request(app)
      .post('/lifecycle/subscription/resume')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(lastQuery.statuses).toEqual(['paused']);
    expect(mockResumeSubscription).toHaveBeenCalledTimes(1);
    expect(mockResumeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merch-1',
      locationId: 'loc-1',
      contactId: 'contact-1',
      offerId: 'offer-1',
      enrollmentId: 'enr-1',
      reason: 'Merchant-initiated resume',
    }));
    expect(mockPauseSubscription).not.toHaveBeenCalled();
  });
});

describe('POST /lifecycle/subscription/cancel', () => {
  it('cancels an enrollment (enrolled/active/paused allowed) and calls cancelSubscription', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT, status: 'active' } };
    const res = await request(app)
      .post('/lifecycle/subscription/cancel')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1', reason: 'customer request' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(lastQuery.statuses).toEqual(['enrolled', 'active', 'paused']);
    expect(mockCancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merch-1',
      locationId: 'loc-1',
      enrollmentId: 'enr-1',
      reason: 'customer request',
    }));
  });

  it('propagates a service failure as an error response (not a 200 success)', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT, status: 'active' } };
    mockCancelSubscription.mockRejectedValue(new Error('processor cancel failed'));

    const res = await request(app)
      .post('/lifecycle/subscription/cancel')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/processor cancel failed/);
    expect(mockCancelSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('POST /lifecycle/enrollment/status', () => {
  it('400s when enrollmentId, contactId, or action is missing', async () => {
    const res = await request(app)
      .post('/lifecycle/enrollment/status')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1' }); // no action
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(mockPauseSubscription).not.toHaveBeenCalled();
  });

  it('dispatches action=cancel to cancelSubscription and echoes the action', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT } };
    const res = await request(app)
      .post('/lifecycle/enrollment/status')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1', action: 'cancel' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, action: 'cancel' });
    expect(lastQuery.filters.location_id).toBe('loc-1');
    expect(lastQuery.filters.contact_id).toBe('contact-1');
    expect(mockCancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merch-1',
      locationId: 'loc-1',
      contactId: 'contact-1',
      enrollmentId: 'enr-1',
    }));
  });

  it('does not require a processor cancellation for a fully paid finite plan', async () => {
    nextEnrollmentResult = {
      data: {
        ...ENROLLMENT,
        payment_type: 'installment',
        payments_made: 2,
        payments_total: 2,
        billing_completed_at: null,
        next_billing_date: null,
      },
    };

    const res = await request(app)
      .post('/lifecycle/enrollment/status')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1', action: 'cancel' });

    expect(res.status).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr-1',
      processorSubscriptionId: 'sub-1',
      processorCancellationRequired: false,
    }));
  });

  it('400s on an unknown action without calling any lifecycle method', async () => {
    nextEnrollmentResult = { data: { ...ENROLLMENT } };
    const res = await request(app)
      .post('/lifecycle/enrollment/status')
      .send({ enrollmentId: 'enr-1', contactId: 'contact-1', action: 'explode' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid action/i);
    expect(mockPauseSubscription).not.toHaveBeenCalled();
    expect(mockResumeSubscription).not.toHaveBeenCalled();
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
  });
});
