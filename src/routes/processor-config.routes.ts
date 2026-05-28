import { Router } from 'express';
import { processorConfigController } from '../controllers/processor-config.controller';
import { whopConfigController } from '../controllers/whop-config.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.post('/nmi', processorConfigController.createNmi);
router.post('/nmi/test', processorConfigController.testNmi);
router.get('/nmi/webhook', processorConfigController.getNmiWebhook);
router.post('/nmi/webhook/key', processorConfigController.saveNmiWebhookKey);
router.delete('/nmi', processorConfigController.disconnectNmi);
router.post('/default', processorConfigController.setDefaultProcessor);
router.get('/whop', whopConfigController.get);
router.post('/whop', whopConfigController.save);
router.post('/whop/test', whopConfigController.test);
router.delete('/whop', whopConfigController.disconnect);

export default router;
