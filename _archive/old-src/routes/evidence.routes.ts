/**
 * evidence.routes.ts — Evidence API Endpoints
 *
 * Provides read access to evidence data for the merchant portal.
 * All routes require SSO authentication (merchant must be logged into GHL).
 *
 * These endpoints are used by the Evidence Viewer in the Vue frontend
 * and by the Defense Compiler to gather evidence for a contact.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import * as evidenceService from '../services/evidence.service';
import { EVIDENCE_TABLES } from '../constants/evidence-types';
import { BadRequestError } from '../utils/errors';

const router = Router();

// All evidence routes require SSO authentication
router.use(ssoAuth);

/** Get unified evidence timeline for a contact (all types, chronological). */
router.get('/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.params;

    const timeline = await evidenceService.getAllForContact(locationId, contactId);
    res.json({ contactId, count: timeline.length, evidence: timeline });
  } catch (error) {
    next(error);
  }
});

/** Get evidence summary (counts per type) for a contact. */
router.get('/:contactId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.params;

    const summary = await evidenceService.getSummary(locationId, contactId);
    res.json({ contactId, summary });
  } catch (error) {
    next(error);
  }
});

/** Get evidence of a specific type for a contact. */
router.get('/:contactId/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId, type } = req.params;

    // Map the URL type parameter to the actual table name
    const tableKey = type.toUpperCase() as keyof typeof EVIDENCE_TABLES;
    const table = EVIDENCE_TABLES[tableKey];
    if (!table) {
      throw new BadRequestError(
        `Unknown evidence type: ${type}. Valid types: ${Object.keys(EVIDENCE_TABLES).join(', ').toLowerCase()}`
      );
    }

    const evidence = await evidenceService.getByType(table, locationId, contactId);
    res.json({ contactId, type, count: evidence.length, evidence });
  } catch (error) {
    next(error);
  }
});

export default router;
