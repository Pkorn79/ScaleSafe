/**
 * All 21 evidence types from SCALESAFE_APP_BLUEPRINT_v2.1.
 * Each maps to a Supabase table and a human-readable label.
 */
export const EVIDENCE_TYPES = {
  CONSENT:                'consent',
  ENROLLMENT_PAYMENT:     'enrollment_payment',
  SESSION_DELIVERY:       'session_delivery',
  MODULE_COMPLETION:      'module_completion',
  PULSE_CHECKIN:          'pulse_checkin',
  PAYMENT_CONFIRMATION:   'payment_confirmation',
  CANCELLATION:           'cancellation',
  SESSION_ATTENDANCE:     'session_attendance',
  MODULE_PROGRESS:        'module_progress',
  MILESTONE_COMPLETION:   'milestone_completion',
  MILESTONE_SIGNOFF:      'milestone_signoff',
  SERVICE_ACCESS:         'service_access',
  EXTERNAL_SESSION:       'external_session',
  COURSE_COMPLETION:      'course_completion',
  ASSIGNMENT_SUBMISSION:  'assignment_submission',
  COMMUNICATION:          'communication',
  RESOURCE_DELIVERY:      'resource_delivery',
  REFUND_ACTIVITY:        'refund_activity',
  FAILED_PAYMENT:         'failed_payment',
  SUBSCRIPTION_CHANGE:    'subscription_change',
  CUSTOM_EVENT:           'custom_event',
} as const;

export type EvidenceType = typeof EVIDENCE_TYPES[keyof typeof EVIDENCE_TYPES];

/**
 * Maps evidence types to their Supabase table names.
 */
export const EVIDENCE_TABLE_MAP: Record<EvidenceType, string> = {
  consent:               'evidence_consent',
  enrollment_payment:    'evidence_enrollment_payment',
  session_delivery:      'evidence_sessions',
  module_completion:     'evidence_modules',
  pulse_checkin:         'evidence_pulse_checkins',
  payment_confirmation:  'evidence_payment_confirmation',
  cancellation:          'evidence_cancellation',
  session_attendance:    'evidence_attendance',
  module_progress:       'evidence_modules',
  milestone_completion:  'evidence_milestones',
  milestone_signoff:     'evidence_signoffs',
  service_access:        'evidence_service_access',
  external_session:      'evidence_external_sessions',
  course_completion:     'evidence_course_completion',
  assignment_submission: 'evidence_assignments',
  communication:         'evidence_communication',
  resource_delivery:     'evidence_resource_delivery',
  refund_activity:       'evidence_refund_activity',
  failed_payment:        'evidence_failed_payment',
  subscription_change:   'evidence_subscription_changes',
  custom_event:          'evidence_custom_events',
};

/**
 * External webhook event_type → evidence type mapping.
 * From docs/external-integration-guide.md.
 */
export const EXTERNAL_EVENT_MAP: Record<string, EvidenceType> = {
  session_completed:  'external_session',
  no_show:            'session_attendance',
  module_completed:   'module_completion',
  milestone_signed:   'milestone_signoff',
  pulse_check:        'pulse_checkin',
  payment_update:     'payment_confirmation',
  service_access:     'service_access',
  course_completed:   'course_completion',
  assignment_submitted: 'assignment_submission',
  custom_event:       'custom_event',
};

/**
 * GHL form IDs → evidence type mapping.
 */
export const GHL_FORM_MAP: Record<string, EvidenceType> = {
  'SYS2-07': 'session_delivery',
  'SYS2-08': 'module_completion',
  'SYS2-09': 'pulse_checkin',
  'SYS2-10': 'payment_confirmation',
  'SYS2-11': 'cancellation',
};
