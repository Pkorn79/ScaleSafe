\set ON_ERROR_STOP on

-- ISOLATED DATABASE ONLY.
-- The shell wrapper rejects non-loopback database URLs. This script also
-- refuses a database containing merchants and rolls every synthetic write back.

BEGIN;
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF scalesafe_schema_version() <> 108 THEN
    RAISE EXCEPTION 'Expected schema 108';
  END IF;
  IF EXISTS (SELECT 1 FROM merchants) THEN
    RAISE EXCEPTION 'Behavior verification requires an empty isolated merchant table';
  END IF;
END;
$$;

DO $$
DECLARE
  v_first_completed_at TIMESTAMPTZ := clock_timestamp() - interval '2 minutes';
  v_throttled_completed_at TIMESTAMPTZ := v_first_completed_at + interval '59 seconds';
  v_second_completed_at TIMESTAMPTZ := v_first_completed_at + interval '1 minute';
  v_heartbeat service_heartbeats%ROWTYPE;
BEGIN
  PERFORM record_service_heartbeat(
    'worker.money_reconciliation',
    'phase2-heartbeat-boundary',
    'healthy',
    v_first_completed_at - interval '10 milliseconds',
    v_first_completed_at,
    10,
    0,
    NULL,
    NULL
  );

  SELECT * INTO v_heartbeat
  FROM record_service_heartbeat(
    'worker.money_reconciliation',
    'phase2-heartbeat-boundary',
    'healthy',
    v_throttled_completed_at - interval '10 milliseconds',
    v_throttled_completed_at,
    10,
    0,
    NULL,
    NULL
  );

  IF v_heartbeat.last_completed_at <> v_first_completed_at THEN
    RAISE EXCEPTION 'Money heartbeat inside one minute was not throttled';
  END IF;

  SELECT * INTO v_heartbeat
  FROM record_service_heartbeat(
    'worker.money_reconciliation',
    'phase2-heartbeat-boundary',
    'healthy',
    v_second_completed_at - interval '10 milliseconds',
    v_second_completed_at,
    10,
    0,
    NULL,
    NULL
  );

  IF v_heartbeat.last_completed_at <> v_second_completed_at THEN
    RAISE EXCEPTION 'One-minute money heartbeat was incorrectly throttled';
  END IF;

  DELETE FROM service_heartbeats
  WHERE worker_key = 'worker.money_reconciliation';
END;
$$;

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
  'cc-behavior-' || merchant_number,
  'Command Center Behavior Merchant ' || merchant_number,
  'active',
  'installed',
  true,
  'standard',
  'complete'
FROM generate_series(1, 3) AS merchant_number;

INSERT INTO auth.users (id)
VALUES ('10000000-0000-4000-8000-000000000001');

INSERT INTO operator_users (
  id,
  auth_user_id,
  email_normalized,
  display_name,
  status
) VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'phase2-operator@scalesafe.test',
  'Phase 2 Operator',
  'active'
);

INSERT INTO operator_memberships (
  id,
  organization_id,
  operator_user_id,
  role,
  status
)
SELECT
  '10000000-0000-4000-8000-000000000003',
  organization.id,
  '10000000-0000-4000-8000-000000000002',
  'platform_owner',
  'active'
FROM operator_organizations organization
WHERE organization.organization_type = 'platform';

INSERT INTO operator_sessions (
  id,
  session_token_hash,
  csrf_token_hash,
  operator_user_id,
  organization_id,
  membership_id,
  auth_assurance,
  idle_expires_at,
  absolute_expires_at
)
SELECT
  '10000000-0000-4000-8000-000000000004',
  repeat('a', 64),
  repeat('b', 64),
  '10000000-0000-4000-8000-000000000002',
  membership.organization_id,
  membership.id,
  'aal2',
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '8 hours'
FROM operator_memberships membership
WHERE membership.id = '10000000-0000-4000-8000-000000000003';

DO $$
DECLARE
  v_context RECORD;
BEGIN
  SELECT * INTO v_context
  FROM resolve_operator_session_context(repeat('a', 64));

  IF v_context.session_id <> '10000000-0000-4000-8000-000000000004'
     OR v_context.membership_role <> 'platform_owner'
     OR v_context.location_access_mode <> 'all'
     OR COALESCE(array_length(v_context.location_ids, 1), 0) <> 0 THEN
    RAISE EXCEPTION 'Consolidated operator session resolution failed';
  END IF;
END;
$$;

DO $$
DECLARE
  v_merchant_id UUID;
  v_rejected BOOLEAN := false;
BEGIN
  SELECT id INTO v_merchant_id
  FROM merchants
  WHERE location_id = 'cc-behavior-1';

  BEGIN
    PERFORM *
    FROM record_health_observation(
      'merchant',
      'cc-behavior-wrong-tenant',
      'cc-behavior-2',
      v_merchant_id,
      'merchant.evidence_connection',
      'unhealthy',
      'warning',
      'EVIDENCE_STALE',
      'Synthetic tenant-binding rejection.',
      '{}'::jsonb,
      clock_timestamp()
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_rejected := SQLERRM LIKE '%does not match location%';
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-tenant merchant observation was not rejected';
  END IF;
END;
$$;

DO $$
DECLARE
  v_merchant RECORD;
  v_merchant_id UUID;
  v_parent_id UUID;
  v_parent_count INTEGER;
  v_linked_children INTEGER;
  v_money_parent UUID;
BEGIN
  FOR v_merchant IN
    SELECT id, location_id
    FROM merchants
    ORDER BY location_id
  LOOP
    PERFORM *
    FROM record_health_observation(
      'merchant',
      v_merchant.location_id,
      v_merchant.location_id,
      v_merchant.id,
      'merchant.trigger_delivery',
      'unhealthy',
      'warning',
      'GHL_TRIGGER_DELIVERY_FAILED',
      'Synthetic shared GHL delivery failure.',
      jsonb_build_object('provider', 'ghl', 'attempt', 1),
      clock_timestamp() - interval '1 minute'
    );
  END LOOP;

  SELECT id INTO v_merchant_id
  FROM merchants
  WHERE location_id = 'cc-behavior-1';

  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-1',
    'cc-behavior-1',
    v_merchant_id,
    'merchant.money_outcome',
    'unhealthy',
    'critical',
    'WRONG_MONEY_OUTCOME',
    'Synthetic protected money-integrity incident.',
    '{"provider":"stripe"}'::jsonb,
    clock_timestamp()
  );

  PERFORM reconcile_command_center_provider_incidents();
  PERFORM reconcile_command_center_provider_incidents();

  SELECT count(*)::integer
  INTO v_parent_count
  FROM platform_incidents
  WHERE scope_type = 'provider'
    AND scope_id = 'ghl'
    AND check_key = 'provider.ghl'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed');

  SELECT id INTO v_parent_id
  FROM platform_incidents
  WHERE scope_type = 'provider'
    AND scope_id = 'ghl'
    AND check_key = 'provider.ghl'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
  LIMIT 1;

  SELECT count(*)::integer INTO v_linked_children
  FROM platform_incidents
  WHERE scope_type = 'merchant'
    AND check_key = 'merchant.trigger_delivery'
    AND parent_incident_id = v_parent_id;

  SELECT parent_incident_id INTO v_money_parent
  FROM platform_incidents
  WHERE scope_type = 'merchant'
    AND scope_id = 'cc-behavior-1'
    AND check_key = 'merchant.money_outcome'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed');

  IF v_parent_count <> 1 OR v_parent_id IS NULL OR v_linked_children <> 3 THEN
    RAISE EXCEPTION
      'Provider grouping failed: parents %, linked children %',
      v_parent_count,
      v_linked_children;
  END IF;
  IF v_money_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Protected money-integrity incident was linked to a provider parent';
  END IF;
END;
$$;

DO $$
DECLARE
  v_merchant_id UUID;
  v_incident_id UUID;
  v_active_count INTEGER;
  v_occurrence_count INTEGER;
  v_severity TEXT;
  v_status TEXT;
  v_event_types TEXT[];
  v_history_id UUID;
  v_history_rejected BOOLEAN := false;
BEGIN
  SELECT id INTO v_merchant_id
  FROM merchants
  WHERE location_id = 'cc-behavior-2';

  SELECT incident_id INTO v_incident_id
  FROM record_health_observation(
    'merchant',
    'cc-behavior-recovery',
    'cc-behavior-2',
    v_merchant_id,
    'merchant.evidence_connection',
    'unhealthy',
    'warning',
    'EVIDENCE_STALE',
    'Synthetic evidence connection failure.',
    '{"attempt":1}'::jsonb,
    clock_timestamp() - interval '20 minutes'
  );

  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-recovery',
    'cc-behavior-2',
    v_merchant_id,
    'merchant.evidence_connection',
    'unhealthy',
    'urgent',
    'EVIDENCE_STALE',
    'Synthetic evidence connection failure.',
    '{"attempt":2}'::jsonb,
    clock_timestamp() - interval '19 minutes'
  );

  SELECT count(*)::integer
  INTO v_active_count
  FROM platform_incidents
  WHERE scope_type = 'merchant'
    AND scope_id = 'cc-behavior-recovery'
    AND check_key = 'merchant.evidence_connection'
    AND failure_class = 'EVIDENCE_STALE'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed');

  SELECT occurrence_count, severity
  INTO v_occurrence_count, v_severity
  FROM platform_incidents
  WHERE scope_type = 'merchant'
    AND scope_id = 'cc-behavior-recovery'
    AND check_key = 'merchant.evidence_connection'
    AND failure_class = 'EVIDENCE_STALE'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
  LIMIT 1;

  IF v_active_count <> 1 OR v_occurrence_count <> 2 OR v_severity <> 'urgent' THEN
    RAISE EXCEPTION
      'Incident dedupe/escalation failed: active %, occurrences %, severity %',
      v_active_count,
      v_occurrence_count,
      v_severity;
  END IF;

  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-recovery',
    'cc-behavior-2',
    v_merchant_id,
    'merchant.evidence_connection',
    'healthy',
    NULL,
    NULL,
    'Synthetic evidence connection recovered.',
    '{}'::jsonb,
    clock_timestamp() - interval '11 minutes'
  );
  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-recovery',
    'cc-behavior-2',
    v_merchant_id,
    'merchant.evidence_connection',
    'healthy',
    NULL,
    NULL,
    'Synthetic evidence connection recovered.',
    '{}'::jsonb,
    clock_timestamp() - interval '5 minutes'
  );
  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-recovery',
    'cc-behavior-2',
    v_merchant_id,
    'merchant.evidence_connection',
    'healthy',
    NULL,
    NULL,
    'Synthetic evidence connection recovered.',
    '{}'::jsonb,
    clock_timestamp()
  );

  SELECT status INTO v_status
  FROM platform_incidents
  WHERE id = v_incident_id;

  SELECT array_agg(event_type ORDER BY occurred_at, id)
  INTO v_event_types
  FROM incident_events
  WHERE incident_id = v_incident_id;

  IF v_status <> 'resolved'
     OR NOT (v_event_types @> ARRAY['opened', 'recovery_started', 'resolved']::TEXT[]) THEN
    RAISE EXCEPTION
      'Recovery history failed: status %, events %',
      v_status,
      v_event_types;
  END IF;

  SELECT id INTO v_history_id
  FROM health_observations
  WHERE scope_type = 'merchant'
    AND scope_id = 'cc-behavior-recovery'
  ORDER BY observed_at
  LIMIT 1;

  BEGIN
    UPDATE health_observations
    SET summary = 'This update must be rejected.'
    WHERE id = v_history_id;
  EXCEPTION
    WHEN OTHERS THEN
      v_history_rejected := SQLERRM LIKE '%append-only%';
  END;

  IF NOT v_history_rejected THEN
    RAISE EXCEPTION 'Health observation history was mutable';
  END IF;
END;
$$;

DO $$
DECLARE
  v_merchant_id UUID;
  v_incident_id UUID;
  v_status TEXT;
  v_expiry_events INTEGER;
BEGIN
  SELECT id INTO v_merchant_id
  FROM merchants
  WHERE location_id = 'cc-behavior-3';

  SELECT incident_id INTO v_incident_id
  FROM record_health_observation(
    'merchant',
    'cc-behavior-suppression',
    'cc-behavior-3',
    v_merchant_id,
    'merchant.defense',
    'unhealthy',
    'warning',
    'DEFENSE_TEST_FAILURE',
    'Synthetic suppression expiry failure.',
    '{"attempt":1}'::jsonb,
    clock_timestamp() - interval '1 minute'
  );

  PERFORM suppress_platform_incident(
    v_incident_id,
    '10000000-0000-4000-8000-000000000002',
    'Synthetic bounded suppression.',
    clock_timestamp() + interval '1 second'
  );

  -- This unchanged observation would take the fast path unless suppression
  -- expiry is processed before unchanged-state return.
  PERFORM *
  FROM record_health_observation(
    'merchant',
    'cc-behavior-suppression',
    'cc-behavior-3',
    v_merchant_id,
    'merchant.defense',
    'unhealthy',
    'warning',
    'DEFENSE_TEST_FAILURE',
    'Synthetic suppression expiry failure.',
    '{"attempt":1}'::jsonb,
    clock_timestamp() + interval '2 seconds'
  );

  SELECT status INTO v_status
  FROM platform_incidents
  WHERE id = v_incident_id;

  SELECT count(*)::integer INTO v_expiry_events
  FROM incident_events
  WHERE incident_id = v_incident_id
    AND event_type = 'suppression_expired';

  IF v_status <> 'open' OR v_expiry_events <> 1 THEN
    RAISE EXCEPTION
      'Suppression expiry fast-path fix failed: status %, events %',
      v_status,
      v_expiry_events;
  END IF;
END;
$$;

DO $$
DECLARE
  v_run scheduled_job_runs%ROWTYPE;
BEGIN
  -- Simulate an unavailable/disabled health contract for a merchant-facing
  -- job. Operational scheduling must remain available from its own registry.
  UPDATE health_check_definitions
  SET active = false
  WHERE check_key = 'job.provisioning_recovery';

  SELECT * INTO v_run
  FROM claim_scheduled_job_run(
    'job.provisioning_recovery',
    date_trunc('hour', clock_timestamp()) + interval '17 minutes',
    date_trunc('hour', clock_timestamp()) + interval '22 minutes',
    'phase2-fault-containment-worker',
    300,
    3
  );

  IF v_run.id IS NULL OR v_run.status <> 'running' THEN
    RAISE EXCEPTION
      'Operational job claim failed while health contract was disabled';
  END IF;

  PERFORM complete_scheduled_job_run(
    v_run.id,
    'phase2-fault-containment-worker',
    'succeeded',
    1,
    0,
    0,
    NULL,
    NULL,
    '{"health_engine_disabled":true}'::jsonb
  );

  UPDATE health_check_definitions
  SET active = true
  WHERE check_key = 'job.provisioning_recovery';
END;
$$;

DO $$
DECLARE
  v_timed_out scheduled_job_runs%ROWTYPE;
  v_settled scheduled_job_runs%ROWTYPE;
  v_recovered scheduled_job_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_timed_out
  FROM claim_scheduled_job_run(
    'job.payment_reminder_check',
    date_trunc('hour', clock_timestamp()) + interval '23 minutes',
    date_trunc('hour', clock_timestamp()) + interval '24 minutes',
    'phase2-timeout-worker',
    30,
    3
  );

  SELECT * INTO v_timed_out
  FROM complete_scheduled_job_run(
    v_timed_out.id,
    'phase2-timeout-worker',
    'timed_out',
    0,
    0,
    0,
    'JOB_TIMEOUT',
    'Synthetic timeout.',
    '{}'::jsonb
  );

  SELECT * INTO v_settled
  FROM settle_timed_out_scheduled_job_run(
    v_timed_out.id,
    'phase2-timeout-worker',
    'completed'
  );

  SELECT * INTO v_recovered
  FROM claim_scheduled_job_run(
    'job.payment_reminder_check',
    date_trunc('hour', clock_timestamp()) + interval '24 minutes',
    date_trunc('hour', clock_timestamp()) + interval '25 minutes',
    'phase2-timeout-worker',
    30,
    3
  );

  IF v_timed_out.status <> 'timed_out'
     OR v_settled.status <> 'exhausted'
     OR v_settled.result_summary->>'late_outcome' <> 'completed'
     OR v_recovered.status <> 'running' THEN
    RAISE EXCEPTION
      'Timeout quarantine or next-window recovery failed: timeout %, settled %, recovered %',
      v_timed_out.status,
      v_settled.status,
      v_recovered.status;
  END IF;

  PERFORM complete_scheduled_job_run(
    v_recovered.id,
    'phase2-timeout-worker',
    'succeeded',
    1,
    0,
    0,
    NULL,
    NULL,
    '{"recovered_after_timeout":true}'::jsonb
  );
END;
$$;

DO $$
DECLARE
  v_incident_id UUID;
  v_incident_status TEXT;
  v_event_types TEXT[];
BEGIN
  PERFORM record_service_heartbeat(
    'worker.trigger_delivery',
    'phase2-worker-recovery',
    'failed',
    clock_timestamp() - interval '2 minutes 1 second',
    clock_timestamp() - interval '2 minutes',
    1000,
    0,
    'SYNTHETIC_WORKER_FAILURE',
    'Synthetic worker failure.'
  );
  UPDATE service_heartbeats
  SET
    last_completed_at = clock_timestamp(),
    state_changed_at = clock_timestamp() - interval '20 minutes'
  WHERE worker_key = 'worker.trigger_delivery';

  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);

  SELECT id INTO v_incident_id
  FROM platform_incidents
  WHERE scope_type = 'worker'
    AND scope_id = 'worker.trigger_delivery'
    AND check_key = 'worker.trigger_delivery'
    AND failure_class = 'SYNTHETIC_WORKER_FAILURE'
    AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed');

  IF v_incident_id IS NULL THEN
    RAISE EXCEPTION 'Worker failure did not create an incident';
  END IF;

  PERFORM record_service_heartbeat(
    'worker.trigger_delivery',
    'phase2-worker-recovery',
    'healthy',
    clock_timestamp(),
    clock_timestamp(),
    10,
    1,
    NULL,
    NULL
  );
  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);
  UPDATE platform_incidents
  SET recovery_candidate_at = clock_timestamp() - interval '11 minutes'
  WHERE id = v_incident_id;
  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);
  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);

  SELECT status INTO v_incident_status
  FROM platform_incidents
  WHERE id = v_incident_id;
  SELECT array_agg(event_type ORDER BY occurred_at)
  INTO v_event_types
  FROM incident_events
  WHERE incident_id = v_incident_id;

  IF v_incident_status <> 'resolved'
     OR NOT ('recovery_started' = ANY(v_event_types))
     OR NOT ('resolved' = ANY(v_event_types)) THEN
    RAISE EXCEPTION
      'Worker recovery did not resolve incident: status %, events %',
      v_incident_status,
      v_event_types;
  END IF;
END;
$$;

DO $$
DECLARE
  v_run_id UUID;
  v_first RECORD;
  v_second RECORD;
  v_final scheduled_job_runs%ROWTYPE;
BEGIN
  SELECT id INTO v_run_id
  FROM claim_scheduled_job_run(
    'job.merchant_health_full_sweep',
    date_trunc('day', clock_timestamp()),
    date_trunc('day', clock_timestamp()) + interval '1 day',
    'phase2-behavior-worker',
    2100,
    3
  );

  SELECT * INTO v_first
  FROM reconcile_command_center_full_sweep_batch(
    v_run_id,
    'phase2-behavior-worker',
    2
  );
  SELECT * INTO v_second
  FROM reconcile_command_center_full_sweep_batch(
    v_run_id,
    'phase2-behavior-worker',
    2
  );

  SELECT * INTO v_final
  FROM complete_scheduled_job_run(
    v_run_id,
    'phase2-behavior-worker',
    'succeeded',
    v_second.total_processed,
    0,
    0,
    NULL,
    NULL,
    '{"verified":true}'::jsonb
  );

  IF v_first.processed_in_batch <> 2
     OR v_first.complete
     OR v_second.processed_in_batch <> 1
     OR NOT v_second.complete
     OR v_second.total_processed <> 3
     OR v_final.processed_count <> 3
     OR v_final.result_summary->>'full_sweep_complete' <> 'true'
     OR v_final.result_summary->>'verified' <> 'true' THEN
    RAISE EXCEPTION
      'Full-sweep checkpoint failed: first %, second %, final %',
      row_to_json(v_first),
      row_to_json(v_second),
      row_to_json(v_final);
  END IF;
END;
$$;

DO $$
DECLARE
  v_check_key TEXT;
  v_state TEXT;
  v_severity TEXT;
BEGIN
  DELETE FROM scheduled_job_runs
  WHERE job_key IN (
    'job.daily_account_health',
    'job.pif_completion_check',
    'job.merchant_health_full_sweep'
  );

  UPDATE health_check_definitions
  SET created_at = clock_timestamp() - interval '31 hours'
  WHERE check_key IN (
    'job.daily_account_health',
    'job.pif_completion_check',
    'job.merchant_health_full_sweep'
  );

  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);

  FOR v_check_key IN
    SELECT unnest(ARRAY[
      'job.daily_account_health',
      'job.pif_completion_check',
      'job.merchant_health_full_sweep'
    ])
  LOOP
    SELECT state, severity INTO v_state, v_severity
    FROM health_current
    WHERE scope_type = 'job'
      AND scope_id = v_check_key
      AND check_key = v_check_key;
    IF v_state <> 'degraded' OR v_severity <> 'warning' THEN
      RAISE EXCEPTION
        'Daily job warning threshold failed for %: state %, severity %',
        v_check_key,
        v_state,
        v_severity;
    END IF;
  END LOOP;

  UPDATE health_check_definitions
  SET created_at = clock_timestamp() - interval '49 hours'
  WHERE check_key IN (
    'job.daily_account_health',
    'job.pif_completion_check',
    'job.merchant_health_full_sweep'
  );

  PERFORM *
  FROM evaluate_command_center_global_health(108, 110, 'production', ARRAY[]::TEXT[]);

  FOR v_check_key IN
    SELECT unnest(ARRAY[
      'job.daily_account_health',
      'job.pif_completion_check',
      'job.merchant_health_full_sweep'
    ])
  LOOP
    SELECT state, severity INTO v_state, v_severity
    FROM health_current
    WHERE scope_type = 'job'
      AND scope_id = v_check_key
      AND check_key = v_check_key;
    IF v_state <> 'unhealthy' OR v_severity <> 'urgent' THEN
      RAISE EXCEPTION
        'Daily job urgent threshold failed for %: state %, severity %',
        v_check_key,
        v_state,
        v_severity;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_first JSONB;
  v_second JSONB;
  v_cursor JSONB;
  v_first_ids UUID[];
  v_second_ids UUID[];
BEGIN
  SELECT get_command_center_platform_overview(2)
  INTO v_first;
  v_cursor := v_first->'next'->'checks';

  IF jsonb_array_length(v_first->'checks') <> 2 OR v_cursor IS NULL THEN
    RAISE EXCEPTION 'Overview first page did not return a bounded cursor';
  END IF;

  SELECT get_command_center_platform_overview(
    2,
    (v_cursor->>'lastObservedAt')::timestamptz,
    (v_cursor->>'id')::uuid
  )
  INTO v_second;

  SELECT array_agg((item->>'id')::uuid)
  INTO v_first_ids
  FROM jsonb_array_elements(v_first->'checks') item;
  SELECT array_agg((item->>'id')::uuid)
  INTO v_second_ids
  FROM jsonb_array_elements(v_second->'checks') item;

  IF v_first_ids && v_second_ids THEN
    RAISE EXCEPTION 'Overview cursor returned duplicate health rows';
  END IF;
END;
$$;

ROLLBACK;
