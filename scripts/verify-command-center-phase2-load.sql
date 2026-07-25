\set ON_ERROR_STOP on
\timing on

-- ISOLATED DATABASE ONLY.
-- This script creates synthetic merchants inside one transaction and always
-- rolls the transaction back. Never run it against production.

BEGIN;
SET LOCAL statement_timeout = '60s';

INSERT INTO merchants (
  location_id,
  business_name,
  status,
  snapshot_status,
  onboarding_complete,
  marketplace_plan_key,
  marketplace_billing_status
)
SELECT
  'cc-load-' || merchant_number,
  'Command Center Load Merchant ' || merchant_number,
  'active',
  'installed',
  true,
  'standard',
  'complete'
FROM generate_series(1, 10000) AS merchant_number;

DO $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_reconciled INTEGER;
BEGIN
  v_started_at := clock_timestamp();
  SELECT reconcile_command_center_merchant_health(
    ARRAY(
      SELECT location_id
      FROM merchants
      WHERE location_id LIKE 'cc-load-%'
      ORDER BY location_id
      LIMIT 1000
    )
  ) INTO v_reconciled;
  v_elapsed_ms := extract(epoch FROM clock_timestamp() - v_started_at) * 1000;

  RAISE NOTICE 'Full-sweep batch: % merchants reconciled in % ms',
    v_reconciled,
    round(v_elapsed_ms, 2);

  IF v_reconciled <> 1000 THEN
    RAISE EXCEPTION 'Expected 1000 full-sweep rollups, received %', v_reconciled;
  END IF;
  IF v_elapsed_ms > 5000 THEN
    RAISE EXCEPTION 'Full-sweep batch exceeded 5000 ms: % ms', round(v_elapsed_ms, 2);
  END IF;
END;
$$;

INSERT INTO health_dirty_scopes (
  location_id,
  merchant_id,
  reasons
)
SELECT
  merchant.location_id,
  merchant.id,
  ARRAY['load_test']
FROM merchants merchant
WHERE merchant.location_id LIKE 'cc-load-%'
ORDER BY merchant.location_id
OFFSET 1000
LIMIT 500;

DO $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_reconciled INTEGER;
BEGIN
  v_started_at := clock_timestamp();
  SELECT reconcile_command_center_dirty_health(500, 'phase2-load-test')
  INTO v_reconciled;
  v_elapsed_ms := extract(epoch FROM clock_timestamp() - v_started_at) * 1000;

  RAISE NOTICE 'Dirty batch: % merchants reconciled in % ms',
    v_reconciled,
    round(v_elapsed_ms, 2);

  IF v_reconciled <> 500 THEN
    RAISE EXCEPTION 'Expected 500 dirty rollups, received %', v_reconciled;
  END IF;
  IF v_elapsed_ms > 2000 THEN
    RAISE EXCEPTION 'Dirty batch exceeded 2000 ms: % ms', round(v_elapsed_ms, 2);
  END IF;
END;
$$;

DO $$
DECLARE
  v_batch INTEGER;
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_max_elapsed_ms NUMERIC := 0;
  v_reconciled INTEGER;
  v_rollup_count INTEGER;
BEGIN
  FOR v_batch IN 0..9 LOOP
    v_started_at := clock_timestamp();
    SELECT reconcile_command_center_merchant_health(
      ARRAY(
        SELECT location_id
        FROM merchants
        WHERE location_id LIKE 'cc-load-%'
        ORDER BY location_id
        OFFSET v_batch * 1000
        LIMIT 1000
      )
    ) INTO v_reconciled;
    v_elapsed_ms := extract(epoch FROM clock_timestamp() - v_started_at) * 1000;
    v_max_elapsed_ms := GREATEST(v_max_elapsed_ms, v_elapsed_ms);

    IF v_elapsed_ms > 5000 THEN
      RAISE EXCEPTION 'Full-sweep batch % exceeded 5000 ms: % ms',
        v_batch + 1,
        round(v_elapsed_ms, 2);
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_rollup_count
  FROM merchant_health_rollups
  WHERE location_id LIKE 'cc-load-%';

  RAISE NOTICE '10,000-merchant sweep complete; max 1,000-row batch % ms',
    round(v_max_elapsed_ms, 2);

  IF v_rollup_count <> 10000 THEN
    RAISE EXCEPTION 'Expected 10000 merchant rollups, received %', v_rollup_count;
  END IF;
END;
$$;

DO $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_rows INTEGER;
BEGIN
  v_started_at := clock_timestamp();
  SELECT count(*) INTO v_rows
  FROM (
    SELECT location_id
    FROM merchant_health_rollups
    ORDER BY needs_attention_count DESC, last_reconciled_at DESC
    LIMIT 50
  ) merchant_page;
  v_elapsed_ms := extract(epoch FROM clock_timestamp() - v_started_at) * 1000;

  RAISE NOTICE 'Merchant list: % rows read in % ms',
    v_rows,
    round(v_elapsed_ms, 2);

  IF v_rows <> 50 THEN
    RAISE EXCEPTION 'Expected a 50-row merchant page, received %', v_rows;
  END IF;
  IF v_elapsed_ms > 350 THEN
    RAISE EXCEPTION 'Merchant list exceeded 350 ms: % ms', round(v_elapsed_ms, 2);
  END IF;
END;
$$;

DO $$
DECLARE
  v_before BIGINT;
  v_after BIGINT;
  v_reconciled INTEGER;
BEGIN
  SELECT count(*) INTO v_before
  FROM merchant_health_rollups
  WHERE location_id LIKE 'cc-load-%';

  SELECT reconcile_command_center_merchant_health(
    ARRAY(
      SELECT location_id
      FROM merchants
      WHERE location_id LIKE 'cc-load-%'
      ORDER BY location_id
      LIMIT 1000
    )
  ) INTO v_reconciled;

  SELECT count(*) INTO v_after
  FROM merchant_health_rollups
  WHERE location_id LIKE 'cc-load-%';

  RAISE NOTICE 'No-change sweep: % changed rollups; row count % -> %',
    v_reconciled,
    v_before,
    v_after;

  IF v_reconciled <> 0 OR v_before <> v_after THEN
    RAISE EXCEPTION 'No-change sweep rewrote merchant rollups';
  END IF;
END;
$$;

DO $$
DECLARE
  v_first_observed_at TIMESTAMPTZ := clock_timestamp() - interval '2 minutes';
  v_second_observed_at TIMESTAMPTZ := clock_timestamp() - interval '1 minute';
  v_health_id UUID;
  v_last_observed_before TIMESTAMPTZ;
  v_last_observed_after TIMESTAMPTZ;
  v_updated_before TIMESTAMPTZ;
  v_updated_after TIMESTAMPTZ;
  v_history_before BIGINT;
  v_history_after BIGINT;
BEGIN
  SELECT health_current_id INTO v_health_id
  FROM record_health_observation(
    'platform',
    'load-no-change-platform',
    NULL,
    NULL,
    'platform.schema_version',
    'healthy',
    NULL,
    NULL,
    'The database schema matches the running code.',
    '{"database_schema_version":104,"code_schema_version":104}'::jsonb,
    v_first_observed_at
  );

  SELECT last_observed_at, updated_at
  INTO v_last_observed_before, v_updated_before
  FROM health_current
  WHERE id = v_health_id;

  SELECT count(*) INTO v_history_before
  FROM health_observations
  WHERE health_current_id = v_health_id;

  PERFORM *
  FROM record_health_observation(
    'platform',
    'load-no-change-platform',
    NULL,
    NULL,
    'platform.schema_version',
    'healthy',
    NULL,
    NULL,
    'The database schema matches the running code.',
    '{"database_schema_version":104,"code_schema_version":104,"sample_age_seconds":60}'::jsonb,
    v_second_observed_at
  );

  SELECT last_observed_at, updated_at
  INTO v_last_observed_after, v_updated_after
  FROM health_current
  WHERE id = v_health_id;

  SELECT count(*) INTO v_history_after
  FROM health_observations
  WHERE health_current_id = v_health_id;

  IF v_last_observed_after IS DISTINCT FROM v_last_observed_before
     OR v_updated_after IS DISTINCT FROM v_updated_before
     OR v_history_after <> v_history_before THEN
    RAISE EXCEPTION 'Unchanged platform health caused a database rewrite';
  END IF;

  RAISE NOTICE 'No-change platform observation: current row and history unchanged';
END;
$$;

ROLLBACK;
