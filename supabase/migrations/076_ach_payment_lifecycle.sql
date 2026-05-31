-- 076_ach_payment_lifecycle.sql
-- ACH/bank-transfer state tracking. ACH processor acceptance is not the same as
-- settled payment, so receipts and fulfillment must be driven from settlement.

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS card_uplift_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS processor_deduction_percent NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS selected_payment_method TEXT;

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_payment_status_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_payment_status_check
  CHECK (payment_status IN (
    'processing',
    'succeeded',
    'settled',
    'failed',
    'returned',
    'late_return',
    'refunded',
    'voided'
  ));

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_selected_payment_method_check;

ALTER TABLE payment_events
  ADD CONSTRAINT payment_events_selected_payment_method_check
  CHECK (selected_payment_method IS NULL OR selected_payment_method IN ('card', 'ach'));

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS initial_payment_status TEXT,
  ADD COLUMN IF NOT EXISTS initial_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS initial_payment_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS initial_payment_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS initial_payment_return_reason TEXT;

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_initial_payment_status_check;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_initial_payment_status_check
  CHECK (initial_payment_status IS NULL OR initial_payment_status IN (
    'processing',
    'succeeded',
    'settled',
    'failed',
    'returned',
    'late_return'
  ));

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_initial_payment_method_check;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_initial_payment_method_check
  CHECK (initial_payment_method IS NULL OR initial_payment_method IN ('card', 'ach'));

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS payment_method_kind TEXT DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS bank_last_four TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_type TEXT,
  ADD COLUMN IF NOT EXISTS bank_holder_type TEXT;

ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_kind_check;

ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_kind_check
  CHECK (payment_method_kind IN ('card', 'ach'));

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_status
  ON payment_events(location_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrollments_initial_payment_status
  ON enrollments(location_id, initial_payment_status, created_at DESC);

NOTIFY pgrst, 'reload schema';
