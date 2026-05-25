import { Router, Request, Response, NextFunction } from 'express';
import { evidenceService } from '../services/evidence.service';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

const router = Router();

router.use(ssoAuth, requireTenant);

/** GET /api/evidence/:contactId — evidence timeline (paginated + filterable) */
router.get('/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const type = (req.query.type as string) || undefined;
    const from = (req.query.from as string) || undefined;
    const to = (req.query.to as string) || undefined;

    const result = await evidenceService.getTimeline(locationId, req.params.contactId, {
      limit, offset, type, from, to,
    });
    // Response shape: { rows, total } — frontend handles both shapes for b/c
    res.json(result);
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

/** POST /api/evidence/:contactId/link-program - manually link a client-level evidence row to an enrollment */
router.post('/:contactId/link-program', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const evidenceTable = String(req.body?.evidenceTable || '');
    const evidenceId = String(req.body?.evidenceId || '');
    const enrollmentId = String(req.body?.enrollmentId || '');
    if (!evidenceTable || !evidenceId || !enrollmentId) {
      throw new ValidationError('evidenceTable, evidenceId, and enrollmentId required');
    }

    await evidenceService.linkEvidenceToEnrollment(
      locationId,
      req.params.contactId,
      evidenceTable,
      evidenceId,
      enrollmentId,
    );
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

export default router;
