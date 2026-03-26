/**
 * milestone.controller.ts — Milestone Sign-Off Request Handler
 *
 * Handles the client-facing milestone sign-off endpoints:
 * - GET  /api/milestones/signoff/:contactId — Public: render sign-off page data
 * - POST /api/milestones/signoff            — Public: handle sign-off submission
 */

import { Request, Response, NextFunction } from 'express';
import * as milestoneService from '../services/milestone.service';
import { BadRequestError } from '../utils/errors';

/** Get sign-off page data for a client. Public endpoint (client clicks a link). */
export async function getSignOffPage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { contactId } = req.params;
    const locationId = req.query.locationId as string;

    if (!locationId) {
      throw new BadRequestError('Missing locationId query parameter');
    }

    const pageData = await milestoneService.getSignOffPageData(locationId, contactId);
    res.json(pageData);
  } catch (error) {
    next(error);
  }
}

/** Handle a milestone sign-off submission from the client. */
export async function submitSignOff(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { locationId, contactId, milestoneNumber, milestoneName, workSummary, clientSigned, consentText } = req.body;

    if (!locationId || !contactId || !milestoneNumber) {
      throw new BadRequestError('locationId, contactId, and milestoneNumber are required');
    }

    if (!clientSigned) {
      throw new BadRequestError('Client must acknowledge the milestone');
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';

    await milestoneService.handleSignOff({
      locationId,
      contactId,
      milestoneNumber: parseInt(milestoneNumber, 10),
      milestoneName: milestoneName || `Milestone ${milestoneNumber}`,
      workSummary: workSummary || '',
      clientSigned: true,
      clientIp,
      consentText: consentText || 'I acknowledge completion of this milestone.',
    });

    res.json({ success: true, message: 'Milestone sign-off recorded' });
  } catch (error) {
    next(error);
  }
}
