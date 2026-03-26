/**
 * defense.controller.ts — Defense API Request Handler
 *
 * Handles defense compilation triggers, status polling, and PDF downloads.
 * All routes require SSO authentication (merchant must be logged into GHL).
 */

import { Request, Response, NextFunction } from 'express';
import * as defenseService from '../services/defense.service';
import { BadRequestError, NotFoundError } from '../utils/errors';

/** Trigger a defense compilation for a contact. */
export async function triggerCompilation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId, reasonCode, amount, date } = req.body;

    if (!contactId) {
      throw new BadRequestError('contactId is required');
    }

    const result = await defenseService.compile(locationId, contactId, {
      reasonCode,
      amount: amount ? parseFloat(amount) : undefined,
      date,
      triggeredBy: 'manual',
    });

    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
}

/** Poll the status of a defense compilation. */
export async function getStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const status = await defenseService.getStatus(id);
    res.json(status);
  } catch (error) {
    next(error);
  }
}

/** Download the defense PDF (redirects to signed Supabase Storage URL). */
export async function downloadPdf(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const packet = await defenseService.getPacket(id);

    if (!packet.pdf_url) {
      throw new NotFoundError('Defense PDF not yet generated');
    }

    res.redirect(packet.pdf_url);
  } catch (error) {
    next(error);
  }
}

/** List all defense packets for a contact. */
export async function listForContact(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const { contactId } = req.params;

    const packets = await defenseService.listForContact(locationId, contactId);
    res.json({ contactId, count: packets.length, packets });
  } catch (error) {
    next(error);
  }
}
