-- Migration 051: Expand installment_frequency to include quarterly and annual
-- Drop the existing CHECK constraint and recreate with new values.

ALTER TABLE offers_mirror DROP CONSTRAINT IF EXISTS offers_mirror_installment_frequency_check;
ALTER TABLE offers_mirror ADD CONSTRAINT offers_mirror_installment_frequency_check
  CHECK (installment_frequency IN ('weekly', 'bi_weekly', 'monthly', 'quarterly', 'annual'));
