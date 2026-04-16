import { Request, Response, NextFunction } from 'express';
import { defenseService } from '../services/defense.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

export const defenseController = {
  /** POST /api/defense/compile — trigger defense compilation */
  async compile(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { contactId, reasonCode, disputeAmount, disputeDate, deadline, caseNumber, offerId, addressee, disputeEventId, processor } = req.body;
      if (!contactId || !reasonCode || !disputeAmount || !disputeDate || !deadline) {
        throw new ValidationError('contactId, reasonCode, disputeAmount, disputeDate, deadline required');
      }

      const defenseId = await defenseService.compileDefense({
        locationId, contactId, offerId,
        reasonCode, disputeAmount, disputeDate, deadline, caseNumber,
        addressee, disputeEventId, processor,
      });

      res.status(202).json({ defenseId, status: 'pending' });
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id — get defense packet status/details */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const packet = await defenseService.getPacket(req.params.id);
      res.json(packet);
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id/status — poll compilation status */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await defenseService.getStatus(req.params.id);
      res.json(status);
    } catch (err) { next(err); }
  },

  /** GET /api/defense/contact/:contactId — list defense history for a contact */
  async listForContact(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const packets = await defenseService.listForContact(locationId, req.params.contactId);
      res.json(packets);
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/outcome — record win/loss/withdrawn */
  async recordOutcome(req: Request, res: Response, next: NextFunction) {
    try {
      const { outcome, amountRecovered, resolvedAt, notes } = req.body;
      if (!outcome || !['won', 'lost', 'withdrawn'].includes(outcome)) {
        throw new ValidationError('outcome must be "won", "lost", or "withdrawn"');
      }

      await defenseService.recordOutcome(req.params.id, outcome, {
        amountRecovered: amountRecovered ?? undefined,
        resolvedAt: resolvedAt ?? undefined,
        notes,
      });
      res.json({ status: 'ok', outcome });
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/submit — mark packet as submitted to processor */
  async markSubmitted(req: Request, res: Response, next: NextFunction) {
    try {
      await defenseService.markSubmitted(req.params.id);
      res.json({ status: 'ok', lifecycleStatus: 'submitted' });
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/regenerate — regenerate the AI letter (pre-submit only) */
  async regenerateLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await defenseService.regenerateLetter(req.params.id);
      const packet = await defenseService.getPacket(req.params.id);
      res.json({ ...result, pdfUrl: (packet as any).pdf_url || '' });
    } catch (err) { next(err); }
  },

  /** PUT /api/defense/:id/letter — save a manual letter edit (pre-submit only) */
  async saveLetterEdit(req: Request, res: Response, next: NextFunction) {
    try {
      const { letterText } = req.body;
      if (!letterText || typeof letterText !== 'string') {
        throw new ValidationError('letterText is required');
      }
      const result = await defenseService.saveLetterEdit(req.params.id, letterText);
      const packet = await defenseService.getPacket(req.params.id);
      res.json({ ...result, pdfUrl: (packet as any).pdf_url || '' });
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id/versions — letter version history */
  async getVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const versions = await defenseService.getLetterVersions(req.params.id);
      res.json(versions);
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/rebundle — manually trigger PDF rebundle */
  async rebundle(req: Request, res: Response, next: NextFunction) {
    try {
      const packet = await defenseService.getPacket(req.params.id);
      const { defenseBundleService } = require('../services/defense-bundle.service');
      const url = await defenseBundleService.bundleDefensePdf(
        req.params.id,
        (packet as any).location_id,
        (packet as any).contact_id,
      );
      res.json({ status: 'ok', pdfUrl: url });
    } catch (err) { next(err); }
  },
};
