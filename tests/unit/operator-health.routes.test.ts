import express from 'express';
import request from 'supertest';

const mockResolveSession = jest.fn();
const mockAuditRequest = jest.fn();
const mockOverview = jest.fn();
const mockIncidentPage = jest.fn();
const mockMerchantPage = jest.fn();
const mockMerchantDetail = jest.fn();
const mockResellerPage = jest.fn();
const mockPlatformSummary = jest.fn();
const mockIncidentById = jest.fn();
const mockMerchantSummary = jest.fn();
const mockHasPermission = jest.fn();
const mockCanAccessLocation = jest.fn();

jest.mock('../../src/services/operator-authorization.service', () => ({
  operatorAuthorizationService: {
    resolveSessionToken: (...args: any[]) => mockResolveSession(...args),
    auditRequest: (...args: any[]) => mockAuditRequest(...args),
    hasPermission: (...args: any[]) => mockHasPermission(...args),
    canAccessLocation: (...args: any[]) => mockCanAccessLocation(...args),
  },
}));

jest.mock('../../src/repositories/operator.repository', () => ({
  operatorRepository: {
    getMerchantSummary: (...args: any[]) => mockMerchantSummary(...args),
  },
}));

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  commandCenterHealthRepository: {
    getPlatformOverviewPage: (...args: any[]) => mockOverview(...args),
    listIncidentsPage: (...args: any[]) => mockIncidentPage(...args),
    listOperatorMerchantsPage: (...args: any[]) => mockMerchantPage(...args),
    getOperatorMerchantDetail: (...args: any[]) => mockMerchantDetail(...args),
    listOperatorResellersPage: (...args: any[]) => mockResellerPage(...args),
    getOperatorPlatformSummary: (...args: any[]) => mockPlatformSummary(...args),
    getIncidentById: (...args: any[]) => mockIncidentById(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { config } from '../../src/config';
import operatorRoutes from '../../src/routes/operator.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const SESSION_TOKEN = 'operator-session-token';
const CONTEXT = {
  operatorUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  organizationType: 'platform',
  membershipId: '44444444-4444-4444-8444-444444444444',
  role: 'platform_owner',
  permissions: new Set(['platform.health.read', 'platform.merchants.read', 'platform.resellers.read']),
  locationAccess: { mode: 'all', locationIds: new Set<string>() },
  authAssurance: 'aal2',
  csrfTokenHash: 'a'.repeat(64),
  sessionTokenHash: 'b'.repeat(64),
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(operatorRoutes);
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  (config.operator as any).enabled = true;
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  (config.operator as any).host = 'ops.scalesafe.app';
  (config.operator as any).origin = 'https://ops.scalesafe.app';
  mockResolveSession.mockResolvedValue({ context: CONTEXT, actor: {} });
  mockAuditRequest.mockResolvedValue('audit-id');
  mockHasPermission.mockReturnValue(true);
  mockCanAccessLocation.mockReturnValue(true);
  mockOverview.mockResolvedValue({
    checks: [],
    incidents: [],
    merchants: [],
    next: {
      checks: {
        lastObservedAt: '2026-07-23T00:00:00.000Z',
        id: '55555555-5555-4555-8555-555555555555',
      },
      incidents: null,
      merchants: null,
    },
  });
  mockIncidentPage.mockResolvedValue({ incidents: [], next: null });
  mockMerchantPage.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  mockMerchantDetail.mockResolvedValue({ merchant: { location_id: 'loc-1' } });
  mockMerchantSummary.mockResolvedValue({
    location_id: 'loc-1',
    business_name: 'Assigned Merchant',
    status: 'active',
    installed_at: '2026-07-01T00:00:00.000Z',
    marketplace_plan_key: 'standard',
    marketplace_billing_status: 'active',
  });
  mockResellerPage.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  mockPlatformSummary.mockResolvedValue({
    platform_state: 'degraded',
    health_checks_total: 18,
    health_unhealthy_count: 0,
    health_unknown_count: 1,
    active_incident_count: 1,
    active_critical_count: 0,
    merchant_count: 12,
    merchant_attention_count: 2,
    merchant_rollup_count: 12,
    merchant_attention: [],
  });
  mockIncidentById.mockResolvedValue(null);
});

describe('operator health routes', () => {
  it('uses one live authorization read, one audit write, and exact platform summary data', async () => {
    const response = await request(app())
      .get('/internal/operator/api/health?limit=50')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(200);
    expect(mockResolveSession).toHaveBeenCalledTimes(1);
    expect(mockAuditRequest).toHaveBeenCalledTimes(1);
    expect(mockOverview).toHaveBeenCalledTimes(1);
    expect(mockPlatformSummary).toHaveBeenCalledWith(true);
    expect(response.body.summary.merchant_count).toBe(12);
    expect(response.body.pagination.checksCursor).toEqual(expect.any(String));
  });

  it('round-trips an opaque stable cursor into the overview repository', async () => {
    const first = await request(app())
      .get('/internal/operator/api/health?limit=50')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    mockOverview.mockClear();

    const second = await request(app())
      .get(`/internal/operator/api/health?limit=50&checksCursor=${first.body.pagination.checksCursor}`)
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(second.status).toBe(200);
    expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({
      checksCursor: {
        at: '2026-07-23T00:00:00.000Z',
        id: '55555555-5555-4555-8555-555555555555',
      },
    }));
  });

  it('rejects malformed cursor and limit inputs without reading health data', async () => {
    const invalidCursor = await request(app())
      .get('/internal/operator/api/health?checksCursor=not-json')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    const invalidLimit = await request(app())
      .get('/internal/operator/api/health?limit=10000')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(invalidCursor.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(mockOverview).not.toHaveBeenCalled();
  });

  it('passes bounded merchant filters to the sanitized read model', async () => {
    const response = await request(app())
      .get('/internal/operator/api/merchants?limit=25&offset=50&query=PMG&state=degraded&processor=stripe&plan=test')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(200);
    expect(mockMerchantPage).toHaveBeenCalledWith({
      limit: 25,
      offset: 50,
      query: 'PMG',
      state: 'degraded',
      processor: 'stripe',
      plan: 'test',
      installation: null,
      reseller: null,
      incidentSeverity: null,
      component: null,
      componentState: null,
    });
  });

  it('rejects invalid merchant filters before reading the database', async () => {
    const response = await request(app())
      .get('/internal/operator/api/merchants?processor=payload-selected-provider')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(400);
    expect(mockMerchantPage).not.toHaveBeenCalled();
  });

  it('returns sanitized merchant detail and reseller rollups', async () => {
    const merchantResponse = await request(app())
      .get('/internal/operator/api/merchants/loc-1')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    const resellerResponse = await request(app())
      .get('/internal/operator/api/resellers')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(merchantResponse.status).toBe(200);
    expect(merchantResponse.body.merchant.location_id).toBe('loc-1');
    expect(mockMerchantDetail).toHaveBeenCalledWith('loc-1');
    expect(resellerResponse.status).toBe(200);
    expect(mockResellerPage).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  it('hides platform-wide merchant and reseller lists from reseller operators', async () => {
    mockResolveSession.mockResolvedValue({
      context: {
        ...CONTEXT,
        organizationType: 'reseller',
        role: 'reseller_operator',
        locationAccess: { mode: 'assigned', locationIds: new Set(['loc-1']) },
      },
      actor: {},
    });
    mockHasPermission.mockImplementation((_context, permission) => permission === 'merchant.summary.read');

    const merchants = await request(app())
      .get('/internal/operator/api/merchants')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    const resellers = await request(app())
      .get('/internal/operator/api/resellers')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(merchants.status).toBe(404);
    expect(resellers.status).toBe(404);
    expect(mockMerchantPage).not.toHaveBeenCalled();
    expect(mockResellerPage).not.toHaveBeenCalled();
  });

  it('returns only the limited summary for a reseller-assigned merchant', async () => {
    mockResolveSession.mockResolvedValue({
      context: {
        ...CONTEXT,
        organizationType: 'reseller',
        role: 'reseller_operator',
        locationAccess: { mode: 'assigned', locationIds: new Set(['loc-1']) },
      },
      actor: {},
    });

    const response = await request(app())
      .get('/internal/operator/api/merchants/loc-1')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      locationId: 'loc-1',
      businessName: 'Assigned Merchant',
      status: 'active',
      installedAt: '2026-07-01T00:00:00.000Z',
      marketplacePlan: 'standard',
      marketplaceBillingStatus: 'active',
    });
    expect(mockMerchantSummary).toHaveBeenCalledWith('loc-1');
    expect(mockMerchantDetail).not.toHaveBeenCalled();
  });

  it('fails closed before reading an unassigned reseller merchant', async () => {
    mockResolveSession.mockResolvedValue({
      context: {
        ...CONTEXT,
        organizationType: 'reseller',
        role: 'reseller_operator',
        locationAccess: { mode: 'assigned', locationIds: new Set(['loc-1']) },
      },
      actor: {},
    });
    mockCanAccessLocation.mockReturnValue(false);

    const response = await request(app())
      .get('/internal/operator/api/merchants/loc-2')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(404);
    expect(mockMerchantSummary).not.toHaveBeenCalled();
    expect(mockMerchantDetail).not.toHaveBeenCalled();
  });

  it('shows support staff only merchant health explicitly covered by a live grant', async () => {
    const supportContext = {
      ...CONTEXT,
      role: 'platform_support',
      permissions: new Set(['operator.session.read', 'platform.health.read', 'merchant.summary.read']),
      locationAccess: { mode: 'support_grants', locationIds: new Set(['loc-1']) },
    };
    mockResolveSession.mockResolvedValue({ context: supportContext, actor: {} });
    mockCanAccessLocation.mockImplementation((context, locationId) => (
      context.locationAccess.locationIds.has(locationId)
    ));
    mockOverview.mockResolvedValue({
      checks: [
        {
          id: '55555555-5555-4555-8555-555555555551',
          scope_type: 'merchant',
          scope_id: 'merchant-1',
          location_id: 'loc-1',
          check_key: 'merchant.processor.status',
          state: 'degraded',
          summary: 'raw assigned merchant text',
        },
        {
          id: '55555555-5555-4555-8555-555555555552',
          scope_type: 'merchant',
          scope_id: 'merchant-2',
          location_id: 'loc-2',
          check_key: 'merchant.processor.status',
          state: 'unhealthy',
          summary: 'raw unassigned merchant text',
        },
      ],
      incidents: [],
      merchants: [{ location_id: 'loc-2', merchant_name: 'Must not leak' }],
      next: { checks: null, incidents: null, merchants: null },
    });

    const response = await request(app())
      .get('/internal/operator/api/health')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.checks).toHaveLength(1);
    expect(response.body.checks[0].location_id).toBe('loc-1');
    expect(response.body.merchants).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('loc-2');
    expect(JSON.stringify(response.body)).not.toContain('Must not leak');
    expect(mockPlatformSummary).toHaveBeenCalledWith(false);
  });

  it('returns exact sanitized incident detail only inside the caller location boundary', async () => {
    const incidentId = '66666666-6666-4666-8666-666666666666';
    const supportContext = {
      ...CONTEXT,
      role: 'platform_support',
      permissions: new Set(['operator.session.read', 'platform.health.read', 'merchant.summary.read']),
      locationAccess: { mode: 'support_grants', locationIds: new Set(['loc-1']) },
    };
    mockResolveSession.mockResolvedValue({ context: supportContext, actor: {} });
    mockIncidentById.mockResolvedValue({
      id: incidentId,
      scope_type: 'merchant',
      scope_id: 'merchant-1',
      location_id: 'loc-1',
      check_key: 'merchant.processor.status',
      failure_class: 'PROCESSOR_UNAVAILABLE',
      severity: 'urgent',
      status: 'open',
      title: 'raw provider title',
      summary: 'raw provider summary',
      occurrence_count: 1,
      first_seen_at: '2026-09-03T12:00:00.000Z',
      last_seen_at: '2026-09-03T12:05:00.000Z',
      runbook_key: 'RUNBOOK-MONEY',
    });
    mockCanAccessLocation.mockImplementation((context, locationId) => (
      context.locationAccess.locationIds.has(locationId)
    ));

    const allowed = await request(app())
      .get(`/internal/operator/api/incidents/${incidentId}`)
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.incident).toEqual(expect.objectContaining({
      id: incidentId,
      location_id: 'loc-1',
      title: 'Merchant Processor Status',
    }));
    expect(JSON.stringify(allowed.body)).not.toContain('raw provider');

    supportContext.locationAccess.locationIds.clear();
    const denied = await request(app())
      .get(`/internal/operator/api/incidents/${incidentId}`)
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(denied.status).toBe(404);
  });

  it('refuses portfolio access when a reseller context is poisoned with platform permissions', async () => {
    mockResolveSession.mockResolvedValue({
      context: {
        ...CONTEXT,
        organizationType: 'reseller',
        role: 'reseller_owner',
        permissions: new Set([
          'operator.session.read',
          'platform.health.read',
          'platform.merchants.read',
          'platform.resellers.read',
          'merchant.summary.read',
        ]),
        locationAccess: { mode: 'assigned', locationIds: new Set(['loc-1']) },
      },
      actor: {},
    });

    const merchants = await request(app())
      .get('/internal/operator/api/merchants')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    const resellers = await request(app())
      .get('/internal/operator/api/resellers')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(merchants.status).toBe(404);
    expect(resellers.status).toBe(404);
    expect(mockMerchantPage).not.toHaveBeenCalled();
    expect(mockResellerPage).not.toHaveBeenCalled();
  });
});
