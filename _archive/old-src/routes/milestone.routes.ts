/**
 * milestone.routes.ts — Milestone Sign-Off Endpoints
 *
 * Public endpoints (no SSO) — clients click a link to view and sign off
 * on milestones. The link includes locationId and contactId as parameters.
 */

import { Router } from 'express';
import * as milestoneCtrl from '../controllers/milestone.controller';

const router = Router();

/** Public: get sign-off page data for a client. */
router.get('/signoff/:contactId', milestoneCtrl.getSignOffPage);

/** Public: submit a milestone sign-off. */
router.post('/signoff', milestoneCtrl.submitSignOff);

export default router;
