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

export default router;
