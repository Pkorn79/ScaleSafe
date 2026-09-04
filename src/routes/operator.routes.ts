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
import {
  operatorAuthCss,
  operatorAuthJs,
  operatorHomeHtml,
  operatorInviteHtml,
  operatorLoginHtml,
} from '../operator-auth-page';
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

router.use(base, operatorFeatureAndHost);
router.use(base, requireOperatorAuthEnabled);

router.get(`${base}/assets/auth.css`, (_req, res) => {
  res.type('text/css').send(operatorAuthCss);
});

router.get(`${base}/assets/auth.js`, (_req, res) => {
  res.type('application/javascript').send(operatorAuthJs);
});

router.get(`${base}/login`, (_req, res) => res.type('html').send(operatorLoginHtml()));
router.get(`${base}/invite`, (_req, res) => res.type('html').send(operatorInviteHtml()));
router.get(`${base}/home`, (_req, res) => res.type('html').send(operatorHomeHtml()));
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
    const page = await commandCenterHealthRepository.getPlatformOverviewPage({
      limit,
      checksCursor: decodeCursor(req.query.checksCursor, 'time'),
      incidentsCursor: decodeCursor(req.query.incidentsCursor, 'time'),
      merchantsCursor: decodeCursor(req.query.merchantsCursor, 'merchant'),
    });
    res.json({
      generatedAt: new Date().toISOString(),
      contractVersion: 'command-center-health-v1.1',
      checks: page.checks,
      incidents: page.incidents,
      merchants: page.merchants,
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
      incidents: page.incidents,
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
  `${base}/api/merchants/:locationId`,
  requireOperatorSession,
  requireOperatorPermission('merchant.summary.read', { locationParam: 'locationId', sensitiveRead: true }),
  asyncRoute(async (req, res) => {
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
  }),
);

router.get(
  `${base}/api/audit`,
  requireOperatorSession,
  requireOperatorPermission('operator.audit.read', { sensitiveRead: true }),
  asyncRoute(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit || '100'), 10);
    const events = await operatorRepository.listAuditEvents(limit);
    res.json({ events });
  }),
);

export default router;
