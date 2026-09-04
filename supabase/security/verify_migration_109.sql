\set ON_ERROR_STOP on

-- Rollback-only proof for schema 109 and its certified successors through 111.
BEGIN;

DO $verify$
DECLARE
  v_credential_id UUID;
  v_rotated_credential_id UUID;
  v_result RECORD;
  v_run JSONB := $json$
    {
      "protocol_version": 1,
      "instance_id": "00000000-0000-4000-8000-000000001001",
      "run_id": "00000000-0000-4000-8000-000000002001",
      "agent_version": "guardian-test/1.0.0",
      "started_at": "2026-07-25T16:59:58.000Z",
      "completed_at": "2026-07-25T17:00:00.000Z",
      "status": "complete",
      "observation_count": 3,
      "observations": [
        {
          "check_key": "public.api.reachability",
          "observed_at": "2026-07-25T16:59:59.500Z",
          "state": "healthy",
          "severity": "info",
          "failure_code": null,
          "summary_code": "CHECK_OK",
          "duration_ms": 143,
          "facts": {"http_status": 200}
        },
        {
          "check_key": "network.tls",
          "observed_at": "2026-07-25T16:59:59.750Z",
          "state": "healthy",
          "severity": "info",
          "failure_code": null,
          "summary_code": "CHECK_OK",
          "duration_ms": 81,
          "facts": {"days_remaining": 73}
        },
        {
          "check_key": "recovery.backup.status",
          "observed_at": "2026-07-25T16:59:59.900Z",
          "state": "unhealthy",
          "severity": "critical",
          "failure_code": "BACKUP_ATTEMPT_FAILED",
          "summary_code": "CHECK_UNHEALTHY",
          "duration_ms": 0,
          "facts": {"snapshot_age_hours": 40}
        }
      ]
    }
  $json$::jsonb;
  v_changed_run JSONB;
  v_recovery JSONB := $json$
    {
      "protocol_version": 1,
      "instance_id": "00000000-0000-4000-8000-000000001001",
      "verification_id": "00000000-0000-4000-8000-000000003001",
      "verification_type": "backup_status",
      "verified_at": "2026-07-25T17:00:00.000Z",
      "snapshot_id": "20260725T170000Z",
      "schema_version": 104,
      "object_count": 105,
      "encrypted_bytes": 21011034,
      "result": "healthy",
      "failure_code": null,
      "proof_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  $json$::jsonb;
  v_alert JSONB := $json$
    {
      "protocol_version": 1,
      "instance_id": "00000000-0000-4000-8000-000000001001",
      "delivery_id": "00000000-0000-4000-8000-000000004001",
      "alert_id": "00000000-0000-4000-8000-000000004101",
      "incident_id": "00000000-0000-4000-8000-000000004201",
      "provider_name": "ghl",
      "event_type": "opened",
      "check_key": "public.api.reachability",
      "severity": "critical",
      "attempt_number": 1,
      "state": "accepted",
      "occurred_at": "2026-07-25T17:00:00.000Z",
      "provider_reference_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "notification_channels": [],
      "failure_code": null,
      "envelope_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }
  $json$::jsonb;
  v_changed_alert JSONB;
  v_notification JSONB;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_proc function_definition
    JOIN pg_namespace namespace
      ON namespace.oid = function_definition.pronamespace
    JOIN pg_roles owner_role
      ON owner_role.oid = function_definition.proowner
    WHERE namespace.nspname = 'public'
      AND function_definition.proname IN (
        'claim_guardian_request',
        'run_guardian_retention'
      )
      AND function_definition.prosecdef
      AND owner_role.rolbypassrls
  ) <> 2 THEN
    RAISE EXCEPTION
      'Guardian SECURITY DEFINER functions do not bypass forced RLS';
  END IF;

  INSERT INTO guardian_credentials (
    key_id,
    instance_id,
    display_name,
    public_key,
    public_key_fingerprint,
    status,
    valid_from,
    activated_at,
    nonsecret_audit_reference
  ) VALUES (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000001001',
    'Migration 105 isolated test',
    decode(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      'hex'
    ),
    repeat('0', 64),
    'active',
    clock_timestamp() - interval '1 hour',
    clock_timestamp(),
    'migration-105-isolated-test'
  )
  RETURNING id INTO v_credential_id;

  INSERT INTO guardian_credential_check_keys (
    guardian_credential_id,
    check_key,
    nonsecret_audit_reference
  )
  SELECT
    v_credential_id,
    check_key,
    'migration-105-isolated-test'
  FROM guardian_check_catalog
  WHERE check_key IN (
    'platform.snapshot.freshness',
    'public.api.reachability',
    'network.tls',
    'recovery.backup.status'
  );

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    1::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/snapshot',
    'GET',
    clock_timestamp(),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    NULL::JSONB
  );
  IF v_result.decision <> 'accepted'
     OR v_result.accepted_sequence <> 1 THEN
    RAISE EXCEPTION 'Snapshot acceptance assertion failed: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    1::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/snapshot',
    'GET',
    clock_timestamp(),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    NULL::JSONB
  );
  IF v_result.decision <> 'duplicate'
     OR v_result.accepted_sequence <> 1 THEN
    RAISE EXCEPTION 'Exact retry assertion failed: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    2::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp(),
    '39569f5bbc2456dede91e0dd76d3df01fda1932771a284b046d426004ebdda50',
    v_run
  );
  IF v_result.decision <> 'accepted'
     OR v_result.accepted_observation_count <> 3 THEN
    RAISE EXCEPTION 'Run acceptance assertion failed: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    3::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp(),
    '39569f5bbc2456dede91e0dd76d3df01fda1932771a284b046d426004ebdda50',
    v_run
  );
  IF v_result.decision <> 'logical_duplicate'
     OR v_result.original_receipt_id IS NULL
     OR v_result.accepted_observation_count <> 3 THEN
    RAISE EXCEPTION 'Logical duplicate assertion failed: %', row_to_json(v_result);
  END IF;

  v_changed_run := jsonb_set(
    v_run,
    '{agent_version}',
    '"guardian-test/1.0.1"'::jsonb
  );
  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    4::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp(),
    'fb5d82e4174a024b69c3e9331fe4570723d9a2d4289b45bbc0f6a6fcb3911bb6',
    v_changed_run
  );
  IF v_result.decision <> 'rejected'
     OR v_result.rejection_code <> 'LOGICAL_ID_CONFLICT' THEN
    RAISE EXCEPTION 'Logical conflict assertion failed: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    4::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/recovery-verifications',
    'POST',
    clock_timestamp(),
    '45e213b2d2392305525ca2e754bfeecde9a61d8757c063df26be61a63b651802',
    v_recovery
  );
  IF v_result.decision <> 'accepted'
     OR v_result.accepted_sequence <> 4 THEN
    RAISE EXCEPTION 'Recovery acceptance assertion failed: %', row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    5::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/alert-deliveries',
    'POST',
    clock_timestamp(),
    repeat('c', 64),
    v_alert
  );
  IF v_result.decision <> 'accepted'
     OR v_result.accepted_sequence <> 5
     OR v_result.record_id IS NULL THEN
    RAISE EXCEPTION 'Alert delivery acceptance assertion failed: %',
      row_to_json(v_result);
  END IF;

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    6::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/alert-deliveries',
    'POST',
    clock_timestamp(),
    repeat('c', 64),
    v_alert
  );
  IF v_result.decision <> 'logical_duplicate'
     OR v_result.original_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Alert delivery logical duplicate assertion failed: %',
      row_to_json(v_result);
  END IF;

  v_changed_alert := jsonb_set(v_alert, '{attempt_number}', '2'::jsonb);
  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    7::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/alert-deliveries',
    'POST',
    clock_timestamp(),
    repeat('d', 64),
    v_changed_alert
  );
  IF v_result.decision <> 'rejected'
     OR v_result.rejection_code <> 'LOGICAL_ID_CONFLICT' THEN
    RAISE EXCEPTION 'Alert delivery logical conflict assertion failed: %',
      row_to_json(v_result);
  END IF;

  v_notification := jsonb_set(
    jsonb_set(
      jsonb_set(
        v_alert,
        '{delivery_id}',
        '"00000000-0000-4000-8000-000000004002"'::jsonb
      ),
      '{state}',
      '"notified"'::jsonb
    ),
    '{notification_channels}',
    '["email","sms"]'::jsonb
  );
  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000001'::UUID,
    7::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/alert-deliveries',
    'POST',
    clock_timestamp(),
    repeat('e', 64),
    v_notification
  );
  IF v_result.decision <> 'accepted'
     OR v_result.accepted_sequence <> 7 THEN
    RAISE EXCEPTION 'Alert notification proof assertion failed: %',
      row_to_json(v_result);
  END IF;

  IF (SELECT last_sequence FROM guardian_credentials WHERE id = v_credential_id) <> 7
     OR (SELECT count(*) FROM guardian_ingestion_receipts) <> 7
     OR (SELECT count(*) FROM guardian_runs) <> 1
     OR (SELECT count(*) FROM guardian_observations) <> 3
     OR (SELECT count(*) FROM recovery_verifications) <> 1
     OR (SELECT count(*) FROM alert_deliveries) <> 2 THEN
    RAISE EXCEPTION 'Atomic row-count assertions failed';
  END IF;

  INSERT INTO guardian_credentials (
    key_id,
    instance_id,
    display_name,
    public_key,
    public_key_fingerprint,
    status,
    valid_from,
    activated_at,
    rotation_parent_credential_id,
    nonsecret_audit_reference
  ) VALUES (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000001001',
    'Migration 105 rotated key test',
    decode(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511b',
      'hex'
    ),
    repeat('1', 64),
    'overlap',
    clock_timestamp() - interval '1 hour',
    clock_timestamp(),
    v_credential_id,
    'migration-105-rotation-test'
  )
  RETURNING id INTO v_rotated_credential_id;

  INSERT INTO guardian_credential_check_keys (
    guardian_credential_id,
    check_key,
    nonsecret_audit_reference
  ) VALUES
    (
      v_rotated_credential_id,
      'public.api.reachability',
      'migration-105-rotation-test'
    ),
    (
      v_rotated_credential_id,
      'network.tls',
      'migration-105-rotation-test'
    );

  SELECT * INTO v_result
  FROM claim_guardian_request(
    '00000000-0000-4000-8000-000000000002'::UUID,
    1::BIGINT,
    1::SMALLINT,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp(),
    '39569f5bbc2456dede91e0dd76d3df01fda1932771a284b046d426004ebdda50',
    v_run
  );
  IF v_result.decision <> 'logical_duplicate'
     OR v_result.original_receipt_id IS NULL
     OR v_result.accepted_observation_count <> 3
     OR (SELECT count(*) FROM guardian_runs) <> 1
     OR (SELECT count(*) FROM guardian_ingestion_receipts) <> 8 THEN
    RAISE EXCEPTION 'Rotation-safe logical duplicate assertion failed: %',
      row_to_json(v_result);
  END IF;

  INSERT INTO guardian_ingestion_receipts (
    guardian_credential_id,
    guardian_instance_id,
    sequence,
    protocol_version,
    endpoint_path,
    http_method,
    request_timestamp,
    received_at,
    body_sha256,
    mutation_result,
    logical_id,
    accepted_observation_count
  ) VALUES (
    v_credential_id,
    '00000000-0000-4000-8000-000000001001',
    100,
    1,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp() - interval '4 years',
    clock_timestamp() - interval '4 years',
    repeat('b', 64),
    'created',
    '00000000-0000-4000-8000-000000002099',
    1
  );

  INSERT INTO guardian_ingestion_receipts (
    guardian_credential_id,
    guardian_instance_id,
    sequence,
    protocol_version,
    endpoint_path,
    http_method,
    request_timestamp,
    received_at,
    body_sha256,
    mutation_result,
    logical_id,
    accepted_observation_count,
    duplicate_of_receipt_id
  )
  SELECT
    v_rotated_credential_id,
    '00000000-0000-4000-8000-000000001001',
    101,
    1,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp(),
    clock_timestamp(),
    repeat('b', 64),
    'logical_duplicate',
    '00000000-0000-4000-8000-000000002099',
    1,
    receipt.id
  FROM guardian_ingestion_receipts receipt
  WHERE receipt.guardian_instance_id =
    '00000000-0000-4000-8000-000000001001'
    AND receipt.logical_id = '00000000-0000-4000-8000-000000002099'
    AND receipt.mutation_result = 'created';

  INSERT INTO guardian_ingestion_receipts (
    guardian_credential_id,
    guardian_instance_id,
    sequence,
    protocol_version,
    endpoint_path,
    http_method,
    request_timestamp,
    received_at,
    body_sha256,
    mutation_result,
    logical_id,
    accepted_observation_count
  ) VALUES (
    v_credential_id,
    '00000000-0000-4000-8000-000000001001',
    102,
    1,
    '/internal/guardian/v1/runs',
    'POST',
    clock_timestamp() - interval '4 years',
    clock_timestamp() - interval '4 years',
    repeat('f', 64),
    'created',
    '00000000-0000-4000-8000-000000002098',
    1
  );

  PERFORM run_guardian_retention(5000);
  IF NOT EXISTS (
    SELECT 1
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.logical_id = '00000000-0000-4000-8000-000000002099'
      AND receipt.mutation_result = 'created'
  ) THEN
    RAISE EXCEPTION 'Retention removed an original with a younger duplicate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.logical_id = '00000000-0000-4000-8000-000000002098'
  ) THEN
    RAISE EXCEPTION 'Retention failed to delete an eligible old receipt';
  END IF;

  IF has_table_privilege('anon', 'guardian_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'guardian_runs', 'SELECT') THEN
    RAISE EXCEPTION 'Browser role unexpectedly has Guardian table access';
  END IF;

  BEGIN
    UPDATE guardian_runs SET status = 'failed';
    RAISE EXCEPTION 'Append-only update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Guardian history is append-only' THEN
        RAISE;
      END IF;
  END;

  IF scalesafe_schema_version() NOT IN (109, 110, 111) THEN
    RAISE EXCEPTION 'Guardian verifier requires certified schema 109, 110, or 111';
  END IF;
END;
$verify$;

SELECT
  'MIGRATION_109_BEHAVIOR_VERIFIED' AS result,
  scalesafe_schema_version() AS schema_version;

ROLLBACK;
