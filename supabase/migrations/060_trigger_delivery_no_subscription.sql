-- 060: Make missing GHL workflow subscriptions visible in trigger delivery logs.

ALTER TABLE trigger_delivery_logs
  DROP CONSTRAINT IF EXISTS trigger_delivery_logs_status_check;

ALTER TABLE trigger_delivery_logs
  ADD CONSTRAINT trigger_delivery_logs_status_check
  CHECK (status IN ('sent', 'failed', 'no_subscription'));
