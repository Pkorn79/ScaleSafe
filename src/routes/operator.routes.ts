import crypto from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import {
  operatorFeatureAndHost,
  requireOperatorAuthEnabled,
  requireOperatorCsrf,
  requireOperatorOrigin,
  requireOperatorPermission,
  requireOperatorSession,
} from '../middleware/operatorAuth';
import { operatorRepository } from '../repositories/operator.repository';
import { operatorAdminService } from '../services/operator-admin.service';
import { operatorAuthService } from '../services/operator-auth.service';
import { operatorAuthorizationService } from '../services/operator-authorization.service';
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

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
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

const mutationMiddleware = [requireOperatorSession, requireOperatorOrigin, requireOperatorCsrf];

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
