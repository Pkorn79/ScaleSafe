-- Read-only preflight/postflight. No credential values or client records are selected.
-- Run only in ScaleSafe Enrollments project zddyagfotdtfbcdursqu. Never replay 107-112.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT jsonb_pretty(jsonb_build_object(
  'read_only', current_setting('transaction_read_only'),
  'schema_version', public.scalesafe_schema_version(),
  'merchant_count', (SELECT count(*) FROM public.merchants),
  'merchant_rls', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.merchants'::regclass),
  'merchant_columns', (SELECT jsonb_object_agg(column_name, data_type || ':' || is_generated)
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'merchants'),
  'merchant_constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
    FROM pg_constraint WHERE conrelid = 'public.merchants'::regclass),
  'merchant_triggers', (SELECT jsonb_agg(jsonb_build_object('definition', pg_get_triggerdef(t.oid),
    'function', pg_get_functiondef(t.tgfoid), 'enabled', t.tgenabled) ORDER BY t.tgname)
    FROM pg_trigger t WHERE t.tgrelid = 'public.merchants'::regclass AND NOT t.tgisinternal),
  'search_rpc', (SELECT jsonb_build_object('signature', pg_get_function_identity_arguments(p.oid),
    'returns', pg_get_function_result(p.oid), 'security_definer', p.prosecdef,
    'definition_md5', md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')),
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'service_execute', has_function_privilege('service_role', p.oid, 'EXECUTE'))
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text)')),
  'merchant_grants', (SELECT jsonb_object_agg(role_name, jsonb_build_object(
    'select', has_table_privilege(role_name, 'public.merchants', 'SELECT'),
    'insert', has_table_privilege(role_name, 'public.merchants', 'INSERT'),
    'update', has_table_privilege(role_name, 'public.merchants', 'UPDATE'),
    'delete', has_table_privilege(role_name, 'public.merchants', 'DELETE')))
    FROM unnest(ARRAY['anon','authenticated','service_role']) AS role_name),
  'search_dependencies', (SELECT jsonb_object_agg(table_name, columns) FROM (
    SELECT table_name, jsonb_object_agg(column_name, data_type) AS columns FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('merchant_health_rollups','processor_configs',
      'whop_configs','reseller_merchant_assignments','operator_organizations') GROUP BY table_name) AS dependencies),
  'protected_fields_md5', (SELECT md5(COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'location_id', location_id, 'company_id', company_id, 'business_name', business_name,
    'support_email', support_email, 'dba_name', dba_name, 'status', status,
    'marketplace_plan_id', marketplace_plan_id, 'marketplace_plan_key', marketplace_plan_key,
    'marketplace_billing_status', marketplace_billing_status,
    'test_access_approved_at', test_access_approved_at, 'test_access_approved_by', test_access_approved_by,
    'test_access_revoked_at', test_access_revoked_at, 'test_access_note', test_access_note,
    'wholepay_approved_at', wholepay_approved_at, 'wholepay_approved_by', wholepay_approved_by,
    'wholepay_approval_revoked_at', wholepay_approval_revoked_at,
    'wholepay_merchant_reference', wholepay_merchant_reference) ORDER BY location_id)::text, '[]'))
    FROM public.merchants),
  'installations', (SELECT jsonb_agg(jsonb_build_object('location_id', location_id,
    'business_name', business_name, 'company_id', company_id, 'status', status, 'snapshot_status', snapshot_status,
    'scope', config->>'ghl_token_scope',
    'has_access', COALESCE(NULLIF(ghl_access_token_encrypted,''),NULLIF(ghl_access_token,'')) IS NOT NULL,
    'has_refresh', COALESCE(NULLIF(ghl_refresh_token_encrypted,''),NULLIF(ghl_refresh_token,'')) IS NOT NULL,
    'has_location_scope', COALESCE(ghl_scopes ~ '(^|[[:space:]])locations[.]readonly($|[[:space:]])',false))
    ORDER BY location_id) FROM public.merchants)
)) AS identity_release_check;
ROLLBACK;
