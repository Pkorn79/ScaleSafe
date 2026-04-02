import { Router } from 'express';
import multer from 'multer';
import { merchantController } from '../controllers/merchant.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

router.use(ssoAuth, requireTenant);

router.get('/config', merchantController.getConfig);
router.put('/config', merchantController.updateConfig);
router.get('/onboarding-status', merchantController.getOnboardingStatus);
router.post('/provision', merchantController.provision);
router.post('/logo', upload.single('logo'), merchantController.uploadLogo);

export default router;
