-- Run only against an isolated schema-110 database.
-- The caller owns the surrounding transaction and must roll it back.

DO $verify$
DECLARE
  v_platform_org_id UUID;
  v_reseller_org_id UUID := gen_random_uuid();
  v_owner_auth_id UUID := gen_random_uuid();
  v_reseller_auth_id_1 UUID := gen_random_uuid();
  v_reseller_auth_id_2 UUID := gen_random_uuid();
  v_owner_user_id UUID := gen_random_uuid();
  v_reseller_user_id_1 UUID := gen_random_uuid();
  v_reseller_user_id_2 UUID := gen_random_uuid();
  v_merchant_a UUID := gen_random_uuid();
  v_merchant_b UUID := gen_random_uuid();
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_poison_rejected BOOLEAN := false;
BEGIN
  IF scalesafe_schema_version() <> 110 THEN
    RAISE EXCEPTION 'Migration 110 schema version assertion failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc function_definition
    JOIN pg_namespace namespace
      ON namespace.oid = function_definition.pronamespace
    WHERE namespace.nspname = 'public'
      AND function_definition.proname IN (
        'list_operator_merchants_page',
        'get_operator_platform_summary',
        'get_operator_merchant_detail',
        'list_operator_resellers_page'
      )
      AND (
        NOT function_definition.prosecdef
        OR has_function_privilege('anon', function_definition.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', function_definition.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', function_definition.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION 'Operator projection function privilege assertion failed';
  END IF;

  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES
    (
      v_owner_auth_id,
      'authenticated',
      'authenticated',
      'owner@isolated.invalid',
      clock_timestamp(),
      '{}'::JSONB,
      '{}'::JSONB,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      v_reseller_auth_id_1,
      'authenticated',
      'authenticated',
      'reseller-one@isolated.invalid',
      clock_timestamp(),
      '{}'::JSONB,
      '{}'::JSONB,
      clock_timestamp(),
      clock_timestamp()
    ),
    (
      v_reseller_auth_id_2,
      'authenticated',
      'authenticated',
      'reseller-two@isolated.invalid',
      clock_timestamp(),
      '{}'::JSONB,
      '{}'::JSONB,
      clock_timestamp(),
      clock_timestamp()
    );

  SELECT organization.id
  INTO v_platform_org_id
  FROM operator_organizations organization
  WHERE organization.organization_type = 'platform'
  LIMIT 1;

  IF v_platform_org_id IS NULL THEN
    v_platform_org_id := gen_random_uuid();
    INSERT INTO operator_organizations (id, organization_type, name)
    VALUES (v_platform_org_id, 'platform', 'ScaleSafe Platform');
  END IF;

  INSERT INTO operator_organizations (id, organization_type, name)
  VALUES (v_reseller_org_id, 'reseller', 'Isolated Reseller');

  INSERT INTO operator_users (
    id,
    auth_user_id,
    email_normalized,
    display_name
  ) VALUES
    (v_owner_user_id, v_owner_auth_id, 'owner@isolated.invalid', 'Isolated Owner'),
    (
      v_reseller_user_id_1,
      v_reseller_auth_id_1,
      'reseller-one@isolated.invalid',
      'Reseller One'
    ),
    (
      v_reseller_user_id_2,
      v_reseller_auth_id_2,
      'reseller-two@isolated.invalid',
      'Reseller Two'
    );

  INSERT INTO operator_memberships (
    organization_id,
    operator_user_id,
    role
  ) VALUES
    (v_platform_org_id, v_owner_user_id, 'platform_owner'),
    (v_reseller_org_id, v_reseller_user_id_1, 'reseller_owner'),
    (v_reseller_org_id, v_reseller_user_id_2, 'reseller_viewer');

  INSERT INTO merchants (
    id,
    location_id,
    business_name,
    status,
    snapshot_status,
    marketplace_plan_key,
    marketplace_billing_status
  ) VALUES
    (
      v_merchant_a,
      'tenant-a',
      'Literal % Merchant',
      'active',
      'installed',
      'standard',
      'complete'
    ),
    (
      v_merchant_b,
      'tenant-b',
      'Literal _ Merchant',
      'active',
      'installed',
      'wholepay',
      'complete'
    );

  INSERT INTO merchants (
    location_id,
    business_name,
    status,
    snapshot_status,
    marketplace_plan_key,
    marketplace_billing_status
  )
  SELECT
    'scale-' || lpad(series::TEXT, 5, '0'),
    'Scale Merchant ' || lpad(series::TEXT, 5, '0'),
    'active',
    'installed',
    'standard',
    'complete'
  FROM generate_series(1, 10000) series;

  BEGIN
    INSERT INTO merchant_health_rollups (
      location_id,
      merchant_id,
      merchant_name,
      overall_state
    ) VALUES (
      'tenant-b',
      v_merchant_a,
      'Poisoned Rollup',
      'healthy'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_poison_rejected := true;
  END;

  IF NOT v_poison_rejected THEN
    RAISE EXCEPTION 'Cross-tenant health rollup was not rejected';
  END IF;

  INSERT INTO merchant_health_rollups (
    location_id,
    merchant_id,
    merchant_name,
    overall_state,
    installation_state,
    processor_state,
    workflow_state,
    evidence_state,
    defense_state,
    billing_state,
    needs_attention_count,
    last_observed_at
  ) VALUES
    (
      'tenant-a',
      v_merchant_a,
      'Literal % Merchant',
      'healthy',
      'healthy',
      'healthy',
      'healthy',
      'healthy',
      'healthy',
      'healthy',
      0,
      clock_timestamp()
    ),
    (
      'tenant-b',
      v_merchant_b,
      'Literal _ Merchant',
      'degraded',
      'healthy',
      'degraded',
      'healthy',
      'healthy',
      'healthy',
      'healthy',
      1,
      clock_timestamp()
    );

  INSERT INTO merchant_health_rollups (
    location_id,
    merchant_id,
    merchant_name,
    overall_state,
    installation_state,
    processor_state,
    workflow_state,
    evidence_state,
    defense_state,
    billing_state,
    needs_attention_count,
    last_observed_at
  )
  SELECT
    merchant.location_id,
    merchant.id,
    merchant.business_name,
    'healthy',
    'healthy',
    'healthy',
    'healthy',
    'healthy',
    'healthy',
    'healthy',
    0,
    clock_timestamp()
  FROM merchants merchant
  WHERE merchant.location_id LIKE 'scale-%';

  INSERT INTO processor_configs (
    merchant_id,
    location_id,
    processor_type,
    stripe_user_id,
    stripe_access_token_encrypted,
    stripe_livemode,
    is_active,
    is_default
  ) VALUES (
    v_merchant_a,
    'tenant-a',
    'stripe',
    'acct_isolated',
    'SECRET_TOKEN_MUST_NOT_PROJECT',
    true,
    true,
    true
  );

  -- These rows deliberately disagree on merchant and location. Projection
  -- functions must require both dimensions and never expose either row.
  INSERT INTO processor_configs (
    merchant_id,
    location_id,
    processor_type,
    nmi_processor_id,
    nmi_security_key_encrypted,
    is_active
  ) VALUES (
    v_merchant_a,
    'tenant-b',
    'nmi',
    'poisoned-processor',
    'POISONED_PROCESSOR_SECRET',
    true
  );

  INSERT INTO evidence_connections (
    merchant_id,
    location_id,
    public_id,
    name,
    source_label,
    connection_type,
    status,
    health_status,
    setup_status,
    provider_key,
    mapping_config
  ) VALUES (
    v_merchant_a,
    'tenant-b',
    'poisoned-connection',
    'Poisoned connection',
    'Poisoned source',
    'provider_adapter',
    'active',
    'healthy',
    'active',
    'zoom',
    '{"secret":"POISONED_CONNECTION_SECRET"}'::JSONB
  );

  INSERT INTO reseller_merchant_assignments (
    reseller_organization_id,
    location_id,
    merchant_id,
    assigned_by_operator_user_id,
    reason
  ) VALUES (
    v_reseller_org_id,
    'tenant-a',
    v_merchant_a,
    v_owner_user_id,
    'Isolated migration verification'
  );

  v_result := list_operator_merchants_page(p_limit => 50, p_offset => 0);
  IF (v_result->>'total')::INTEGER <> 10002
     OR jsonb_array_length(v_result->'items') <> 50 THEN
    RAISE EXCEPTION 'Exact merchant pagination assertion failed: %', v_result;
  END IF;

  v_result := list_operator_merchants_page(p_query => 'Literal %');
  IF (v_result->>'total')::INTEGER <> 1
     OR v_result#>>'{items,0,location_id}' <> 'tenant-a' THEN
    RAISE EXCEPTION 'Literal percent filter assertion failed: %', v_result;
  END IF;

  v_result := list_operator_merchants_page(p_query => 'Literal _');
  IF (v_result->>'total')::INTEGER <> 1
     OR v_result#>>'{items,0,location_id}' <> 'tenant-b' THEN
    RAISE EXCEPTION 'Literal underscore filter assertion failed: %', v_result;
  END IF;

  v_result := list_operator_merchants_page(p_plan => 'wholepay');
  IF (v_result->>'total')::INTEGER <> 1
     OR v_result#>>'{items,0,location_id}' <> 'tenant-b' THEN
    RAISE EXCEPTION 'Plan filter assertion failed: %', v_result;
  END IF;

  v_result := list_operator_merchants_page(p_processor => 'stripe');
  IF (v_result->>'total')::INTEGER <> 1
     OR v_result#>>'{items,0,location_id}' <> 'tenant-a' THEN
    RAISE EXCEPTION 'Processor filter assertion failed: %', v_result;
  END IF;

  v_result := list_operator_merchants_page(
    p_reseller => v_reseller_org_id::TEXT
  );
  IF (v_result->>'total')::INTEGER <> 1
     OR v_result#>>'{items,0,location_id}' <> 'tenant-a' THEN
    RAISE EXCEPTION 'Reseller filter assertion failed: %', v_result;
  END IF;

  v_result := get_operator_merchant_detail('tenant-a');
  IF jsonb_array_length(v_result->'processors') <> 1
     OR v_result#>>'{processors,0,type}' <> 'stripe'
     OR v_result::TEXT LIKE '%SECRET_TOKEN_MUST_NOT_PROJECT%' THEN
    RAISE EXCEPTION 'Sanitized merchant detail assertion failed: %', v_result;
  END IF;

  v_result := get_operator_merchant_detail('tenant-b');
  IF jsonb_array_length(v_result->'processors') <> 0
     OR jsonb_array_length(v_result->'connectors') <> 0
     OR v_result::TEXT LIKE '%POISONED_%' THEN
    RAISE EXCEPTION 'Cross-tenant merchant detail assertion failed: %', v_result;
  END IF;

  v_result := get_operator_platform_summary(false);
  IF (v_result->>'merchant_count')::INTEGER <> 10002
     OR jsonb_array_length(v_result->'merchant_attention') <> 0 THEN
    RAISE EXCEPTION 'Platform summary assertion failed: %', v_result;
  END IF;

  v_result := list_operator_resellers_page();
  IF (v_result->>'total')::INTEGER <> 1
     OR (v_result#>>'{items,0,active_staff_count}')::INTEGER <> 2
     OR (v_result#>>'{items,0,active_merchant_count}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'Reseller aggregate assertion failed: %', v_result;
  END IF;

  BEGIN
    PERFORM list_operator_merchants_page(p_limit => 201);
    RAISE EXCEPTION 'Invalid merchant page request unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Invalid operator merchant page request' THEN
        RAISE;
      END IF;
  END;

  v_started_at := clock_timestamp();
  PERFORM list_operator_merchants_page(
    p_limit => 200,
    p_offset => 9800,
    p_query => 'Scale Merchant'
  );
  v_elapsed_ms := extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000;
  IF v_elapsed_ms > 5000 THEN
    RAISE EXCEPTION '10,000-merchant page exceeded budget: % ms', v_elapsed_ms;
  END IF;

  RAISE NOTICE 'MIGRATION_110_BEHAVIOR_VERIFIED scale_page_ms=%', v_elapsed_ms;
END;
$verify$;

SELECT
  'MIGRATION_110_BEHAVIOR_VERIFIED' AS result,
  scalesafe_schema_version() AS schema_version;
