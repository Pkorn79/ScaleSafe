-- 004_evidence_timeline_view.sql — Unified evidence timeline (v2.1)
--
-- UNIONs all 20 evidence tables into a single chronological view.
-- The AI Defense Compiler queries:
--   SELECT * FROM evidence_timeline
--   WHERE contact_id = $1 AND location_id = $2
--   ORDER BY created_at ASC
--
-- Each row: contact_id, location_id, type, created_at, data (JSONB)

CREATE OR REPLACE VIEW evidence_timeline AS

  SELECT contact_id, location_id, 'consent' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_consent e

  UNION ALL
  SELECT contact_id, location_id, 'enrollment_payment' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_enrollment_payment e

  UNION ALL
  SELECT contact_id, location_id, 'session' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_sessions e

  UNION ALL
  SELECT contact_id, location_id, 'module' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_modules e

  UNION ALL
  SELECT contact_id, location_id, 'pulse_checkin' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_pulse_checkins e

  UNION ALL
  SELECT contact_id, location_id, 'payment_confirmation' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_payment_confirmation e

  UNION ALL
  SELECT contact_id, location_id, 'failed_payment' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_failed_payment e

  UNION ALL
  SELECT contact_id, location_id, 'attendance' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_attendance e

  UNION ALL
  SELECT contact_id, location_id, 'milestone' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_milestones e

  UNION ALL
  SELECT contact_id, location_id, 'signoff' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_signoffs e

  UNION ALL
  SELECT contact_id, location_id, 'service_access' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_service_access e

  UNION ALL
  SELECT contact_id, location_id, 'external_session' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_external_sessions e

  UNION ALL
  SELECT contact_id, location_id, 'course_completion' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_course_completion e

  UNION ALL
  SELECT contact_id, location_id, 'assignment' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_assignments e

  UNION ALL
  SELECT contact_id, location_id, 'communication' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_communication e

  UNION ALL
  SELECT contact_id, location_id, 'resource_delivery' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_resource_delivery e

  UNION ALL
  SELECT contact_id, location_id, 'refund' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_refund_activity e

  UNION ALL
  SELECT contact_id, location_id, 'cancellation' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_cancellation e

  UNION ALL
  SELECT contact_id, location_id, 'subscription_change' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_subscription_changes e

  UNION ALL
  SELECT contact_id, location_id, 'custom_event' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_custom_events e

ORDER BY created_at ASC;
