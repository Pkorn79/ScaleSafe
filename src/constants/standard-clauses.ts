/**
 * The 9 standard T&C clauses merchants can toggle on/off.
 *
 * Each clause has:
 *   key        — stored in merchants.tc_clause_toggles JSONB
 *   label      — shown in the UI
 *   text       — the full clause text compiled into T&C HTML
 *   recommended — defaults to ON if true
 *   ghlFieldId — the GHL I Fields checkbox ID (written to contacts at enrollment)
 */
export const STANDARD_CLAUSES = [
  {
    key: 'purchase_summary',
    label: 'Purchase Summary (recommended)',
    text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
    recommended: true,
    ghlFieldId: 'eSINYX4MfsLhEbV0DlrO',
  },
  {
    key: 'cardholder_auth',
    label: 'Cardholder Authorization (recommended)',
    text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
    recommended: true,
    ghlFieldId: 'uoQ47sqkamlkD07X6BL1',
  },
  {
    key: 'program_scope',
    label: 'Program Scope',
    text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.',
    recommended: false,
    ghlFieldId: 'UYSsDeuKPKksUlxdyr8b',
  },
  {
    key: 'refund_cancellation',
    label: 'Refund & Cancellation',
    text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.',
    recommended: false,
    ghlFieldId: 'LgQjNE7ITUcFVtJJ7K5p',
  },
  {
    key: 'digital_access',
    label: 'Digital Access',
    text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
    recommended: false,
    ghlFieldId: 'XGS9Ae0p58mNw776G4lw',
  },
  {
    key: 'participation_responsibility',
    label: 'Participation Responsibility',
    text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.',
    recommended: false,
    ghlFieldId: '56Lqj6agUH8G7CWGWzoc',
  },
  {
    key: 'no_guaranteed_results',
    label: 'No Guaranteed Results',
    text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.',
    recommended: false,
    ghlFieldId: 'w7VhO2Apb12gm7CO1Lgv',
  },
  {
    key: 'installment_billing',
    label: 'Installment Billing',
    text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
    recommended: false,
    ghlFieldId: '8IdyOxOopSSDCK259dQd',
  },
  {
    key: 'feedback_checkin',
    label: 'Feedback & Check-In',
    text: 'I understand that periodic check-ins, surveys, or progress reviews may be requested during the program to monitor my satisfaction and progress. I agree to respond to these check-ins in good faith and understand that the merchant may reference my responses as part of the program record.',
    recommended: false,
    ghlFieldId: '', // No separate I Field — uses same checkbox pattern
  },
] as const;

export type StandardClauseKey = typeof STANDARD_CLAUSES[number]['key'];
