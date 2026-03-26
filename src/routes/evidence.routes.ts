import { Router, Request, Response, NextFunction } from 'express';
import { evidenceService } from '../services/evidence.service';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

const router = Router();

router.use(ssoAuth, requireTenant);

/** GET /api/evidence/:contactId — full evidence timeline */
router.get('/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const timeline = await evidenceService.getTimeline(locationId, req.params.contactId);
    res.json(timeline);
  } catch (err) { next(err); }
});

/** GET /api/evidence/:contactId/score — Defense Readiness Score */
router.get('/:contactId/score', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const result = await evidenceService.calculateReadinessScore(locationId, req.params.contactId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
