import { Router } from 'express';
import { offerController } from '../controllers/offer.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

// All offer routes require SSO auth (merchant must be logged in via GHL)
router.use(ssoAuth, requireTenant);

router.post('/', offerController.create);
router.get('/', offerController.list);
router.get('/dual-pricing/config', offerController.dualPricingConfig);
router.put('/dual-pricing/config', offerController.updateDualPricingConfig);
router.post('/quote', offerController.quote);
router.get('/:id', offerController.getById);
router.put('/:id', offerController.update);
router.delete('/:id', offerController.delete);
router.get('/:id/enrollment-link', offerController.getEnrollmentLink);
router.post('/:id/clone', offerController.clone);

export default router;
