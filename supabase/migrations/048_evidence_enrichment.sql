-- 048_evidence_enrichment.sql — Enrich 5 critical evidence tables for defense letter quality
--
-- Adds description TEXT (server-rendered human-readable sentence at write time)
-- and enrollment_id UUID (scopes evidence to a specific enrollment for
-- multi-enrollment clients) to the 5 most defense-critical evidence tables.
--
-- Forward-only: new columns are nullable, old rows stay sparse.
-- Write paths in enrollment.service.ts, dashboard.controller.ts,
-- payment-update.routes.ts, and evidence.service.ts are updated to populate
-- these columns on every new insert.

-- 1. evidence_consent
ALTER TABLE evidence_consent
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

-- 2. evidence_enrollment_payment
ALTER TABLE evidence_enrollment_payment
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

-- 3. evidence_milestones (description already exists — only add enrollment_id)
ALTER TABLE evidence_milestones
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

-- 4. evidence_signoffs
ALTER TABLE evidence_signoffs
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

-- 5. evidence_cancellation
ALTER TABLE evidence_cancellation
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;
