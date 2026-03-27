import { Router } from 'express';
import { merchantController } from '../controllers/merchant.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.get('/config', merchantController.getConfig);
router.put('/config', merchantController.updateConfig);
router.post('/provision', merchantController.provision);

export default router;
