-- Read-only catalog gate for the proposed 106 -> 111 rollout.
-- Run on the confirmed ScaleSafe database, before and after migration.
-- This does not apply SQL changes, inspect customer rows, or replace the live-schema comparison.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $check$
DECLARE
  v_version INTEGER := public.scalesafe_schema_version();
  v_name TEXT;
  v_relation REGCLASS;
  v_function RECORD;
  v_tables TEXT[] := ARRAY[
    'operator_organizations', 'operator_users', 'operator_memberships',
    'reseller_merchant_assignments', 'operator_support_grants', 'operator_invitations',
    'operator_auth_attempts', 'operator_sessions', 'operator_audit_events',
    'operator_rate_limit_buckets', 'health_check_definitions', 'service_heartbeats',
    'scheduled_job_definitions', 'scheduled_job_runs', 'health_current',
    'health_observations', 'merchant_health_rollups', 'platform_incidents',
    'incident_events', 'health_dirty_scopes', 'application_metric_buckets',
    'guardian_credentials', 'guardian_check_catalog', 'guardian_check_metric_catalog',
    'guardian_credential_check_keys', 'guardian_ingestion_receipts', 'guardian_runs',
    'guardian_observations', 'guardian_rate_limit_buckets', 'alert_routes',
    'alert_deliveries', 'recovery_verifications'
  ];
  v_functions TEXT[] := ARRAY[
    'validate_operator_membership', 'operator_user_has_active_role',
    'validate_operator_invitation', 'validate_reseller_assignment',
    'validate_operator_support_grant', 'prevent_operator_audit_mutation',
    'consume_operator_rate_limit', 'record_operator_auth_attempt_failure',
    'create_operator_reseller_organization', 'request_operator_support_grant',
    'approve_operator_support_grant', 'revoke_operator_support_grant',
    'transfer_primary_reseller_assignment', 'claim_operator_invitation',
    'release_operator_invitation', 'complete_operator_invitation',
    'complete_operator_auth_attempt', 'revoke_current_operator_session',
    'bootstrap_platform_owner', 'command_center_database_canary',
    'record_service_heartbeat', 'claim_scheduled_job_run', 'complete_scheduled_job_run',
    'settle_timed_out_scheduled_job_run', 'record_health_observation',
    'reconcile_command_center_provider_incidents', 'evaluate_command_center_global_health',
    'acknowledge_platform_incident', 'suppress_platform_incident', 'mark_health_dirty',
    'claim_health_dirty_scopes', 'complete_health_dirty_scope',
    'reconcile_command_center_merchant_incidents', 'reconcile_command_center_merchant_health',
    'reconcile_command_center_full_sweep_batch', 'reconcile_command_center_dirty_health',
    'run_command_center_retention', 'resolve_operator_session_context',
    'get_command_center_platform_overview', 'list_command_center_incidents_page',
    'validate_command_center_tenant_binding', 'prevent_command_center_history_mutation',
    'validate_guardian_credential', 'prevent_guardian_history_mutation',
    'claim_guardian_request', 'run_guardian_retention', 'list_operator_merchants_page',
    'get_operator_platform_summary', 'get_operator_merchant_detail',
    'list_operator_resellers_page'
  ];
BEGIN
  IF v_version NOT IN (106, 111) OR v_version IS NULL THEN
    RAISE EXCEPTION 'Unexpected schema version %. Stop and reconcile the release bundle.', v_version;
  END IF;

  FOREACH v_name IN ARRAY v_tables LOOP
    v_relation := to_regclass(format('public.%I', v_name));
    IF v_version = 106 THEN
      IF v_relation IS NOT NULL THEN
        RAISE EXCEPTION 'Pre-existing Command Center relation %. Compare its schema before migration.', v_name;
      END IF;
    ELSE
      IF v_relation IS NULL THEN
        RAISE EXCEPTION 'Required Command Center table % is missing.', v_name;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = v_relation AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity
      ) THEN
        RAISE EXCEPTION 'Required forced RLS is missing on %.', v_name;
      END IF;
      IF has_table_privilege('anon', v_relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege('authenticated', v_relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR NOT has_table_privilege('service_role', v_relation, 'SELECT') THEN
        RAISE EXCEPTION 'Unexpected table access on %.', v_name;
      END IF;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY v_functions LOOP
    IF v_version = 106 THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_name) THEN
        RAISE EXCEPTION 'Pre-existing Command Center function %. Compare its definition before migration.', v_name;
      END IF;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_name) <> 1 THEN
      RAISE EXCEPTION 'Missing or unexpected overloaded Command Center function %.', v_name;
    END IF;
    SELECT p.*, owner_role.rolbypassrls INTO v_function
    FROM pg_proc p JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name;
    IF has_function_privilege('anon', v_function.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
      OR (v_function.prorettype <> 'trigger'::regtype
          AND NOT has_function_privilege('service_role', v_function.oid, 'EXECUTE'))
      OR (v_function.prosecdef AND NOT v_function.rolbypassrls) THEN
      RAISE EXCEPTION 'Unexpected function access or forced-RLS owner on %.', v_name;
    END IF;
  END LOOP;

  IF v_version = 106 THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.efw_events'::regclass
        AND conname = 'efw_events_merchant_stripe_efw_id_key'
    ) THEN
      RAISE EXCEPTION 'Pre-existing migration 111 EFW constraint requires reconciliation.';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.efw_events'::regclass
      AND conname = 'efw_events_merchant_stripe_efw_id_key'
      AND pg_get_constraintdef(oid) = 'UNIQUE (merchant_id, stripe_efw_id)'
  ) THEN
    RAISE EXCEPTION 'Required migration 111 EFW integrity constraint is missing.';
  END IF;
END;
$check$;

SELECT public.scalesafe_schema_version() AS schema_version,
  CASE public.scalesafe_schema_version()
    WHEN 106 THEN 'COMMAND_CENTER_PRE_MIGRATION_CATALOG_PASSED'
    WHEN 111 THEN 'COMMAND_CENTER_POST_MIGRATION_CATALOG_PASSED'
  END AS result;
ROLLBACK;
