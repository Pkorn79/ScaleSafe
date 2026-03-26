/**
 * evidence-types.ts — Evidence Type Definitions
 *
 * Maps evidence type names to their Supabase table names.
 * Also maps external webhook event_type values to evidence tables.
 * Used by the evidence service to route data to the correct table.
 *
 * There are 10 evidence tables total (9 original + 1 for service access).
 * All tables are append-only — evidence is never updated or deleted
 * because it forms a legal audit trail for chargeback defense.
 */

/** All Supabase evidence table names. */
export const EVIDENCE_TABLES = {
  SESSIONS: 'evidence_sessions',
  MODULES: 'evidence_modules',
  MILESTONES: 'evidence_milestones',
  PULSE: 'evidence_pulse',
  PAYMENTS: 'evidence_payments',
  ENROLLMENT: 'evidence_enrollment',
  CANCELLATION: 'evidence_cancellation',
  NOSHOW: 'evidence_noshow',
  REFUND_ACTIVITY: 'evidence_refund_activity',
  SERVICE_ACCESS: 'evidence_service_access',
} as const;

/**
 * Maps external webhook event_type values to evidence tables.
 * When a third-party tool (Calendly, Zoom, Kajabi, etc.) sends a webhook
 * to /webhooks/external, the event_type field determines which table it goes to.
 */
export const EXTERNAL_EVENT_TO_TABLE: Record<string, string> = {
  session_completed: EVIDENCE_TABLES.SESSIONS,
  no_show: EVIDENCE_TABLES.NOSHOW,
  module_completed: EVIDENCE_TABLES.MODULES,
  milestone_signed: EVIDENCE_TABLES.MILESTONES,
  pulse_check: EVIDENCE_TABLES.PULSE,
  payment_update: EVIDENCE_TABLES.PAYMENTS,
  service_access: EVIDENCE_TABLES.SERVICE_ACCESS,
};

/** The unified view that UNIONs all evidence tables for the defense compiler. */
export const EVIDENCE_TIMELINE_VIEW = 'evidence_timeline';
