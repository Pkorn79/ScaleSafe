-- 100_recurring_payment_evidence_repair.sql
-- Restore the runtime schema contract for recurring-payment evidence and
-- idempotently materialize evidence for already-recorded recurring payments.

ALTER TABLE evidence_payment_confirmation
  ADD COLUMN IF NOT EXISTS processor TEXT;

COMMENT ON COLUMN evidence_payment_confirmation.processor IS
  'Processor that confirmed the recurring payment (Stripe, NMI, Whop, or another supported rail).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_payment_confirmation_payment_event
  ON evidence_payment_confirmation (payment_event_id)
  WHERE payment_event_id IS NOT NULL;

INSERT INTO evidence_payment_confirmation (
  location_id,
  contact_id,
  source,
  ghl_transaction_id,
  amount,
  currency,
  payment_date,
  payment_number,
  running_total,
  payments_remaining,
  payment_method,
  contact_email,
  raw_payload,
  created_at,
  payment_event_id,
  defense_summary,
  issuer_exhibit_title,
  proof_role,
  reason_code_tags,
  dispute_relevance,
  source_record_id,
  actor,
  defense_metadata,
  enrollment_id,
  processor
)
SELECT
  pe.location_id,
  pe.contact_id,
  COALESCE(NULLIF(pe.source, ''), 'recurring_payment_backfill'),
  pe.processor_transaction_id,
  pe.amount,
  UPPER(COALESCE(NULLIF(pe.currency, ''), 'USD')),
  COALESCE(pe.settled_at, pe.recorded_at, pe.created_at),
  pe.payment_number,
  (
    SELECT COALESCE(SUM(previous.amount), 0)
    FROM payment_events previous
    WHERE previous.enrollment_id = pe.enrollment_id
      AND previous.event_type = 'sale'
      AND (
        previous.created_at < pe.created_at
        OR (previous.created_at = pe.created_at AND previous.id <= pe.id)
      )
  ),
  CASE
    WHEN pe.payment_number IS NOT NULL
      AND COALESCE(pe.payments_total, enrollment.payments_total) IS NOT NULL
    THEN GREATEST(0, COALESCE(pe.payments_total, enrollment.payments_total) - pe.payment_number)
    ELSE NULL
  END,
  NULLIF(CONCAT_WS(
    ' ',
    pe.processor,
    pe.payment_method_type,
    CASE WHEN pe.payment_method_last4 IS NOT NULL THEN 'ending in ' || pe.payment_method_last4 END
  ), ''),
  pe.customer_email,
  jsonb_strip_nulls(jsonb_build_object(
    'transactionId', pe.processor_transaction_id,
    'processorType', pe.processor,
    'amount', pe.amount,
    'source', pe.source,
    'paymentType', enrollment.payment_type,
    'offerName', offer.offer_name,
    'backfilledByMigration', 100
  )),
  pe.created_at,
  pe.id,
  CONCAT(
    CASE WHEN enrollment.payment_type = 'subscription' THEN 'Subscription' ELSE 'Installment' END,
    CASE WHEN pe.payment_number IS NOT NULL THEN ' payment #' || pe.payment_number ELSE ' payment' END,
    ' of $', TO_CHAR(pe.amount, 'FM999999990.00'),
    ' for ', COALESCE(NULLIF(offer.offer_name, ''), 'the enrolled program'),
    ' processed via ', pe.processor,
    '. Transaction: ', pe.processor_transaction_id, '.'
  ),
  CASE
    WHEN pe.payment_number IS NOT NULL THEN 'Recurring Payment #' || pe.payment_number
    ELSE 'Recurring Payment'
  END,
  'payment_history',
  ARRAY[
    'authorization',
    'fraud',
    'services_not_provided',
    'credit_not_processed',
    'cancelled_recurring'
  ]::TEXT[],
  jsonb_build_object(
    'tags', ARRAY[
      'authorization',
      'fraud',
      'services_not_provided',
      'credit_not_processed',
      'cancelled_recurring'
    ]::TEXT[],
    'priority', 'high',
    'confidence', 'strong'
  ),
  pe.processor_transaction_id,
  'processor',
  jsonb_build_object(
    'actor', 'processor',
    'service', jsonb_strip_nulls(jsonb_build_object(
      'enrollmentId', pe.enrollment_id,
      'offerId', COALESCE(pe.offer_id, enrollment.offer_id),
      'offerName', offer.offer_name
    )),
    'transaction', jsonb_strip_nulls(jsonb_build_object(
      'paymentEventId', pe.id,
      'processor', pe.processor,
      'transactionId', pe.processor_transaction_id,
      'subscriptionId', pe.processor_subscription_id,
      'amount', pe.amount,
      'currency', UPPER(COALESCE(NULLIF(pe.currency, ''), 'USD')),
      'paymentSequence', pe.payment_number
    )),
    'source', jsonb_strip_nulls(jsonb_build_object(
      'system', COALESCE(NULLIF(pe.source, ''), 'recurring_payment_backfill'),
      'recordId', pe.processor_transaction_id,
      'rawEventType', 'recurring_payment_success'
    ))
  ),
  pe.enrollment_id,
  pe.processor
FROM payment_events pe
JOIN enrollments enrollment
  ON enrollment.id = pe.enrollment_id
 AND enrollment.location_id = pe.location_id
LEFT JOIN offers_mirror offer
  ON offer.id = COALESCE(pe.offer_id, enrollment.offer_id)
 AND offer.location_id = pe.location_id
WHERE pe.event_type = 'sale'
  AND pe.is_recurring IS TRUE
  AND pe.enrollment_id IS NOT NULL
  AND pe.processor_transaction_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM evidence_payment_confirmation existing
    WHERE existing.payment_event_id = pe.id
  )
ON CONFLICT (payment_event_id) WHERE payment_event_id IS NOT NULL DO NOTHING;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 100;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
