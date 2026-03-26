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

      const { contactId, reasonCode, disputeAmount, disputeDate, deadline, caseNumber, offerId } = req.body;
      if (!contactId || !reasonCode || !disputeAmount || !disputeDate || !deadline) {
        throw new ValidationError('contactId, reasonCode, disputeAmount, disputeDate, deadline required');
      }

      const defenseId = await defenseService.compileDefense({
        locationId, contactId, offerId,
        reasonCode, disputeAmount, disputeDate, deadline, caseNumber,
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

  /** POST /api/defense/:id/outcome — record win/loss */
  async recordOutcome(req: Request, res: Response, next: NextFunction) {
    try {
      const { outcome, notes } = req.body;
      if (!outcome || !['won', 'lost'].includes(outcome)) {
        throw new ValidationError('outcome must be "won" or "lost"');
      }

      await defenseService.recordOutcome(req.params.id, outcome, notes);
      res.json({ status: 'ok' });
    } catch (err) { next(err); }
  },
};
