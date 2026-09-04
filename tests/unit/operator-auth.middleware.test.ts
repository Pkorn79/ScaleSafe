import express, { Request, Response } from 'express';
import request from 'supertest';

const mockResolveSession = jest.fn();
const mockAuditRequest = jest.fn();
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

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { config } from '../../src/config';
import {
  operatorFeatureAndHost,
  requireOperatorCsrf,
  requireOperatorHealthEnabled,
  requireOperatorPermission,
  requireOperatorSession,
} from '../../src/middleware/operatorAuth';
import { hashOperatorValue } from '../../src/utils/operator-security';

const SESSION_TOKEN = 'opsession_example';
const CSRF_TOKEN = 'opcsrf_example';
const CONTEXT = {
  operatorUserId: 'user-1',
  sessionId: 'session-1',
  organizationId: 'org-1',
  organizationType: 'reseller',
  membershipId: 'membership-1',
  role: 'reseller_operator',
  permissions: new Set(['operator.session.read', 'merchant.summary.read']),
  locationAccess: { mode: 'assigned', locationIds: new Set(['loc-a']) },
  authAssurance: 'aal2',
  csrfTokenHash: hashOperatorValue(CSRF_TOKEN),
  sessionTokenHash: hashOperatorValue(SESSION_TOKEN),
};

function baseApp() {
  const app = express();
  app.use(express.json());
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  (config.operator as any).enabled = true;
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  (config.operator as any).host = 'ops.scalesafe.app';
  (config.operator as any).origin = 'https://ops.scalesafe.app';
  mockResolveSession.mockResolvedValue({ context: CONTEXT, actor: {} });
  mockAuditRequest.mockResolvedValue('audit-1');
  mockHasPermission.mockReturnValue(true);
  mockCanAccessLocation.mockReturnValue(true);
});

describe('operator request boundary', () => {
  it('returns 404 while the command center flag is disabled', async () => {
    (config.operator as any).enabled = false;
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, (_req, res) => res.json({ ok: true }));
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(404);
  });

  it('returns the same 404 from a non-operator host', async () => {
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, (_req, res) => res.json({ ok: true }));
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'dashboard.scalesafe.app');
    expect(response.status).toBe(404);
  });

  it('returns 404 for Phase 2 routes while health incidents are disabled', async () => {
    (config.operator as any).healthEnabled = false;
    const app = baseApp();
    app.get('/internal/operator/api/health', requireOperatorHealthEnabled, (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/internal/operator/api/health');

    expect(response.status).toBe(404);
  });

  it('hides platform-only health routes from reseller roles', async () => {
    mockHasPermission.mockReturnValue(false);
    const app = baseApp();
    app.get(
      '/internal/operator/api/health',
      operatorFeatureAndHost,
      requireOperatorSession,
      requireOperatorPermission('platform.health.read', { hideUnauthorized: true }),
      (_req, res) => res.json({ ok: true }),
    );

    const response = await request(app)
      .get('/internal/operator/api/health')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Resource not found' });
  });

  it('rejects a request that tries to combine GHL and operator identity planes', async () => {
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, (_req, res) => res.json({ ok: true }));
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'ops.scalesafe.app')
      .set('x-sso-payload', 'merchant-sso')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('MIXED_IDENTITY_PLANES');
    expect(mockResolveSession).not.toHaveBeenCalled();
  });

  it('requires an opaque operator cookie', async () => {
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, requireOperatorSession, (_req, res) => res.json({ ok: true }));
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(401);
    expect(mockAuditRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'operator.session.authenticate',
      result: 'denied',
    }));
  });

  it('uses only the operator session resolution for authorization', async () => {
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, requireOperatorSession, (req: Request, res: Response) => {
      res.json({ role: req.operatorContext?.role });
    });
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body.role).toBe('reseller_operator');
    expect(mockResolveSession).toHaveBeenCalledWith(SESSION_TOKEN);
  });

  it('makes out-of-scope and nonexistent merchant responses indistinguishable', async () => {
    const app = baseApp();
    app.get(
      '/internal/operator/api/merchants/:locationId',
      operatorFeatureAndHost,
      requireOperatorSession,
      requireOperatorPermission('merchant.summary.read', { locationParam: 'locationId', sensitiveRead: true }),
      (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' }),
    );

    mockCanAccessLocation.mockReturnValueOnce(false);
    const denied = await request(app)
      .get('/internal/operator/api/merchants/loc-other')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    mockCanAccessLocation.mockReturnValueOnce(true);
    const absent = await request(app)
      .get('/internal/operator/api/merchants/loc-absent')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(denied.body).toEqual(absent.body);
  });

  it('blocks a sensitive read when its audit write fails', async () => {
    mockAuditRequest.mockRejectedValueOnce(new Error('audit unavailable'));
    const app = baseApp();
    app.get(
      '/internal/operator/api/merchants/:locationId',
      operatorFeatureAndHost,
      requireOperatorSession,
      requireOperatorPermission('merchant.summary.read', { locationParam: 'locationId', sensitiveRead: true }),
      (_req, res) => res.json({ ok: true }),
    );
    const response = await request(app)
      .get('/internal/operator/api/merchants/loc-a')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(response.status).toBe(503);
  });

  it('requires the host-only CSRF cookie and matching header for mutation', async () => {
    const app = baseApp();
    app.post(
      '/internal/operator/api/change',
      operatorFeatureAndHost,
      requireOperatorSession,
      requireOperatorCsrf,
      (_req, res) => res.json({ changed: true }),
    );

    const denied = await request(app)
      .post('/internal/operator/api/change')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post('/internal/operator/api/change')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', [
        `__Host-scalesafe_ops=${SESSION_TOKEN}`,
        `__Host-scalesafe_ops_csrf=${CSRF_TOKEN}`,
      ])
      .set('x-csrf-token', CSRF_TOKEN);
    expect(allowed.status).toBe(200);
    expect(allowed.body.changed).toBe(true);
  });

  it('fails closed when live authorization state cannot be loaded', async () => {
    mockResolveSession.mockRejectedValueOnce(new Error('database timeout'));
    const app = baseApp();
    app.get('/internal/operator/api/session', operatorFeatureAndHost, requireOperatorSession, (_req, res) => res.json({ ok: true }));
    const response = await request(app)
      .get('/internal/operator/api/session')
      .set('Host', 'ops.scalesafe.app')
      .set('Cookie', `__Host-scalesafe_ops=${SESSION_TOKEN}`);
    expect(response.status).toBe(503);
  });
});
