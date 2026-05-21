import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { evidenceService } from '../services/evidence.service';
import { disengagementService } from '../services/disengagement.service';
import { selectProcessorPaymentMethod } from '../services/payment-methods.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { config } from '../config';
import { createPublicActionToken } from '../utils/public-action-token';
import { WORKFLOW_MILESTONE_CONTACT_FIELDS } from '../constants/ghl-fields';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { logger } from '../utils/logger';
import { merchantRepository } from '../repositories/merchant.repository';

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

const DEFENSE_EVIDENCE_COLUMNS = [
  'payment_event_id',
  'defense_summary',
  'issuer_exhibit_title',
  'proof_role',
  'reason_code_tags',
  'dispute_relevance',
  'source_record_id',
  'actor',
  'defense_metadata',
];

function isColumnCompatibilityError(error: any): boolean {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(' ').toLowerCase();

  return text.includes('pgrst204')
    || text.includes('schema cache')
    || text.includes('could not find')
    || text.includes('does not exist');
}

function omitColumns(fields: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const next = { ...fields };
  for (const column of columns) {
    delete next[column];
  }
  return next;
}

async function insertMilestoneEvidence(
  supabase: any,
  fields: Record<string, unknown>,
): Promise<{ status: 'logged' | 'failed'; error?: string }> {
  try {
    let response = await supabase.from('evidence_milestones').insert(fields);
    if (!response.error) return { status: 'logged' };

    if (isColumnCompatibilityError(response.error)) {
      const withoutDefenseFields = omitColumns(fields, DEFENSE_EVIDENCE_COLUMNS);
      response = await supabase.from('evidence_milestones').insert(withoutDefenseFields);
      if (!response.error) return { status: 'logged' };

      if (isColumnCompatibilityError(response.error) && 'enrollment_id' in withoutDefenseFields) {
        response = await supabase
          .from('evidence_milestones')
          .insert(omitColumns(withoutDefenseFields, ['enrollment_id']));
        if (!response.error) return { status: 'logged' };
      }
    }

    return { status: 'failed', error: response.error?.message || String(response.error) };
  } catch (err: any) {
    return { status: 'failed', error: err?.message || String(err) };
  }
}

function normalizeUrlBase(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

async function buildMilestoneSignoffLink(locationId: string, actionToken: string): Promise<string> {
  const fallback = `${config.appUrl}/milestone-signoff?actionToken=${encodeURIComponent(actionToken)}`;
  try {
    const merchant = await merchantRepository.findByLocationId(locationId);
    const merchantConfig = (merchant?.config || {}) as Record<string, unknown>;
    const base = normalizeUrlBase(
      merchantConfig.enrollment_funnel_url
      || merchantConfig.business_website,
    );
    if (!base) return fallback;

    const url = new URL('/milestone-approval-page', base);
    url.searchParams.set('actionToken', actionToken);
    return url.toString();
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err), locationId }, 'Milestone merchant signoff link fallback used');
    return fallback;
  }
}

function cleanCardDisplay(card: {
  card_last_four?: string | null;
  card_brand?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
}) {
  const last4 = String(card.card_last_four || '').trim();
  const brand = String(card.card_brand || '').trim();
  const expMonth = Number(card.card_exp_month || 0);
  const expYear = Number(card.card_exp_year || 0);

  return {
    last4: /^\d{4}$/.test(last4) ? last4 : '',
    brand: brand && brand.toLowerCase() !== 'unknown' ? brand : '',
    expMonth: expMonth > 0 ? expMonth : null,
    expYear: expYear > 0 ? expYear : null,
  };
}

function processorLabel(processor?: string | null): string {
  const value = String(processor || '').toLowerCase();
  if (value === 'nmi') return 'NMI';
  if (value === 'stripe') return 'Stripe';
  if (value === 'ghl') return 'GHL';
  return processor || 'Unknown';
}

function cardSummary(method: any) {
  if (!method) return null;
  const display = cleanCardDisplay(method);
  const processor = processorLabel(method.processor_type);
  const brand = display.brand || 'card on file';
  const ending = display.last4 ? ` ending in ${display.last4}` : '';
  const detailParts: string[] = [];
  if (display.expMonth && display.expYear) detailParts.push(`exp ${display.expMonth}/${display.expYear}`);
  if (method.processor_type === 'nmi' && method.nmi_customer_vault_id) detailParts.push(`NMI vault ${method.nmi_customer_vault_id}`);
  if (method.processor_type === 'stripe' && method.stripe_payment_method_id) detailParts.push(`Stripe PM ${method.stripe_payment_method_id}`);
  else if (method.processor_type === 'stripe' && method.stripe_customer_id) detailParts.push(`Stripe customer ${method.stripe_customer_id}`);

  return {
    id: method.id || null,
    processorType: method.processor_type || '',
    displayLabel: `${processor} ${brand}${ending}`.trim(),
    detailLabel: detailParts.join(' - '),
    isDefault: Boolean(method.is_default),
    ...display,
  };
}

function selectProcessorCard(methods: any[], processor?: string | null) {
  return selectProcessorPaymentMethod(methods, processor);
}

const PAID_PAYMENT_EVENT_TYPES = new Set(['sale', 'subscription_payment', 'capture']);

function isPaidPaymentEvent(event: any): boolean {
  const type = String(event?.event_type || '').toLowerCase();
  return PAID_PAYMENT_EVENT_TYPES.has(type) && !event?.failure_reason && Number(event?.amount || 0) > 0;
}

function paymentDates(events: any[]): Array<{ date: string; amount: number; transactionId: string | null; paymentNumber: number | null }> {
  return events
    .filter(isPaidPaymentEvent)
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .map(event => ({
      date: event.created_at,
      amount: Number(event.amount || 0),
      transactionId: event.processor_transaction_id || null,
      paymentNumber: event.payment_number == null ? null : Number(event.payment_number),
    }));
}

function enrollmentBillingIssue(enrollment: any, lastPayment: any | null, lastNmiLog: any | null) {
  const processor = String(enrollment?.processor_type || '').toLowerCase();
  const paymentType = String(enrollment?.payment_type || '').toLowerCase();
  const status = String(enrollment?.status || '').toLowerCase();
  const recurring = ['installment', 'installments', 'subscription'].includes(paymentType);
  const active = ['enrolled', 'active', 'paused', 'consent_captured'].includes(status);
  if (!recurring || !active || enrollment?.billing_completed_at) return null;

  if (processor === 'nmi' && !enrollment?.processor_subscription_id) {
    return { code: 'missing_nmi_subscription', label: 'Missing NMI subscription ID' };
  }

  if (processor === 'nmi') {
    const action = String(lastNmiLog?.action || '').toLowerCase();
    const verification = String(lastNmiLog?.verification_status || '').toLowerCase();
    if (action.includes('unknown_subscription')) return { code: 'unmatched_subscription', label: 'NMI post did not match this enrollment' };
    if (action.includes('verification') || verification === 'failed' || verification === 'error') return { code: 'verification_failed', label: 'NMI verification failed' };
    if (action.includes('payment_event_missing')) return { code: 'payment_record_failed', label: 'Payment record failed' };
  }

  const nextBilling = String(enrollment?.next_billing_date || '').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (nextBilling && nextBilling < today) {
    if (processor === 'nmi' && !lastNmiLog) return { code: 'no_nmi_post', label: 'No NMI post received for overdue billing' };
    if (!lastPayment) return { code: 'missing_payment_record', label: 'Payment record missing for overdue billing' };
    return { code: 'overdue_tracking', label: 'Billing date is overdue' };
  }

  return null;
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
        activeClientsResult,
        defenseResult,
        outcomesResult,
        evidenceCountResult,
      ] = await Promise.all([
        supabase.from('offers_mirror').select('id', { count: 'exact', head: true }).eq('location_id', locationId).eq('active', true),
        supabase
          .from('client_list_view')
          .select('contact_id', { count: 'exact', head: true })
          .eq('location_id', locationId)
          .in('status', ['enrolled', 'active', 'consent_captured', 'device_captured', 'paused', 'manual_add']),
        supabase.from('defense_packets').select('id, status', { count: 'exact' }).eq('location_id', locationId),
        supabase.from('defense_outcomes').select('outcome, amount_recovered').eq('location_id', locationId).eq('outcome', 'won'),
        supabase.from('evidence_timeline').select('contact_id', { count: 'exact', head: true }).eq('location_id', locationId),
      ]);

      // Calculate total value recovered from won outcomes.
      const totalValueSaved = (outcomesResult.data || [])
        .reduce((sum, o) => sum + (o.amount_recovered || 0), 0);

      // Defense stats
      const defensePackets = defenseResult.data || [];
      const defenseStats = {
        total: defensePackets.length,
        pending: defensePackets.filter(d => d.status === 'pending').length,
        processing: defensePackets.filter(d => d.status === 'processing').length,
        complete: defensePackets.filter(d => d.status === 'complete').length,
        failed: defensePackets.filter(d => d.status === 'failed').length,
      };

      res.json({
        activeOffers: offersResult.count || 0,
        activeClients: activeClientsResult.count || 0,
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
        .select('id, contact_id, chargeback_reason_code, reason_code_category, chargeback_amount, chargeback_date, response_deadline, status, lifecycle_status, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });

      // Get outcomes for completed packets
      const packetIds = (packets || []).map(p => p.id);
      const { data: outcomes } = await supabase
        .from('defense_outcomes')
        .select('defense_packet_id, outcome, amount_recovered, notes')
        .in('defense_packet_id', packetIds.length > 0 ? packetIds : ['_none_']);

      const outcomeMap = new Map((outcomes || []).map(o => [o.defense_packet_id, o]));

      // Resolve customer names from enrollments (avoids GHL API rate limits)
      const contactIds = [...new Set((packets || []).map(p => p.contact_id).filter(Boolean))];
      const nameMap: Record<string, string> = {};
      if (contactIds.length > 0) {
        const { data: enrollmentNames } = await supabase
          .from('enrollments')
          .select('contact_id, first_name, last_name, digital_signature, email')
          .eq('location_id', locationId)
          .in('contact_id', contactIds)
          .order('created_at', { ascending: false });
        for (const e of (enrollmentNames || [])) {
          if (nameMap[e.contact_id]) continue; // keep the most recent enrollment's name
          nameMap[e.contact_id] = [e.first_name, e.last_name].filter(Boolean).join(' ')
            || e.digital_signature
            || e.email
            || e.contact_id.slice(0, 12);
        }
      }

      // Alias DB column names to the response shape the frontend reads
      const history = (packets || []).map(p => ({
        id: p.id,
        contact_id: p.contact_id,
        contactName: nameMap[p.contact_id] || p.contact_id?.slice(0, 12) || 'Unknown',
        reason_code: p.chargeback_reason_code,
        reason_category: p.reason_code_category,
        dispute_amount: p.chargeback_amount,
        dispute_date: p.chargeback_date,
        deadline: p.response_deadline,
        status: p.status,
        lifecycleStatus: p.lifecycle_status || 'pending_submission',
        created_at: p.created_at,
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
          totalValueSaved: won.reduce((s, o) => s + (o.amount_recovered || 0), 0),
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

      // Get enrollment data for this contact — pick the best enrollment by status priority
      // (matches the client_list_view logic from migration 050: active > paused > pending > completed > cancelled)
      const { data: allEnrollments } = await supabase
        .from('enrollments')
        .select('id, email, status, payment_amount, payment_type, processor_type, enrolled_at, offer_id, digital_signature, payments_made, payments_total, next_billing_date, created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId);

      const statusPriority: Record<string, number> = { enrolled: 0, active: 0, paused: 1, consent_captured: 2, device_captured: 2, completed: 3, cancelled: 4 };
      const sorted = (allEnrollments || []).sort((a: any, b: any) => {
        const pa = statusPriority[a.status] ?? 5;
        const pb = statusPriority[b.status] ?? 5;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const enrollment = sorted[0] || null;

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
        supabase.from('payment_methods').select('card_last_four, card_brand, card_exp_month, card_exp_year, is_default, processor_type')
          .eq('location_id', locationId).eq('contact_id', contactId).eq('is_default', true).limit(1).maybeSingle(),
        supabase.from('payment_events').select('amount, event_type, created_at')
          .eq('location_id', locationId).eq('contact_id', contactId).not('enrollment_id', 'is', null),
        supabase.from('payment_events').select('id, dunning_status')
          .eq('location_id', locationId).eq('contact_id', contactId).not('enrollment_id', 'is', null).in('dunning_status', ['active', 'escalated']).limit(1).maybeSingle(),
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
        processorType: enrollment?.processor_type || '',
        enrolledAt: enrollment?.enrolled_at || null,
        offerName: offer?.offer_name || '',
        signature: enrollment?.digital_signature || '',
        // Payment enrichment
        cardOnFile: card ? { ...cleanCardDisplay(card), processorType: card.processor_type || '' } : null,
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
        nextBillingDate: enrollment?.next_billing_date || null,
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
        .select('id, status, offer_id, payment_amount, payment_type, processor_type, processor_subscription_id, billing_completed_at, enrolled_at, cancelled_at, completed_at, payments_made, payments_total, next_billing_date, digital_signature, packet_pdf_path, created_at, email, current_milestone')
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

      const { data: paymentMethods } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      const enrollmentIds = (enrollments || []).map((e: any) => e.id).filter(Boolean);
      const nmiSubscriptionIds = (enrollments || [])
        .filter((e: any) => String(e.processor_type || '').toLowerCase() === 'nmi')
        .map((e: any) => e.processor_subscription_id)
        .filter(Boolean);

      const [paymentEventsResult, nmiLogsResult] = await Promise.all([
        enrollmentIds.length > 0
          ? supabase
            .from('payment_events')
            .select('id, enrollment_id, event_type, amount, failure_reason, processor_transaction_id, payment_number, created_at')
            .eq('location_id', locationId)
            .in('enrollment_id', enrollmentIds)
            .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        nmiSubscriptionIds.length > 0
          ? supabase
            .from('nmi_silent_post_logs')
            .select('id, processor_subscription_id, transaction_id, action, verification_status, created_at')
            .eq('location_id', locationId)
            .in('processor_subscription_id', nmiSubscriptionIds)
            .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      const paymentsByEnrollment = new Map<string, any[]>();
      for (const payment of ((paymentEventsResult as any).data || [])) {
        const list = paymentsByEnrollment.get(payment.enrollment_id) || [];
        list.push(payment);
        paymentsByEnrollment.set(payment.enrollment_id, list);
      }

      const nmiLogsBySubscription = new Map<string, any[]>();
      for (const log of ((nmiLogsResult as any).data || [])) {
        const list = nmiLogsBySubscription.get(log.processor_subscription_id) || [];
        list.push(log);
        nmiLogsBySubscription.set(log.processor_subscription_id, list);
      }

      const result = (enrollments || []).map(e => {
        const offer = e.offer_id ? offerMap[e.offer_id] : null;
        const matchedCard = selectProcessorCard(paymentMethods || [], e.processor_type);
        const enrollmentPayments = paymentsByEnrollment.get(e.id) || [];
        const paidDates = paymentDates(enrollmentPayments);
        const lastPayment = paidDates.length > 0 ? paidDates[paidDates.length - 1] : null;
        const lastNmiLog = e.processor_subscription_id
          ? ((nmiLogsBySubscription.get(e.processor_subscription_id) || [])[0] || null)
          : null;
        const billingIssue = enrollmentBillingIssue(e, lastPayment, lastNmiLog);
        return {
          id: e.id,
          status: e.status,
          offerName: offer?.offer_name || 'Unknown Program',
          offerPrice: offer?.price || e.payment_amount || 0,
          paymentType: e.payment_type || offer?.payment_type || 'one_time',
          processorType: e.processor_type || null,
          processorSubscriptionId: e.processor_subscription_id || null,
          cardOnFile: cardSummary(matchedCard),
          controlVerified: Boolean(e.processor_subscription_id),
          paymentAmount: e.payment_amount || 0,
          enrolledAt: e.enrolled_at,
          cancelledAt: e.cancelled_at,
          completedAt: e.completed_at,
          createdAt: e.created_at,
          paymentsMade: e.payments_made || 0,
          paymentsTotal: e.payments_total || offer?.num_payments || null,
          amountPaidActual: paidDates.reduce((sum, payment) => sum + payment.amount, 0),
          lastPaymentDate: lastPayment?.date || null,
          lastPaymentAmount: lastPayment?.amount || null,
          lastPaymentTransactionId: lastPayment?.transactionId || null,
          paymentDates: paidDates,
          lastNmiPostDate: lastNmiLog?.created_at || null,
          lastNmiPostAction: lastNmiLog?.action || null,
          lastNmiPostTransactionId: lastNmiLog?.transaction_id || null,
          billingIssue,
          billingCompletedAt: e.billing_completed_at || null,
          installmentAmount: offer?.installment_amount || null,
          installmentFrequency: offer?.installment_frequency || null,
          programDuration: offer?.program_duration_value || null,
          programDurationUnit: offer?.program_duration_unit || null,
          deliveryMethod: offer?.delivery_method || null,
          digitalSignature: e.digital_signature || '',
          packetPdfPath: e.packet_pdf_path || null,
          nextBillingDate: e.next_billing_date || null,
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
      const requestedMilestoneNumber = Number(milestoneNumber);
      if (!Number.isInteger(requestedMilestoneNumber) || requestedMilestoneNumber <= 0) {
        throw new ValidationError('milestoneNumber must be a positive whole number');
      }

      const supabase = getSupabase();

      // Verify enrollment belongs to location + check sequential order
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .select('id, location_id, contact_id, current_milestone, offer_id, email')
        .eq('id', enrollmentId)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (enrollmentError) {
        logger.error(
          { err: enrollmentError.message, locationId, contactId, enrollmentId, milestoneNumber: requestedMilestoneNumber },
          'Milestone enrollment validation failed',
        );
        throw enrollmentError;
      }
      if (!enrollment) {
        logger.warn({ locationId, contactId, enrollmentId }, 'Milestone enrollment validation failed: enrollment not found');
        throw new ValidationError('Enrollment not found');
      }
      const nextMilestoneNumber = (Number(enrollment.current_milestone) || 0) + 1;
      if (requestedMilestoneNumber !== nextMilestoneNumber) {
        throw new ValidationError(`Must complete milestone ${nextMilestoneNumber} before ${requestedMilestoneNumber}`);
      }

      // Get milestone name + delivers + client_does from offer
      const { data: offer, error: offerError } = await supabase
        .from('offers_mirror').select('*')
        .eq('id', enrollment.offer_id)
        .maybeSingle();
      if (offerError) {
        logger.warn(
          { err: offerError.message, locationId, contactId, enrollmentId, offerId: enrollment.offer_id },
          'Milestone offer lookup failed; using fallback milestone labels',
        );
      }
      const milestoneName = (offer as any)?.[`m${requestedMilestoneNumber}_name`] || `Milestone ${requestedMilestoneNumber}`;
      const milestoneDelivers = (offer as any)?.[`m${requestedMilestoneNumber}_delivers`] || '';
      const milestoneClientDoes = (offer as any)?.[`m${requestedMilestoneNumber}_client_does`] || '';

      const completedAt = new Date().toISOString();
      const signoffToken = createPublicActionToken({
        action: 'milestone_signoff',
        locationId,
        contactId,
        enrollmentId,
        milestoneNumber: requestedMilestoneNumber,
      });
      const scaleSafeSignoffLink = `${config.appUrl}/milestone-signoff?actionToken=${encodeURIComponent(signoffToken)}`;
      const signoffLink = await buildMilestoneSignoffLink(locationId, signoffToken);
      const workSummary = [milestoneDelivers, milestoneClientDoes]
        .filter(Boolean)
        .join('. Client responsibility: ');
      const triggerPayload = {
        event_type: 'milestone_reached',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        enrollment_id: enrollmentId,
        enrollmentId,
        milestone_number: requestedMilestoneNumber,
        milestoneNumber: requestedMilestoneNumber,
        milestone_name: milestoneName,
        milestoneName,
        offer_id: enrollment.offer_id || '',
        offerId: enrollment.offer_id || '',
        offer_name: (offer as any)?.offer_name || '',
        offerName: (offer as any)?.offer_name || '',
        program_name: (offer as any)?.offer_name || '',
        programName: (offer as any)?.offer_name || '',
        signoff_link: signoffLink,
        signoffLink,
        milestone_signoff_link: signoffLink,
        milestoneSignoffLink: signoffLink,
        scalesafe_signoff_link: scaleSafeSignoffLink,
        scaleSafeSignoffLink,
        work_summary: workSummary,
        workSummary,
      };

      // Save first. Evidence and workflow steps cannot block the saved milestone.
      const { error: updateError } = await supabase
        .from('enrollments')
        .update({ current_milestone: requestedMilestoneNumber })
        .eq('id', enrollmentId)
        .eq('location_id', locationId)
        .eq('contact_id', contactId);
      if (updateError) {
        logger.error(
          { err: updateError.message, locationId, contactId, enrollmentId, milestoneNumber: requestedMilestoneNumber },
          'Milestone enrollment update failed',
        );
        throw updateError;
      }

      // Log evidence — enriched with description + contact_email + raw_payload for downstream defense compilation
      // Resolve contact name for enriched evidence row
      let milestoneContactName = '';
      try {
        const { data: enrName } = await supabase
          .from('enrollments')
          .select('first_name, last_name, digital_signature')
          .eq('id', enrollmentId)
          .maybeSingle();
        milestoneContactName = [enrName?.first_name, enrName?.last_name].filter(Boolean).join(' ')
          || enrName?.digital_signature || '';
      } catch (nameErr: any) {
        logger.debug(
          { err: nameErr?.message || String(nameErr), locationId, contactId, enrollmentId },
          'Milestone contact name lookup skipped',
        );
      }

      const evidenceResult = await insertMilestoneEvidence(supabase, {
        location_id: locationId,
        contact_id: contactId,
        enrollment_id: enrollmentId,
        source: 'merchant_action',
        milestone_number: requestedMilestoneNumber,
        milestone_name: milestoneName,
        description: milestoneDelivers || null,
        notes: milestoneClientDoes || null,
        contact_name: milestoneContactName || null,
        contact_email: (enrollment as any).email || null,
        completed_at: completedAt,
        raw_payload: triggerPayload,
        ...buildDefenseEvidenceFields({
          summary: `Merchant marked Milestone ${requestedMilestoneNumber} (${milestoneName}) complete.${milestoneDelivers ? ` Deliverables: ${milestoneDelivers}.` : ''}${milestoneClientDoes ? ` Client responsibility: ${milestoneClientDoes}.` : ''}`,
          title: `Milestone ${requestedMilestoneNumber}: ${milestoneName}`,
          proofRole: 'service_delivery',
          relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'high', confidence: 'moderate' },
          enrollmentId,
          metadata: {
            actor: 'merchant',
            customerIdentity: { name: milestoneContactName || null, email: (enrollment as any).email || null },
            service: {
              enrollmentId,
              offerId: enrollment.offer_id || null,
              offerName: (offer as any)?.offer_name || null,
              deliverableName: milestoneName,
              serviceDate: completedAt,
            },
            source: { system: 'dashboard', rawEventType: 'milestone_completed' },
          },
        }),
      });
      if (evidenceResult.status === 'failed') {
        logger.warn(
          { err: evidenceResult.error, locationId, contactId, enrollmentId, milestoneNumber: requestedMilestoneNumber },
          'Milestone evidence insert failed after enrollment save',
        );
      }

      try {
        const api = await ghlApi(locationId);
        await api.put(`/contacts/${contactId}`, {
          customField: {
            [WORKFLOW_MILESTONE_CONTACT_FIELDS.CURRENT_MILESTONE_NAME]: milestoneName,
            [WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_LINK]: signoffLink,
            [WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_MILESTONE_NAME]: milestoneName,
            [WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_MILESTONE_NUMBER]: String(requestedMilestoneNumber),
            [WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_WORK_SUMMARY]: workSummary,
          },
        });
      } catch (fieldErr: any) {
        logger.warn(
          { err: fieldErr?.message || String(fieldErr), locationId, contactId, milestoneNumber: requestedMilestoneNumber },
          'Milestone contact field sync failed (non-fatal)',
        );
      }

      // Fire trigger — fire-and-forget. Trigger delivery has its own retry/backoff
      // (postWithRetry) and a subscription-list fetch failure must NOT 500 the
      // merchant action since the evidence row + enrollment update have already succeeded.
      let workflowResult: { status: string; sent: number; failed: number; error?: string } = {
        status: 'not_attempted',
        sent: 0,
        failed: 0,
      };
      try {
        const { triggerService: ts } = require('../services/trigger.service');
        const result = await ts.fireTrigger(locationId, 'ss_milestone_reached', triggerPayload);
        workflowResult = {
          status: result.sent > 0 ? 'sent' : result.failed > 0 ? 'failed' : 'not_sent',
          sent: result.sent,
          failed: result.failed,
        };
        if (workflowResult.status !== 'sent') {
          logger.warn(
            { locationId, contactId, enrollmentId, milestoneNumber: requestedMilestoneNumber, workflowResult },
            'Milestone trigger returned without delivery',
          );
        }
      } catch (triggerErr: any) {
        workflowResult = {
          status: 'failed',
          sent: 0,
          failed: 1,
          error: triggerErr?.message || String(triggerErr),
        };
        logger.warn(
          { err: workflowResult.error, locationId, contactId, enrollmentId, milestoneNumber: requestedMilestoneNumber },
          'Milestone trigger fire failed (non-fatal — evidence already logged)',
        );
      }

      res.json({
        success: true,
        currentMilestone: requestedMilestoneNumber,
        milestoneName,
        signoffLink,
        evidenceStatus: evidenceResult.status,
        evidenceError: evidenceResult.error || null,
        workflowResult,
      });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/dashboard/client-activity/:contactId
   * Bundled overview data: recent N activities + most recent note + at-risk snapshot.
   */
  async clientActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 5));

      // 1) Recent activity (slice of timeline)
      const [timelineResult, noteResult, riskResult] = await Promise.allSettled([
        evidenceService.getTimeline(locationId, contactId, { limit }),
        (async () => {
          try {
            const api = await ghlApi(locationId);
            const resp = await api.get(`/contacts/${contactId}/notes`);
            const notes = (resp.data?.notes || resp.data || []) as any[];
            if (!Array.isArray(notes) || notes.length === 0) return null;
            const sorted = [...notes].sort((a, b) => {
              const da = new Date(a.dateAdded || a.createdAt || 0).getTime();
              const db = new Date(b.dateAdded || b.createdAt || 0).getTime();
              return db - da;
            });
            const top = sorted[0];
            return { body: top.body || '', createdAt: top.dateAdded || top.createdAt || '' };
          } catch {
            return null;
          }
        })(),
        disengagementService.scoreClient(locationId, contactId),
      ]);

      const recentActivity = timelineResult.status === 'fulfilled' ? (timelineResult.value.rows || []) : [];
      const recentNote = noteResult.status === 'fulfilled' ? noteResult.value : null;
      const risk = riskResult.status === 'fulfilled' ? riskResult.value : null;

      res.json({
        recentActivity,
        recentNote,
        atRisk: risk ? { flagged: risk.flagged, riskScore: risk.riskScore, riskFactors: risk.riskFactors, daysInactive: risk.daysInactive } : null,
      });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/dashboard/client-communications/:contactId
   * Unified feed of messages (GHL conversations) + notes (GHL) with source marking.
   *
   * Query params:
   *   limit: default 50 (max 200)
   *   offset: default 0
   *   windowDays: default 30 (cap fetch window for rate-limit safety)
   */
  async clientCommunications(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const windowDays = Math.min(365, Math.max(1, parseInt(req.query.windowDays as string) || 30));
      const windowStart = new Date(Date.now() - windowDays * 86400000);

      const supabase = getSupabase();

      // Pull GHL data + evidence cross-reference in parallel
      const [ghlMessages, ghlNotes, appSentEvidence] = await Promise.allSettled([
        (async () => {
          try {
            const api = await ghlApi(locationId);
            const convRes = await api.get('/conversations/search', { params: { locationId, contactId } });
            const conversations = convRes.data?.conversations || [];
            const all: any[] = [];
            for (const conv of conversations) {
              try {
                const msgRes = await api.get(`/conversations/${conv.id}/messages`, { params: { limit: 50 } });
                const msgs = msgRes.data?.messages || msgRes.data?.items || [];
                for (const msg of msgs) {
                  all.push({ msg, convId: conv.id });
                }
              } catch { /* skip conversation on error */ }
            }
            return all;
          } catch {
            return [] as any[];
          }
        })(),
        (async () => {
          try {
            const api = await ghlApi(locationId);
            const resp = await api.get(`/contacts/${contactId}/notes`);
            const rows = (resp.data?.notes || resp.data || []) as any[];
            return Array.isArray(rows) ? rows : [];
          } catch {
            return [] as any[];
          }
        })(),
        // Cross-reference: app-sent messages logged with source='app_triggered'
        supabase
          .from('evidence_communication')
          .select('comm_type, comm_date, summary, direction')
          .eq('location_id', locationId)
          .eq('contact_id', contactId)
          .eq('source', 'app_triggered')
          .gte('comm_date', windowStart.toISOString())
          .order('comm_date', { ascending: false }),
      ]);

      const messages = ghlMessages.status === 'fulfilled' ? ghlMessages.value : [];
      const notes = ghlNotes.status === 'fulfilled' ? ghlNotes.value : [];
      const appSentRows = (appSentEvidence.status === 'fulfilled' ? (appSentEvidence.value?.data || []) : []) as any[];

      // Build marker set for fast cross-reference: (channel|direction|timestamp bucket)
      // Use 5-minute buckets on comm_date for matching outbound GHL messages to app-sent evidence rows.
      const appSentMarkers = new Set<string>();
      for (const row of appSentRows) {
        const bucket = Math.floor(new Date(row.comm_date).getTime() / (5 * 60 * 1000));
        const channel = String(row.comm_type || '').toLowerCase();
        appSentMarkers.add(`${channel}|outbound|${bucket}`);
      }

      function markSource(channel: string, direction: string, date: string): 'automated' | 'manual' | null {
        if (direction !== 'outbound') return null;
        const bucket = Math.floor(new Date(date).getTime() / (5 * 60 * 1000));
        // Check this bucket and ±1 neighbor buckets for clock skew
        for (const b of [bucket - 1, bucket, bucket + 1]) {
          if (appSentMarkers.has(`${channel.toLowerCase()}|outbound|${b}`)) return 'automated';
        }
        return 'manual';
      }

      // Normalize GHL messages into unified feed items
      const messageItems = messages
        .map(({ msg, convId }) => {
          const direction: 'inbound' | 'outbound' = msg.direction === 1 || msg.direction === 'inbound' ? 'inbound' : 'outbound';
          const ghlType = String(msg.type || '').toUpperCase();
          let channel: string = 'other';
          if (ghlType === 'SMS' || ghlType === 'TYPE_SMS') channel = 'sms';
          else if (ghlType === 'EMAIL' || ghlType === 'TYPE_EMAIL') channel = 'email';
          else if (ghlType === 'CALL' || ghlType === 'TYPE_CALL') channel = 'call';
          else if (ghlType) channel = ghlType.toLowerCase();
          const date = msg.dateAdded || msg.createdAt || msg.date || '';
          return {
            id: `msg-${msg.id || convId}-${date}`,
            channel,
            direction,
            date,
            body: msg.body || msg.text || msg.message || '',
            sourceMark: markSource(channel, direction, date),
          };
        })
        .filter(m => m.date && (new Date(m.date).getTime() >= windowStart.getTime()));

      // Normalize GHL notes into feed items
      const noteItems = notes
        .map((n: any) => ({
          id: `note-${n.id || ''}`,
          channel: 'note',
          direction: 'note' as const,
          date: n.dateAdded || n.createdAt || '',
          body: n.body || '',
          sourceMark: null as null,
        }))
        .filter((n: any) => n.date && (new Date(n.date).getTime() >= windowStart.getTime()));

      // Merge + sort newest-first
      const combined = [...messageItems, ...noteItems].sort((a, b) => {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      const page = combined.slice(offset, offset + limit);
      const hasMore = combined.length > offset + limit;

      res.json({
        items: page,
        total: combined.length,
        hasMore,
        windowDays,
      });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/dashboard/client-files/:contactId
   * Returns enrollment packet signed URLs + signed-milestone metadata.
   */
  async clientFiles(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId } = req.params;

      const supabase = getSupabase();

      // Fetch enrollments w/ packet paths and signoffs in parallel
      const [enrollmentRes, signoffRes] = await Promise.all([
        supabase
          .from('enrollments')
          .select('id, offer_id, packet_pdf_path, created_at')
          .eq('location_id', locationId)
          .eq('contact_id', contactId)
          .not('packet_pdf_path', 'is', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('evidence_signoffs')
          .select('id, milestone_number, milestone_name, signed_at, digital_signature, work_summary')
          .eq('location_id', locationId)
          .eq('contact_id', contactId)
          .order('signed_at', { ascending: false }),
      ]);

      // Resolve offer names for packet rows
      const offerIds = [...new Set((enrollmentRes.data || []).map(e => e.offer_id).filter(Boolean))];
      let offerMap: Record<string, string> = {};
      if (offerIds.length > 0) {
        const { data: offers } = await supabase
          .from('offers_mirror')
          .select('id, offer_name')
          .in('id', offerIds);
        for (const o of (offers || [])) offerMap[o.id] = o.offer_name;
      }

      // Build packet list — do NOT pre-generate signed URLs (merchant can hit /api/enrollments/:id/packet)
      // The frontend FilesTab downloads via the existing streaming route to avoid URL leakage.
      const packets = (enrollmentRes.data || []).map(e => ({
        enrollmentId: e.id,
        offerName: e.offer_id ? (offerMap[e.offer_id] || 'Enrollment Packet') : 'Enrollment Packet',
        createdAt: e.created_at,
      }));

      const signoffs = (signoffRes.data || []).map((s: any) => ({
        id: s.id,
        milestoneNumber: s.milestone_number,
        milestoneName: s.milestone_name,
        signedAt: s.signed_at,
        signedBy: s.digital_signature || null,
        workSummary: s.work_summary || null,
      }));

      res.json({ packets, signoffs });
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

      // Status filter — specific status takes priority over statusGroup
      const statusGroup = req.query.statusGroup as string || '';
      if (status) {
        query = query.eq('status', status);
      } else if (statusGroup === 'active') {
        query = query.in('status', ['enrolled', 'active', 'consent_captured', 'device_captured', 'paused', 'manual_add']);
      } else if (statusGroup === 'archive') {
        query = query.in('status', ['completed', 'cancelled']);
      }
      // statusGroup === 'all' or empty → no filter

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

  /** POST /api/dashboard/add-client — create a client (GHL contact + minimal enrollment record) */
  async addClient(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { firstName, lastName, email, phone } = req.body;
      if (!firstName || !email) throw new ValidationError('firstName and email required');

      const supabase = getSupabase();
      const api = await ghlApi(locationId);

      // Upsert GHL contact
      const upsertRes = await api.post('/contacts/upsert', {
        firstName,
        lastName: lastName || '',
        email,
        phone: phone || '',
        locationId,
      });
      const contactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
      if (!contactId) throw new ValidationError('Failed to create GHL contact');

      // Get merchant for merchant_id
      const { data: merchant } = await supabase.from('merchants').select('id').eq('location_id', locationId).single();

      // Create minimal enrollment record so client appears in client_list_view
      await supabase.from('enrollments').insert({
        location_id: locationId,
        merchant_id: merchant?.id || null,
        contact_id: contactId,
        email,
        first_name: firstName,
        last_name: lastName || '',
        status: 'manual_add',
        created_at: new Date().toISOString(),
      });

      res.json({ success: true, contactId });
    } catch (err) { next(err); }
  },

  /** POST /api/dashboard/assign-offer — directly enroll a client in an offer */
  async assignOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { contactId, offerId } = req.body;
      if (!contactId || !offerId) throw new ValidationError('contactId and offerId required');

      const supabase = getSupabase();

      // Validate offer
      const { data: offer } = await supabase.from('offers_mirror').select('id, offer_name, price, payment_type, location_id').eq('id', offerId).eq('active', true).single();
      if (!offer) throw new ValidationError('Offer not found or inactive');

      // Get merchant
      const { data: merchant } = await supabase.from('merchants').select('id').eq('location_id', locationId).single();

      // Get contact info from GHL
      let contactEmail = '';
      let contactFirstName = '';
      let contactLastName = '';
      try {
        const api = await ghlApi(locationId);
        const contactRes = await api.get(`/contacts/${contactId}`);
        const contact = contactRes.data?.contact || contactRes.data || {};
        contactEmail = contact.email || '';
        contactFirstName = contact.firstName || '';
        contactLastName = contact.lastName || '';
      } catch {}

      // Create enrollment
      const { data: enrollment, error: insertErr } = await supabase.from('enrollments').insert({
        location_id: locationId,
        merchant_id: merchant?.id || null,
        contact_id: contactId,
        offer_id: offerId,
        email: contactEmail,
        first_name: contactFirstName,
        last_name: contactLastName,
        status: 'enrolled',
        payment_type: 'manual',
        payment_amount: 0,
        enrolled_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }).select('id').single();

      if (insertErr) throw insertErr;

      // Log evidence
      try {
        await evidenceService.logEvidence(
          'subscription_change', locationId, contactId, 'merchant_action',
          {
            action: 'plan_change',
            offer_id: offerId,
            offer_name: offer.offer_name,
            change_date: new Date().toISOString(),
            initiated_by: 'merchant',
            previous_status: 'none',
            new_status: 'enrolled',
            enrollment_id: enrollment?.id || null,
            ...buildDefenseEvidenceFields({
              summary: `Merchant manually enrolled client in ${offer.offer_name}.`,
              title: 'Manual Enrollment Assignment',
              proofRole: 'merchant_action',
              relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'medium', confidence: 'moderate' },
              enrollmentId: enrollment?.id || null,
              metadata: {
                actor: 'merchant',
                service: { enrollmentId: enrollment?.id || null, offerId, offerName: offer.offer_name },
                source: { system: 'dashboard', rawEventType: 'manual_enrollment' },
              },
            }),
          },
        );
      } catch {}

      // Update GHL contact status
      try {
        const api = await ghlApi(locationId);
        await api.put(`/contacts/${contactId}`, {
          customField: { 'contact.ss_enrollment_status': 'enrolled' },
        });
        await api.post(`/contacts/${contactId}/notes`, {
          body: `Manually enrolled in ${offer.offer_name} by merchant.`,
        });
      } catch {}

      res.json({ success: true, enrollmentId: enrollment?.id });
    } catch (err) { next(err); }
  },
};
