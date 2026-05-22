/**
 * Valid GHL custom trigger keys for ScaleSafe.
 * These correspond to triggers registered in the GHL Marketplace portal.
 * Note: 'enrollment_complete' lacks the ss_ prefix (submitted before convention).
 */
export const VALID_TRIGGER_KEYS = [
  'enrollment_complete',
  'ss_cancellation_requested',
  'ss_session_logged',
  'ss_session_noshow',
  'ss_module_completed',
  'ss_program_completed',
  'ss_milestone_reached',
  'ss_milestone_signedoff',
  'ss_payment_received',
  'ss_payment_failed',
  'ss_refund_processed',
  // ss_client_at_risk — migrated to contact field update (ss_engagement_status = 'At Risk')
  // ss_client_reengaged — migrated to contact field update (ss_engagement_status = 'Active')
  'ss_chargeback_detected',
  'ss_defense_ready',
  'ss_evidence_milestone',
  'ss_chargeback_ratio_warning',
  'ss_chargeback_ratio_critical',
  'ss_send_enrollment_link',
  'ss_subscription_paused',
  'ss_subscription_resumed',
  'ss_app_event',
] as const;

export type TriggerKey = typeof VALID_TRIGGER_KEYS[number];

export function isValidTriggerKey(key: string): key is TriggerKey {
  return (VALID_TRIGGER_KEYS as readonly string[]).includes(key);
}
