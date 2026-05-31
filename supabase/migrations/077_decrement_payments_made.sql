-- 077_decrement_payments_made.sql
-- Batch B (bug hunt 2026-05-29): the inverse of increment_enrollment_payments_made.
--
-- A refunded recurring installment must be un-counted so TOTAL_PAID / running-total defense
-- evidence does not overstate what the client paid, and a refunded final installment must
-- reopen billing (clear billing_completed_at). Location-scoped, floors at 0.

CREATE OR REPLACE FUNCTION decrement_enrollment_payments_made(
  p_enrollment_id UUID,
  p_location_id   TEXT DEFAULT NULL
)
RETURNS TABLE (
  payments_made        INTEGER,
  payments_total       INTEGER,
  billing_completed_at TIMESTAMPTZ,
  next_billing_date    DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE enrollments e
     SET payments_made = GREATEST(COALESCE(e.payments_made, 0) - 1, 0),
         billing_completed_at = NULL,
         updated_at = now()
   WHERE e.id = p_enrollment_id
     AND (p_location_id IS NULL OR e.location_id = p_location_id)
  RETURNING e.payments_made, e.payments_total, e.billing_completed_at, e.next_billing_date;
END;
$$;

NOTIFY pgrst, 'reload schema';
