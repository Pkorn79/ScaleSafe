import { Router } from 'express';
import { defenseController } from '../controllers/defense.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.get('/transactions/:contactId', defenseController.getTransactions);
router.post('/compile', defenseController.compile);
router.post('/:id/submit', defenseController.markSubmitted);
router.post('/:id/outcome', defenseController.recordOutcome);
router.post('/:id/regenerate', defenseController.regenerateLetter);
router.put('/:id/letter', defenseController.saveLetterEdit);
router.get('/:id/versions', defenseController.getVersions);
router.post('/:id/rebundle', defenseController.rebundle);
router.get('/:id/status', defenseController.getStatus);
router.get('/:id', defenseController.getById);
router.get('/contact/:contactId', defenseController.listForContact);

export default router;
