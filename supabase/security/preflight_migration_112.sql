\set ON_ERROR_STOP on

-- Read-only migration 112 readiness report for a schema 111 database.
-- The result contains aggregate counts only. It emits no tenant or customer data.
DO $$
BEGIN
  IF scalesafe_schema_version() <> 111 THEN
    RAISE EXCEPTION 'Migration 112 preflight requires ScaleSafe schema version 111';
  END IF;
END;
$$;

WITH config_counts AS (
  SELECT
    merchant_id,
    location_id,
    processor_type,
    count(*)::integer AS candidate_count
  FROM public.processor_configs
  WHERE processor_type IN ('nmi', 'stripe')
  GROUP BY merchant_id, location_id, processor_type
), enrollment_readiness AS (
  SELECT
    e.id,
    e.processor_type,
    e.processor_subscription_id,
    e.payment_type,
    e.billing_completed_at,
    e.status,
    COALESCE(c.candidate_count, 0) AS candidate_count,
    e.processor_subscription_id IS NOT NULL
      AND e.payment_type IN ('installment', 'installments', 'subscription')
      AND e.billing_completed_at IS NULL
      AND e.status IN ('enrolled', 'active', 'paused', 'past_due') AS active_recurring
  FROM public.enrollments AS e
  LEFT JOIN config_counts AS c
    ON c.merchant_id = e.merchant_id
   AND c.location_id = e.location_id
   AND c.processor_type = e.processor_type
  WHERE e.processor_type IN ('nmi', 'stripe')
), payment_method_readiness AS (
  SELECT
    pm.id,
    COALESCE(c.candidate_count, 0) AS candidate_count
  FROM public.payment_methods AS pm
  LEFT JOIN config_counts AS c
    ON c.merchant_id = pm.merchant_id
   AND c.location_id = pm.location_id
   AND c.processor_type = pm.processor_type
  WHERE pm.processor_type IN ('nmi', 'stripe')
), dunning_readiness AS (
  SELECT
    pe.id,
    pe.processor,
    pe.raw_webhook_payload,
    COALESCE(c.candidate_count, 0) AS candidate_count
  FROM public.payment_events AS pe
  LEFT JOIN public.enrollments AS e
    ON e.id = pe.enrollment_id
   AND e.location_id = pe.location_id
  LEFT JOIN config_counts AS c
    ON c.merchant_id = COALESCE(e.merchant_id, pe.merchant_id)
   AND c.location_id = pe.location_id
   AND c.processor_type = pe.processor
  WHERE pe.processor IN ('nmi', 'stripe')
    AND pe.event_type = 'payment_failed'
    AND pe.dunning_status IN ('active', 'retrying', 'escalated')
), config_ambiguity AS (
  SELECT
    count(*) FILTER (WHERE candidate_count > 1)::integer AS ambiguous_groups,
    COALESCE(sum(candidate_count) FILTER (WHERE candidate_count > 1), 0)::integer AS configs_in_ambiguous_groups
  FROM config_counts
)
SELECT jsonb_pretty(jsonb_build_object(
  'status', CASE
    WHEN EXISTS (
      SELECT 1 FROM enrollment_readiness
      WHERE active_recurring AND candidate_count <> 1
    ) THEN 'blocked'
    WHEN EXISTS (
      SELECT 1 FROM dunning_readiness
      WHERE candidate_count <> 1
    ) THEN 'attention'
    ELSE 'ready'
  END,
  'schema_version', scalesafe_schema_version(),
  'active_recurring_enrollments', jsonb_build_object(
    'total', (SELECT count(*) FROM enrollment_readiness WHERE active_recurring),
    'deterministic', (SELECT count(*) FROM enrollment_readiness WHERE active_recurring AND candidate_count = 1),
    'unmatched', (SELECT count(*) FROM enrollment_readiness WHERE active_recurring AND candidate_count = 0),
    'ambiguous', (SELECT count(*) FROM enrollment_readiness WHERE active_recurring AND candidate_count > 1)
  ),
  'all_processor_enrollments', jsonb_build_object(
    'total', (SELECT count(*) FROM enrollment_readiness),
    'deterministic', (SELECT count(*) FROM enrollment_readiness WHERE candidate_count = 1),
    'unmatched', (SELECT count(*) FROM enrollment_readiness WHERE candidate_count = 0),
    'ambiguous', (SELECT count(*) FROM enrollment_readiness WHERE candidate_count > 1)
  ),
  'stored_payment_methods', jsonb_build_object(
    'total', (SELECT count(*) FROM payment_method_readiness),
    'deterministic', (SELECT count(*) FROM payment_method_readiness WHERE candidate_count = 1),
    'unmatched', (SELECT count(*) FROM payment_method_readiness WHERE candidate_count = 0),
    'ambiguous', (SELECT count(*) FROM payment_method_readiness WHERE candidate_count > 1)
  ),
  'active_dunning', jsonb_build_object(
    'total', (SELECT count(*) FROM dunning_readiness),
    'configuration_unmatched', (SELECT count(*) FROM dunning_readiness WHERE candidate_count = 0),
    'configuration_ambiguous', (SELECT count(*) FROM dunning_readiness WHERE candidate_count > 1),
    'stripe_missing_invoice_id', (
      SELECT count(*)
      FROM dunning_readiness
      WHERE processor = 'stripe'
        AND COALESCE(
          NULLIF(raw_webhook_payload->>'stripe_invoice_id', ''),
          NULLIF(raw_webhook_payload->>'invoiceId', '')
        ) IS NULL
    ),
    'stripe_missing_account_id', (
      SELECT count(*)
      FROM dunning_readiness
      WHERE processor = 'stripe'
        AND COALESCE(
          NULLIF(raw_webhook_payload->>'stripe_account_id', ''),
          NULLIF(raw_webhook_payload->>'stripeAccountId', '')
        ) IS NULL
    ),
    'nmi_missing_processor_id', (
      SELECT count(*)
      FROM dunning_readiness
      WHERE processor = 'nmi'
        AND COALESCE(
          NULLIF(raw_webhook_payload->>'nmi_processor_id', ''),
          NULLIF(raw_webhook_payload->>'processor_id', '')
        ) IS NULL
    )
  ),
  'processor_configuration', (
    SELECT jsonb_build_object(
      'ambiguous_groups', ambiguous_groups,
      'configs_in_ambiguous_groups', configs_in_ambiguous_groups
    )
    FROM config_ambiguity
  ),
  'contains_customer_data', false
)) AS migration_112_preflight;
