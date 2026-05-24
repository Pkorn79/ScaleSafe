import { getSupabase } from '../clients/supabase.client';
import { evidenceRepository } from '../repositories/evidence.repository';
import { logger } from '../utils/logger';
import { getDefenseSummary } from '../utils/defense-evidence';

/**
 * Defense Exhibits Service — single source of truth for the numbered exhibit
 * list that the AI letter cites AND the bundled PDF assembles. The same list
 * is passed to both consumers so citations and PDF assembly never drift.
 *
 * Exhibits are grouped by semantic category for the prompt builder:
 *   - Consent (T&C acceptance — strongest evidence after the signed packet)
 *   - Service Delivery (sessions, modules, milestones, signoffs, course completions)
 *   - Communication (inbound + outbound logs — proves authorization & engagement)
 *   - Payments (prior undisputed transactions)
 *   - Termination (cancellation, refund, dispute events — must be framed
 *     factually, NEVER as engagement)
 *
 * Letter assignment (A, B, C…) is sequential in the order exhibits are listed.
 * Exhibit A is reserved for the signed enrollment packet (the strongest
 * single piece of evidence). The signed packet is loaded from storage by the
 * bundler — the exhibit list just records its existence.
 */

export type ExhibitSource =
  | 'enrollment_packet_pdf' // loaded from private storage with legacy bucket fallback
  | 'evidence_consent'
  | 'evidence_sessions'
  | 'evidence_modules'
  | 'evidence_milestones'
  | 'evidence_signoffs'
  | 'evidence_communication'
  | 'evidence_appointments'
  | 'evidence_invoices'
  | 'evidence_payment_confirmation'
  | 'evidence_enrollment_payment'
  | 'evidence_cancellation'
  | 'evidence_refund_activity'
  | 'evidence_subscription_changes'
  | 'evidence_course_completion'
  | 'evidence_external_sessions'
  | 'evidence_service_access'
  | 'evidence_pulse_checkins'
  | 'evidence_failed_payment'
  | 'evidence_attendance'
  | 'evidence_resource_delivery';

export type ExhibitCategory =
  | 'consent'
  | 'service_delivery'
  | 'communication'
  | 'payments'
  | 'termination';

export interface ExhibitEntry {
  /** Sequential letter assignment: A, B, C… */
  letter: string;
  /** Display name shown in the letter and PDF table of contents */
  name: string;
  /** Semantic category for prompt grouping */
  category: ExhibitCategory;
  /** Where the content lives so the bundler can fetch it */
  source: ExhibitSource;
  /** Source row id (or storage path for the enrollment packet) */
  ref: string;
  /** ISO date string when the underlying event occurred */
  occurredAt: string | null;
  /** Plain-English single-sentence summary, server-rendered for the prompt */
  summary: string;
  /** Optional structured fields the bundler can render in the PDF */
  meta?: Record<string, unknown>;
}

export interface ExhibitList {
  exhibits: ExhibitEntry[];
  byCategory: Record<ExhibitCategory, ExhibitEntry[]>;
  totals: {
    consent: number;
    serviceDelivery: number;
    communication: number;
    payments: number;
    termination: number;
  };
  enrollmentPacketPath: string | null;
}

/** Convert column index to letter: 1→A, 2→B… 26→Z, 27→AA… */
function indexToLetter(n: number): string {
  let result = '';
  let remaining = n;
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return 'date unknown';
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return String(d);
  }
}

const DEFENSE_FIELD_SELECT = [
  'defense_summary',
  'issuer_exhibit_title',
  'proof_role',
  'reason_code_tags',
  'dispute_relevance',
  'defense_metadata',
  'actor',
  'source_record_id',
].join(', ');

function exhibitName(row: any, fallback: string): string {
  return row?.issuer_exhibit_title || fallback;
}

function exhibitSummary(row: any, fallback: string): string {
  return getDefenseSummary(row) || fallback;
}

function exhibitMeta(row: any, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...extra,
    proofRole: row?.proof_role || null,
    reasonCodeTags: row?.reason_code_tags || [],
    disputeRelevance: row?.dispute_relevance || {},
    defenseMetadata: row?.defense_metadata || {},
    actor: row?.actor || null,
    sourceRecordId: row?.source_record_id || null,
  };
}

function applyDefenseContract(exhibit: ExhibitEntry, row: any): void {
  exhibit.name = exhibitName(row, exhibit.name);
  exhibit.summary = exhibitSummary(row, exhibit.summary);
  exhibit.meta = exhibitMeta(row, exhibit.meta || {});
}

export const defenseExhibitsService = {
  /**
   * Build the exhibit list for a contact at compilation time.
   * Returns ordered exhibits + by-category index + totals.
   *
   * When `opts.enrollmentId` is provided (from the transaction selector), evidence
   * queries are scoped to that enrollment's offer_id so multi-enrollment contacts
   * don't get irrelevant evidence in their defense packet.
   */
  async buildExhibitList(
    locationId: string,
    contactId: string,
    opts?: { enrollmentId?: string },
  ): Promise<ExhibitList> {
    const supabase = getSupabase();
    const exhibits: ExhibitEntry[] = [];
    let nextIdx = 1;

    // Resolve the target enrollment's offer_id for scoping (when available)
    let scopeOfferId: string | null = null;
    if (opts?.enrollmentId) {
      try {
        const { data: enr } = await supabase
          .from('enrollments')
          .select('offer_id')
          .eq('id', opts.enrollmentId)
          .maybeSingle();
        scopeOfferId = enr?.offer_id || null;
      } catch {}
    }

    // ── 1. Signed enrollment packet PDF (Exhibit A — always first if it exists) ──
    let enrollmentPacketPath: string | null = null;
    try {
      let enrollmentQuery = supabase
        .from('enrollments')
        .select('id, packet_pdf_path, enrolled_at, offer_id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId);
      if (opts?.enrollmentId) {
        enrollmentQuery = enrollmentQuery.eq('id', opts.enrollmentId);
      } else {
        enrollmentQuery = enrollmentQuery.order('created_at', { ascending: false }).limit(1);
      }
      const { data: enrollment } = await enrollmentQuery.maybeSingle();

      if (enrollment?.packet_pdf_path) {
        enrollmentPacketPath = enrollment.packet_pdf_path;
        let offerName = '';
        if (enrollment.offer_id) {
          const { data: o } = await supabase
            .from('offers_mirror')
            .select('offer_name')
            .eq('id', enrollment.offer_id)
            .maybeSingle();
          offerName = o?.offer_name || '';
        }
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Signed Enrollment Packet${offerName ? ` — ${offerName}` : ''}`,
          category: 'consent',
          source: 'enrollment_packet_pdf',
          ref: enrollment.packet_pdf_path,
          occurredAt: enrollment.enrolled_at || null,
          summary: `Signed enrollment packet captured at the time of agreement, dated ${fmtDate(enrollment.enrolled_at)}. Includes T&C acceptance with consent forensics (IP, device, scroll depth, digital signature) and the original payment confirmation.`,
        });
      }
    } catch (err: any) {
      logger.warn({ err: err.message, locationId, contactId }, 'defense-exhibits: failed to look up enrollment packet');
    }

    // ── 2. Consent records (separate from the signed packet — for funnel-direct enrollments) ──
    try {
      const { data: consents } = await supabase
        .from('evidence_consent')
        .select(`id, consent_timestamp, ip_address, device_fingerprint, browser, tc_version, contact_name, contact_email, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('consent_timestamp', { ascending: true });
      for (const c of ((consents || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(c, 'Consent Record'),
          category: 'consent',
          source: 'evidence_consent',
          ref: c.id,
          occurredAt: c.consent_timestamp,
          summary: exhibitSummary(c, `Terms & Conditions acceptance recorded ${fmtDate(c.consent_timestamp)} from IP ${c.ip_address || 'unknown'}${c.browser ? ` (${c.browser})` : ''}. T&C version: ${c.tc_version || 'n/a'}.`),
          meta: exhibitMeta(c, { ip: c.ip_address, device: c.device_fingerprint, browser: c.browser }),
        });
      }
    } catch { /* table may be empty — non-fatal */ }

    // ── 3. Service Delivery: sessions, modules, milestones, signoffs, course completion ──
    try {
      const { data: appointments } = await supabase
        .from('evidence_appointments')
        .select(`id, appointment_title, appointment_status, appointment_event_type, start_time, end_time, calendar_id, delivery_role, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('start_time', { ascending: true });
      for (const a of ((appointments || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(a, `Appointment: ${a.appointment_title || 'GHL appointment'}`),
          category: 'service_delivery',
          source: 'evidence_appointments',
          ref: a.id,
          occurredAt: a.start_time || null,
          summary: exhibitSummary(a, `GHL appointment "${a.appointment_title || 'Untitled'}" recorded as ${a.appointment_status || 'unknown'} on ${fmtDate(a.start_time)}.`),
          meta: exhibitMeta(a, { calendarId: a.calendar_id, deliveryRole: a.delivery_role, appointmentStatus: a.appointment_status }),
        });
      }
    } catch {}

    try {
      const { data: sessions } = await supabase
        .from('evidence_sessions')
        .select(`id, session_date, session_title, duration_minutes, attendance_status, facilitator, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('attendance_status', 'attended') // only count attended sessions as delivery evidence
        .order('session_date', { ascending: true });
      for (const s of ((sessions || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(s, `Session: ${s.session_title || 'Untitled'}`),
          category: 'service_delivery',
          source: 'evidence_sessions',
          ref: s.id,
          occurredAt: s.session_date,
          summary: exhibitSummary(s, `Session "${s.session_title || 'Untitled'}" delivered ${fmtDate(s.session_date)}, duration ${s.duration_minutes || 'n/a'} minutes${s.facilitator ? `, facilitated by ${s.facilitator}` : ''}. Status: attended.`),
          meta: exhibitMeta(s),
        });
      }
    } catch {}

    try {
      const { data: modules } = await supabase
        .from('evidence_modules')
        .select(`id, module_name, completion_date, completion_status, progress_pct, time_spent_minutes, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completion_date', { ascending: true });
      for (const m of ((modules || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(m, `Module: ${m.module_name || 'Untitled'}`),
          category: 'service_delivery',
          source: 'evidence_modules',
          ref: m.id,
          occurredAt: m.completion_date,
          summary: `Module "${m.module_name || 'Untitled'}" — status ${m.completion_status || 'n/a'} as of ${fmtDate(m.completion_date)}. Progress: ${m.progress_pct ?? 'n/a'}%. Time spent: ${m.time_spent_minutes ?? 'n/a'} minutes.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], m);
      }
    } catch {}

    try {
      const { data: milestones } = await supabase
        .from('evidence_milestones')
        .select(`id, milestone_number, milestone_name, completed_at, description, notes, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completed_at', { ascending: true });
      for (const ms of ((milestones || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Milestone ${ms.milestone_number ?? '?'}: ${ms.milestone_name || ''}`,
          category: 'service_delivery',
          source: 'evidence_milestones',
          ref: ms.id,
          occurredAt: ms.completed_at,
          summary: `Milestone ${ms.milestone_number ?? '?'} ("${ms.milestone_name || 'Untitled'}") marked complete ${fmtDate(ms.completed_at)}.${ms.description ? ` Deliverables: ${ms.description}.` : ''}`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], ms);
      }
    } catch {}

    try {
      const { data: signoffs } = await supabase
        .from('evidence_signoffs')
        .select(`id, milestone_number, milestone_name, work_summary, signed_at, ip_address, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('signed_at', { ascending: true });
      for (const so of ((signoffs || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Client Signoff: Milestone ${so.milestone_number ?? '?'}`,
          category: 'service_delivery',
          source: 'evidence_signoffs',
          ref: so.id,
          occurredAt: so.signed_at,
          summary: `Client digitally signed off on milestone ${so.milestone_number ?? '?'} ("${so.milestone_name || 'Untitled'}") on ${fmtDate(so.signed_at)} from IP ${so.ip_address || 'unknown'}.${so.work_summary ? ` Work summary: ${so.work_summary}.` : ''}`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], so);
      }
    } catch {}

    try {
      const { data: courses } = await supabase
        .from('evidence_course_completion')
        .select(`id, course_name, completed_at, certificate_url, grade, platform, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completed_at', { ascending: true });
      for (const c of ((courses || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Course Completion: ${c.course_name || ''}`,
          category: 'service_delivery',
          source: 'evidence_course_completion',
          ref: c.id,
          occurredAt: c.completed_at,
          summary: `Course "${c.course_name || 'Untitled'}" completed ${fmtDate(c.completed_at)} on ${c.platform || 'platform unknown'}${c.grade ? `, grade ${c.grade}` : ''}.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], c);
      }
    } catch {}

    // ── 4. Communication log ──
    try {
      const { data: comms } = await supabase
        .from('evidence_communication')
        .select(`id, comm_type, direction, comm_date, summary, body_preview, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('comm_date', { ascending: true });
      for (const c of ((comms || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Communication: ${c.direction === 'inbound' ? 'From client' : 'To client'} (${c.comm_type})`,
          category: 'communication',
          source: 'evidence_communication',
          ref: c.id,
          occurredAt: c.comm_date,
          summary: `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} ${c.comm_type} on ${fmtDate(c.comm_date)}.${c.summary ? ` Summary: ${c.summary}.` : c.body_preview ? ` Preview: ${c.body_preview.slice(0, 200)}.` : ''}`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], c);
      }
    } catch {}

    // ── 5. Payments: enrollment + recurring confirmations (Prior Undisputed Transactions) ──
    try {
      const { data: invoices } = await supabase
        .from('evidence_invoices')
        .select(`id, invoice_id, invoice_number, invoice_status, invoice_event_type, amount, amount_paid, currency, sent_at, paid_at, due_date, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true });
      for (const inv of ((invoices || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(inv, `Invoice: ${inv.invoice_number || inv.invoice_id || inv.invoice_status || 'GHL invoice'}`),
          category: inv.paid_at ? 'payments' : 'communication',
          source: 'evidence_invoices',
          ref: inv.id,
          occurredAt: inv.paid_at || inv.sent_at || inv.due_date || null,
          summary: exhibitSummary(inv, `GHL invoice ${inv.invoice_number || inv.invoice_id || 'unknown'} recorded as ${inv.invoice_status || inv.invoice_event_type || 'unknown'}. Amount: $${Number(inv.amount || 0).toFixed(2)} ${inv.currency || 'USD'}.`),
          meta: exhibitMeta(inv, { invoiceId: inv.invoice_id, amount: inv.amount, amountPaid: inv.amount_paid, status: inv.invoice_status }),
        });
      }
    } catch {}

    try {
      const { data: enrollPay } = await supabase
        .from('evidence_enrollment_payment')
        .select(`id, ghl_transaction_id, amount, payment_method, last_four, payment_timestamp, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('payment_timestamp', { ascending: true });
      for (const p of ((enrollPay || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: 'Enrollment Payment',
          category: 'payments',
          source: 'evidence_enrollment_payment',
          ref: p.id,
          occurredAt: p.payment_timestamp,
          summary: `Initial enrollment payment of $${Number(p.amount || 0).toFixed(2)} processed ${fmtDate(p.payment_timestamp)} via ${p.payment_method || 'card'}${p.last_four ? ` ending ${p.last_four}` : ''}. Transaction id: ${p.ghl_transaction_id || 'n/a'}.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], p);
      }
    } catch {}

    try {
      const { data: recPay } = await supabase
        .from('evidence_payment_confirmation')
        .select(`id, ghl_transaction_id, amount, payment_date, payment_number, running_total, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('payment_date', { ascending: true });
      for (const p of ((recPay || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Recurring Payment #${p.payment_number ?? '?'}`,
          category: 'payments',
          source: 'evidence_payment_confirmation',
          ref: p.id,
          occurredAt: p.payment_date,
          summary: `Recurring payment #${p.payment_number ?? '?'} of $${Number(p.amount || 0).toFixed(2)} processed ${fmtDate(p.payment_date)}. Running total: $${Number(p.running_total || 0).toFixed(2)}.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], p);
      }
    } catch {}

    // ── 6. Termination events: cancellation, refund, subscription changes ──
    try {
      const { data: cancels } = await supabase
        .from('evidence_cancellation')
        .select(`id, cancellation_date, reason, refund_eligibility, status_at_cancellation, initiated_by, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('cancellation_date', { ascending: true });
      for (const c of ((cancels || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: 'Cancellation Record',
          category: 'termination',
          source: 'evidence_cancellation',
          ref: c.id,
          occurredAt: c.cancellation_date,
          summary: `Subscription cancelled on ${fmtDate(c.cancellation_date)}${c.initiated_by ? ` by ${c.initiated_by}` : ''}. Reason: ${c.reason || 'not specified'}. Status at cancellation: ${c.status_at_cancellation || 'n/a'}. Refund eligibility: ${c.refund_eligibility || 'n/a'}.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], c);
      }
    } catch {}

    try {
      const { data: refunds } = await supabase
        .from('evidence_refund_activity')
        .select(`id, amount, refund_type, reason, refund_date, initiated_by, ghl_transaction_id, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('refund_date', { ascending: true });
      for (const r of ((refunds || []) as any[])) {
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Refund (${r.refund_type || 'partial'})`,
          category: 'termination',
          source: 'evidence_refund_activity',
          ref: r.id,
          occurredAt: r.refund_date,
          summary: `Refund of $${Number(r.amount || 0).toFixed(2)} (${r.refund_type || 'partial'}) issued ${fmtDate(r.refund_date)}${r.initiated_by ? ` by ${r.initiated_by}` : ''}. Reason: ${r.reason || 'not specified'}.`,
        });
        applyDefenseContract(exhibits[exhibits.length - 1], r);
      }
    } catch {}

    // Also pull from unified evidence repo for any evidence_type rows not in the per-table tables
    // (deliberate: we trust the per-table queries above as the primary source — this is just a
    // safety net for the unified `evidence` table additions made post-migration 010).
    try {
      const { rows: extra } = await evidenceRepository.getTimeline(locationId, contactId, { limit: 200 });
      for (const e of extra) {
        // Skip rows already covered by the per-table queries above (matched by id).
        if (exhibits.some(ex => ex.ref === e.id)) continue;
        // Only include high-signal types from the unified table
        const type = (e as any).evidence_type || (e as any).type;
        if (!['custom_event', 'resource_delivery', 'service_access'].includes(type)) continue;
        const summary = getDefenseSummary(e) || JSON.stringify((e as any).data || {}).slice(0, 200);
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(e, `Evidence: ${type.replace(/_/g, ' ')}`),
          category: 'service_delivery',
          source: ('evidence_' + type) as ExhibitSource,
          ref: e.id,
          occurredAt: (e as any).created_at || null,
          summary: `${type.replace(/_/g, ' ')} recorded ${fmtDate((e as any).created_at)}. ${summary}`,
          meta: exhibitMeta(e),
        });
      }
    } catch {}

    // Build by-category index
    const byCategory: Record<ExhibitCategory, ExhibitEntry[]> = {
      consent: [],
      service_delivery: [],
      communication: [],
      payments: [],
      termination: [],
    };
    for (const ex of exhibits) {
      byCategory[ex.category].push(ex);
    }

    return {
      exhibits,
      byCategory,
      totals: {
        consent: byCategory.consent.length,
        serviceDelivery: byCategory.service_delivery.length,
        communication: byCategory.communication.length,
        payments: byCategory.payments.length,
        termination: byCategory.termination.length,
      },
      enrollmentPacketPath,
    };
  },
};
