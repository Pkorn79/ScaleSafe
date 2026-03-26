import { Router } from 'express';
import { enrollmentController } from '../controllers/enrollment.controller';

const router = Router();

// Enrollment endpoints are PUBLIC (client-facing funnel, no SSO)
router.post('/prep', enrollmentController.prep);
router.get('/offer/:id', enrollmentController.getOffer);
router.post('/consent', enrollmentController.captureConsent);

export default router;
