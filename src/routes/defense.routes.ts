import { Router } from 'express';
import { defenseController } from '../controllers/defense.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.post('/compile', defenseController.compile);
router.get('/:id', defenseController.getById);
router.get('/:id/status', defenseController.getStatus);
router.get('/contact/:contactId', defenseController.listForContact);
router.post('/:id/outcome', defenseController.recordOutcome);

export default router;
