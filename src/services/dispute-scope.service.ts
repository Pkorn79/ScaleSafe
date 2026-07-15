import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import { resolveProgramName } from '../utils/program-name';

/**
 * Dispute Scope Service — resolves the specific enrollment/program a disputed
 * transaction belongs to BEFORE any evidence is gathered.
 *
 * This is the guard against the regression where a defense packet dumped every
 * contact-wide evidence row (29 outbound emails across four programs) because the
 * caller passed an empty enrollmentId and exhibit scoping fell open. Compilation
 * must resolve scope here first and thread it through exhibit building, prior-
 * payment scoping, prompt building, and PDF bundling.
 */

export type ScopeConfidence = 'exact' | 'inferred' | 'contact_only';

export interface DisputeScope {
  paymentEventId: string | null;
  processorTransactionId: string | null;
  /** When the disputed charge occurred (payment_events.created_at) — anchors the
   *  transaction timeline and the billed-after-cancellation red-flag check. */
  transactionDate: string | null;
  processor: string | null;
  enrollmentId: string | null;
  offerId: string | null;
  offerName: string | null;
  enrollmentStart: string | null;
  enrollmentEnd: string | null;
  scopeConfidence: ScopeConfidence;
  gaps: string[];
}

interface ResolveInput {
  locationId: string;
  contactId: string;
  paymentEventId?: string | null;
  enrollmentId?: string | null;
  offerId?: string | null;
}

function emptyScope(overrides: Partial<DisputeScope> = {}): DisputeScope {
  return {
    paymentEventId: null,
    processorTransactionId: null,
    transactionDate: null,
    processor: null,
    enrollmentId: null,
    offerId: null,
    offerName: null,
    enrollmentStart: null,
    enrollmentEnd: null,
    scopeConfidence: 'contact_only',
    gaps: [],
    ...overrides,
  };
}

async function loadEnrollment(
  locationId: string,
  contactId: string,
  enrollmentId: string,
): Promise<any | null> {
  try {
    const { data } = await getSupabase()
      .from('enrollments')
      .select('id, offer_id, program_name_snapshot, enrolled_at, created_at, completed_at, cancelled_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('id', enrollmentId)
      .maybeSingle();
    return data || null;
  } catch (err: any) {
    logger.warn({ err: err.message, enrollmentId }, 'dispute-scope: enrollment lookup failed');
    return null;
  }
}

async function loadPaymentEvent(
  locationId: string,
  contactId: string,
  paymentEventId: string,
): Promise<any | null> {
  try {
    const { data } = await getSupabase()
      .from('payment_events')
      .select('id, contact_id, enrollment_id, offer_id, processor, processor_transaction_id, processor_subscription_id, created_at')
      .eq('id', paymentEventId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (!data) return null;
    if (data.contact_id && data.contact_id !== contactId) return null;
    if (!data.contact_id) {
      if (!data.enrollment_id) return null;
      const enrollment = await loadEnrollment(locationId, contactId, data.enrollment_id);
      if (!enrollment) return null;
    }
    return data;
  } catch (err: any) {
    logger.warn({ err: err.message, paymentEventId }, 'dispute-scope: payment_event lookup failed');
    return null;
  }
}

async function resolveOfferName(locationId: string, offerId: string | null): Promise<string | null> {
  if (!offerId) return null;
  try {
    const { data } = await getSupabase()
      .from('offers_mirror')
      .select('offer_name')
      .eq('id', offerId)
      .eq('location_id', locationId)
      .maybeSingle();
    return data?.offer_name || null;
  } catch {
    return null;
  }
}

/** Build the enrollment-bounded window used to scope time-based evidence. */
function windowFromEnrollment(enrollment: any): { start: string | null; end: string | null } {
  const anchor = enrollment?.enrolled_at || enrollment?.created_at || null;
  if (!anchor) return { start: null, end: null };
  const explicitEnd = enrollment?.completed_at || enrollment?.cancelled_at || null;
  return { start: anchor, end: explicitEnd };
}

async function buildExactScope(
  locationId: string,
  enrollment: any,
  confidence: ScopeConfidence,
  base: Partial<DisputeScope>,
  gaps: string[],
): Promise<DisputeScope> {
  const offerId = enrollment?.offer_id || null;
  const currentOfferName = await resolveOfferName(locationId, offerId);
  const offerName = resolveProgramName(enrollment, { offer_name: currentOfferName }) || null;
  const win = windowFromEnrollment(enrollment);
  if (!offerId) gaps.push('Enrollment has no linked offer/program on file.');
  return emptyScope({
    ...base,
    enrollmentId: enrollment.id,
    offerId,
    offerName,
    enrollmentStart: win.start,
    enrollmentEnd: win.end,
    scopeConfidence: confidence,
    gaps,
  });
}

export const disputeScopeService = {
  async resolveDisputeScope(input: ResolveInput): Promise<DisputeScope> {
    const { locationId, contactId } = input;
    const gaps: string[] = [];

    // 1. Explicit enrollmentId supplied — verify ownership, enrich, treat as exact.
    if (input.enrollmentId && !input.paymentEventId) {
      const enrollment = await loadEnrollment(locationId, contactId, input.enrollmentId);
      if (enrollment) {
        return buildExactScope(locationId, enrollment, 'exact', {
          paymentEventId: input.paymentEventId || null,
          offerId: input.offerId || null,
        }, gaps);
      }
      // Supplied id we couldn't confirm — trust the caller's selection but flag it.
      gaps.push('Supplied enrollment could not be verified against this contact/location; evidence is contact-wide and needs review.');
      return emptyScope({
        paymentEventId: input.paymentEventId || null,
        scopeConfidence: 'contact_only',
        gaps,
      });
    }

    // 2. paymentEventId supplied — load the disputed transaction and resolve from it.
    if (input.paymentEventId) {
      const pe = await loadPaymentEvent(locationId, contactId, input.paymentEventId);

      if (pe) {
        const base = {
          paymentEventId: pe.id,
          processorTransactionId: pe.processor_transaction_id || null,
          transactionDate: pe.created_at || null,
          processor: pe.processor || null,
          offerId: pe.offer_id || input.offerId || null,
        };

        // 2a. Transaction is directly linked to an enrollment — exact.
        if (input.enrollmentId && pe.enrollment_id && pe.enrollment_id !== input.enrollmentId) {
          gaps.push('The selected transaction and selected program do not match; no program evidence was included.');
          return emptyScope({ ...base, scopeConfidence: 'contact_only', gaps });
        }

        if (input.enrollmentId) {
          const selectedEnrollment = await loadEnrollment(locationId, contactId, input.enrollmentId);
          if (!selectedEnrollment) {
            gaps.push('Supplied enrollment could not be verified against this contact/location; evidence is contact-wide and needs review.');
            return emptyScope({ ...base, scopeConfidence: 'contact_only', gaps });
          }
          if (pe.offer_id && selectedEnrollment.offer_id && pe.offer_id !== selectedEnrollment.offer_id) {
            gaps.push('The selected transaction and selected program reference different offers; no program evidence was included.');
            return emptyScope({ ...base, scopeConfidence: 'contact_only', gaps });
          }
          return buildExactScope(locationId, selectedEnrollment, 'exact', base, gaps);
        }

        if (pe.enrollment_id) {
          const enrollment = await loadEnrollment(locationId, contactId, pe.enrollment_id);
          if (enrollment) {
            return buildExactScope(locationId, enrollment, 'exact', base, gaps);
          }
          gaps.push('Transaction references an enrollment that could not be loaded.');
          return emptyScope({ ...base, scopeConfidence: 'contact_only', gaps });
        }

        // 2b. No direct link — infer carefully from subscription id, then offer id.
        const inferred = await inferEnrollment(locationId, contactId, pe);
        if (inferred) {
          gaps.push('Program inferred from the transaction — confirm it matches the disputed charge.');
          return buildExactScope(locationId, inferred, 'inferred', base, gaps);
        }

        gaps.push('Disputed transaction is not linked to any program; evidence is contact-wide and needs review.');
        return emptyScope({ ...base, scopeConfidence: 'contact_only', gaps });
      }

      gaps.push('Disputed transaction could not be found for this contact; evidence is contact-wide and needs review.');
      return emptyScope({
        paymentEventId: input.paymentEventId,
        offerId: input.offerId || null,
        scopeConfidence: 'contact_only',
        gaps,
      });
    }

    // 3. Nothing to anchor on — contact-only, flagged for review.
    gaps.push('No transaction or program was provided; evidence is contact-wide and needs review.');
    return emptyScope({ offerId: input.offerId || null, scopeConfidence: 'contact_only', gaps });
  },
};

/**
 * Best-effort inference of the enrollment behind an unlinked payment_event.
 * Only matches on strong keys (subscription id, then offer id) scoped to the
 * same contact/location — never a blind "most recent enrollment" guess.
 */
async function inferEnrollment(locationId: string, contactId: string, pe: any): Promise<any | null> {
  const supabase = getSupabase();
  const select = 'id, offer_id, program_name_snapshot, enrolled_at, created_at, completed_at, cancelled_at';

  // Match by processor subscription id (recurring installments share it).
  if (pe.processor_subscription_id) {
    try {
      const { data } = await supabase
        .from('enrollments')
        .select(select)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('processor_subscription_id', pe.processor_subscription_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'dispute-scope: subscription-id inference failed');
    }
  }

  // Match by offer id on the transaction — unambiguous only when the contact has
  // exactly one enrollment for that offer.
  if (pe.offer_id) {
    try {
      const { data } = await supabase
        .from('enrollments')
        .select(select)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('offer_id', pe.offer_id);
      if (data && data.length === 1) return data[0];
    } catch (err: any) {
      logger.warn({ err: err.message }, 'dispute-scope: offer-id inference failed');
    }
  }

  return null;
}
