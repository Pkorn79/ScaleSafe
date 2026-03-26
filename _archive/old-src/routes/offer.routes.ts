/**
 * offer.routes.ts — Offer API Endpoints
 *
 * CRUD operations for coaching program offers.
 * All routes require SSO authentication except the T&C clauses list.
 */

import { Router } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { tenantContext } from '../middleware/tenantContext';
import * as offerCtrl from '../controllers/offer.controller';

const router = Router();

// All offer routes require SSO auth + tenant context
router.use(ssoAuth);
router.use(tenantContext);

router.get('/', offerCtrl.listOffers);
router.post('/', offerCtrl.createOffer);
router.get('/clauses', offerCtrl.getStandardClauses);
router.get('/:id', offerCtrl.getOffer);
router.put('/:id', offerCtrl.updateOffer);
router.get('/:id/tc-preview', offerCtrl.previewTc);

export default router;
