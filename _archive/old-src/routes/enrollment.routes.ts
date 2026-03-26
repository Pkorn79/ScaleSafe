/**
 * enrollment.routes.ts — Enrollment API Endpoints
 *
 * Mixed auth: some endpoints are public (client-facing enrollment pages),
 * some require SSO (merchant-initiated prep).
 */

import { Router } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import * as enrollmentCtrl from '../controllers/enrollment.controller';

const router = Router();

/** Public: fetch offer data for enrollment page (Page 2). */
router.get('/offer/:offerId', enrollmentCtrl.getOfferForEnrollment);

/** Public: process payment from enrollment page (Page 4). */
router.post('/charge', enrollmentCtrl.processCharge);

/** SSO required: prepare enrollment (populate contact fields). */
router.post('/prepare', ssoAuth, enrollmentCtrl.prepareEnrollment);

export default router;
