-- 073_record_recurring_payment.sql
-- Batch A (bug hunt 2026-05-29): atomic recurring-payment recording.
--
-- Replaces the non-atomic "SELECT dedupe -> increment -> insert" sequence in
-- handleRecurringPaymentSuccess. In ONE transaction this:
--   1. Locks the enrollment row (FOR UPDATE).
--   2. Inserts the payment_events ledger row FIRST, deduping on the partial unique index
--      from migration 072 (ON CONFLICT DO NOTHING). No claim-before-side-effect, so a
--      crashed/retried webhook is never poisoned.
--   3. Only on a genuinely new row: increments payments_made and advances the schedule.
--
-- next_billing_date is resolved by the CALLER (processor truth first):
--   * webhook event's trusted next/current-period date, else
--   * a processor-subscription API lookup by processor_subscription_id.
-- The caller passes that date as p_next_billing_date with p_next_billing_source='processor'.
-- ONLY if the processor cannot yield a date does the caller pass NULL date +
-- p_next_billing_source='estimated'; this RPC then computes an anchored estimate from the
-- PRIOR next_billing_date + interval (never now()) and records it as 'estimated' so callers
-- can treat the schedule as needs-verification (not fully healthy).
--
-- Rules honored: no now()-based recurring anchor (initial schedule is set at checkout, not
-- here); final payment -> next_billing_date NULL; no fallback billing; no silent history repair.

CREATE OR REPLACE FUNCTION record_recurring_payment(
  p_enrollment_id       uuid,
  p_location_id         text,
  p_processor           text,
  p_transaction_id      text,
  p_amount              numeric,
  p_next_billing_date   date    DEFAULT NULL,        -- caller-resolved processor date
  p_next_billing_source text    DEFAULT 'processor', -- 'processor' | 'estimated'
  p_interval            text    DEFAULT 'monthly',   -- last-resort estimate only
  p_source              text    DEFAULT NULL,
  p_raw_payload         jsonb   DEFAULT NULL
)
RETURNS TABLE (
  is_duplicate          boolean,
  payment_event_id      uuid,
  payments_made         integer,
  payments_total        integer,
  is_final              boolean,
  billing_completed_at  timestamptz,
  next_billing_date     date,
  next_billing_source   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_enr       enrollments%ROWTYPE;
  v_event_id  uuid;
  v_new_made  integer;
  v_is_finite boolean;
  v_is_final  boolean := false;
  v_next      date;
  v_source    text;
  v_completed timestamptz;
BEGIN
  IF p_transaction_id IS NULL OR p_transaction_id = '' THEN
    RAISE EXCEPTION 'record_recurring_payment requires a non-empty transaction id (enrollment %)',
      p_enrollment_id;
  END IF;

  -- Lock the enrollment for the duration of the transaction.
  SELECT * INTO v_enr FROM enrollments e
   WHERE e.id = p_enrollment_id AND e.location_id = p_location_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment % not found for location %', p_enrollment_id, p_location_id;
  END IF;

  v_is_finite := v_enr.payment_type <> 'subscription' AND v_enr.payments_total IS NOT NULL;

  -- Primary dedupe: insert the ledger row first (ON CONFLICT against the partial unique index).
  INSERT INTO payment_events (
    merchant_id, location_id, contact_id, enrollment_id,
    event_type, processor, processor_transaction_id, processor_subscription_id,
    amount, currency, payment_number, payments_total, source, is_recurring, raw_webhook_payload
  ) VALUES (
    v_enr.merchant_id, p_location_id, v_enr.contact_id, p_enrollment_id,
    'sale', p_processor, p_transaction_id, v_enr.processor_subscription_id,
    p_amount, 'usd', COALESCE(v_enr.payments_made,0) + 1,
    CASE WHEN v_is_finite THEN v_enr.payments_total ELSE NULL END,
    p_source, true, p_raw_payload
  )
  ON CONFLICT (location_id, processor, processor_transaction_id)
    WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> ''
  DO NOTHING
  RETURNING id INTO v_event_id;

  -- Duplicate delivery: ledger row already exists -> do NOT increment.
  IF v_event_id IS NULL THEN
    RETURN QUERY SELECT true, NULL::uuid, v_enr.payments_made, v_enr.payments_total,
      false, v_enr.billing_completed_at, v_enr.next_billing_date, v_enr.next_billing_date_source;
    RETURN;
  END IF;

  -- New payment: increment + advance schedule atomically.
  v_new_made := COALESCE(v_enr.payments_made,0) + 1;
  v_is_final := v_is_finite AND v_new_made >= v_enr.payments_total;

  IF v_is_final THEN
    v_next := NULL;
    v_source := 'complete';
    v_completed := now();
  ELSE
    v_completed := v_enr.billing_completed_at;
    IF p_next_billing_date IS NOT NULL THEN
      v_next := p_next_billing_date;                   -- processor truth, preferred
      v_source := COALESCE(p_next_billing_source, 'processor');
    ELSE
      -- Last resort: anchor to the PRIOR schedule (never now()) and mark estimated.
      v_next := (COALESCE(v_enr.next_billing_date, CURRENT_DATE)::timestamp
        + CASE lower(p_interval)
            WHEN 'daily'     THEN interval '1 day'
            WHEN 'weekly'    THEN interval '7 days'
            WHEN 'bi_weekly' THEN interval '14 days'
            WHEN 'biweekly'  THEN interval '14 days'
            WHEN 'quarterly' THEN interval '3 months'
            WHEN 'annual'    THEN interval '1 year'
            ELSE interval '1 month'
          END)::date;
      v_source := 'estimated';
    END IF;
  END IF;

  UPDATE enrollments e
     SET payments_made = v_new_made,
         next_billing_date = v_next,
         next_billing_date_source = v_source,
         billing_completed_at = v_completed,
         updated_at = now()
   WHERE e.id = p_enrollment_id AND e.location_id = p_location_id;

  RETURN QUERY SELECT false, v_event_id, v_new_made, v_enr.payments_total,
    v_is_final, v_completed, v_next, v_source;
END;
$$;

NOTIFY pgrst, 'reload schema';
