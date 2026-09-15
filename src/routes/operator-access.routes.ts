import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { requireOperatorCsrf, requireOperatorOrigin, requireOperatorPermission, requireOperatorSession } from '../middleware/operatorAuth';
import { AccessFilters, AccessProduct, operatorMerchantAccessService, projectEnrollmentAccess } from '../services/operator-merchant-access.service';
import { operatorEvidenceAccessService } from '../services/operator-evidence-access.service';
import { operatorAuthorizationService } from '../services/operator-authorization.service';
import { NotFoundError, ValidationError } from '../utils/errors';

const router = Router();
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
}
function product(req: Request): AccessProduct {
  const value = req.params.product;
  if (value !== 'enrollments' && value !== 'evidence') throw new NotFoundError('Product');
  const actor = req.operatorContext!;
  if (actor.organizationType !== 'platform' || !actor.permissions.has(value === 'evidence' ? 'platform.evidence.read' : 'platform.merchants.read')) throw new NotFoundError('Product');
  return value;
}
function location(req: Request): string {
  const value = req.params.locationId;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value || '')) throw new ValidationError('Invalid location');
  return value;
}
function filters(req: Request): AccessFilters {
  const { query = '', status = 'all', limit = '50', offset = '0' } = req.query;
  if (typeof query !== 'string' || query.length > 100 || typeof status !== 'string' || !['all', 'pending', 'active', 'disconnected'].includes(status)
    || typeof limit !== 'string' || !/^\d+$/.test(limit) || +limit < 1 || +limit > 50
    || typeof offset !== 'string' || !/^\d+$/.test(offset) || +offset > 100000) throw new ValidationError('Invalid access filters');
  return { query: query.trim(), status: status as AccessFilters['status'], limit: +limit, offset: +offset };
}
router.use(requireOperatorSession);
router.get('/:product', requireOperatorPermission('platform.merchants.read', { sensitiveRead: true, hideUnauthorized: true }), route(async (req, res) => {
  const selected = product(req);
  const input = filters(req);
  res.json(selected === 'enrollments' ? await operatorMerchantAccessService.list(input) : await operatorEvidenceAccessService.list(input));
}));
router.get('/:product/:locationId', requireOperatorPermission('platform.merchants.read', { sensitiveRead: true, hideUnauthorized: true }), route(async (req, res) => {
  const selected = product(req);
  const id = location(req);
  res.json(selected === 'enrollments' ? { merchant: projectEnrollmentAccess(await operatorMerchantAccessService.read(id)), approvalAvailable: true } : await operatorEvidenceAccessService.get(id));
}));
router.post('/:product/:locationId/approve', requireOperatorOrigin, requireOperatorCsrf,
  requireOperatorPermission('platform.merchant_access.approve', { locationParam: 'locationId', hideUnauthorized: true }), route(async (req, res) => {
    const selected = product(req);
    const id = location(req);
    const actor = req.operatorContext!;
    // Defense in depth: this first release grants no approval authority to ops,
    // support, auditors or resellers even if a future role mapping changes.
    if (actor.role !== 'platform_owner') throw new NotFoundError('Approval');
    const { version, note, wholepayVerified = false, merchantReference = '' } = req.body || {};
    if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || typeof note !== 'string' || note.trim().length < 3 || note.length > 500
      || typeof wholepayVerified !== 'boolean' || typeof merchantReference !== 'string' || merchantReference.length > 100) throw new ValidationError('Enter a reason and reload the current merchant before approving');
    const input = { version, note: note.trim(), wholepayVerified, merchantReference: merchantReference.trim() };
    const correlationId = crypto.randomUUID();
    const audit = { correlationId, actorOperatorUserId: actor.operatorUserId, actorOrganizationId: actor.organizationId,
      actorSessionId: actor.sessionId, actorRole: actor.role, action: `operator.access.${selected}.approve`,
      targetLocationId: id, targetType: `${selected}_installation`, targetId: id };
    await operatorAuthorizationService.auditRequest(req, { ...audit, result: 'intent', metadata: { version, note: input.note, wholepayVerified } });
    let merchant;
    try {
      merchant = selected === 'enrollments' ? await operatorMerchantAccessService.approve(req, id, input)
        : await operatorEvidenceAccessService.approve(id, input, actor.operatorUserId, actor.sessionId, correlationId);
    } catch (error) {
      await operatorAuthorizationService.auditRequest(req, { ...audit, result: 'failed', metadata: { outcome: 'not_confirmed_reload_required' } }).catch(() => undefined);
      throw error;
    }
    let auditComplete = true;
    await operatorAuthorizationService.auditRequest(req, { ...audit, result: 'succeeded', metadata: { accessAllowed: merchant.accessAllowed, approvedAt: merchant.approvedAt } }).catch(() => { auditComplete = false; });
    res.json({ merchant, auditComplete, correlationId });
  }));
export default router;
