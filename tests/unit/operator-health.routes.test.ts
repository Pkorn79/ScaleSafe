import express from 'express';
import request from 'supertest';

const mockResolveSession = jest.fn();
const mockAuditRequest = jest.fn();
const mockOverview = jest.fn();
const mockIncidentPage = jest.fn();

jest.mock('../../src/services/operator-authorization.service', () => ({
  operatorAuthorizationService: {
    resolveSessionToken: (...args: any[]) => mockResolveSession(...args),
    auditRequest: (...args: any[]) => mockAuditRequest(...args),
    hasPermission: () => true,
    canAccessLocation: () => true,
  },
}));

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  commandCenterHealthRepository: {
    getPlatformOverviewPage: (...args: any[]) => mockOverview(...args),
    listIncidentsPage: (...args: any[]) => mockIncidentPage(...args),
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
  permissions: new Set(['platform.health.read']),
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
});

describe('operator health routes', () => {
  it('uses one live authorization read, one audit write, and one overview read', async () => {
    const response = await request(app())
      .get('/internal/operator/api/health?limit=50')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(200);
    expect(mockResolveSession).toHaveBeenCalledTimes(1);
    expect(mockAuditRequest).toHaveBeenCalledTimes(1);
    expect(mockOverview).toHaveBeenCalledTimes(1);
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
});
