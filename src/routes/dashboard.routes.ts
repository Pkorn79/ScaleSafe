import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';

const router = Router();

router.use(ssoAuth, requireTenant);

router.get('/overview', dashboardController.overview);
router.get('/clients', dashboardController.clients);
router.get('/at-risk', dashboardController.atRisk);
router.get('/evidence-health', dashboardController.evidenceHealth);
router.get('/defense-history', dashboardController.defenseHistory);
router.get('/client-info/:contactId', dashboardController.clientInfo);
router.get('/client-enrollments/:contactId', dashboardController.clientEnrollments);
router.get('/client-activity/:contactId', dashboardController.clientActivity);
router.get('/client-communications/:contactId', dashboardController.clientCommunications);
router.get('/client-files/:contactId', dashboardController.clientFiles);
router.post('/client-note', dashboardController.addClientNote);
router.post('/client-message', dashboardController.sendClientMessage);
router.post('/mark-milestone', dashboardController.markMilestone);
router.post('/add-client', dashboardController.addClient);
router.post('/assign-offer', dashboardController.assignOffer);
router.post('/pay-first-enrollment', dashboardController.recordPayFirstEnrollment);
router.post('/enrollments/:enrollmentId/resend-paid-link', dashboardController.resendPaidEnrollmentLink);
router.post('/enrollments/:enrollmentId/send-test-pulse', dashboardController.sendTestPulse);
router.get('/manual-sale/config', dashboardController.manualSaleConfig);
router.post('/manual-sale/whop-session', dashboardController.createManualSaleWhopSession);
router.post('/manual-sale/stripe-ach/intent', dashboardController.createManualSaleStripeAchIntent);
router.post('/manual-sale/stripe-ach/finalize', dashboardController.finalizeManualSaleStripeAch);
router.post('/manual-sale/charge', dashboardController.chargeManualSale);

export default router;
