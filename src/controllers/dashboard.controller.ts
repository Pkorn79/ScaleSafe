import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { evidenceService } from '../services/evidence.service';
import { disengagementService } from '../services/disengagement.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

/** Build milestone list from offer's m1-m8 fields */
function buildMilestoneList(offer: any): Array<{ number: number; name: string; delivers: string; clientDoes: string }> {
  if (!offer) return [];
  const milestones: Array<{ number: number; name: string; delivers: string; clientDoes: string }> = [];
  for (let i = 1; i <= 8; i++) {
    const name = offer[`m${i}_name`];
    if (name) {
      milestones.push({
        number: i,
        name,
        delivers: offer[`m${i}_delivers`] || '',
        clientDoes: offer[`m${i}_client_does`] || '',
      });
    }
  }
  return milestones;
}

export const dashboardController = {
  /** GET /api/dashboard/overview — merchant dashboard summary */
  async overview(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      // Parallel queries for dashboard data
      const [
        offersResult,
        defenseResult,
        outcomesResult,
        evidenceCountResult,
      ] = await Promise.all([
        supabase.from('offers_mirror').select('id', { count: 'exact' }).eq('location_id', locationId).eq('active', true),
        supabase.from('defense_packets').select('id, status', { count: 'exact' }).eq('location_id', locationId),
        supabase.from('defense_outcomes').select('outcome, amount_saved').eq('outcome', 'won'),
        supabase.from('evidence_timeline').select('contact_id', { count: 'exact' }).eq('location_id', locationId),
      ]);

      // Calculate Total Value Saved
      const totalValueSaved = (outcomesResult.data || [])
        .reduce((sum, o) => sum + (o.amount_saved || 0), 0);

      // Defense stats
      const defensePackets = defenseResult.data || [];
      const defenseStats = {
        total: defensePackets.length,
        pending: defensePackets.filter(d => d.status === 'pending').length,
        processing: defensePackets.filter(d => d.status === 'processing').length,
        complete: defensePackets.filter(d => d.status === 'complete').length,
        failed: defensePackets.filter(d => d.status === 'failed').length,
      };

      // Unique active clients (distinct contact_ids with evidence)
      const uniqueContacts = new Set((evidenceCountResult.data || []).map(e => e.contact_id));

      res.json({
        activeOffers: offersResult.count || 0,
        activeClients: uniqueContacts.size,
        totalEvidenceRecords: evidenceCountResult.count || 0,
        defenseStats,
        totalValueSaved,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/at-risk — list at-risk clients */
  async atRisk(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const flagged = await disengagementService.checkAllClients(locationId);
      res.json({
        count: flagged.length,
        clients: flagged.map(c => ({
          contactId: c.contactId,
          riskScore: c.riskScore,
          riskFactors: c.riskFactors,
          daysInactive: c.daysInactive,
        })),
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/evidence-health — evidence completeness per client */
  async evidenceHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      // Get contacts from evidence_timeline + enrollments (including those without contact_id)
      const [{ data: evidenceContacts }, { data: enrolledContacts }] = await Promise.all([
        supabase.from('evidence_timeline').select('contact_id').eq('location_id', locationId),
        supabase
          .from('enrollments')
          .select('id, contact_id, email, status, created_at, digital_signature')
          .eq('location_id', locationId)
          .in('status', ['enrolled', 'consent_captured', 'completed']),
      ]);

      // Build set of contact IDs from evidence_timeline
      const evidenceIds = (evidenceContacts || []).map(c => c.contact_id).filter(Boolean);

      // Build enrollment contact IDs — use contact_id if available, else synthetic key
      const enrollmentEntries = (enrolledContacts || []).map(e => ({
        contactId: e.contact_id || `enrollment:${e.id}`,
        hasRealContactId: !!e.contact_id,
        email: (e as any).email || '',
        clientName: '',
        status: e.status,
        createdAt: e.created_at,
      }));

      const allContactIds = [
        ...evidenceIds,
        ...enrollmentEntries.map(e => e.contactId),
      ];
      const uniqueIds = [...new Set(allContactIds)].filter(Boolean);

      // Build enrollment lookup for baseline scores
      const enrollmentLookup = new Map(enrollmentEntries.map(e => [e.contactId, e]));

      // Score each (limit to 50 for performance)
      const clientScores: Array<{ contactId: string; displayName: string; score: number; breakdown: Record<string, { points: number; max: number; detail?: string }> }> = [];
      for (const cid of uniqueIds.slice(0, 50)) {
        if (cid.startsWith('enrollment:')) {
          // No real GHL contact — provide baseline score from enrollment data
          const entry = enrollmentLookup.get(cid)!;
          clientScores.push({
            contactId: cid,
            displayName: entry.email || 'Unknown',
            score: 15, // baseline: consent captured but no other evidence
            breakdown: {
              consent: { points: 15, max: 20 },
              payments: { points: 0, max: 15 },
              delivery: { points: 0, max: 25 },
              engagement: { points: 0, max: 20 },
              recency: { points: 0, max: 10 },
            },
          });
        } else {
          const { score, breakdown } = await evidenceService.calculateReadinessScore(locationId, cid);
          const entry = enrollmentLookup.get(cid);
          clientScores.push({
            contactId: cid,
            displayName: entry?.email || '',
            score,
            breakdown,
          });
        }
      }

      // Build signature lookup from enrollments for better name fallback
      const signatureLookup = new Map<string, string>();
      for (const ec of (enrolledContacts || [])) {
        if (ec.contact_id && (ec as any).digital_signature) {
          signatureLookup.set(ec.contact_id, (ec as any).digital_signature);
        }
      }

      // Enrich displayNames: GHL names for real contacts, signature/email fallback
      const realContactIds = clientScores
        .filter(c => !c.contactId.startsWith('enrollment:'))
        .map(c => c.contactId);

      if (realContactIds.length > 0) {
        try {
          const api = await ghlApi(locationId);
          await Promise.all(realContactIds.slice(0, 30).map(async (cid) => {
            try {
              const resp = await api.get(`/contacts/${cid}`);
              const contact = resp.data?.contact || resp.data || {};
              const first = (contact.firstName || '').trim();
              const last = (contact.lastName || '').trim();
              const looksLikeEmail = first.includes('_') || first.includes('@') || first.includes('.');
              let name = '';
              if (looksLikeEmail) {
                // GHL firstName was set from email prefix — prefer enrollment signature
                name = signatureLookup.get(cid) || `${first} ${last}`.trim();
              } else {
                name = `${first} ${last}`.trim();
              }
              if (name) {
                const entry = clientScores.find(c => c.contactId === cid);
                if (entry) entry.displayName = name;
              }
            } catch {}
          }));
        } catch {}
      }

      // Ensure every entry has a displayName
      for (const cs of clientScores) {
        if (!cs.displayName) {
          const sig = signatureLookup.get(cs.contactId);
          const entry = enrollmentLookup.get(cs.contactId);
          cs.displayName = sig || entry?.email || cs.contactId.slice(0, 12);
        }
      }

      // Sort by score ascending (weakest first)
      clientScores.sort((a, b) => a.score - b.score);

      res.json({
        totalClients: uniqueIds.length,
        scores: clientScores,
        averageScore: clientScores.length > 0
          ? Math.round(clientScores.reduce((s, c) => s + c.score, 0) / clientScores.length)
          : 0,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/defense-history — past chargebacks with outcomes */
  async defenseHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      const { data: packets } = await supabase
        .from('defense_packets')
        .select('id, contact_id, reason_code, reason_category, dispute_amount, dispute_date, deadline, status, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });

      // Get outcomes for completed packets
      const packetIds = (packets || []).map(p => p.id);
      const { data: outcomes } = await supabase
        .from('defense_outcomes')
        .select('defense_packet_id, outcome, amount_saved, notes')
        .in('defense_packet_id', packetIds.length > 0 ? packetIds : ['_none_']);

      const outcomeMap = new Map((outcomes || []).map(o => [o.defense_packet_id, o]));

      const history = (packets || []).map(p => ({
        ...p,
        outcome: outcomeMap.get(p.id) || null,
      }));

      // Summary stats
      const won = (outcomes || []).filter(o => o.outcome === 'won');
      const lost = (outcomes || []).filter(o => o.outcome === 'lost');

      res.json({
        packets: history,
        summary: {
          total: history.length,
          won: won.length,
          lost: lost.length,
          pending: history.filter(h => !h.outcome && h.status === 'complete').length,
          totalValueSaved: won.reduce((s, o) => s + (o.amount_saved || 0), 0),
          winRate: won.length + lost.length > 0
            ? Math.round((won.length / (won.length + lost.length)) * 100)
            : 0,
        },
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/client-info/:contactId — client name + email + enrollment summary */
  async clientInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;

      const supabase = getSupabase();

      // Get enrollment data for this contact
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, email, status, payment_amount, payment_type, enrolled_at, offer_id, digital_signature, payments_made, payments_total')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Fetch GHL contact for name, phone, company, tags
      let name = '';
      let email = enrollment?.email || '';
      let phone = '';
      let companyName = '';
      let tags: string[] = [];
      let dateAdded = '';
      try {
        const api = await ghlApi(locationId);
        const contactRes = await api.get(`/contacts/${contactId}`);
        const contact = contactRes.data?.contact || contactRes.data || {};
        const first = (contact.firstName || '').trim();
        const last = (contact.lastName || '').trim();
        const looksLikeEmail = first.includes('_') || first.includes('@') || first.includes('.');
        if (looksLikeEmail && enrollment?.digital_signature) {
          name = enrollment.digital_signature;
        } else {
          name = `${first} ${last}`.trim();
        }
        if (!email) email = contact.email || '';
        phone = contact.phone || '';
        companyName = contact.companyName || contact.company_name || '';
        tags = (contact.tags || []).map((t: any) => typeof t === 'string' ? t : t.name || '').filter(Boolean);
        dateAdded = contact.dateAdded || contact.date_added || '';
      } catch {
        if (enrollment?.digital_signature) name = enrollment.digital_signature;
      }

      // Get offer name, card on file, payment summary in parallel
      const [offerResult, cardResult, paymentSummaryResult, dunningResult] = await Promise.allSettled([
        enrollment?.offer_id
          ? supabase.from('offers_mirror').select('offer_name, payment_type, num_payments, installment_amount, installment_frequency').eq('id', enrollment.offer_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('payment_methods').select('card_last_four, card_brand, card_exp_month, card_exp_year, is_default')
          .eq('location_id', locationId).eq('contact_id', contactId).eq('is_default', true).limit(1).maybeSingle(),
        supabase.from('payment_events').select('amount, event_type, created_at')
          .eq('location_id', locationId).eq('contact_id', contactId),
        supabase.from('payment_events').select('id, dunning_status')
          .eq('location_id', locationId).eq('contact_id', contactId).in('dunning_status', ['active', 'escalated']).limit(1).maybeSingle(),
      ]);

      const offer = offerResult.status === 'fulfilled' ? (offerResult.value as any)?.data : null;
      const card = cardResult.status === 'fulfilled' ? (cardResult.value as any)?.data : null;
      const paymentEvents = paymentSummaryResult.status === 'fulfilled' ? ((paymentSummaryResult.value as any)?.data || []) : [];
      const dunningRow = dunningResult.status === 'fulfilled' ? (dunningResult.value as any)?.data : null;

      // Compute payment summary
      let totalCharged = 0;
      let totalRefunded = 0;
      let lastPaymentDate: string | null = null;
      for (const ev of paymentEvents) {
        const amt = Number(ev.amount) || 0;
        if (ev.event_type === 'refund') totalRefunded += amt;
        else if (ev.event_type === 'sale') totalCharged += amt;
        if (ev.created_at && (!lastPaymentDate || ev.created_at > lastPaymentDate)) lastPaymentDate = ev.created_at;
      }

      res.json({
        contactId,
        enrollmentId: enrollment?.id || null,
        name: name || enrollment?.digital_signature || (email ? email.split('@')[0] : ''),
        email,
        status: enrollment?.status || 'unknown',
        paymentAmount: enrollment?.payment_amount || 0,
        paymentType: enrollment?.payment_type || '',
        enrolledAt: enrollment?.enrolled_at || null,
        offerName: offer?.offer_name || '',
        signature: enrollment?.digital_signature || '',
        // Payment enrichment
        cardOnFile: card ? { last4: card.card_last_four, brand: card.card_brand, expMonth: card.card_exp_month, expYear: card.card_exp_year } : null,
        totalCharged,
        totalRefunded,
        totalPayments: paymentEvents.filter((e: any) => e.event_type === 'sale').length,
        lastPaymentDate,
        dunningActive: !!dunningRow,
        // Installment progress
        paymentsMade: enrollment?.payments_made || 0,
        paymentsTotal: enrollment?.payments_total || offer?.num_payments || null,
        installmentAmount: offer?.installment_amount || null,
        installmentFrequency: offer?.installment_frequency || null,
        // GHL contact data
        phone,
        companyName,
        tags,
        dateAdded,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/client-enrollments/:contactId — all enrollments for a contact */
  async clientEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;

      const supabase = getSupabase();

      // Get all enrollments for this contact, with offer details
      const { data: enrollments, error } = await supabase
        .from('enrollments')
        .select('id, status, offer_id, payment_amount, payment_type, enrolled_at, cancelled_at, completed_at, payments_made, payments_total, digital_signature, packet_pdf_path, created_at, email, current_milestone')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get all offer IDs to fetch offer details in one query
      const offerIds = [...new Set((enrollments || []).map(e => e.offer_id).filter(Boolean))];
      let offerMap: Record<string, any> = {};
      if (offerIds.length > 0) {
        const { data: offers } = await supabase
          .from('offers_mirror')
          .select('*')
          .in('id', offerIds);
        for (const o of (offers || [])) {
          offerMap[o.id] = o;
        }
      }

      const result = (enrollments || []).map(e => {
        const offer = e.offer_id ? offerMap[e.offer_id] : null;
        return {
          id: e.id,
          status: e.status,
          offerName: offer?.offer_name || 'Unknown Program',
          offerPrice: offer?.price || e.payment_amount || 0,
          paymentType: e.payment_type || offer?.payment_type || 'one_time',
          paymentAmount: e.payment_amount || 0,
          enrolledAt: e.enrolled_at,
          cancelledAt: e.cancelled_at,
          completedAt: e.completed_at,
          createdAt: e.created_at,
          paymentsMade: e.payments_made || 0,
          paymentsTotal: e.payments_total || offer?.num_payments || null,
          installmentAmount: offer?.installment_amount || null,
          installmentFrequency: offer?.installment_frequency || null,
          programDuration: offer?.program_duration_value || null,
          programDurationUnit: offer?.program_duration_unit || null,
          deliveryMethod: offer?.delivery_method || null,
          digitalSignature: e.digital_signature || '',
          packetPdfPath: e.packet_pdf_path || null,
          currentMilestone: e.current_milestone || 0,
          milestones: buildMilestoneList(offer),
        };
      });

      // Summary stats
      const active = result.filter(e => ['enrolled', 'active', 'consent_captured'].includes(e.status)).length;
      const completed = result.filter(e => e.status === 'completed').length;
      const cancelled = result.filter(e => e.status === 'cancelled').length;
      const clientSince = result.length > 0 ? result[result.length - 1].createdAt : null;

      res.json({
        enrollments: result,
        summary: { total: result.length, active, completed, cancelled, clientSince },
      });
    } catch (err) { next(err); }
  },

  /** POST /api/dashboard/client-note — add a note to a GHL contact */
  async addClientNote(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId, body } = req.body;
      if (!contactId || !body) throw new ValidationError('contactId and body required');

      const api = await ghlApi(locationId);
      await api.post(`/contacts/${contactId}/notes`, { body });
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  /** POST /api/dashboard/client-message — send email/SMS via GHL Conversations */
  async sendClientMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId, type, message } = req.body;
      if (!contactId || !type || !message) throw new ValidationError('contactId, type, and message required');

      const api = await ghlApi(locationId);
      await api.post('/conversations/messages', {
        type: type === 'sms' ? 'SMS' : 'Email',
        contactId,
        message,
      });
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  /** POST /api/dashboard/mark-milestone — merchant marks a milestone complete for a client */
  async markMilestone(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId, enrollmentId, milestoneNumber } = req.body;
      if (!contactId || !enrollmentId || !milestoneNumber) throw new ValidationError('contactId, enrollmentId, milestoneNumber required');

      const supabase = getSupabase();

      // Verify enrollment belongs to location + check sequential order
      const { data: enrollment } = await supabase
        .from('enrollments').select('id, location_id, current_milestone, offer_id')
        .eq('id', enrollmentId).single();
      if (!enrollment || enrollment.location_id !== locationId) throw new ValidationError('Enrollment not found');
      if (milestoneNumber !== (enrollment.current_milestone || 0) + 1) {
        throw new ValidationError(`Must complete milestone ${(enrollment.current_milestone || 0) + 1} before ${milestoneNumber}`);
      }

      // Get milestone name from offer
      const { data: offer } = await supabase
        .from('offers_mirror').select('*')
        .eq('id', enrollment.offer_id).single();
      const milestoneName = (offer as any)?.[`m${milestoneNumber}_name`] || `Milestone ${milestoneNumber}`;

      // Log evidence
      await supabase.from('evidence_milestones').insert({
        location_id: locationId, contact_id: contactId,
        milestone_number: milestoneNumber, milestone_name: milestoneName,
        completed_at: new Date().toISOString(), source: 'merchant_action',
      });

      // Update enrollment
      await supabase.from('enrollments').update({ current_milestone: milestoneNumber }).eq('id', enrollmentId);

      // Fire trigger — flat doc contract
      const { triggerService: ts } = require('../services/trigger.service');
      await ts.fireTrigger(locationId, 'ss_milestone_reached', {
        contact_id: contactId,
        milestone_number: milestoneNumber,
        milestone_name: milestoneName,
        offer_id: enrollment.offer_id || '',
      });

      res.json({ success: true, currentMilestone: milestoneNumber, milestoneName });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/clients — paginated client list from denormalized view */
  async clients(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
      const search = (req.query.search as string || '').trim();
      const status = req.query.status as string || '';
      const offset = (page - 1) * limit;

      const supabase = getSupabase();

      // Build query against the client_list_view
      let query = supabase
        .from('client_list_view')
        .select('*', { count: 'exact' })
        .eq('location_id', locationId)
        .order('last_activity_date', { ascending: false, nullsFirst: false });

      // Status filter
      if (status) {
        query = query.eq('status', status);
      }

      // Search by name/email
      if (search) {
        query = query.or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,digital_signature.ilike.%${search}%`,
        );
      }

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data: rows, count, error } = await query;
      if (error) throw error;

      const clients = (rows || []).map((r: any) => ({
        contactId: r.contact_id,
        enrollmentId: r.enrollment_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.digital_signature || r.email || r.contact_id.slice(0, 12),
        email: r.email || '',
        status: r.status || 'unknown',
        paymentType: r.payment_type || '',
        offerName: r.offer_name || '',
        enrolledAt: r.enrolled_at || null,
        lastActivityDate: r.last_activity_date || null,
        hasCard: r.has_card || false,
        nextBillingDate: r.next_billing_date || null,
        paymentsMade: r.payments_made || 0,
        paymentsTotal: r.payments_total || null,
        paymentAmount: r.payment_amount || 0,
      }));

      res.json({
        clients,
        total: count || 0,
        page,
        limit,
      });
    } catch (err) { next(err); }
  },
};
