import { Router } from 'express';
import { offerController } from '../controllers/offer.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

// All offer routes require SSO auth (merchant must be logged in via GHL)
router.use(ssoAuth, requireTenant);

router.post('/', offerController.create);
router.get('/', offerController.list);
router.get('/:id', offerController.getById);
router.put('/:id', offerController.update);
router.delete('/:id', offerController.delete);
router.get('/:id/enrollment-link', offerController.getEnrollmentLink);

export default router;
