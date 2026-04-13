-- 037: Add dunning tracking columns to payment_events table.
-- Used by payment-lifecycle.service.ts for retry scheduling and escalation.

ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS dunning_status TEXT;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS dunning_retry_count INTEGER DEFAULT 0;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS dunning_next_retry TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS dunning_started_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS dunning_resolved_at TIMESTAMPTZ;
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS source TEXT;
