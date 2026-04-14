import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.get('/overview', dashboardController.overview);
router.get('/at-risk', dashboardController.atRisk);
router.get('/evidence-health', dashboardController.evidenceHealth);
router.get('/defense-history', dashboardController.defenseHistory);
router.get('/client-info/:contactId', dashboardController.clientInfo);
router.get('/client-enrollments/:contactId', dashboardController.clientEnrollments);
router.post('/client-note', dashboardController.addClientNote);
router.post('/client-message', dashboardController.sendClientMessage);

export default router;
