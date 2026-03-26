/**
 * defense.routes.ts — Defense API Endpoints
 *
 * All routes require SSO authentication.
 * The compile endpoint returns immediately with a defenseId — the actual
 * compilation runs asynchronously and can be polled via the status endpoint.
 */

import { Router } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { tenantContext } from '../middleware/tenantContext';
import * as defenseCtrl from '../controllers/defense.controller';

const router = Router();

// All defense routes require SSO auth + tenant context
router.use(ssoAuth);
router.use(tenantContext);

/** Trigger a defense compilation (returns immediately, runs async). */
router.post('/compile', defenseCtrl.triggerCompilation);

/** Poll compilation status. */
router.get('/:id/status', defenseCtrl.getStatus);

/** Download the defense PDF. */
router.get('/:id/download', defenseCtrl.downloadPdf);

/** List all defense packets for a contact. */
router.get('/contact/:contactId', defenseCtrl.listForContact);

export default router;
