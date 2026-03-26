-- 005_evidence_timeline_view.sql — Unified evidence timeline view
--
-- UNIONs all 10 evidence tables into a single queryable timeline.
-- The AI Defense Compiler uses this view to gather ALL evidence for a contact
-- in one query: SELECT * FROM evidence_timeline WHERE contact_id = $1 AND location_id = $2
--
-- Each row has: contact_id, location_id, type (evidence category), created_at, data (JSONB).
-- The 'data' column contains all type-specific fields as JSONB.
--
-- NOTE: If any of the 9 original evidence tables don't exist yet in your Supabase,
-- comment out those lines before running. The existing tables from Make.com are:
-- evidence_sessions, evidence_modules, evidence_milestones, evidence_pulse,
-- evidence_payments, evidence_enrollment, evidence_cancellation, evidence_noshow,
-- evidence_refund_activity

CREATE OR REPLACE VIEW evidence_timeline AS

  SELECT contact_id, location_id, 'session' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_sessions e

  UNION ALL
  SELECT contact_id, location_id, 'module' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_modules e

  -- NOTE: The following tables do not exist yet in Supabase.
  -- Re-add these UNION ALL blocks when they are created:
  -- evidence_milestones (milestone), evidence_pulse (pulse),
  -- evidence_payments (payment), evidence_enrollment (enrollment),
  -- evidence_noshow (noshow)

  UNION ALL
  SELECT contact_id, location_id, 'cancellation' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_cancellation e

  UNION ALL
  SELECT contact_id, location_id, 'refund' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_refund_activity e

  UNION ALL
  SELECT contact_id, location_id, 'service_access' AS type, created_at,
         to_jsonb(e) - 'id' - 'contact_id' - 'location_id' - 'created_at' AS data
  FROM evidence_service_access e

ORDER BY created_at ASC;
