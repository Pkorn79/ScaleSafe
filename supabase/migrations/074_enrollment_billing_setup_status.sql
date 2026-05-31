-- 074_enrollment_billing_setup_status.sql
-- Batch H (bug hunt 2026-05-29): make a recurring enrollment whose processor-native
-- subscription setup did not complete STOP looking healthy. No fallback billing.
--
-- billing_setup_status:
--   'ok'                   -> processor subscription created and its ID saved
--   'pending'              -> synthetic enrollment created, subscription not yet confirmed
--   'failed'              -> subscription setup failed (no processor subscription exists)
--   'needs_reconciliation' -> processor subscription EXISTS but ScaleSafe failed to save its ID
--
-- On 'failed' / 'needs_reconciliation' the caller also sets next_billing_date = NULL so the
-- payment-reminder job and active-enrollment views do not treat it as scheduled.
--
-- next_billing_date_source (used by migration 073's RPC and checkout):
--   'processor'  -> date came from the processor (event payload or subscription API)
--   'estimated'  -> anchored fallback estimate; treat as needs-verification, not fully healthy
--   'complete'   -> final installment billed; next_billing_date is NULL

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS billing_setup_status     TEXT DEFAULT 'ok';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS billing_setup_error      TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS next_billing_date_source TEXT DEFAULT 'processor';

-- Index to surface enrollments needing attention on the dashboard.
CREATE INDEX IF NOT EXISTS idx_enrollments_billing_setup
  ON enrollments (location_id, billing_setup_status)
  WHERE billing_setup_status <> 'ok';

NOTIFY pgrst, 'reload schema';
