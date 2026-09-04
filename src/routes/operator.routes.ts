import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import {
  operatorFeatureAndHost,
  requireOperatorAuthEnabled,
  requireOperatorCsrf,
  requireOperatorHealthEnabled,
  requireOperatorOrigin,
  requireOperatorPermission,
  requireOperatorSession,
} from '../middleware/operatorAuth';
import { operatorRepository } from '../repositories/operator.repository';
import { commandCenterHealthRepository } from '../repositories/command-center-health.repository';
import { operatorAdminService } from '../services/operator-admin.service';
import { operatorAuthService } from '../services/operator-auth.service';
import { operatorAuthorizationService } from '../services/operator-authorization.service';
import { commandCenterIncidentService } from '../services/command-center-incident.service';
import { ValidationError } from '../utils/errors';
import { projectOperatorHealthCheck, projectOperatorIncident } from '../utils/operator-projections';
import { OPERATOR_RUNBOOKS } from '../operator-runbooks';
import {
  operatorAuthCss,
  operatorAuthJs,
  operatorInviteHtml,
  operatorLoginHtml,
} from '../operator-auth-page';
import {
  operatorCommandCenterCss,
  operatorCommandCenterHtml,
  operatorCommandCenterJs,
} from '../operator-command-center-page';
import {
  OPERATOR_PENDING_COOKIE,
  clearOperatorPendingCookie,
  clearOperatorSessionCookies,
  parseCookies,
  setOperatorPendingCookie,
  setOperatorSessionCookies,
} from '../utils/operator-cookies';

const router = Router();
const base = '/internal/operator';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

function pageLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new ValidationError('Invalid page limit');
  }
  return parsed;
}

function pageOffset(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000) {
    throw new ValidationError('Invalid page offset');
  }
  return parsed;
}

function optionalQuery(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 100) throw new ValidationError('Invalid search query');
  return normalized;
}

function optionalEnum(value: unknown, allowed: readonly string[], label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  if (!allowed.includes(normalized)) throw new ValidationError(`Invalid ${label}`);
  return normalized;
}

function optionalReseller(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  if (normalized !== 'unassigned' && !UUID_PATTERN.test(normalized)) {
    throw new ValidationError('Invalid reseller');
  }
  return normalized;
}

function decodeCursor(value: unknown, kind: 'time' | 'merchant'): any | null {
  if (value === undefined || value === null || value === '') return null;
  const encoded = String(value);
  if (encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new ValidationError('Invalid page cursor');
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid cursor');
    }
    if (kind === 'time') {
      if (
        typeof parsed.at !== 'string'
        || !Number.isFinite(new Date(parsed.at).getTime())
        || typeof parsed.id !== 'string'
        || !UUID_PATTERN.test(parsed.id)
      ) {
        throw new Error('invalid time cursor');
      }
      return { at: parsed.at, id: parsed.id };
    }
    if (
      !Number.isInteger(parsed.needsAttentionCount)
      || parsed.needsAttentionCount < 0
      || typeof parsed.lastReconciledAt !== 'string'
      || !Number.isFinite(new Date(parsed.lastReconciledAt).getTime())
      || typeof parsed.locationId !== 'string'
      || parsed.locationId.length < 1
      || parsed.locationId.length > 100
    ) {
      throw new Error('invalid merchant cursor');
    }
    return {
      needsAttentionCount: parsed.needsAttentionCount,
      lastReconciledAt: parsed.lastReconciledAt,
      locationId: parsed.locationId,
    };
  } catch {
    throw new ValidationError('Invalid page cursor');
  }
}

function encodeCursor(value: Record<string, unknown> | null, kind: 'time' | 'merchant'): string | null {
  if (!value) return null;
  const normalized = kind === 'time'
    ? {
      at: String(value.lastObservedAt || value.lastSeenAt || ''),
      id: String(value.id || ''),
    }
    : {
      needsAttentionCount: Number(value.needsAttentionCount),
      lastReconciledAt: String(value.lastReconciledAt || ''),
      locationId: String(value.locationId || ''),
    };
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
}

function hasPlatformPortfolioAccess(req: Request): boolean {
  const actor = req.operatorContext!;
  return actor.organizationType === 'platform'
    && actor.permissions.has('platform.merchants.read');
}

function canViewMerchantScopedRow(req: Request, row: Record<string, unknown>): boolean {
  const actor = req.operatorContext!;
  if (hasPlatformPortfolioAccess(req)) return true;
  const locationId = typeof row.location_id === 'string' ? row.location_id : '';
  if (!locationId) return row.scope_type !== 'merchant';
  return operatorAuthorizationService.canAccessLocation(actor, locationId);
}

router.use(base, operatorFeatureAndHost);
router.use(base, requireOperatorAuthEnabled);

router.get(`${base}/assets/auth.css`, (_req, res) => {
  res.type('text/css').send(operatorAuthCss);
});

router.get(`${base}/assets/auth.js`, (_req, res) => {
  res.type('application/javascript').send(operatorAuthJs);
});

router.get(`${base}/assets/command-center.css`, (_req, res) => {
  res.type('text/css').send(operatorCommandCenterCss);
});

router.get(`${base}/assets/command-center.js`, (_req, res) => {
  res.type('application/javascript').send(operatorCommandCenterJs);
});

router.get(`${base}/login`, (_req, res) => res.type('html').send(operatorLoginHtml()));
router.get(`${base}/invite`, (_req, res) => res.type('html').send(operatorInviteHtml()));
router.get(`${base}/home`, (_req, res) => res.type('html').send(operatorCommandCenterHtml()));
router.get(base, (_req, res) => res.redirect(302, `${base}/home`));

router.post(`${base}/auth/start`, requireOperatorOrigin, asyncRoute(async (req, res) => {
  const result = await operatorAuthService.startPasswordAuthentication(req, req.body?.email, req.body?.password);
  setOperatorPendingCookie(res, result.pendingToken, result.expiresInSeconds);
  res.json({ next: result.next, expiresInSeconds: result.expiresInSeconds });
}));

router.post(`${base}/auth/mfa/enroll`, requireOperatorOrigin, asyncRoute(async (req, res) => {
  const pendingToken = parseCookies(req)[OPERATOR_PENDING_COOKIE] || '';
  const result = await operatorAuthService.enrollTotp(req, pendingToken);
  res.json(result);
}));

router.post(`${base}/auth/mfa/verify`, requireOperatorOrigin, asyncRoute(async (req, res) => {
  const pendingToken = parseCookies(req)[OPERATOR_PENDING_COOKIE] || '';
  const result = await operatorAuthService.verifyTotp(req, pendingToken, req.body?.code);
  clearOperatorPendingCookie(res);
  setOperatorSessionCookies(res, result);
  res.json({ authenticated: true });
}));

router.post(`${base}/auth/invitations/accept`, requireOperatorOrigin, asyncRoute(async (req, res) => {
  await operatorAuthService.acceptInvitation(req, {
    invitationToken: req.body?.invitationToken,
    email: req.body?.email,
    password: req.body?.password,
    displayName: req.body?.displayName,
  });
  res.status(204).send();
}));

router.post(
  `${base}/auth/logout`,
  requireOperatorSession,
  requireOperatorOrigin,
  requireOperatorCsrf,
  asyncRoute(async (req, res) => {
    const actor = req.operatorContext!;
    const correlationId = crypto.randomUUID();
    await operatorAuthorizationService.auditRequest(req, {
      correlationId,
      actorOperatorUserId: actor.operatorUserId,
      actorOrganizationId: actor.organizationId,
      actorRole: actor.role,
      actorSessionId: actor.sessionId,
      action: 'operator.auth.logout',
      result: 'intent',
      targetType: 'operator_session',
      targetId: actor.sessionId,
    });
    await operatorRepository.revokeCurrentSession({
      sessionId: actor.sessionId,
      actorOperatorUserId: actor.operatorUserId,
      reason: 'logout',
      correlationId,
    });
    clearOperatorSessionCookies(res);
    res.status(204).send();
  }),
);

router.get(
  `${base}/api/session`,
  requireOperatorSession,
  requireOperatorPermission('operator.session.read'),
  (req: Request, res: Response) => {
    const actor = req.operatorContext!;
    res.json({
      operatorUserId: actor.operatorUserId,
      organizationId: actor.organizationId,
      organizationType: actor.organizationType,
      role: actor.role,
      authAssurance: actor.authAssurance,
    });
  },
);

router.get(
  `${base}/api/health`,
  requireOperatorHealthEnabled,
  requireOperatorSession,
  requireOperatorPermission('platform.health.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    const limit = pageLimit(req.query.limit, 200);
    const canViewMerchantIdentity = hasPlatformPortfolioAccess(req);
    const [page, rawSummary] = await Promise.all([
      commandCenterHealthRepository.getPlatformOverviewPage({
        limit,
        checksCursor: decodeCursor(req.query.checksCursor, 'time'),
        incidentsCursor: decodeCursor(req.query.incidentsCursor, 'time'),
        merchantsCursor: decodeCursor(req.query.merchantsCursor, 'merchant'),
      }),
      commandCenterHealthRepository.getOperatorPlatformSummary(canViewMerchantIdentity),
    ]);
    const checks = page.checks
      .map((item) => projectOperatorHealthCheck(item, canViewMerchantScopedRow(req, item)))
      .filter(Boolean);
    const incidents = page.incidents
      .map((item) => projectOperatorIncident(item, canViewMerchantScopedRow(req, item)))
      .filter(Boolean);
    const summary = {
      platform_state: rawSummary.platform_state,
      health_checks_total: Number(rawSummary.health_checks_total || 0),
      health_unhealthy_count: Number(rawSummary.health_unhealthy_count || 0),
      health_unknown_count: Number(rawSummary.health_unknown_count || 0),
      active_incident_count: Number(rawSummary.active_incident_count || 0),
      active_critical_count: Number(rawSummary.active_critical_count || 0),
      merchant_count: Number(rawSummary.merchant_count || 0),
      merchant_attention_count: Number(rawSummary.merchant_attention_count || 0),
      merchant_rollup_count: Number(rawSummary.merchant_rollup_count || 0),
      merchant_attention: canViewMerchantIdentity && Array.isArray(rawSummary.merchant_attention)
        ? rawSummary.merchant_attention
        : [],
    };
    res.json({
      generatedAt: new Date().toISOString(),
      contractVersion: 'command-center-health-v1.2',
      summary,
      checks,
      incidents,
      merchants: summary.merchant_attention,
      pagination: {
        checksCursor: encodeCursor(page.next.checks, 'time'),
        incidentsCursor: encodeCursor(page.next.incidents, 'time'),
        merchantsCursor: encodeCursor(page.next.merchants, 'merchant'),
      },
    });
  }),
);

router.get(
  `${base}/api/incidents`,
  requireOperatorHealthEnabled,
  requireOperatorSession,
  requireOperatorPermission('platform.health.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    const limit = pageLimit(req.query.limit, 100);
    const includeResolved = String(req.query.includeResolved || '') === 'true';
    const page = await commandCenterHealthRepository.listIncidentsPage({
      limit,
      includeResolved,
      cursor: decodeCursor(req.query.cursor, 'time'),
    });
    res.json({
      incidents: page.incidents
        .map((item) => projectOperatorIncident(item, canViewMerchantScopedRow(req, item)))
        .filter(Boolean),
      nextCursor: encodeCursor(page.next, 'time'),
    });
  }),
);

const mutationMiddleware = [requireOperatorSession, requireOperatorOrigin, requireOperatorCsrf];

router.post(
  `${base}/api/incidents/:incidentId/acknowledge`,
  requireOperatorHealthEnabled,
  ...mutationMiddleware,
  requireOperatorPermission('platform.incidents.manage', { hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    const incident = await commandCenterIncidentService.acknowledge(
      req,
      req.params.incidentId,
      req.body?.summary,
    );
    res.json({ incident });
  }),
);

router.post(
  `${base}/api/incidents/:incidentId/suppress`,
  requireOperatorHealthEnabled,
  ...mutationMiddleware,
  requireOperatorPermission('platform.incidents.manage', { hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    const incident = await commandCenterIncidentService.suppress(
      req,
      req.params.incidentId,
      req.body || {},
    );
    res.json({ incident });
  }),
);

router.post(
  `${base}/api/organizations/resellers`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.organizations.manage'),
  asyncRoute(async (req, res) => {
    const organization = await operatorAdminService.createResellerOrganization(req, req.body || {});
    res.status(201).json({
      id: organization.id,
      organizationType: organization.organization_type,
      name: organization.name,
      status: organization.status,
    });
  }),
);

router.post(
  `${base}/api/invitations`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.invitations.manage'),
  asyncRoute(async (req, res) => {
    const invitation = await operatorAdminService.createInvitation(req, req.body || {});
    res.status(201).json(invitation);
  }),
);

router.post(
  `${base}/api/assignments/transfer`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.assignments.manage'),
  asyncRoute(async (req, res) => {
    const assignment = await operatorAdminService.transferAssignment(req, req.body || {});
    res.json({
      id: assignment.id,
      locationId: assignment.location_id,
      resellerOrganizationId: assignment.reseller_organization_id,
      status: assignment.status,
      effectiveAt: assignment.effective_at,
    });
  }),
);

router.post(
  `${base}/api/support-grants`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.support_grants.manage'),
  asyncRoute(async (req, res) => {
    const grant = await operatorAdminService.requestSupportGrant(req, req.body || {});
    res.status(201).json({
      id: grant.id,
      locationId: grant.location_id,
      status: grant.status,
      expiresAt: grant.expires_at,
    });
  }),
);

router.post(
  `${base}/api/support-grants/:grantId/approve`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.support_grants.manage'),
  asyncRoute(async (req, res) => {
    const grant = await operatorAdminService.approveSupportGrant(req, req.params.grantId);
    res.json({ id: grant.id, locationId: grant.location_id, status: grant.status });
  }),
);

router.post(
  `${base}/api/support-grants/:grantId/revoke`,
  ...mutationMiddleware,
  requireOperatorPermission('operator.support_grants.manage'),
  asyncRoute(async (req, res) => {
    const grant = await operatorAdminService.revokeSupportGrant(req, req.params.grantId);
    res.json({ id: grant.id, locationId: grant.location_id, status: grant.status });
  }),
);

router.get(
  `${base}/api/merchants`,
  requireOperatorHealthEnabled,
  requireOperatorSession,
  requireOperatorPermission('platform.merchants.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    if (!hasPlatformPortfolioAccess(req)) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    const component = optionalEnum(
      req.query.component,
      ['processor', 'workflow', 'evidence', 'defense', 'billing'],
      'component',
    );
    const componentState = optionalEnum(
      req.query.componentState,
      ['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'],
      'component state',
    );
    if (Boolean(component) !== Boolean(componentState)) {
      throw new ValidationError('Component and component state must be selected together');
    }
    const page = await commandCenterHealthRepository.listOperatorMerchantsPage({
      limit: pageLimit(req.query.limit, 50),
      offset: pageOffset(req.query.offset),
      query: optionalQuery(req.query.query),
      state: optionalEnum(
        req.query.state,
        ['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'],
        'merchant state',
      ),
      plan: optionalEnum(
        req.query.plan,
        ['legacy', 'test', 'standard', 'wholepay', 'unknown'],
        'plan',
      ),
      processor: optionalEnum(req.query.processor, ['stripe', 'nmi', 'whop'], 'processor'),
      installation: optionalEnum(
        req.query.installation,
        ['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'],
        'installation state',
      ),
      reseller: optionalReseller(req.query.reseller),
      incidentSeverity: optionalEnum(
        req.query.incidentSeverity,
        ['critical', 'urgent', 'warning', 'info'],
        'incident severity',
      ),
      component,
      componentState,
    });
    res.json(page);
  }),
);

router.get(
  `${base}/api/incidents/:incidentId`,
  requireOperatorHealthEnabled,
  requireOperatorSession,
  requireOperatorPermission('platform.health.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    if (!UUID_PATTERN.test(req.params.incidentId)) throw new ValidationError('Invalid incident ID');
    const raw = await commandCenterHealthRepository.getIncidentById(req.params.incidentId);
    if (!raw || !canViewMerchantScopedRow(req, raw)) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    const incident = projectOperatorIncident(raw, true);
    if (!incident) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    res.json({ incident });
  }),
);

router.get(
  `${base}/api/resellers`,
  requireOperatorSession,
  requireOperatorPermission('platform.resellers.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    if (req.operatorContext!.organizationType !== 'platform') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    const page = await commandCenterHealthRepository.listOperatorResellersPage({
      limit: pageLimit(req.query.limit, 100),
      offset: pageOffset(req.query.offset),
    });
    res.json(page);
  }),
);

router.get(
  `${base}/api/runbooks`,
  requireOperatorSession,
  requireOperatorPermission('platform.health.read', { sensitiveRead: true, hideUnauthorized: true }),
  (_req: Request, res: Response) => {
    res.json({ runbooks: OPERATOR_RUNBOOKS });
  },
);

router.get(
  `${base}/api/merchants/:locationId`,
  requireOperatorSession,
  requireOperatorPermission('merchant.summary.read', { locationParam: 'locationId', sensitiveRead: true }),
  asyncRoute(async (req, res) => {
    const actor = req.operatorContext!;
    if (actor.organizationType === 'reseller') {
      const merchant = await operatorRepository.getMerchantSummary(req.params.locationId);
      if (!merchant) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
        return;
      }
      res.json({
        locationId: merchant.location_id,
        businessName: merchant.business_name,
        status: merchant.status,
        installedAt: merchant.installed_at,
        marketplacePlan: merchant.marketplace_plan_key,
        marketplaceBillingStatus: merchant.marketplace_billing_status,
      });
      return;
    }

    const merchant = await commandCenterHealthRepository.getOperatorMerchantDetail(req.params.locationId);
    if (!merchant) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }
    res.json(merchant);
  }),
);

router.get(
  `${base}/api/audit`,
  requireOperatorSession,
  requireOperatorPermission('operator.audit.read', { sensitiveRead: true, hideUnauthorized: true }),
  asyncRoute(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || '100'), 10);
    const events = await operatorRepository.listAuditEvents(limit);
    res.json({ events });
  }),
);

export default router;
