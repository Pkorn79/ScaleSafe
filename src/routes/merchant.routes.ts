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
router.get('/webhook-secret', merchantController.getWebhookSecret);
router.post('/webhook-secret/rotate', merchantController.rotateWebhookSecret);
router.get('/ghl-activity/setup', merchantController.getGhlActivitySetup);
router.post('/ghl-activity/match-rules', merchantController.saveGhlActivityMatchRule);
router.delete('/ghl-activity/match-rules/:id', merchantController.deleteGhlActivityMatchRule);
router.post('/ghl-activity/appointment-mappings', merchantController.saveGhlAppointmentMapping);
router.delete('/ghl-activity/appointment-mappings/:id', merchantController.deleteGhlAppointmentMapping);
router.get('/onboarding-status', merchantController.getOnboardingStatus);
router.get('/provisioning-health', merchantController.getProvisioningHealth);
router.post('/provisioning-health/repair-webhook-secret', merchantController.repairWebhookSecretCustomValue);
router.post('/provisioning-health/repair-custom-fields', merchantController.repairWorkflowCustomFields);
router.post('/provisioning-health/custom-field-cleanup', merchantController.cleanupWorkflowCustomFields);
router.post('/provision', merchantController.provision);
router.post('/logo', upload.single('logo'), merchantController.uploadLogo);

export default router;
