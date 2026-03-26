/**
 * merchant.routes.ts — Merchant API Endpoints
 *
 * Settings, credential sync, and onboarding.
 * All routes require SSO authentication.
 */

import { Router } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { tenantContext } from '../middleware/tenantContext';
import * as merchantCtrl from '../controllers/merchant.controller';

const router = Router();

router.use(ssoAuth);
router.use(tenantContext);

/** Get merchant config (module toggles, incentive settings, business info). */
router.get('/config', merchantCtrl.getConfig);

/** Update merchant settings. */
router.put('/config', merchantCtrl.updateConfig);

/** Re-fetch accept.blue credentials from GHL Custom Values. */
router.post('/sync-credentials', merchantCtrl.syncCredentials);

/** Handle merchant onboarding funnel submission. */
router.post('/onboard', merchantCtrl.handleOnboarding);

export default router;
