/**
 * ghl-forms.ts — GHL Form IDs
 *
 * Maps each evidence collection form to its GHL form ID.
 * When GHL fires a webhook after a form submission, the payload
 * includes the form ID. We use these constants to route the submission
 * to the correct evidence table in Supabase.
 *
 * Form naming convention: SYS2-XX where XX is the form number.
 */

export const GHL_FORMS = {
  /** SYS2-06: Milestone Sign-Off — client acknowledges completing a milestone */
  MILESTONE_SIGNOFF: 'SYS2-06',

  /** SYS2-07: Session Log — coach records a completed coaching session */
  SESSION_LOG: 'SYS2-07',

  /** SYS2-08: Module Progress — client completes a course module */
  MODULE_PROGRESS: 'SYS2-08',

  /** SYS2-09: Pulse Check — periodic client satisfaction snapshot */
  PULSE_CHECK: 'SYS2-09',

  /** SYS2-10: Payment Update — payment event notes */
  PAYMENT_UPDATE: 'SYS2-10',

  /** SYS2-11: Cancellation — cancellation request form */
  CANCELLATION: 'SYS2-11',
} as const;

/**
 * Maps form IDs to the Supabase evidence table they write to.
 * Used by the evidence service to route form submissions.
 */
export const FORM_TO_EVIDENCE_TABLE: Record<string, string> = {
  [GHL_FORMS.MILESTONE_SIGNOFF]: 'evidence_milestones',
  [GHL_FORMS.SESSION_LOG]: 'evidence_sessions',
  [GHL_FORMS.MODULE_PROGRESS]: 'evidence_modules',
  [GHL_FORMS.PULSE_CHECK]: 'evidence_pulse',
  [GHL_FORMS.PAYMENT_UPDATE]: 'evidence_payments',
  [GHL_FORMS.CANCELLATION]: 'evidence_cancellation',
};
