import { Request, Response, NextFunction } from 'express';
import { defenseService } from '../services/defense.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { defenseInputValidationService } from '../services/defense-input-validation.service';

export const defenseController = {
  /** GET /api/defense/transactions/:contactId — list payment events for the transaction selector */
  async getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;

      const { getSupabase } = await import('../clients/supabase.client');
      const supabase = getSupabase();

      const { data: events } = await supabase
        .from('payment_events')
        .select('id, created_at, amount, processor_transaction_id, processor, event_type, enrollment_id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('event_type', 'sale')
        .order('created_at', { ascending: false });

      // Resolve offer names for each enrollment
      const enrollmentIds = [...new Set((events || []).map(e => e.enrollment_id).filter(Boolean))];
      const offerMap: Record<string, { offerName: string; offerId: string }> = {};
      if (enrollmentIds.length > 0) {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('id, offer_id')
          .eq('location_id', locationId)
          .in('id', enrollmentIds);
        const offerIds = [...new Set((enrollments || []).map(e => e.offer_id).filter(Boolean))];
        if (offerIds.length > 0) {
          const { data: offers } = await supabase
            .from('offers_mirror')
            .select('id, offer_name')
            .eq('location_id', locationId)
            .in('id', offerIds);
          const offerNameMap = new Map((offers || []).map(o => [o.id, o.offer_name]));
          for (const enr of (enrollments || [])) {
            offerMap[enr.id] = {
              offerName: enr.offer_id ? (offerNameMap.get(enr.offer_id) || '') : '',
              offerId: enr.offer_id || '',
            };
          }
        }
      }

      const transactions = (events || []).map(e => ({
        id: e.id,
        date: e.created_at,
        amount: e.amount,
        transactionId: e.processor_transaction_id || '',
        processor: e.processor || '',
        enrollmentId: e.enrollment_id || null,
        offerId: e.enrollment_id ? (offerMap[e.enrollment_id]?.offerId || '') : '',
        offerName: e.enrollment_id ? (offerMap[e.enrollment_id]?.offerName || '') : '',
      }));

      res.json({ transactions });
    } catch (err) { next(err); }
  },

  /** POST /api/defense/compile — trigger defense compilation */
  async compile(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { contactId, reasonCode, disputeAmount, disputeDate, deadline, caseNumber, offerId, addressee, disputeEventId, processor, paymentEventId, enrollmentId } = req.body;
      if (!contactId || !reasonCode || !disputeAmount || !disputeDate || !deadline) {
        throw new ValidationError('contactId, reasonCode, disputeAmount, disputeDate, deadline required');
      }

      const validated = await defenseInputValidationService.validate({
        locationId,
        contactId,
        offerId,
        disputeEventId,
        paymentEventId,
        enrollmentId,
        processor,
        disputeDate,
        disputeTimezone: req.body.disputeTimezone,
      });

      const defenseId = await defenseService.compileDefense({
        locationId, contactId, offerId: validated.offerId,
        reasonCode, disputeAmount, disputeDate, deadline, caseNumber,
        addressee,
        disputeEventId: validated.disputeEventId,
        processor: validated.processor,
        paymentEventId: validated.paymentEventId,
        enrollmentId: validated.enrollmentId,
        disputeTimezone: req.body.disputeTimezone,
      });

      require('../services/defense-compilation-worker').defenseCompilationWorker.wake();

      res.status(202).json({ defenseId, status: 'pending' });
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id — get defense packet status/details */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const packet = await defenseService.getPacket(req.params.id, locationId);
      res.json(packet);
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id/status — poll compilation status */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const status = await defenseService.getStatus(req.params.id, locationId);
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

      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      await defenseService.recordOutcome(req.params.id, outcome, {
        amountRecovered: amountRecovered ?? undefined,
        resolvedAt: resolvedAt ?? undefined,
        notes,
        locationId,
      });
      res.json({ status: 'ok', outcome });
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/submit — mark packet as submitted to processor */
  async markSubmitted(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      await defenseService.markSubmitted(req.params.id, locationId);
      res.json({ status: 'ok', lifecycleStatus: 'submitted' });
    } catch (err) { next(err); }
  },

  /** PATCH /api/defense/:id/deadline — correct the response deadline (pre-submit only) */
  async updateDeadline(req: Request, res: Response, next: NextFunction) {
    try {
      const { deadline } = req.body;
      if (!deadline || typeof deadline !== 'string') {
        throw new ValidationError('deadline is required (YYYY-MM-DD)');
      }
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      await defenseService.updateDeadline(req.params.id, deadline, locationId);
      res.json({ status: 'ok', deadline });
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/regenerate — regenerate the AI letter (pre-submit only) */
  async regenerateLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const result = await defenseService.queueRegeneration(req.params.id, locationId);
      if (result.created) require('../services/defense-compilation-worker').defenseCompilationWorker.wake();
      res.status(202).json(result);
    } catch (err) { next(err); }
  },

  /** PUT /api/defense/:id/letter — save a manual letter edit (pre-submit only) */
  async saveLetterEdit(req: Request, res: Response, next: NextFunction) {
    try {
      const { letterText } = req.body;
      if (!letterText || typeof letterText !== 'string') {
        throw new ValidationError('letterText is required');
      }
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const result = await defenseService.saveLetterEdit(req.params.id, letterText, locationId);
      const packet = await defenseService.getPacket(req.params.id, locationId);
      res.json({ ...result, pdfUrl: (packet as any).pdf_url || '' });
    } catch (err) { next(err); }
  },

  /** GET /api/defense/:id/versions — letter version history */
  async getVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const versions = await defenseService.getLetterVersions(req.params.id, locationId);
      res.json(versions);
    } catch (err) { next(err); }
  },

  /** POST /api/defense/:id/rebundle — manually trigger PDF rebundle */
  async rebundle(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const packet = await defenseService.getPacket(req.params.id, locationId);
      const { defenseBundleService } = require('../services/defense-bundle.service');
      const url = await defenseBundleService.bundleDefensePdf(
        req.params.id,
        (packet as any).location_id,
        (packet as any).contact_id,
        { enrollmentId: (packet as any).enrollment_id || undefined },
      );
      res.json({ status: 'ok', pdfUrl: url });
    } catch (err) { next(err); }
  },
};
