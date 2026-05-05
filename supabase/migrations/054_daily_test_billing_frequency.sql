-- Migration 054: Allow daily installment frequency for controlled test billing.
-- Daily is a ScaleSafe testing cadence; the UI should only expose it when the
-- test billing flag is enabled, but the database must accept existing test
-- offers that use it.

ALTER TABLE offers_mirror DROP CONSTRAINT IF EXISTS offers_mirror_installment_frequency_check;

ALTER TABLE offers_mirror ADD CONSTRAINT offers_mirror_installment_frequency_check
  CHECK (installment_frequency IN ('daily', 'weekly', 'bi_weekly', 'monthly', 'quarterly', 'annual'));
