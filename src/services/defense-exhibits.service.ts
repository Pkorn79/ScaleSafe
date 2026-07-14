import { getSupabase } from '../clients/supabase.client';
import { evidenceRepository } from '../repositories/evidence.repository';
import { logger } from '../utils/logger';
import { getDefenseSummary } from '../utils/defense-evidence';
import { cleanCommunicationBody, looksLikeUnrenderedTemplate } from '../utils/communication-evidence';

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
  | 'payment_event'
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
  | 'evidence_resource_delivery'
  | 'evidence_assignments'
  | 'evidence_custom_events';

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
  /** True when this exhibit was included under contact-only (unverified) scope */
  unverifiedScope?: boolean;
  /** True for low-signal exhibits (e.g. unlinked comms) — sorted after everything else */
  deprioritized?: boolean;
}

/** A defense evidence source whose query failed — the packet is missing that
 *  source's exhibits entirely, so callers must surface it (needs_review), never
 *  present the packet as complete. */
export interface ExhibitSourceError {
  source: string;
  message: string;
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
  /** Evidence source queries that failed (schema drift, etc.) — never silently empty */
  sourceErrors: ExhibitSourceError[];
}

export function appointmentExhibitCategory(row: any): ExhibitCategory {
  const status = String(row?.appointment_status || '').trim().toLowerCase();
  const proofRole = String(row?.proof_role || '').trim().toLowerCase();
  const delivered = proofRole === 'service_delivery'
    || ['completed', 'attended', 'showed'].includes(status);
  return delivered ? 'service_delivery' : 'communication';
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

// Exported for unit testing — this is the fail-safe that decides whether a row is
// in-scope for the disputed enrollment. A regression here is what caused contact-wide
// evidence dumps.
export function scopedRows<T extends Record<string, any>>(
  rows: T[] | null | undefined,
  enrollmentId: string | undefined,
  dateField: string,
  windowStart: Date | null,
  windowEnd: Date | null,
  offerId?: string | null,
  scopeConfidence?: string,
): T[] {
  if (!enrollmentId) {
    // Fail-safe: a missing enrollment must NOT mean "include every contact-wide
    // row". Only allow contact-wide evidence when scope is *explicitly* contact_only
    // (the packet is then marked needs_review and communications are capped).
    return scopeConfidence === 'contact_only' ? (rows || []) : [];
  }
  return (rows || []).filter((row) => {
    if (row.enrollment_id === enrollmentId) return true;
    if (row.enrollment_id) return false;
    // Legacy rows (pre-048 write paths) carry the enrollment/offer link only inside
    // defense_metadata or raw_payload — consult both before falling to the date window.
    const meta = row.defense_metadata || {};
    const raw = row.raw_payload || {};
    const metaEnrollmentId = meta.enrollmentId || meta.enrollment_id || meta.service?.enrollmentId || meta.service?.enrollment_id
      || raw.enrollmentId || raw.enrollment_id;
    if (metaEnrollmentId === enrollmentId) return true;
    if (metaEnrollmentId) return false;
    const metaOfferId = meta.offerId || meta.offer_id || meta.service?.offerId || meta.service?.offer_id
      || raw.offerId || raw.offer_id;
    if (offerId && (row.offer_id === offerId || metaOfferId === offerId)) {
      // Offer-only identity is not exact when a client can enroll in the same
      // offer more than once. It is usable only for a clearly labelled inferred
      // scope; exact packets require an enrollment identifier.
      return scopeConfidence === 'inferred';
    }
    if (row.offer_id || metaOfferId) return false;
    // Exact transaction scope must never promote a contact-wide row solely
    // because its timestamp falls inside the program window. That is how sibling
    // enrollments on the same day leaked into a bank-facing packet. Legacy rows
    // remain usable when they carry enrollment/offer identifiers in metadata.
    if (scopeConfidence === 'exact' || scopeConfidence === undefined) return false;
    if (!windowStart || !windowEnd) return true;
    const value = row[dateField] || row.created_at;
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time >= windowStart.getTime() && time <= windowEnd.getTime();
  });
}

// Maps each exhibit source to the evidence-priority keys used in
// reason_code_strategies.evidence_priorities. An exhibit's rank is the index of
// its earliest-matching key; unmatched exhibits keep build order after all
// matched ones. Sort is stable, so within a rank the original chronology holds.
const SOURCE_PRIORITY_KEYS: Record<string, string[]> = {
  payment_event: ['payment_history'],
  enrollment_packet_pdf: ['consent', 'enrollment_packet', 'offer_terms'],
  evidence_consent: ['consent', 'ip_device_match'],
  evidence_sessions: ['sessions'],
  evidence_appointments: ['sessions'],
  evidence_external_sessions: ['sessions'],
  evidence_modules: ['modules', 'deliverables'],
  evidence_course_completion: ['modules', 'deliverables'],
  evidence_milestones: ['milestones'],
  evidence_signoffs: ['signoffs', 'milestones'],
  evidence_service_access: ['service_access', 'ip_device_match'],
  evidence_resource_delivery: ['deliverables'],
  evidence_assignments: ['deliverables', 'modules'],
  evidence_custom_events: ['service_access', 'deliverables'],
  evidence_communication: ['communication'],
  evidence_invoices: ['payment_history'],
  evidence_enrollment_payment: ['payment_history'],
  evidence_payment_confirmation: ['payment_history'],
  evidence_cancellation: ['cancellation'],
  evidence_refund_activity: ['refund_policy', 'cancellation'],
};

// ── Transaction timeline ─────────────────────────────────────────────────
// A chronological table (date → event → exhibit letter) assembled from the
// exhibit list plus markers for the disputed charge and the dispute filing.
// Reviewers skim; the timeline shows at a glance that engagement continued
// after purchase and where the dispute falls in the story.

export interface TimelineRow {
  /** ISO date string */
  date: string;
  label: string;
  exhibitLetter?: string;
  /** Marker rows (disputed charge / dispute filed) get emphasis in rendering */
  isMarker?: boolean;
}

export function buildTimelineRows(
  exhibits: ExhibitEntry[],
  opts?: { transactionDate?: string | null; disputeDate?: string | null },
): TimelineRow[] {
  const rows: TimelineRow[] = exhibits
    .filter((ex) => ex.occurredAt)
    .map((ex) => ({ date: ex.occurredAt as string, label: ex.name, exhibitLetter: ex.letter }));

  if (opts?.transactionDate) {
    rows.push({ date: opts.transactionDate, label: 'Disputed charge', isMarker: true });
  }
  if (opts?.disputeDate) {
    rows.push({ date: opts.disputeDate, label: 'Chargeback filed by cardholder', isMarker: true });
  }

  return rows
    .filter((r) => Number.isFinite(new Date(r.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** reason_code_strategies.evidence_priorities is JSONB — normalize whatever
 *  shape the driver returns (array, JSON string, null) to a string array. */
export function normalizeEvidencePriorities(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function exhibitPriorityRank(exhibit: ExhibitEntry, priorities: string[]): number {
  // Low-signal exhibits (unlinked comms) go after everything, matched or not.
  if (exhibit.deprioritized) return priorities.length + 1;
  const keys = SOURCE_PRIORITY_KEYS[exhibit.source] || [];
  let best = priorities.length;
  for (const key of keys) {
    const idx = priorities.indexOf(key);
    if (idx !== -1 && idx < best) best = idx;
  }
  // The signed enrollment packet is the strongest single piece of evidence. When a
  // reason code's priority list ranks it (via 'consent' etc.) that rank wins — e.g.
  // 13.6 deliberately leads with the refund record. But when the list has no consent
  // key at all (e.g. 4855), the packet must LEAD the exhibits, not fall behind
  // unmatched noise. (The 4855 live test put five outbound emails ahead of it.)
  if (exhibit.source === 'enrollment_packet_pdf' && best === priorities.length) return -1;
  return best;
}

// Exported for unit testing — this decides which exhibit leads the packet.
export function sortExhibitsByPriority(exhibits: ExhibitEntry[], priorities: string[]): void {
  const ranked = exhibits.map((ex, i) => ({ ex, rank: exhibitPriorityRank(ex, priorities), i }));
  ranked.sort((a, b) => (a.rank - b.rank) || (a.i - b.i));
  for (let i = 0; i < ranked.length; i++) exhibits[i] = ranked[i].ex;
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
    opts?: {
      enrollmentId?: string;
      paymentEventId?: string | null;
      scopeConfidence?: string;
      offerId?: string | null;
      offerName?: string | null;
      enrollmentStart?: string | null;
      enrollmentEnd?: string | null;
      /** Ordered persuasiveness keys from reason_code_strategies.evidence_priorities
       *  (e.g. ["cancellation","consent","service_access"]). When present, exhibits
       *  are re-sorted by these priorities and re-lettered. */
      evidencePriorities?: string[];
    },
  ): Promise<ExhibitList> {
    const supabase = getSupabase();
    const exhibits: ExhibitEntry[] = [];
    let nextIdx = 1;
    const scopeConfidence = opts?.scopeConfidence;
    const isContactOnly = scopeConfidence === 'contact_only';

    // Supabase queries do NOT throw — they return { data, error }. Ignoring `error`
    // is what silently dropped every milestone exhibit when the live DB was missing
    // evidence_milestones.enrollment_id. Every source query below must route its
    // error through here so the failure is loud and the packet is held for review.
    const sourceErrors: ExhibitSourceError[] = [];
    const recordSourceError = (source: string, err: any) => {
      const message = err?.message || String(err);
      sourceErrors.push({ source, message });
      logger.error(
        { source, err: message, locationId, contactId },
        'defense-exhibits: evidence source query failed — exhibits from this source are MISSING from the packet',
      );
    };

    // Resolve the target enrollment for scoping (when available). Prefer values the
    // caller already resolved (dispute-scope) to avoid a redundant lookup.
    let scopeOfferId: string | null = opts?.offerId ?? null;
    let scopeOfferName: string | null = opts?.offerName?.trim() || null;
    let scopeWindowStart: Date | null = null;
    let scopeWindowEnd: Date | null = null;
    if (opts?.enrollmentId && (opts.enrollmentStart !== undefined || opts.enrollmentEnd !== undefined || opts.offerId !== undefined)) {
      // Use the pre-resolved scope window/offer.
      const anchor = opts.enrollmentStart || null;
      if (anchor) {
        scopeWindowStart = new Date(new Date(anchor).getTime() - 14 * 86400000);
        const explicitEnd = opts.enrollmentEnd || null;
        const fallbackEnd = new Date(new Date(anchor).getTime() + 180 * 86400000);
        scopeWindowEnd = explicitEnd ? new Date(explicitEnd) : fallbackEnd;
        const now = new Date();
        if (scopeWindowEnd.getTime() > now.getTime()) scopeWindowEnd = now;
      }
    } else if (opts?.enrollmentId) {
      try {
        const { data: enr } = await supabase
          .from('enrollments')
          .select('offer_id, created_at, enrolled_at, completed_at, cancelled_at')
          .eq('location_id', locationId)
          .eq('contact_id', contactId)
          .eq('id', opts.enrollmentId)
          .maybeSingle();
        scopeOfferId = enr?.offer_id || null;
        const anchor = enr?.enrolled_at || enr?.created_at;
        if (anchor) {
          scopeWindowStart = new Date(new Date(anchor).getTime() - 14 * 86400000);
          const explicitEnd = enr?.completed_at || enr?.cancelled_at;
          const fallbackEnd = new Date(new Date(anchor).getTime() + 180 * 86400000);
          scopeWindowEnd = explicitEnd ? new Date(explicitEnd) : fallbackEnd;
          const now = new Date();
          if (scopeWindowEnd.getTime() > now.getTime()) scopeWindowEnd = now;
        }
      } catch {}
    }

    if (!scopeOfferName && scopeOfferId) {
      try {
        const { data: offer } = await supabase
          .from('offers_mirror')
          .select('offer_name')
          .eq('id', scopeOfferId)
          .eq('location_id', locationId)
          .maybeSingle();
        scopeOfferName = offer?.offer_name?.trim() || null;
      } catch {}
    }

    // ── 1. Signed enrollment packet PDF (Exhibit A — always first if it exists) ──
    let enrollmentPacketPath: string | null = null;
    if (opts?.enrollmentId) try {
      let enrollmentQuery = supabase
        .from('enrollments')
        .select('id, packet_pdf_path, enrolled_at, offer_id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId);
      enrollmentQuery = enrollmentQuery.eq('id', opts.enrollmentId);
      const { data: enrollment, error: enrollmentErr } = await enrollmentQuery.maybeSingle();
      if (enrollmentErr) recordSourceError('enrollments', enrollmentErr);

      if (enrollment?.packet_pdf_path) {
        enrollmentPacketPath = enrollment.packet_pdf_path;
        let offerName = '';
        if (enrollment.offer_id) {
          const { data: o } = await supabase
            .from('offers_mirror')
            .select('offer_name')
            .eq('id', enrollment.offer_id)
            .eq('location_id', locationId)
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
      recordSourceError('enrollments', err);
    }

    // ── 2. Consent records (separate from the signed packet — for funnel-direct enrollments) ──
    try {
      const { data: consents, error: consentsErr } = await supabase
        .from('evidence_consent')
        .select(`id, enrollment_id, consent_timestamp, ip_address, device_fingerprint, browser, tc_version, contact_name, contact_email, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('consent_timestamp', { ascending: true });
      if (consentsErr) recordSourceError('evidence_consent', consentsErr);
      for (const c of scopedRows((consents || []) as any[], opts?.enrollmentId, 'consent_timestamp', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_consent', err); }

    // ── 3. Service Delivery: sessions, modules, milestones, signoffs, course completion ──
    try {
      const { data: appointments, error: appointmentsErr } = await supabase
        .from('evidence_appointments')
        .select(`id, enrollment_id, appointment_title, appointment_status, appointment_event_type, start_time, end_time, calendar_id, delivery_role, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('start_time', { ascending: true });
      if (appointmentsErr) recordSourceError('evidence_appointments', appointmentsErr);
      for (const a of scopedRows((appointments || []) as any[], opts?.enrollmentId, 'start_time', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        const category = appointmentExhibitCategory(a);
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: exhibitName(a, `Appointment: ${a.appointment_title || 'GHL appointment'}`),
          category,
          source: 'evidence_appointments',
          ref: a.id,
          occurredAt: a.start_time || null,
          summary: exhibitSummary(a, `GHL appointment "${a.appointment_title || 'Untitled'}" recorded as ${a.appointment_status || 'unknown'} on ${fmtDate(a.start_time)}.`),
          meta: exhibitMeta(a, { calendarId: a.calendar_id, deliveryRole: a.delivery_role, appointmentStatus: a.appointment_status }),
          deprioritized: category !== 'service_delivery',
        });
      }
    } catch (err) { recordSourceError('evidence_appointments', err); }

    try {
      const { data: sessions, error: sessionsErr } = await supabase
        .from('evidence_sessions')
        .select(`id, enrollment_id, session_date, session_title, duration_minutes, attendance_status, facilitator, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('attendance_status', 'attended') // only count attended sessions as delivery evidence
        .order('session_date', { ascending: true });
      if (sessionsErr) recordSourceError('evidence_sessions', sessionsErr);
      for (const s of scopedRows((sessions || []) as any[], opts?.enrollmentId, 'session_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_sessions', err); }

    try {
      const { data: modules, error: modulesErr } = await supabase
        .from('evidence_modules')
        .select(`id, enrollment_id, module_name, completion_date, completion_status, progress_pct, time_spent_minutes, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completion_date', { ascending: true });
      if (modulesErr) recordSourceError('evidence_modules', modulesErr);
      for (const m of scopedRows((modules || []) as any[], opts?.enrollmentId, 'completion_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_modules', err); }

    try {
      // raw_payload is selected because legacy milestone rows (written before the
      // enrollment_id column existed) carry the enrollment link only inside it.
      const { data: milestones, error: milestonesErr } = await supabase
        .from('evidence_milestones')
        .select(`id, enrollment_id, milestone_number, milestone_name, completed_at, description, notes, raw_payload, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completed_at', { ascending: true });
      if (milestonesErr) recordSourceError('evidence_milestones', milestonesErr);
      for (const ms of scopedRows((milestones || []) as any[], opts?.enrollmentId, 'completed_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        // Compose the full delivery story from the record. A thin defense_summary
        // (the live one was just "Access to ScaleSafe") must not replace it — a
        // milestone exhibit is only persuasive when it says what was delivered,
        // when, and what the client agreed to do with it.
        const composedSummary = `Milestone ${ms.milestone_number ?? '?'} ("${ms.milestone_name || 'Untitled'}") marked complete ${fmtDate(ms.completed_at)}.`
          + `${ms.description ? ` Deliverables: ${ms.description}.` : ''}`
          + `${ms.notes ? ` Client responsibility: ${ms.notes}.` : ''}`;
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Milestone ${ms.milestone_number ?? '?'}: ${ms.milestone_name || ''}`,
          category: 'service_delivery',
          source: 'evidence_milestones',
          ref: ms.id,
          occurredAt: ms.completed_at,
          summary: composedSummary,
        });
        const exhibit = exhibits[exhibits.length - 1];
        applyDefenseContract(exhibit, ms);
        if ((exhibit.summary || '').length < composedSummary.length) {
          exhibit.summary = composedSummary;
        }
      }
    } catch (err) { recordSourceError('evidence_milestones', err); }

    try {
      const { data: signoffs, error: signoffsErr } = await supabase
        .from('evidence_signoffs')
        .select(`id, enrollment_id, milestone_number, milestone_name, work_summary, signed_at, ip_address, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('signed_at', { ascending: true });
      if (signoffsErr) recordSourceError('evidence_signoffs', signoffsErr);
      for (const so of scopedRows((signoffs || []) as any[], opts?.enrollmentId, 'signed_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_signoffs', err); }

    try {
      const { data: courses, error: coursesErr } = await supabase
        .from('evidence_course_completion')
        .select(`id, enrollment_id, course_name, completed_at, certificate_url, grade, platform, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('completed_at', { ascending: true });
      if (coursesErr) recordSourceError('evidence_course_completion', coursesErr);
      for (const c of scopedRows((courses || []) as any[], opts?.enrollmentId, 'completed_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_course_completion', err); }

    try {
      const { data: rows, error } = await supabase
        .from('evidence_external_sessions')
        .select(`id, enrollment_id, platform, session_date, duration_minutes, session_type, notes, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId).eq('contact_id', contactId).order('session_date', { ascending: true });
      if (error) recordSourceError('evidence_external_sessions', error);
      for (const row of scopedRows((rows || []) as any[], opts?.enrollmentId, 'session_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        exhibits.push({
          letter: indexToLetter(nextIdx++), name: exhibitName(row, `External Session: ${row.session_type || 'Session'}`),
          category: 'service_delivery', source: 'evidence_external_sessions', ref: row.id, occurredAt: row.session_date,
          summary: exhibitSummary(row, `${row.platform || 'External provider'} recorded a ${row.session_type || 'session'} on ${fmtDate(row.session_date)}${row.duration_minutes ? ` lasting ${row.duration_minutes} minutes` : ''}.`),
          meta: exhibitMeta(row),
        });
      }
    } catch (err) { recordSourceError('evidence_external_sessions', err); }

    try {
      const { data: rows, error } = await supabase
        .from('evidence_service_access')
        .select(`id, enrollment_id, platform, event_type, access_date, duration_seconds, content_accessed, ip_address, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId).eq('contact_id', contactId).order('access_date', { ascending: true });
      if (error) recordSourceError('evidence_service_access', error);
      for (const row of scopedRows((rows || []) as any[], opts?.enrollmentId, 'access_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        exhibits.push({
          letter: indexToLetter(nextIdx++), name: exhibitName(row, `Service Access: ${row.content_accessed || row.event_type || 'Activity'}`),
          category: 'service_delivery', source: 'evidence_service_access', ref: row.id, occurredAt: row.access_date,
          summary: exhibitSummary(row, `${row.platform || 'External provider'} recorded ${row.event_type || 'service activity'} on ${fmtDate(row.access_date)}${row.content_accessed ? ` for ${row.content_accessed}` : ''}.`),
          meta: exhibitMeta(row, { ip: row.ip_address }),
        });
      }
    } catch (err) { recordSourceError('evidence_service_access', err); }

    try {
      const { data: rows, error } = await supabase
        .from('evidence_assignments')
        .select(`id, enrollment_id, title, submitted_at, grade, feedback, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId).eq('contact_id', contactId).order('submitted_at', { ascending: true });
      if (error) recordSourceError('evidence_assignments', error);
      for (const row of scopedRows((rows || []) as any[], opts?.enrollmentId, 'submitted_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        exhibits.push({
          letter: indexToLetter(nextIdx++), name: exhibitName(row, `Assignment: ${row.title || 'Submission'}`),
          category: 'service_delivery', source: 'evidence_assignments', ref: row.id, occurredAt: row.submitted_at,
          summary: exhibitSummary(row, `Assignment “${row.title || 'Untitled'}” was submitted on ${fmtDate(row.submitted_at)}${row.grade ? ` with result ${row.grade}` : ''}.`),
          meta: exhibitMeta(row),
        });
      }
    } catch (err) { recordSourceError('evidence_assignments', err); }

    try {
      const { data: rows, error } = await supabase
        .from('evidence_resource_delivery')
        .select(`id, enrollment_id, resource_type, title, delivered_at, access_confirmed, delivery_method, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId).eq('contact_id', contactId).order('delivered_at', { ascending: true });
      if (error) recordSourceError('evidence_resource_delivery', error);
      for (const row of scopedRows((rows || []) as any[], opts?.enrollmentId, 'delivered_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        exhibits.push({
          letter: indexToLetter(nextIdx++), name: exhibitName(row, `Resource: ${row.title || row.resource_type || 'Delivery'}`),
          category: 'service_delivery', source: 'evidence_resource_delivery', ref: row.id, occurredAt: row.delivered_at,
          summary: exhibitSummary(row, `Resource “${row.title || row.resource_type || 'Untitled'}” was delivered on ${fmtDate(row.delivered_at)}${row.access_confirmed ? ' and access was confirmed' : ''}.`),
          meta: exhibitMeta(row),
        });
      }
    } catch (err) { recordSourceError('evidence_resource_delivery', err); }

    try {
      const { data: rows, error } = await supabase
        .from('evidence_custom_events')
        .select(`id, enrollment_id, event_type, event_timestamp, description, metadata, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId).eq('contact_id', contactId).order('event_timestamp', { ascending: true });
      if (error) recordSourceError('evidence_custom_events', error);
      const approved = (rows || []).filter((row: any) => row.metadata?.approved_for_defense === true);
      for (const row of scopedRows(approved as any[], opts?.enrollmentId, 'event_timestamp', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        exhibits.push({
          letter: indexToLetter(nextIdx++), name: exhibitName(row, `External Activity: ${row.event_type || 'Custom Event'}`),
          category: 'service_delivery', source: 'evidence_custom_events', ref: row.id, occurredAt: row.event_timestamp,
          summary: exhibitSummary(row, row.description || `Approved external activity recorded on ${fmtDate(row.event_timestamp)}.`),
          meta: exhibitMeta(row),
        });
      }
    } catch (err) { recordSourceError('evidence_custom_events', err); }

    // ── 4. Communication log ──
    // Communications are the highest-volume, lowest-signal evidence type (GHL syncs
    // every outbound email). Cap them so a packet can never again become 29 emails:
    // enrollment/transaction-linked comms are always kept; unlinked ones are capped.
    const MAX_UNLINKED_COMMS = 5;
    try {
      const { data: comms, error: commsErr } = await supabase
        .from('evidence_communication')
        .select(`id, enrollment_id, comm_type, direction, comm_date, summary, body_preview, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('comm_date', { ascending: true });
      if (commsErr) recordSourceError('evidence_communication', commsErr);
      const targetOfferText = String(scopeOfferName || '').trim().toLowerCase();
      const commCandidates = ((comms || []) as any[]).map((row) => {
        if (scopeConfidence !== 'inferred' || !scopeOfferId || !targetOfferText || row.enrollment_id || row.offer_id) return row;
        const meta = row.defense_metadata || {};
        const metaOfferId = meta.offerId || meta.offer_id || meta.service?.offerId || meta.service?.offer_id;
        if (metaOfferId) return row;
        const searchable = `${row.summary || ''} ${row.body_preview || ''} ${row.defense_summary || ''}`.toLowerCase();
        return searchable.includes(targetOfferText)
          ? { ...row, offer_id: scopeOfferId, _scope_offer_name_match: true }
          : row;
      });
      const scopedComms = scopedRows(commCandidates, opts?.enrollmentId, 'comm_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence);

      const isDirectlyLinked = (row: any): boolean => {
        if (!opts?.enrollmentId) return false;
        if (row.enrollment_id === opts.enrollmentId) return true;
        const meta = row.defense_metadata || {};
        const metaEnr = meta.enrollmentId || meta.enrollment_id || meta.service?.enrollmentId || meta.service?.enrollment_id;
        if (metaEnr === opts.enrollmentId) return true;
        if (row._scope_offer_name_match) return false;
        const metaOfferId = meta.offerId || meta.offer_id || meta.service?.offerId || meta.service?.offer_id;
        return Boolean(scopeOfferId && (row.offer_id === scopeOfferId || metaOfferId === scopeOfferId));
      };

      const linked = scopedComms.filter(isDirectlyLinked);
      const unlinked = scopedComms.filter((c) => !isDirectlyLinked(c));
      const keptUnlinked = unlinked.slice(0, MAX_UNLINKED_COMMS);
      const droppedCount = unlinked.length - keptUnlinked.length;
      if (droppedCount > 0) {
        logger.info(
          { locationId, contactId, droppedCount, keptUnlinked: keptUnlinked.length, linked: linked.length, scopeConfidence },
          'defense-exhibits: capped unlinked communication exhibits',
        );
      }

      const linkedIds = new Set(linked.map((c: any) => c.id));
      for (const c of [...linked, ...keptUnlinked]) {
        // Workflow emails whose merge fields never rendered ("Amount: Next
        // payment date: Payment number: of") read as sloppy billing in a
        // bank-facing packet — exclude them entirely.
        const bodyText = cleanCommunicationBody(c.summary || c.body_preview || '');
        if (looksLikeUnrenderedTemplate(bodyText)) {
          logger.info(
            { locationId, contactId, commId: c.id },
            'defense-exhibits: excluded communication with unrendered merge fields',
          );
          continue;
        }
        exhibits.push({
          letter: indexToLetter(nextIdx++),
          name: `Communication: ${c.direction === 'inbound' ? 'From client' : 'To client'} (${c.comm_type})`,
          category: 'communication',
          source: 'evidence_communication',
          ref: c.id,
          occurredAt: c.comm_date,
          summary: `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} ${c.comm_type} on ${fmtDate(c.comm_date)}.${c.summary || c.body_preview ? ` Summary: ${cleanCommunicationBody(c.summary || c.body_preview).slice(0, 240)}.` : ''}`,
          // Unlinked comms are low-signal (routine workflow emails) — keep them as
          // secondary context at the END of the exhibit list, never leading the packet.
          deprioritized: !linkedIds.has(c.id),
        });
        applyDefenseContract(exhibits[exhibits.length - 1], c);
      }
    } catch (err) { recordSourceError('evidence_communication', err); }

    // ── 5. Payments: enrollment + recurring confirmations (Prior Undisputed Transactions) ──
    if (opts?.paymentEventId) {
      try {
        const { data: payment, error: paymentErr } = await supabase
          .from('payment_events')
          .select('id, contact_id, enrollment_id, offer_id, event_type, amount, currency, payment_status, processor, processor_transaction_id, processor_charge_id, payment_number, payments_total, installment_number, total_installments, line_items, settled_at, recorded_at, created_at, source')
          .eq('id', opts.paymentEventId)
          .eq('location_id', locationId)
          .maybeSingle();
        if (paymentErr) recordSourceError('payment_events', paymentErr);
        if (!payment && !paymentErr) {
          recordSourceError('payment_events', new Error('The selected payment event could not be loaded for this client and location.'));
        }
        const contactMatches = !payment?.contact_id || payment.contact_id === contactId;
        const enrollmentMatches = !payment?.enrollment_id || payment.enrollment_id === opts.enrollmentId;
        const hasVerifiedLink = payment?.contact_id === contactId
          || Boolean(opts.enrollmentId && payment?.enrollment_id === opts.enrollmentId);
        if (payment && (!contactMatches || !enrollmentMatches || !hasVerifiedLink)) {
          recordSourceError('payment_events', new Error('The selected payment event does not match the scoped client and enrollment.'));
        } else if (payment) {
          const lineItems = Array.isArray(payment.line_items) ? payment.line_items : [];
          const lineItemText = lineItems.map((item: any) => {
            const amount = Number.isFinite(Number(item?.amount))
              ? Number(item.amount)
              : Number(item?.amountCents || 0) / 100;
            return `${item?.label || item?.type || 'Line item'} ($${amount.toFixed(2)})`;
          }).join('; ');
          const sequence = payment.payment_number || payment.installment_number;
          const total = payment.payments_total || payment.total_installments;
          const processor = String(payment.processor || 'processor').toUpperCase();
          const transactionId = payment.processor_transaction_id || payment.processor_charge_id || 'not recorded';
          const occurredAt = payment.settled_at || payment.recorded_at || payment.created_at || null;
          let summary = `${processor} recorded the disputed $${Number(payment.amount || 0).toFixed(2)} ${String(payment.event_type || 'payment').replace(/_/g, ' ')} on ${fmtDate(occurredAt)}. Transaction ID: ${transactionId}. Status: ${payment.payment_status || 'recorded'}.`;
          if (sequence) summary += ` Payment ${sequence}${total ? ` of ${total}` : ''}.`;
          if (lineItemText) summary += ` Charge components: ${lineItemText}.`;
          exhibits.push({
            letter: indexToLetter(nextIdx++),
            name: 'Disputed Transaction Record',
            category: 'payments',
            source: 'payment_event',
            ref: payment.id,
            occurredAt,
            summary,
            meta: {
              processor: payment.processor || null,
              processorTransactionId: payment.processor_transaction_id || null,
              processorChargeId: payment.processor_charge_id || null,
              amount: payment.amount,
              currency: payment.currency || 'USD',
              status: payment.payment_status || null,
              lineItems,
              source: payment.source || null,
            },
          });
        }
      } catch (err) { recordSourceError('payment_events', err); }
    }

    try {
      const { data: invoices, error: invoicesErr } = await supabase
        .from('evidence_invoices')
        .select(`id, enrollment_id, invoice_id, invoice_number, invoice_status, invoice_event_type, amount, amount_paid, currency, sent_at, paid_at, due_date, created_at, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true });
      if (invoicesErr) recordSourceError('evidence_invoices', invoicesErr);
      for (const inv of scopedRows((invoices || []) as any[], opts?.enrollmentId, 'paid_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_invoices', err); }

    try {
      const { data: enrollPay, error: enrollPayErr } = await supabase
        .from('evidence_enrollment_payment')
        .select(`id, enrollment_id, ghl_transaction_id, amount, payment_method, last_four, payment_timestamp, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('payment_timestamp', { ascending: true });
      if (enrollPayErr) recordSourceError('evidence_enrollment_payment', enrollPayErr);
      for (const p of scopedRows((enrollPay || []) as any[], opts?.enrollmentId, 'payment_timestamp', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_enrollment_payment', err); }

    try {
      const { data: recPay, error: recPayErr } = await supabase
        .from('evidence_payment_confirmation')
        .select(`id, enrollment_id, ghl_transaction_id, amount, payment_date, payment_number, running_total, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('payment_date', { ascending: true });
      if (recPayErr) recordSourceError('evidence_payment_confirmation', recPayErr);
      for (const p of scopedRows((recPay || []) as any[], opts?.enrollmentId, 'payment_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_payment_confirmation', err); }

    // ── 6. Termination events: cancellation, refund, subscription changes ──
    try {
      const { data: cancels, error: cancelsErr } = await supabase
        .from('evidence_cancellation')
        .select(`id, enrollment_id, cancellation_date, reason, refund_eligibility, status_at_cancellation, initiated_by, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('cancellation_date', { ascending: true });
      if (cancelsErr) recordSourceError('evidence_cancellation', cancelsErr);
      // One cancellation exhibit per enrollment: the EARLIEST record is the one
      // with legal weight (the service period ended then). Re-cancellations of an
      // already-cancelled subscription are noise that reads as sloppy evidence.
      const seenCancellations = new Set<string>();
      for (const c of scopedRows((cancels || []) as any[], opts?.enrollmentId, 'cancellation_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        const dedupeKey = c.enrollment_id || 'no_enrollment';
        if (seenCancellations.has(dedupeKey)) continue;
        seenCancellations.add(dedupeKey);
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
    } catch (err) { recordSourceError('evidence_cancellation', err); }

    try {
      const { data: refunds, error: refundsErr } = await supabase
        .from('evidence_refund_activity')
        .select(`id, enrollment_id, amount, refund_type, reason, refund_date, initiated_by, ghl_transaction_id, ${DEFENSE_FIELD_SELECT}`)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('refund_date', { ascending: true });
      if (refundsErr) recordSourceError('evidence_refund_activity', refundsErr);
      for (const r of scopedRows((refunds || []) as any[], opts?.enrollmentId, 'refund_date', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
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
    } catch (err) { recordSourceError('evidence_refund_activity', err); }

    // Also pull from unified evidence repo for any evidence_type rows not in the per-table tables
    // (deliberate: we trust the per-table queries above as the primary source — this is just a
    // safety net for the unified `evidence` table additions made post-migration 010).
    try {
      const { rows: extra } = await evidenceRepository.getTimeline(locationId, contactId, { limit: 200 });
      for (const e of scopedRows(extra as any[], opts?.enrollmentId, 'created_at', scopeWindowStart, scopeWindowEnd, scopeOfferId, scopeConfidence)) {
        // Skip rows already covered by the per-table queries above (matched by id).
        if (exhibits.some(ex => ex.ref === e.id)) continue;
        // Only include high-signal types from the unified table
        const type = (e as any).evidence_type || (e as any).type;
        if (!['custom_event', 'resource_delivery', 'service_access'].includes(type)) continue;
        // ScaleSafe's own readiness-score threshold events (event_type
        // 'evidence_milestone' with readiness_score/milestone_threshold) are internal
        // bookkeeping, not client service-delivery proof — never bank-facing.
        const payload = (e as any).data || {};
        if (type === 'custom_event'
          && (payload.event_type === 'evidence_milestone'
            || payload.readiness_score !== undefined
            || payload.milestone_threshold !== undefined)) {
          continue;
        }
        if (type === 'custom_event') {
          const proofRole = String((e as any).proof_role || payload.proof_role || '').trim().toLowerCase();
          const approved = payload.approved_for_defense === true
            || payload.metadata?.approved_for_defense === true
            || ['service_delivery', 'service_access', 'deliverable', 'milestone'].includes(proofRole);
          if (!approved) continue;
        }
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
    } catch (err) { recordSourceError('evidence_timeline', err); }

    // Under contact-only scope the evidence is not verified against a specific
    // enrollment — tag every exhibit so the letter/PDF and reviewer can see it.
    if (isContactOnly) {
      for (const ex of exhibits) ex.unverifiedScope = true;
    }

    // Re-order exhibits by reason-code persuasiveness and re-letter A, B, C…
    // Reviewers skim: for 13.6 the refund record must lead, for 13.2 the
    // cancellation ledger, for fraud the consent forensics. Without priorities
    // the original build order is kept (existing behavior).
    if (opts?.evidencePriorities?.length) {
      sortExhibitsByPriority(exhibits, opts.evidencePriorities);
      exhibits.forEach((ex, i) => { ex.letter = indexToLetter(i + 1); });
    }

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
      sourceErrors,
    };
  },
};
