-- 064_evidence_signoffs_schema_repair.sql
--
-- Repairs live environments where evidence_signoffs missed enrichment columns
-- expected by milestone signoff submission and defense exhibit generation.

ALTER TABLE evidence_signoffs
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID,
  ADD COLUMN IF NOT EXISTS payment_event_id UUID,
  ADD COLUMN IF NOT EXISTS defense_summary TEXT,
  ADD COLUMN IF NOT EXISTS issuer_exhibit_title TEXT,
  ADD COLUMN IF NOT EXISTS proof_role TEXT,
  ADD COLUMN IF NOT EXISTS reason_code_tags TEXT[],
  ADD COLUMN IF NOT EXISTS dispute_relevance JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_record_id TEXT,
  ADD COLUMN IF NOT EXISTS actor TEXT,
  ADD COLUMN IF NOT EXISTS defense_metadata JSONB DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
