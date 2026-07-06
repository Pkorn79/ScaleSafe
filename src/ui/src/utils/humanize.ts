/**
 * Humanize internal slugs, timestamps, and identifiers for merchant-facing UI.
 *
 * Single source of truth for slug→label mapping. Phase 4 view substitutions all
 * route through these helpers - no inline slug rendering in templates.
 */

/* ------------------------------------------------------------------------ */
/* Event-type slugs → human labels                                          */
/* ------------------------------------------------------------------------ */

const EVENT_TYPE_LABELS: Record<string, string> = {
  // Enrollment
  send_enrollment_link: 'Enrollment Link Sent',
  enrollment_started: 'Enrollment Started',
  enrollment_completed: 'Enrollment Completed',
  enrollment_cancelled: 'Enrollment Cancelled',
  // Consent
  consent_captured: 'Consent Captured',
  consent_viewed: 'Consent Viewed',
  // Payment
  payment_succeeded: 'Payment Succeeded',
  payment_failed: 'Payment Failed',
  payment_refunded: 'Payment Refunded',
  payment_disputed: 'Payment Disputed',
  installment_succeeded: 'Installment Paid',
  installment_failed: 'Installment Failed',
  card_updated: 'Card on File Updated',
  // Program / milestones
  evidence_milestone: 'Milestone Logged',
  milestone_signed_off: 'Milestone Signed Off',
  module_completed: 'Module Completed',
  session_logged: 'Session Logged',
  session_no_show: 'Session No-Show',
  pulse_check_submitted: 'Pulse Check-In Submitted',
  // Submission states
  pending_submission: 'Pending Submission',
  submission_in_progress: 'Submission In Progress',
  submission_failed: 'Submission Failed',
  // Cancellation / dispute
  cancellation_requested: 'Cancellation Requested',
  dispute_received: 'Dispute Received',
  dispute_submitted: 'Dispute Submitted',
  dispute_won: 'Dispute Won',
  dispute_lost: 'Dispute Lost',
};

/**
 * Convert a snake_case event-type slug to a human-readable label.
 *
 * - Known slugs return the curated label from EVENT_TYPE_LABELS.
 * - Unknown slugs fall back to title-case of the slug ("foo_bar_baz" → "Foo Bar Baz").
 * - Empty / nullish input returns the empty string.
 */
export function humanizeEventType(slug: string | null | undefined): string {
  if (!slug) return '';
  const known = EVENT_TYPE_LABELS[slug];
  if (known) return known;
  return slug
    .split('_')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ');
}

/* ------------------------------------------------------------------------ */
/* Timestamps                                                                */
/* ------------------------------------------------------------------------ */

const MS = { sec: 1000, min: 60_000, hour: 3_600_000, day: 86_400_000 };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date value for display. A date-only string ("2026-08-16" — e.g. a DB
 * DATE column like response_deadline) is a calendar date, not an instant:
 * `new Date('2026-08-16')` parses it as UTC midnight, which any US timezone
 * renders as Aug 15. Construct it as LOCAL midnight so it displays as the exact
 * calendar date stored.
 */
export function parseDateValue(value: string | number | Date): Date {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value.trim())) {
    const [y, m, d] = value.trim().split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return value instanceof Date ? value : new Date(value);
}

/**
 * Format a calendar date (or timestamp) as "Aug 16, 2026". Date-only strings
 * render as that exact calendar date with no timezone shift.
 */
export function formatCalendarDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a timestamp for merchant-facing UI.
 *
 * - "relative":  "Just now" / "3 minutes ago" / "Yesterday" / "Apr 24" (>7d)
 * - "absolute":  "Apr 24, 2026 - 2:14 PM"
 * - "short":     "Apr 24"
 *
 * Invalid / null / undefined inputs return the empty string.
 */
export function formatTimestamp(
  value: string | number | Date | null | undefined,
  mode: 'relative' | 'absolute' | 'short' = 'relative',
  now: Date = new Date(),
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return '';

  if (mode === 'absolute') {
    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} - ${timePart}`;
  }

  if (mode === 'short') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // relative
  const diff = now.getTime() - date.getTime();
  if (diff < 0) {
    // Future date - fall through to short.
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (diff < MS.min) return 'Just now';
  if (diff < MS.hour) {
    const m = Math.floor(diff / MS.min);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < MS.day) {
    const h = Math.floor(diff / MS.hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diff < 2 * MS.day) return 'Yesterday';
  if (diff < 7 * MS.day) {
    const d = Math.floor(diff / MS.day);
    return `${d} days ago`;
  }
  // > 7 days - show short date with year if not current year
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ------------------------------------------------------------------------ */
/* Reason codes                                                              */
/* ------------------------------------------------------------------------ */

const REASON_CODES: Record<string, string> = {
  // Visa
  '13.1': 'Merchandise/Services Not Received',
  '13.2': 'Cancelled Recurring',
  '13.3': 'Not as Described or Defective Merchandise/Services',
  '13.5': 'Misrepresentation',
  '13.6': 'Credit Not Processed',
  '13.7': 'Cancelled Merchandise/Services',
  '13.8': 'Original Credit Not Accepted',
  '13.9': 'Non-Receipt of Cash or Load Transaction Value',
  '10.4': 'Other Fraud - Card Absent Environment',
  // Mastercard
  '4853': 'Cardholder Dispute',
  '4854': 'Cardholder Dispute - Not Elsewhere Classified',
  '4855': 'Goods/Services Not Provided',
  '4859': 'Services Not Rendered',
  '4860': 'Credit Not Processed',
  '4863': 'Cardholder Does Not Recognize',
  // Amex
  'F29': 'Card Not Present',
  'F30': 'EMV Counterfeit',
  'F31': 'EMV Lost / Stolen / Non-Received',
  'C02': 'Credit Not Processed',
  'C04': 'Goods / Services Returned or Refused',
  'C05': 'Goods / Services Cancelled',
  'C08': 'Goods / Services Not Received',
};

/**
 * Convert a chargeback reason code to a human description.
 *
 * Unknown codes return the input unchanged so the merchant still sees something.
 * Whitespace is trimmed; case is preserved for lookup.
 */
export function humanizeReasonCode(code: string | null | undefined): string {
  if (!code) return '';
  const trimmed = String(code).trim();
  return REASON_CODES[trimmed] ?? trimmed;
}

/* ------------------------------------------------------------------------ */
/* Transaction IDs                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Mask a transaction ID for display: first 4 + ellipsis + last 4 characters.
 *
 * Pair with a copy button so the full ID is still recoverable.
 * IDs shorter than 12 characters are returned unchanged.
 */
export function maskTransactionId(txId: string | null | undefined): string {
  if (!txId) return '';
  const s = String(txId).trim();
  if (s.length < 12) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/* ------------------------------------------------------------------------ */
/* Pluralization                                                             */
/* ------------------------------------------------------------------------ */

const IRREGULAR_PLURALS: Record<string, string> = {
  child: 'children',
  person: 'people',
};

/**
 * Pluralize a unit based on a count: "1 day" / "2 days" / "0 days".
 *
 * - Zero is plural in English ("0 days").
 * - Handles common irregulars (child→children, person→people).
 * - Handles -y → -ies (story → stories) when not preceded by a vowel.
 * - Strips a leading "s" already present on the unit before deciding.
 * - Nullish or empty count returns the empty string.
 * - Nullish or empty unit just returns the count.
 */
export function pluralize(
  count: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (count === null || count === undefined || count === '') return '';
  const n = typeof count === 'number' ? count : Number(count);
  if (!Number.isFinite(n)) return '';
  if (!unit) return String(n);

  const trimmed = String(unit).trim();
  if (!trimmed) return String(n);

  // Normalize: if the caller already passed a plural-looking unit ("days"), strip the trailing "s"
  // so we can decide based on the count.
  const singular = trimmed.toLowerCase().endsWith('s') && trimmed.length > 1
    ? trimmed.slice(0, -1)
    : trimmed;

  if (n === 1 || n === -1) return `${n} ${singular}`;

  const lower = singular.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) {
    // Preserve original casing of first letter
    const irregular = IRREGULAR_PLURALS[lower];
    const cased = singular[0] === singular[0].toUpperCase()
      ? irregular[0].toUpperCase() + irregular.slice(1)
      : irregular;
    return `${n} ${cased}`;
  }

  // -y → -ies when preceded by a consonant
  if (singular.length > 1 && singular.toLowerCase().endsWith('y')) {
    const prev = singular[singular.length - 2].toLowerCase();
    if (!'aeiou'.includes(prev)) {
      return `${n} ${singular.slice(0, -1)}ies`;
    }
  }

  return `${n} ${singular}s`;
}
