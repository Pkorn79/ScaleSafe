-- 066_idempotency_and_payment_atomicity.sql
-- Tenant-scope idempotency and provide an atomic enrollment payment increment.

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_event_source_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_location_event_source
  ON idempotency_keys(location_id, event_id, source);

DROP INDEX IF EXISTS idx_idempotency_keys_event_source;

CREATE OR REPLACE FUNCTION increment_enrollment_payments_made(
  p_enrollment_id UUID,
  p_location_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  payments_made INTEGER,
  payments_total INTEGER,
  billing_completed_at TIMESTAMPTZ,
  next_billing_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE enrollments e
     SET payments_made = COALESCE(e.payments_made, 0) + 1,
         updated_at = now()
   WHERE e.id = p_enrollment_id
     AND (p_location_id IS NULL OR e.location_id = p_location_id)
  RETURNING e.payments_made,
            e.payments_total,
            e.billing_completed_at,
            e.next_billing_date;
END;
$$;

NOTIFY pgrst, 'reload schema';
