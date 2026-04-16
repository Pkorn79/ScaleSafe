-- Migration 049: Add processor_subscription_id to enrollments
-- Stores the NMI subscription_id or Stripe subscription ID so the processor
-- manages recurring billing natively. Enrollments with this column populated
-- are skipped by the daily recurring-billing cron (processor handles charges).

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS processor_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_enrollments_processor_sub
  ON enrollments(processor_subscription_id)
  WHERE processor_subscription_id IS NOT NULL;
