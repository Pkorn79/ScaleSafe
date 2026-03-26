/**
 * admin.routes.ts — Admin / System Operations Endpoints
 *
 * Internal endpoints for system maintenance:
 * - Reconciliation (compare AB transactions vs evidence records)
 * - Idempotency cleanup (purge old keys)
 * - Subscription management (pause/resume/cancel)
 *
 * All routes require SSO authentication.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { tenantContext } from '../middleware/tenantContext';
import * as reconciliationService from '../services/reconciliation.service';
import * as subscriptionService from '../services/subscription.service';
import { BadRequestError } from '../utils/errors';

const router = Router();

router.use(ssoAuth);
router.use(tenantContext);

/** Trigger daily reconciliation (compares AB transactions vs evidence). */
router.post('/reconciliation/run', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await reconciliationService.runDailyReconciliation();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Cleanup old idempotency keys (> 90 days). */
router.post('/idempotency/cleanup', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await reconciliationService.cleanupOldIdempotencyKeys();
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

/** Pause a client's installment schedule. */
router.post('/subscriptions/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.body;
    if (!contactId) throw new BadRequestError('contactId is required');
    await subscriptionService.pause(locationId, contactId);
    res.json({ success: true, message: 'Subscription paused' });
  } catch (error) {
    next(error);
  }
});

/** Resume a paused installment schedule. */
router.post('/subscriptions/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.body;
    if (!contactId) throw new BadRequestError('contactId is required');
    await subscriptionService.resume(locationId, contactId);
    res.json({ success: true, message: 'Subscription resumed' });
  } catch (error) {
    next(error);
  }
});

/** Cancel an installment schedule. */
router.post('/subscriptions/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId, reason } = req.body;
    if (!contactId) throw new BadRequestError('contactId is required');
    await subscriptionService.cancel(locationId, contactId, reason);
    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    next(error);
  }
});

/** Get subscription status for a contact. */
router.get('/subscriptions/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.params;
    const status = await subscriptionService.getStatus(locationId, contactId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

export default router;
