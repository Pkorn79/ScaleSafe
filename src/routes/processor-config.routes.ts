import { Router } from 'express';
import { processorConfigController } from '../controllers/processor-config.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.post('/nmi', processorConfigController.createNmi);
router.post('/nmi/test', processorConfigController.testNmi);
router.delete('/nmi', processorConfigController.disconnectNmi);
router.post('/default', processorConfigController.setDefaultProcessor);

export default router;
