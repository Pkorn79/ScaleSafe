import { Router, Request, Response, NextFunction } from 'express';
import { reconciliationService } from '../services/reconciliation.service';
import { disengagementService } from '../services/disengagement.service';
// notificationService import removed — at-risk now handled by contact field update in disengagement service
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

const router = Router();

router.use(ssoAuth, requireTenant);

/** POST /api/admin/reconciliation/run — trigger reconciliation for this merchant */
router.post('/reconciliation/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const result = await reconciliationService.runForMerchant(locationId);
    res.json(result);
  } catch (err) { next(err); }
});

/** POST /api/admin/idempotency/cleanup — purge old idempotency keys */
router.post('/idempotency/cleanup', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const purged = await reconciliationService.cleanupIdempotencyKeys();
    res.json({ purged });
  } catch (err) { next(err); }
});

/** POST /api/admin/disengagement/run — run disengagement check for this merchant */
router.post('/disengagement/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    // checkAllClients now sets ss_engagement_status = 'At Risk' directly on GHL contacts
    const flagged = await disengagementService.checkAllClients(locationId);
    res.json({ flagged: flagged.length, clients: flagged });
  } catch (err) { next(err); }
});

export default router;
