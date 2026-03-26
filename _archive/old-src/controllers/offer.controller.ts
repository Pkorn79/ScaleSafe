/**
 * offer.controller.ts — Offer API Request Handler
 *
 * Thin controller that validates input and delegates to offer.service.
 * All routes require SSO authentication.
 */

import { Request, Response, NextFunction } from 'express';
import * as offerService from '../services/offer.service';
import * as tcService from '../services/tc.service';
import { BadRequestError } from '../utils/errors';

/** List all offers for the current merchant. */
export async function listOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const offers = await offerService.list(locationId);
    res.json({ offers });
  } catch (error) {
    next(error);
  }
}

/** Create a new offer. */
export async function createOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const merchantName = (req as any).tenantContext?.merchant?.business_name || 'Merchant';
    const offerData = req.body;

    if (!offerData.programName) {
      throw new BadRequestError('programName is required');
    }

    const result = await offerService.create(locationId, merchantName, offerData);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** Get a single offer by ID. */
export async function getOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { id } = req.params;
    const offer = await offerService.get(locationId, id);
    res.json(offer);
  } catch (error) {
    next(error);
  }
}

/** Update an existing offer. */
export async function updateOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const merchantName = (req as any).tenantContext?.merchant?.business_name || 'Merchant';
    const { id } = req.params;
    const result = await offerService.update(locationId, id, merchantName, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/** Preview compiled T&C HTML for an offer. */
export async function previewTc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { id } = req.params;
    const offer = await offerService.get(locationId, id);
    const properties = (offer as any).properties || offer;
    res.json({ compiledTcHtml: properties.compiled_tc_html || '' });
  } catch (error) {
    next(error);
  }
}

/** Get the list of standard T&C clauses available for offers. */
export async function getStandardClauses(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clauses = tcService.getStandardClauses();
    res.json({ clauses });
  } catch (error) {
    next(error);
  }
}
