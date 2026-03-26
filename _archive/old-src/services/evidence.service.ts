/**
 * evidence.service.ts — Evidence Logging Service
 *
 * The core evidence collection engine. Routes incoming data to the correct
 * Supabase evidence table based on the source:
 *
 * 1. GHL form submissions (SYS2-06 through SYS2-11) → routed by form ID
 * 2. External webhooks (Calendly, Zoom, Kajabi, etc.) → routed by event_type
 * 3. Payment events (from accept.blue) → evidence_payments
 * 4. Service access events (from S13 sources) → evidence_service_access
 * 5. Communication logs (from S14 daily comms) → evidence_sessions (as comms type)
 *
 * All evidence is immutable — append-only for legal defensibility.
 */

import * as evidenceRepo from '../repositories/evidence.repository';
import { FORM_TO_EVIDENCE_TABLE } from '../constants/ghl-forms';
import { EXTERNAL_EVENT_TO_TABLE, EVIDENCE_TABLES } from '../constants/evidence-types';
import { BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================
// GHL FORM SUBMISSIONS
// ============================================

/**
 * Logs evidence from a GHL form submission.
 * The form ID determines which evidence table the data goes to.
 */
export async function logFromForm(
  locationId: string,
  formId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const table = FORM_TO_EVIDENCE_TABLE[formId];
  if (!table) {
    throw new BadRequestError(`Unknown form ID: ${formId}`);
  }

  const contactId = (payload.contact_id || payload.contactId) as string;
  if (!contactId) {
    throw new BadRequestError('Missing contact_id in form submission');
  }

  const record = {
    contact_id: contactId,
    location_id: locationId,
    ...sanitizePayload(payload),
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(table, record);
}

// ============================================
// EXTERNAL WEBHOOKS (Calendly, Zoom, Kajabi, etc.)
// ============================================

/**
 * External webhook payload shape (from external-integration-guide.md).
 */
interface ExternalEventPayload {
  source: string;
  event_type: string;
  location_id: string;
  contact_email: string;
  contact_name: string;
  contact_id?: string;
  data: Record<string, unknown>;
}

/**
 * Logs evidence from an external integration webhook.
 * Routes by event_type to the correct evidence table.
 */
export async function logExternalEvent(
  locationId: string,
  payload: ExternalEventPayload
): Promise<Record<string, unknown>> {
  const table = EXTERNAL_EVENT_TO_TABLE[payload.event_type];
  if (!table) {
    throw new BadRequestError(`Unknown external event_type: ${payload.event_type}`);
  }

  const contactId = payload.contact_id || '';
  if (!contactId) {
    logger.warn(
      { source: payload.source, eventType: payload.event_type, email: payload.contact_email },
      'External event missing contact_id — will need lookup'
    );
  }

  const record = {
    contact_id: contactId,
    location_id: locationId,
    source: payload.source,
    contact_email: payload.contact_email,
    contact_name: payload.contact_name,
    ...payload.data,
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(table, record);
}

// ============================================
// PAYMENT EVENTS
// ============================================

/**
 * Logs a payment event (success, failure, or refund) from accept.blue.
 */
export async function logPaymentEvent(
  locationId: string,
  contactId: string,
  eventData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const record = {
    contact_id: contactId,
    location_id: locationId,
    ...eventData,
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(EVIDENCE_TABLES.PAYMENTS, record);
}

/**
 * Logs a refund event to the refund_activity table.
 */
export async function logRefundActivity(
  locationId: string,
  contactId: string,
  refundData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const record = {
    contact_id: contactId,
    location_id: locationId,
    ...refundData,
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(EVIDENCE_TABLES.REFUND_ACTIVITY, record);
}

// ============================================
// ENROLLMENT EVIDENCE
// ============================================

/**
 * Logs enrollment evidence (T&C consent + payment).
 */
export async function logEnrollment(
  locationId: string,
  contactId: string,
  enrollmentData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const record = {
    contact_id: contactId,
    location_id: locationId,
    ...enrollmentData,
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(EVIDENCE_TABLES.ENROLLMENT, record);
}

// ============================================
// SERVICE ACCESS (S13 equivalent)
// ============================================

/**
 * Logs a platform access event (login, view, download, completion).
 * From course platforms: Kajabi, Skool, GHL Memberships, Teachable.
 */
export async function logServiceAccess(
  locationId: string,
  contactId: string,
  accessData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const record = {
    contact_id: contactId,
    location_id: locationId,
    ...accessData,
    created_at: new Date().toISOString(),
  };

  return evidenceRepo.insertEvidence(EVIDENCE_TABLES.SERVICE_ACCESS, record);
}

// ============================================
// QUERY FUNCTIONS (for defense compiler and evidence viewer)
// ============================================

/**
 * Gets ALL evidence for a contact across all 10 tables.
 * Uses the evidence_timeline Supabase view.
 */
export async function getAllForContact(
  locationId: string,
  contactId: string
): Promise<Record<string, unknown>[]> {
  return evidenceRepo.getTimelineForContact(locationId, contactId);
}

/**
 * Gets evidence of a specific type for a contact.
 */
export async function getByType(
  table: string,
  locationId: string,
  contactId: string
): Promise<Record<string, unknown>[]> {
  return evidenceRepo.getByTypeForContact(table, locationId, contactId);
}

/**
 * Gets a count summary of evidence per type for a contact.
 */
export async function getSummary(
  locationId: string,
  contactId: string
): Promise<Record<string, number>> {
  return evidenceRepo.getSummaryForContact(locationId, contactId);
}

// ============================================
// HELPERS
// ============================================

/**
 * Strips internal/system fields from a webhook payload before storing.
 * Prevents storing things like raw GHL tokens or internal routing data.
 */
function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload };
  // Remove fields we handle separately or don't want stored
  delete sanitized.contact_id;
  delete sanitized.contactId;
  delete sanitized.location_id;
  delete sanitized.locationId;
  delete sanitized.created_at;
  return sanitized;
}
