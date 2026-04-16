-- 046_rls_lockdown.sql — Lock down RLS: drop overly-permissive anon-accessible policies
--
-- Every table in the ScaleSafe schema has RLS enabled but with a single policy:
--   CREATE POLICY "Service role full access" ... FOR ALL USING (true) WITH CHECK (true)
-- This policy has no TO clause, so it applies to the PUBLIC pseudo-role —
-- including the anon key. Anyone with the Supabase project URL can read/write
-- every table through the public API.
--
-- FIX: drop these policies. With RLS enabled and no matching policy for anon,
-- the anon role gets zero access (PostgreSQL default-deny). The service_role
-- (used exclusively by the backend via SUPABASE_SERVICE_KEY) bypasses RLS
-- entirely — the app is completely unaffected.
--
-- Frontend verified: no @supabase/supabase-js import exists in src/ui/src/.
-- All database queries go through the backend using the service key.
--
-- If we ever need frontend-direct Supabase access in the future (e.g., realtime
-- subscriptions), we'll add narrowly-scoped policies at that time with proper
-- auth.uid() or location_id checks. For now: deny all non-service access.

-- Core tables (migration 001)
DROP POLICY IF EXISTS "Service role full access" ON merchants;
DROP POLICY IF EXISTS "Service role full access" ON offers_mirror;
DROP POLICY IF EXISTS "Service role full access" ON enrollment_packets;
DROP POLICY IF EXISTS "Service role full access" ON payment_customer_map;
DROP POLICY IF EXISTS "Service role full access" ON idempotency_keys;

-- Defense tables (migration 002)
DROP POLICY IF EXISTS "Service role full access" ON defense_packets;
DROP POLICY IF EXISTS "Service role full access" ON reason_code_strategies;
DROP POLICY IF EXISTS "Service role full access" ON defense_templates;
DROP POLICY IF EXISTS "Service role full access" ON defense_outcomes;

-- Evidence tables (migration 003) — 20 tables
DROP POLICY IF EXISTS "Service role full access" ON evidence_consent;
DROP POLICY IF EXISTS "Service role full access" ON evidence_enrollment_payment;
DROP POLICY IF EXISTS "Service role full access" ON evidence_sessions;
DROP POLICY IF EXISTS "Service role full access" ON evidence_modules;
DROP POLICY IF EXISTS "Service role full access" ON evidence_pulse_checkins;
DROP POLICY IF EXISTS "Service role full access" ON evidence_payment_confirmation;
DROP POLICY IF EXISTS "Service role full access" ON evidence_failed_payment;
DROP POLICY IF EXISTS "Service role full access" ON evidence_attendance;
DROP POLICY IF EXISTS "Service role full access" ON evidence_milestones;
DROP POLICY IF EXISTS "Service role full access" ON evidence_signoffs;
DROP POLICY IF EXISTS "Service role full access" ON evidence_service_access;
DROP POLICY IF EXISTS "Service role full access" ON evidence_external_sessions;
DROP POLICY IF EXISTS "Service role full access" ON evidence_course_completion;
DROP POLICY IF EXISTS "Service role full access" ON evidence_assignments;
DROP POLICY IF EXISTS "Service role full access" ON evidence_communication;
DROP POLICY IF EXISTS "Service role full access" ON evidence_resource_delivery;
DROP POLICY IF EXISTS "Service role full access" ON evidence_refund_activity;
DROP POLICY IF EXISTS "Service role full access" ON evidence_cancellation;
DROP POLICY IF EXISTS "Service role full access" ON evidence_subscription_changes;
DROP POLICY IF EXISTS "Service role full access" ON evidence_custom_events;

-- Trigger subscriptions (migration 008)
DROP POLICY IF EXISTS "Service role full access" ON trigger_subscriptions;

-- Enrollments (migration 009)
DROP POLICY IF EXISTS "Service role full access" ON enrollments;

-- Unified evidence (migration 010)
DROP POLICY IF EXISTS "Service role full access" ON evidence;

-- Payment events (migration 011)
DROP POLICY IF EXISTS "Service role full access" ON payment_events;

-- Processor configs (migration 015) — contains encrypted NMI keys + Stripe tokens
DROP POLICY IF EXISTS "Service role full access" ON processor_configs;

-- Payment methods (migration 016) — contains card details + vault IDs
DROP POLICY IF EXISTS "Service role full access" ON payment_methods;

-- Dispute events (migration 017)
DROP POLICY IF EXISTS "Service role full access" ON dispute_events;

-- Dispute evidence files (migration 018)
DROP POLICY IF EXISTS "Service role full access" ON dispute_evidence_files;

-- Account health snapshots (migration 019)
DROP POLICY IF EXISTS "Service role full access" ON account_health_snapshots;

-- EFW events (migration 020)
DROP POLICY IF EXISTS "Service role full access" ON efw_events;

-- Stripe radar lists (migration 021)
DROP POLICY IF EXISTS "Service role full access" ON stripe_radar_lists;

-- Transaction mappings (migration 023)
DROP POLICY IF EXISTS "Service role full access" ON transaction_mappings;

-- Risk audit results (migration 025)
DROP POLICY IF EXISTS "Service role full access" ON risk_audit_results;

-- Stripe evidence vault (migration 026)
DROP POLICY IF EXISTS "Service role full access" ON stripe_evidence_vault;

-- Defense letter versions (migration 045)
DROP POLICY IF EXISTS "Service role full access" ON defense_letter_versions;
