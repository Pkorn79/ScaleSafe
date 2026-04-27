/**
 * The 9 standard T&C clauses merchants can toggle on/off.
 *
 * Each clause has:
 *   key         — stored in merchants.tc_clause_toggles JSONB; submitted by the funnel
 *                 in `clausesAccepted: string[]`
 *   label       — shown in the UI
 *   text        — the full clause text compiled into T&C HTML
 *   recommended — defaults to ON if true
 *   ghlFieldId  — registry pointer to the per-clause "Click-Wrap: X" CHECKBOX field
 *                 in PMG GHL. Useful for snapshot drift detection and manual GHL UI
 *                 audits. NOT read at runtime — write-through uses ghlFieldKey instead.
 *   ghlFieldKey — the runtime write target. The Click-Wrap fields are system fixtures
 *                 shipped in every merchant's GHL Snapshot, so writing by stable
 *                 fieldKey (rather than per-merchant ID) avoids a discovery step. See
 *                 phase2Enrollment.service.ts for the write site.
 */
export const STANDARD_CLAUSES = [
  {
    key: 'purchase_summary',
    label: 'Purchase Summary (recommended)',
    text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
    recommended: true,
    ghlFieldId: 'ApziTuKXhG6rhvtqRYly',
    ghlFieldKey: 'contact.clickwrap_purchase_summary',
  },
  {
    key: 'cardholder_auth',
    label: 'Cardholder Authorization (recommended)',
    text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
    recommended: true,
    ghlFieldId: 'XDgT2gdX1TReWeui3znE',
    ghlFieldKey: 'contact.clickwrap_cardholder_authorization',
  },
  {
    key: 'program_scope',
    label: 'Program Scope',
    text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.',
    recommended: false,
    ghlFieldId: 'hCi4g4ETbYA5qj37LI7o',
    ghlFieldKey: 'contact.clickwrap_program_scope',
  },
  {
    key: 'refund_cancellation',
    label: 'Refund & Cancellation',
    text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.',
    recommended: false,
    ghlFieldId: 'sBRrcd7ABgW7sDUKO04f',
    ghlFieldKey: 'contact.clickwrap_refund__cancellation',
  },
  {
    key: 'digital_access',
    label: 'Digital Access',
    text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
    recommended: false,
    ghlFieldId: 'OnbjFvAsqzVvQjAT8Fcf',
    ghlFieldKey: 'contact.clickwrap_digital_access_acknowledgment',
  },
  {
    key: 'participation_responsibility',
    label: 'Participation Responsibility',
    text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.',
    recommended: false,
    ghlFieldId: '4K90TKxyjxXWJF8PnBzg',
    ghlFieldKey: 'contact.clickwrap_participation_responsibility',
  },
  {
    key: 'no_guaranteed_results',
    label: 'No Guaranteed Results',
    text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.',
    recommended: false,
    ghlFieldId: 'pgQgc9NNrt0kyHk7mZ6g',
    ghlFieldKey: 'contact.clickwrap_no_guaranteed_results',
  },
  {
    key: 'installment_billing',
    label: 'Installment Billing',
    text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
    recommended: false,
    ghlFieldId: 'PEzSpjtM8OFZnNDC5TAd',
    ghlFieldKey: 'contact.clickwrap_installment_billing',
  },
  {
    key: 'feedback_checkin',
    label: 'Feedback & Check-In',
    text: 'I understand that periodic check-ins, surveys, or progress reviews may be requested during the program to monitor my satisfaction and progress. I agree to respond to these check-ins in good faith and understand that the merchant may reference my responses as part of the program record.',
    recommended: false,
    ghlFieldId: '7AoLipHuDcpC0PK2S6QN',
    ghlFieldKey: 'contact.clickwrap_feedback__checkin',
  },
] as const;

export type StandardClauseKey = typeof STANDARD_CLAUSES[number]['key'];
