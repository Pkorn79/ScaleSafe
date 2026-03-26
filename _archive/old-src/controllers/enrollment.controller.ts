/**
 * enrollment.controller.ts — Enrollment API Request Handler
 *
 * Handles the client-facing enrollment endpoints:
 * - GET  /api/enrollment/offer/:offerId  — Public: fetch offer data for Page 2
 * - POST /api/enrollment/prepare         — SSO: prep enrollment (populate contact fields)
 * - POST /api/enrollment/charge          — Public: process payment from Page 4
 */

import { Request, Response, NextFunction } from 'express';
import * as enrollmentService from '../services/enrollment.service';
import * as offerService from '../services/offer.service';
import { BadRequestError } from '../utils/errors';

/** Fetch offer data for the enrollment page (Page 2). Public endpoint. */
export async function getOfferForEnrollment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { offerId } = req.params;
    const locationId = req.query.locationId as string;

    if (!locationId) {
      throw new BadRequestError('Missing locationId query parameter');
    }

    const offer = await offerService.getForEnrollment(locationId, offerId);
    res.json(offer);
  } catch (error) {
    next(error);
  }
}

/** Prepare enrollment — populate contact fields from offer. SSO required. */
export async function prepareEnrollment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId, offerId } = req.body;

    if (!contactId || !offerId) {
      throw new BadRequestError('contactId and offerId are required');
    }

    const result = await enrollmentService.prepare(locationId, contactId, offerId);
    res.json({ success: true, offer: result });
  } catch (error) {
    next(error);
  }
}

/**
 * Process payment from the enrollment page (Page 4).
 * Public endpoint (no SSO) — the client is on the payment page.
 * Protected by the accept.blue tokenization (card data never touches our server).
 */
export async function processCharge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      locationId, contactId, offerId, paymentType, amount,
      sourceToken, billingInfo, consent,
    } = req.body;

    if (!locationId || !contactId || !offerId || !amount) {
      throw new BadRequestError('locationId, contactId, offerId, and amount are required');
    }

    if (!consent?.tc_accepted) {
      throw new BadRequestError('Client must accept terms and conditions');
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';

    const result = await enrollmentService.processCharge({
      locationId,
      contactId,
      offerId,
      paymentType: paymentType || 'One-Time',
      amount: parseFloat(amount),
      sourceToken,
      billingInfo,
      consent,
      clientIp,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}
