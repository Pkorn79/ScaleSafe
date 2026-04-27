/**
 * The 9 standard T&C clauses merchants can toggle on/off.
 *
 * Each clause has:
 *   key        — stored in merchants.tc_clause_toggles JSONB
 *   label      — shown in the UI
 *   text       — the full clause text compiled into T&C HTML
 *   recommended — defaults to ON if true
 *   ghlFieldId — the per-clause "Click-Wrap: X" CHECKBOX field ID in GHL (PMG location)
 *
 * NOTE: ghlFieldId values below are PMG-specific and currently unused at runtime —
 * no service reads this field. They serve as a registry pointer to the canonical
 * Click-Wrap fields. Per-merchant resolution of these click-wrap fields is a
 * deferred workstream (Option B in the SESSION.md cleanup plan, 2026-04-26).
 */
export const STANDARD_CLAUSES = [
  {
    key: 'purchase_summary',
    label: 'Purchase Summary (recommended)',
    text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
    recommended: true,
    ghlFieldId: 'ApziTuKXhG6rhvtqRYly',
  },
  {
    key: 'cardholder_auth',
    label: 'Cardholder Authorization (recommended)',
    text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
    recommended: true,
    ghlFieldId: 'XDgT2gdX1TReWeui3znE',
  },
  {
    key: 'program_scope',
    label: 'Program Scope',
    text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.',
    recommended: false,
    ghlFieldId: 'hCi4g4ETbYA5qj37LI7o',
  },
  {
    key: 'refund_cancellation',
    label: 'Refund & Cancellation',
    text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.',
    recommended: false,
    ghlFieldId: 'sBRrcd7ABgW7sDUKO04f',
  },
  {
    key: 'digital_access',
    label: 'Digital Access',
    text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
    recommended: false,
    ghlFieldId: 'OnbjFvAsqzVvQjAT8Fcf',
  },
  {
    key: 'participation_responsibility',
    label: 'Participation Responsibility',
    text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.',
    recommended: false,
    ghlFieldId: '4K90TKxyjxXWJF8PnBzg',
  },
  {
    key: 'no_guaranteed_results',
    label: 'No Guaranteed Results',
    text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.',
    recommended: false,
    ghlFieldId: 'pgQgc9NNrt0kyHk7mZ6g',
  },
  {
    key: 'installment_billing',
    label: 'Installment Billing',
    text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
    recommended: false,
    ghlFieldId: 'PEzSpjtM8OFZnNDC5TAd',
  },
  {
    key: 'feedback_checkin',
    label: 'Feedback & Check-In',
    text: 'I understand that periodic check-ins, surveys, or progress reviews may be requested during the program to monitor my satisfaction and progress. I agree to respond to these check-ins in good faith and understand that the merchant may reference my responses as part of the program record.',
    recommended: false,
    ghlFieldId: '7AoLipHuDcpC0PK2S6QN',
  },
] as const;

export type StandardClauseKey = typeof STANDARD_CLAUSES[number]['key'];
