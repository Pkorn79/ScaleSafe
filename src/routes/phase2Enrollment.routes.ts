import { Router } from 'express';
import { phase2EnrollmentController } from '../controllers/phase2Enrollment.controller';
import { ssoAuth } from '../middleware/ssoAuth';

const router = Router();

// Merchant-authenticated enrollment list & detail
router.get('/', ssoAuth, phase2EnrollmentController.list);
router.get('/:id', ssoAuth, phase2EnrollmentController.detail);

export default router;
