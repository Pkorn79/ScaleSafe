import { TriggerKey, VALID_TRIGGER_KEYS } from './trigger-keys';

export type TriggerOwner =
  | 'enrollment'
  | 'payment'
  | 'evidence'
  | 'milestone'
  | 'defense'
  | 'risk'
  | 'pulse'
  | 'system';

export type TriggerSourceType = 'checkout' | 'manual' | 'webhook' | 'scheduled' | 'field_change';
export type TriggerAudience = 'contact' | 'location';
export type TriggerBetaStatus = 'critical' | 'important' | 'optional' | 'deferred';

export interface TriggerContract {
  key: TriggerKey;
  label: string;
  owner: TriggerOwner;
  firesFrom: string;
  sourceType: TriggerSourceType;
  audience: TriggerAudience;
  betaStatus: TriggerBetaStatus;
  requiredPayloadFields: string[];
}

export const TRIGGER_CONTRACTS: Record<TriggerKey, TriggerContract> = {
  enrollment_complete: {
    key: 'enrollment_complete',
    label: 'Enrollment Complete',
    owner: 'enrollment',
    firesFrom: 'Full enrollment completion',
    sourceType: 'checkout',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'enrollment_id', 'offer_id', 'offer_name', 'amount', 'payment_type'],
  },
  ss_cancellation_requested: {
    key: 'ss_cancellation_requested',
    label: 'Cancellation Requested',
    owner: 'payment',
    firesFrom: 'Cancellation widget or cancellation evidence form',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'offer_id', 'reason', 'refund_eligibility'],
  },
  ss_session_logged: {
    key: 'ss_session_logged',
    label: 'Session Logged',
    owner: 'evidence',
    firesFrom: 'Session delivery evidence form',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'session_date', 'duration', 'topics'],
  },
  ss_session_noshow: {
    key: 'ss_session_noshow',
    label: 'Session No-Show',
    owner: 'evidence',
    firesFrom: 'Session delivery evidence form when no-show is checked',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'scheduled_date', 'follow_up_action'],
  },
  ss_module_completed: {
    key: 'ss_module_completed',
    label: 'Module Completed',
    owner: 'evidence',
    firesFrom: 'Module completion evidence form',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'module_name', 'progress_pct', 'completion_date'],
  },
  ss_program_completed: {
    key: 'ss_program_completed',
    label: 'Program Completed',
    owner: 'enrollment',
    firesFrom: 'Manual completion or duration-based completion',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'offer_id', 'completed_at', 'completion_reason'],
  },
  ss_milestone_reached: {
    key: 'ss_milestone_reached',
    label: 'Milestone Reached',
    owner: 'milestone',
    firesFrom: 'Merchant marks a milestone complete',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'milestone_number', 'milestone_name', 'offer_id', 'signoff_link'],
  },
  ss_milestone_signedoff: {
    key: 'ss_milestone_signedoff',
    label: 'Milestone Signed Off',
    owner: 'milestone',
    firesFrom: 'Client signs milestone confirmation',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'milestone_number', 'milestone_name', 'signature_timestamp'],
  },
  ss_payment_received: {
    key: 'ss_payment_received',
    label: 'Payment Received',
    owner: 'payment',
    firesFrom: 'Checkout, recurring billing, Stripe webhook, or NMI Silent Post',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'amount', 'transaction_id', 'payment_kind'],
  },
  ss_payment_failed: {
    key: 'ss_payment_failed',
    label: 'Payment Failed',
    owner: 'payment',
    firesFrom: 'Failed checkout or failed recurring payment',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'amount', 'failure_reason', 'attempt_count'],
  },
  ss_refund_processed: {
    key: 'ss_refund_processed',
    label: 'Refund Processed',
    owner: 'payment',
    firesFrom: 'Manual refund action',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'amount', 'refund_type', 'reason'],
  },
  ss_chargeback_detected: {
    key: 'ss_chargeback_detected',
    label: 'Chargeback Detected',
    owner: 'defense',
    firesFrom: 'Defense packet creation',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'amount', 'reason_code', 'dispute_date', 'processor'],
  },
  ss_defense_ready: {
    key: 'ss_defense_ready',
    label: 'Defense Ready',
    owner: 'defense',
    firesFrom: 'Defense compilation completion',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'packet_url', 'evidence_count', 'readiness_score', 'processor'],
  },
  ss_evidence_milestone: {
    key: 'ss_evidence_milestone',
    label: 'Evidence Milestone',
    owner: 'evidence',
    firesFrom: 'Evidence score threshold crossing',
    sourceType: 'webhook',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'milestone_type', 'evidence_count', 'readiness_score'],
  },
  ss_chargeback_ratio_warning: {
    key: 'ss_chargeback_ratio_warning',
    label: 'Chargeback Ratio Warning',
    owner: 'risk',
    firesFrom: 'Daily health check',
    sourceType: 'scheduled',
    audience: 'location',
    betaStatus: 'optional',
    requiredPayloadFields: ['location_id', 'processor', 'current_ratio', 'threshold'],
  },
  ss_chargeback_ratio_critical: {
    key: 'ss_chargeback_ratio_critical',
    label: 'Chargeback Ratio Critical',
    owner: 'risk',
    firesFrom: 'Daily health check',
    sourceType: 'scheduled',
    audience: 'location',
    betaStatus: 'optional',
    requiredPayloadFields: ['location_id', 'processor', 'current_ratio', 'threshold'],
  },
  ss_send_enrollment_link: {
    key: 'ss_send_enrollment_link',
    label: 'Send Enrollment Link',
    owner: 'enrollment',
    firesFrom: 'Merchant sends an offer link from ScaleSafe',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'offer_id', 'offer_name', 'enrollment_url'],
  },
  ss_subscription_paused: {
    key: 'ss_subscription_paused',
    label: 'Subscription Paused',
    owner: 'payment',
    firesFrom: 'Merchant pauses recurring plan',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'offer_name', 'pause_reason', 'payments_remaining'],
  },
  ss_subscription_resumed: {
    key: 'ss_subscription_resumed',
    label: 'Subscription Resumed',
    owner: 'payment',
    firesFrom: 'Merchant resumes recurring plan',
    sourceType: 'manual',
    audience: 'contact',
    betaStatus: 'important',
    requiredPayloadFields: ['contact_id', 'offer_name', 'next_billing_date', 'payments_remaining'],
  },
  ss_upcoming_payment_reminder: {
    key: 'ss_upcoming_payment_reminder',
    label: 'Upcoming Payment Reminder',
    owner: 'payment',
    firesFrom: 'Hourly payment reminder job',
    sourceType: 'scheduled',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['contact_id', 'enrollment_id', 'amount', 'next_billing_date', 'days_until_payment'],
  },
  ss_app_event: {
    key: 'ss_app_event',
    label: 'ScaleSafe App Event',
    owner: 'system',
    firesFrom: 'Shared app event path; pulse uses event_type = pulse_check_due',
    sourceType: 'scheduled',
    audience: 'contact',
    betaStatus: 'critical',
    requiredPayloadFields: ['event_type', 'contact_id', 'enrollment_id'],
  },
};

export const FIELD_AUTOMATION_CONTRACTS = [
  {
    key: 'ss_engagement_status_at_risk',
    label: 'Client At Risk',
    fieldKey: 'contact.ss_engagement_status',
    expectedValue: 'At Risk',
    owner: 'risk',
    betaStatus: 'important' as const,
    firesFrom: 'Disengagement check writes the contact field; GHL Contact Field Changed workflow sends the message.',
  },
  {
    key: 'ss_engagement_status_active',
    label: 'Client Re-Engaged',
    fieldKey: 'contact.ss_engagement_status',
    expectedValue: 'Active',
    owner: 'risk',
    betaStatus: 'important' as const,
    firesFrom: 'Participation evidence writes the contact field; GHL Contact Field Changed workflow sends the message.',
  },
];

export function getTriggerContracts(): TriggerContract[] {
  return VALID_TRIGGER_KEYS.map((key) => TRIGGER_CONTRACTS[key]);
}
