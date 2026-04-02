-- 013_offer_duration_refund.sql
-- Add program duration and structured refund policy fields to offers_mirror.

-- Program duration (e.g., "12 Weeks" or "6 Months")
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS program_duration_value INTEGER;
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS program_duration_unit TEXT
  CHECK (program_duration_unit IN ('weeks', 'months'));

-- Structured refund policy type
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS refund_policy_type TEXT
  CHECK (refund_policy_type IN ('no_refunds', 'full_refund', 'prorated', 'custom'));
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS refund_policy_days INTEGER;

-- Per-offer T&C clause toggles (overrides merchant defaults)
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS tc_clause_overrides JSONB DEFAULT '{}'::jsonb;
