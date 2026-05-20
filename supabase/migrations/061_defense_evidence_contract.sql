-- 061_defense_evidence_contract.sql
--
-- Phase 1 of the evidence-quality audit: give every evidence source the same
-- defense-facing metadata contract. Idempotent and safe after partial runs.

DO $$
DECLARE
  table_name text;
  tables_with_enrollment_id text[] := ARRAY[
    'evidence_sessions',
    'evidence_modules',
    'evidence_payment_confirmation',
    'evidence_failed_payment',
    'evidence_attendance',
    'evidence_service_access',
    'evidence_external_sessions',
    'evidence_course_completion',
    'evidence_assignments',
    'evidence_communication',
    'evidence_resource_delivery',
    'evidence_refund_activity',
    'evidence_subscription_changes',
    'evidence_custom_events'
  ];
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'evidence',
    'evidence_consent',
    'evidence_enrollment_payment',
    'evidence_sessions',
    'evidence_modules',
    'evidence_pulse_checkins',
    'evidence_payment_confirmation',
    'evidence_failed_payment',
    'evidence_attendance',
    'evidence_milestones',
    'evidence_signoffs',
    'evidence_service_access',
    'evidence_external_sessions',
    'evidence_course_completion',
    'evidence_assignments',
    'evidence_communication',
    'evidence_resource_delivery',
    'evidence_refund_activity',
    'evidence_cancellation',
    'evidence_subscription_changes',
    'evidence_custom_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS payment_event_id UUID', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS defense_summary TEXT', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS issuer_exhibit_title TEXT', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS proof_role TEXT', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS reason_code_tags TEXT[]', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS dispute_relevance JSONB DEFAULT ''{}''::jsonb', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS source_record_id TEXT', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS actor TEXT', table_name);
    EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS defense_metadata JSONB DEFAULT ''{}''::jsonb', table_name);

    IF table_name = ANY(tables_with_enrollment_id) THEN
      EXECUTE format('ALTER TABLE IF EXISTS %I ADD COLUMN IF NOT EXISTS enrollment_id UUID', table_name);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_evidence_payment_event
  ON evidence (payment_event_id);
CREATE INDEX IF NOT EXISTS idx_evidence_reason_code_tags
  ON evidence USING GIN (reason_code_tags);
CREATE INDEX IF NOT EXISTS idx_evidence_defense_metadata
  ON evidence USING GIN (defense_metadata);
