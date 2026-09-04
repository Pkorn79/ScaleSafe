-- 109_guardian_and_independent_alerting.sql
-- Phase 3 foundation for independently signed Guardian observations, recovery
-- verification, and sanitized alert reconciliation. Browser roles receive no
-- direct access. Runtime activation remains behind GUARDIAN_INGESTION_ENABLED.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF scalesafe_schema_version() <> 108 THEN
    RAISE EXCEPTION 'Migration 109 requires ScaleSafe schema version 108';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS guardian_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  public_key BYTEA NOT NULL CHECK (octet_length(public_key) = 32),
  public_key_fingerprint CHAR(64) NOT NULL UNIQUE
    CHECK (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'overlap', 'revoked', 'expired'
  )),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_request_method TEXT CHECK (
    last_request_method IS NULL OR last_request_method IN ('GET', 'POST')
  ),
  last_request_path TEXT CHECK (
    last_request_path IS NULL OR last_request_path IN (
      '/internal/guardian/v1/snapshot',
      '/internal/guardian/v1/runs',
      '/internal/guardian/v1/recovery-verifications',
      '/internal/guardian/v1/alert-deliveries'
    )
  ),
  last_request_body_sha256 CHAR(64) CHECK (
    last_request_body_sha256 IS NULL
    OR last_request_body_sha256 ~ '^[0-9a-f]{64}$'
  ),
  last_receipt_id UUID,
  last_accepted_at TIMESTAMPTZ,
  rotation_parent_credential_id UUID REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  created_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  activated_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  revoked_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  nonsecret_audit_reference TEXT CHECK (
    nonsecret_audit_reference IS NULL OR length(nonsecret_audit_reference) <= 300
  ),
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    status NOT IN ('active', 'overlap')
    OR activated_at IS NOT NULL
  ),
  CHECK (
    status <> 'revoked'
    OR revoked_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_guardian_credentials_status_validity
  ON guardian_credentials (status, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_guardian_credentials_instance
  ON guardian_credentials (instance_id, status);

CREATE TABLE IF NOT EXISTS guardian_check_catalog (
  check_key TEXT PRIMARY KEY CHECK (check_key ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'platform', 'recovery')),
  authorized_source TEXT NOT NULL CHECK (authorized_source IN (
    'guardian_probe', 'scalesafe_snapshot', 'backup_status_drop', 'external_deadman'
  )),
  cadence_seconds INTEGER NOT NULL CHECK (cadence_seconds BETWEEN 30 AND 604800),
  freshness_threshold_seconds INTEGER NOT NULL
    CHECK (freshness_threshold_seconds BETWEEN 60 AND 2592000),
  default_severity TEXT NOT NULL CHECK (default_severity IN (
    'info', 'warning', 'urgent', 'critical'
  )),
  parent_check_key TEXT REFERENCES guardian_check_catalog(check_key) ON DELETE RESTRICT,
  recovery_stable_observations INTEGER NOT NULL DEFAULT 2
    CHECK (recovery_stable_observations BETWEEN 1 AND 100),
  allowed_summary_codes TEXT[] NOT NULL DEFAULT ARRAY[
    'CHECK_OK', 'CHECK_DEGRADED', 'CHECK_UNHEALTHY', 'CHECK_UNKNOWN'
  ]::TEXT[] CHECK (cardinality(allowed_summary_codes) BETWEEN 1 AND 32),
  allowed_failure_codes TEXT[] NOT NULL DEFAULT ARRAY[
    'CHECK_DEGRADED', 'CHECK_UNHEALTHY', 'CHECK_UNKNOWN', 'TIMEOUT',
    'STALE', 'SOURCE_UNAVAILABLE'
  ]::TEXT[] CHECK (cardinality(allowed_failure_codes) BETWEEN 1 AND 32),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_check_catalog_active
  ON guardian_check_catalog (active, scope_type, check_key);

CREATE TABLE IF NOT EXISTS guardian_check_metric_catalog (
  check_key TEXT NOT NULL
    REFERENCES guardian_check_catalog(check_key) ON DELETE CASCADE,
  metric_key TEXT NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{0,47}$'),
  value_type TEXT NOT NULL CHECK (value_type IN ('integer', 'boolean', 'token')),
  minimum_integer BIGINT,
  maximum_integer BIGINT,
  token_pattern TEXT CHECK (
    token_pattern IS NULL OR length(token_pattern) BETWEEN 1 AND 200
  ),
  allowed_token_values TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (check_key, metric_key),
  CHECK (
    (value_type = 'integer'
      AND minimum_integer IS NOT NULL
      AND maximum_integer IS NOT NULL
      AND minimum_integer <= maximum_integer
      AND token_pattern IS NULL
      AND allowed_token_values IS NULL)
    OR
    (value_type = 'boolean'
      AND minimum_integer IS NULL
      AND maximum_integer IS NULL
      AND token_pattern IS NULL
      AND allowed_token_values IS NULL)
    OR
    (value_type = 'token'
      AND minimum_integer IS NULL
      AND maximum_integer IS NULL
      AND (
        token_pattern IS NOT NULL
        OR COALESCE(cardinality(allowed_token_values), 0) > 0
      ))
  )
);

CREATE INDEX IF NOT EXISTS idx_guardian_check_metric_catalog_check
  ON guardian_check_metric_catalog (check_key, metric_key);

CREATE TABLE IF NOT EXISTS guardian_credential_check_keys (
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL
    REFERENCES guardian_check_catalog(check_key) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT true,
  authorized_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  nonsecret_audit_reference TEXT CHECK (
    nonsecret_audit_reference IS NULL OR length(nonsecret_audit_reference) <= 300
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_credential_id, check_key)
);

CREATE INDEX IF NOT EXISTS idx_guardian_credential_check_keys_active
  ON guardian_credential_check_keys (guardian_credential_id, active, check_key);

CREATE TABLE IF NOT EXISTS guardian_ingestion_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  guardian_instance_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 1),
  endpoint_path TEXT NOT NULL CHECK (endpoint_path IN (
    '/internal/guardian/v1/snapshot',
    '/internal/guardian/v1/runs',
    '/internal/guardian/v1/recovery-verifications',
    '/internal/guardian/v1/alert-deliveries'
  )),
  http_method TEXT NOT NULL CHECK (http_method IN ('GET', 'POST')),
  request_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  body_sha256 CHAR(64) NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  result TEXT NOT NULL DEFAULT 'accepted' CHECK (result = 'accepted'),
  mutation_result TEXT NOT NULL DEFAULT 'created' CHECK (mutation_result IN (
    'created', 'logical_duplicate'
  )),
  logical_id UUID,
  accepted_observation_count INTEGER NOT NULL DEFAULT 0
    CHECK (accepted_observation_count BETWEEN 0 AND 64),
  duplicate_of_receipt_id UUID
    REFERENCES guardian_ingestion_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_credential_id, sequence),
  CHECK (
    (mutation_result = 'created' AND duplicate_of_receipt_id IS NULL)
    OR
    (mutation_result = 'logical_duplicate' AND duplicate_of_receipt_id IS NOT NULL)
  ),
  CHECK (
    (endpoint_path = '/internal/guardian/v1/snapshot' AND http_method = 'GET')
    OR
    (endpoint_path IN (
      '/internal/guardian/v1/runs',
      '/internal/guardian/v1/recovery-verifications',
      '/internal/guardian/v1/alert-deliveries'
    ) AND http_method = 'POST')
  ),
  CHECK (
    (
      endpoint_path = '/internal/guardian/v1/snapshot'
      AND logical_id IS NULL
      AND accepted_observation_count = 0
    )
    OR
    (
      endpoint_path = '/internal/guardian/v1/runs'
      AND logical_id IS NOT NULL
      AND accepted_observation_count BETWEEN 1 AND 64
    )
    OR
    (
      endpoint_path = '/internal/guardian/v1/recovery-verifications'
      AND logical_id IS NOT NULL
      AND accepted_observation_count = 0
    )
    OR
    (
      endpoint_path = '/internal/guardian/v1/alert-deliveries'
      AND logical_id IS NOT NULL
      AND accepted_observation_count = 0
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_guardian_ingestion_receipts_time
  ON guardian_ingestion_receipts (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_ingestion_receipts_credential_time
  ON guardian_ingestion_receipts (guardian_credential_id, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_receipts_original_logical_id
  ON guardian_ingestion_receipts (
    guardian_instance_id,
    endpoint_path,
    logical_id
  )
  WHERE logical_id IS NOT NULL
    AND mutation_result = 'created';

ALTER TABLE guardian_credentials
  DROP CONSTRAINT IF EXISTS guardian_credentials_last_receipt_id_fkey;

ALTER TABLE guardian_credentials
  ADD CONSTRAINT guardian_credentials_last_receipt_id_fkey
  FOREIGN KEY (last_receipt_id)
  REFERENCES guardian_ingestion_receipts(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS guardian_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id UUID NOT NULL,
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  guardian_instance_id UUID NOT NULL,
  agent_version TEXT NOT NULL
    CHECK (
      length(agent_version) BETWEEN 1 AND 64
      AND agent_version ~ '^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,63}$'
    ),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  observation_count INTEGER NOT NULL CHECK (observation_count BETWEEN 1 AND 64),
  healthy_count INTEGER NOT NULL DEFAULT 0 CHECK (healthy_count >= 0),
  degraded_count INTEGER NOT NULL DEFAULT 0 CHECK (degraded_count >= 0),
  unhealthy_count INTEGER NOT NULL DEFAULT 0 CHECK (unhealthy_count >= 0),
  unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  ingestion_receipt_id UUID NOT NULL UNIQUE
    REFERENCES guardian_ingestion_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_instance_id, source_run_id),
  CHECK (completed_at >= started_at),
  CHECK (
    healthy_count + degraded_count + unhealthy_count + unknown_count
    = observation_count
  )
);

CREATE INDEX IF NOT EXISTS idx_guardian_runs_completed
  ON guardian_runs (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_runs_instance_completed
  ON guardian_runs (guardian_instance_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS guardian_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_run_id UUID NOT NULL REFERENCES guardian_runs(id) ON DELETE CASCADE,
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  guardian_instance_id UUID NOT NULL,
  check_key TEXT NOT NULL
    REFERENCES guardian_check_catalog(check_key) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'platform', 'recovery')),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'guardian_probe', 'scalesafe_snapshot', 'backup_status_drop', 'external_deadman'
  )),
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'unhealthy', 'unknown'
  )),
  severity TEXT NOT NULL CHECK (severity IN (
    'info', 'warning', 'urgent', 'critical'
  )),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  summary_code TEXT NOT NULL
    CHECK (summary_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 3600000),
  facts JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(facts) = 'object' AND pg_column_size(facts) <= 4096),
  observed_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  parent_check_key TEXT REFERENCES guardian_check_catalog(check_key) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > observed_at),
  CHECK (
    (state = 'healthy' AND severity = 'info' AND failure_code IS NULL)
    OR
    (state <> 'healthy' AND failure_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_guardian_observations_check_time
  ON guardian_observations (check_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_observations_state_time
  ON guardian_observations (state, severity, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_observations_run
  ON guardian_observations (guardian_run_id, observed_at);

CREATE TABLE IF NOT EXISTS guardian_rate_limit_buckets (
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE CASCADE,
  endpoint_path TEXT NOT NULL CHECK (endpoint_path IN (
    '/internal/guardian/v1/snapshot',
    '/internal/guardian/v1/runs',
    '/internal/guardian/v1/recovery-verifications',
    '/internal/guardian/v1/alert-deliveries'
  )),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_credential_id, endpoint_path)
);

CREATE TABLE IF NOT EXISTS alert_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL CHECK (provider_name IN (
    'better_stack', 'ghl', 'openclaw'
  )),
  route_name TEXT NOT NULL CHECK (length(route_name) BETWEEN 1 AND 160),
  severity_threshold TEXT NOT NULL CHECK (severity_threshold IN (
    'info', 'warning', 'urgent', 'critical'
  )),
  enabled BOOLEAN NOT NULL DEFAULT false,
  channel_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (
      channel_labels <@ ARRAY[
        'public_monitor', 'deadman', 'sms', 'email', 'handoff'
      ]::TEXT[]
    ),
  nonsecret_configuration_reference TEXT CHECK (
    nonsecret_configuration_reference IS NULL
    OR length(nonsecret_configuration_reference) <= 300
  ),
  last_delivery_test_at TIMESTAMPTZ,
  last_delivery_test_result TEXT CHECK (
    last_delivery_test_result IS NULL
    OR last_delivery_test_result IN ('accepted', 'notified', 'failed')
  ),
  last_delivery_test_failure_code TEXT CHECK (
    last_delivery_test_failure_code IS NULL
    OR last_delivery_test_failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_name, route_name)
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_delivery_id UUID NOT NULL,
  source_alert_id UUID NOT NULL,
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  guardian_instance_id UUID NOT NULL,
  guardian_incident_id UUID NOT NULL,
  alert_route_id UUID REFERENCES alert_routes(id) ON DELETE RESTRICT,
  provider_name TEXT NOT NULL CHECK (provider_name = 'ghl'),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'opened', 'escalated', 'resolved'
  )),
  check_key TEXT NOT NULL
    REFERENCES guardian_check_catalog(check_key) ON DELETE RESTRICT,
  severity TEXT NOT NULL CHECK (severity IN (
    'info', 'warning', 'urgent', 'critical'
  )),
  provider_reference_sha256 CHAR(64) CHECK (
    provider_reference_sha256 IS NULL
    OR provider_reference_sha256 ~ '^[0-9a-f]{64}$'
  ),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 100),
  state TEXT NOT NULL CHECK (state IN (
    'accepted', 'notified', 'failed'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  notification_channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (
    notification_channels <@ ARRAY['email', 'sms']::TEXT[]
  ),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code IN (
      'GHL_ACCEPTANCE_UNKNOWN',
      'GHL_ALERT_UNAVAILABLE',
      'GHL_PROVIDER_ERROR',
      'GHL_RATE_LIMITED',
      'GHL_REJECTED',
      'GHL_UNREACHABLE',
      'PROCESS_INTERRUPTED_AFTER_SEND'
    )
  ),
  envelope_sha256 CHAR(64) NOT NULL CHECK (
    envelope_sha256 ~ '^[0-9a-f]{64}$'
  ),
  ingestion_receipt_id UUID NOT NULL UNIQUE
    REFERENCES guardian_ingestion_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_instance_id, source_delivery_id),
  CHECK (
    (state = 'accepted'
      AND cardinality(notification_channels) = 0
      AND failure_code IS NULL)
    OR
    (state = 'notified'
      AND notification_channels = CASE
        WHEN severity IN ('urgent', 'critical')
        THEN ARRAY['email', 'sms']::TEXT[]
        ELSE ARRAY['email']::TEXT[]
      END
      AND provider_reference_sha256 IS NOT NULL
      AND failure_code IS NULL)
    OR
    (state = 'failed'
      AND cardinality(notification_channels) = 0
      AND provider_reference_sha256 IS NULL
      AND failure_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_incident_time
  ON alert_deliveries (guardian_incident_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_provider_state
  ON alert_deliveries (provider_name, state, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_check_time
  ON alert_deliveries (check_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS recovery_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_verification_id UUID NOT NULL,
  guardian_credential_id UUID NOT NULL
    REFERENCES guardian_credentials(id) ON DELETE RESTRICT,
  guardian_instance_id UUID NOT NULL,
  verification_type TEXT NOT NULL CHECK (verification_type IN (
    'backup_status', 'backup_object', 'restore_recency'
  )),
  snapshot_id TEXT CHECK (
    snapshot_id IS NULL OR (
      length(snapshot_id) <= 128
      AND snapshot_id ~ '^[A-Za-z0-9._:-]+$'
    )
  ),
  verified_at TIMESTAMPTZ NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('healthy', 'failed', 'unknown')),
  schema_version INTEGER CHECK (schema_version IS NULL OR schema_version >= 1),
  object_count BIGINT CHECK (
    object_count IS NULL OR object_count BETWEEN 0 AND 9007199254740991
  ),
  encrypted_bytes BIGINT CHECK (
    encrypted_bytes IS NULL OR encrypted_bytes BETWEEN 0 AND 9007199254740991
  ),
  proof_sha256 CHAR(64) NOT NULL CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  ingestion_receipt_id UUID NOT NULL UNIQUE
    REFERENCES guardian_ingestion_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guardian_instance_id, source_verification_id),
  CHECK (result <> 'healthy' OR failure_code IS NULL),
  CHECK (result = 'healthy' OR failure_code IS NOT NULL),
  CHECK (
    failure_code IS NULL OR failure_code IN (
      'BACKUP_COMMAND_FAILED',
      'BACKUP_STALE',
      'BACKUP_STATUS_MISSING',
      'BACKUP_OBJECT_MISSING',
      'BACKUP_OBJECT_MISMATCH',
      'RESTORE_OVERDUE',
      'RESTORE_PROOF_MISSING',
      'STATUS_UNAVAILABLE',
      'VERIFICATION_TIMEOUT'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_recovery_verifications_type_time
  ON recovery_verifications (verification_type, verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_recovery_verifications_result_time
  ON recovery_verifications (result, verified_at DESC);

INSERT INTO guardian_check_catalog (
  check_key,
  display_name,
  scope_type,
  authorized_source,
  cadence_seconds,
  freshness_threshold_seconds,
  default_severity,
  parent_check_key,
  recovery_stable_observations,
  active
) VALUES
  (
    'public.api.reachability', 'Public API reachability', 'global',
    'guardian_probe', 120, 300, 'critical', NULL, 2, true
  ),
  (
    'public.operator.reachability', 'Operator host reachability', 'global',
    'guardian_probe', 120, 300, 'urgent', NULL, 2, true
  ),
  (
    'platform.snapshot.freshness', 'Guardian snapshot freshness', 'platform',
    'guardian_probe', 300, 600, 'urgent', 'public.api.reachability', 2, true
  ),
  (
    'platform.database.aggregate', 'Database aggregate health', 'platform',
    'scalesafe_snapshot', 300, 900, 'critical', 'platform.snapshot.freshness', 2, true
  ),
  (
    'platform.workers.aggregate', 'Worker aggregate health', 'platform',
    'scalesafe_snapshot', 300, 900, 'urgent', 'platform.database.aggregate', 2, true
  ),
  (
    'platform.queues.aggregate', 'Queue aggregate health', 'platform',
    'scalesafe_snapshot', 300, 900, 'urgent', 'platform.database.aggregate', 2, true
  ),
  (
    'platform.jobs.aggregate', 'Scheduled job aggregate health', 'platform',
    'scalesafe_snapshot', 300, 900, 'urgent', 'platform.database.aggregate', 2, true
  ),
  (
    'platform.http.aggregate', 'Application HTTP aggregate health', 'platform',
    'scalesafe_snapshot', 300, 900, 'urgent', 'platform.snapshot.freshness', 2, true
  ),
  (
    'platform.deployment.build', 'Deployment build status', 'platform',
    'guardian_probe', 86400, 172800, 'warning', 'public.api.reachability', 2, true
  ),
  (
    'platform.ci.main', 'Main branch CI status', 'platform',
    'guardian_probe', 86400, 172800, 'urgent', NULL, 2, true
  ),
  (
    'platform.security.flags', 'Production safety flags', 'platform',
    'scalesafe_snapshot', 900, 1800, 'critical', 'platform.snapshot.freshness', 2, true
  ),
  (
    'recovery.backup.status', 'Encrypted backup status', 'recovery',
    'backup_status_drop', 1800, 7200, 'critical', NULL, 2, true
  ),
  (
    'recovery.backup.object', 'Encrypted backup object verification', 'recovery',
    'guardian_probe', 604800, 691200, 'urgent', 'recovery.backup.status', 2, true
  ),
  (
    'recovery.restore.recency', 'Scratch restore recency', 'recovery',
    'backup_status_drop', 86400, 172800, 'critical', NULL, 2, true
  ),
  (
    'guardian.deadman', 'Guardian dead-man heartbeat', 'global',
    'external_deadman', 120, 300, 'critical', NULL, 2, true
  ),
  (
    'network.dns', 'DNS resolution', 'global',
    'guardian_probe', 900, 1800, 'urgent', NULL, 2, true
  ),
  (
    'network.tls', 'TLS certificate validity', 'global',
    'guardian_probe', 900, 1800, 'critical', 'network.dns', 2, true
  )
ON CONFLICT (check_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  scope_type = EXCLUDED.scope_type,
  authorized_source = EXCLUDED.authorized_source,
  cadence_seconds = EXCLUDED.cadence_seconds,
  freshness_threshold_seconds = EXCLUDED.freshness_threshold_seconds,
  default_severity = EXCLUDED.default_severity,
  parent_check_key = EXCLUDED.parent_check_key,
  recovery_stable_observations = EXCLUDED.recovery_stable_observations,
  allowed_summary_codes = EXCLUDED.allowed_summary_codes,
  allowed_failure_codes = EXCLUDED.allowed_failure_codes,
  active = EXCLUDED.active,
  updated_at = now();

UPDATE guardian_check_catalog
SET
  allowed_failure_codes = ARRAY[
    'CHECK_DEGRADED',
    'CHECK_UNHEALTHY',
    'CHECK_UNKNOWN',
    'TIMEOUT',
    'STALE',
    'SOURCE_UNAVAILABLE',
    'BACKUP_ATTEMPT_FAILED',
    'BACKUP_TIMER_DISABLED',
    'BACKUP_VERIFY_FAILED',
    'B2_CAPABILITY_INVALID',
    'B2_OBJECT_INVALID',
    'B2_SOURCE_UNAVAILABLE'
  ]::TEXT[],
  updated_at = now()
WHERE check_key IN (
  'recovery.backup.status',
  'recovery.backup.object'
);

INSERT INTO guardian_check_metric_catalog (
  check_key,
  metric_key,
  value_type,
  minimum_integer,
  maximum_integer,
  token_pattern,
  allowed_token_values
) VALUES
  ('public.api.reachability', 'http_status', 'integer', 100, 599, NULL, NULL),
  ('public.api.reachability', 'response_bytes', 'integer', 0, 9007199254740991, NULL, NULL),
  ('public.operator.reachability', 'http_status', 'integer', 100, 599, NULL, NULL),
  ('public.operator.reachability', 'response_bytes', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.snapshot.freshness', 'http_status', 'integer', 100, 599, NULL, NULL),
  ('platform.snapshot.freshness', 'age_seconds', 'integer', 0, 2592000, NULL, NULL),
  ('platform.snapshot.freshness', 'expires_in_seconds', 'integer', -2592000, 2592000, NULL, NULL),
  ('platform.database.aggregate', 'schema_version', 'integer', 1, 2147483647, NULL, NULL),
  ('platform.database.aggregate', 'canary_latency_ms', 'integer', 0, 3600000, NULL, NULL),
  ('platform.database.aggregate', 'timeout_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.workers.aggregate', 'healthy_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.workers.aggregate', 'degraded_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.workers.aggregate', 'unhealthy_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.workers.aggregate', 'unknown_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.workers.aggregate', 'stale_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.queues.aggregate', 'pending_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.queues.aggregate', 'retrying_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.queues.aggregate', 'failed_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.queues.aggregate', 'oldest_age_seconds', 'integer', 0, 2592000, NULL, NULL),
  ('platform.jobs.aggregate', 'healthy_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.jobs.aggregate', 'failed_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.jobs.aggregate', 'missed_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.jobs.aggregate', 'stale_count', 'integer', 0, 2147483647, NULL, NULL),
  ('platform.jobs.aggregate', 'oldest_age_seconds', 'integer', 0, 2592000, NULL, NULL),
  ('platform.http.aggregate', 'request_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.http.aggregate', 'server_error_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.http.aggregate', 'timeout_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('platform.http.aggregate', 'latency_p95_ms', 'integer', 0, 3600000, NULL, NULL),
  ('platform.http.aggregate', 'latency_max_ms', 'integer', 0, 3600000, NULL, NULL),
  ('platform.deployment.build', 'build_sha', 'token', NULL, NULL, '^[A-Fa-f0-9]{7,64}$', NULL),
  ('platform.deployment.build', 'build_age_seconds', 'integer', 0, 315576000, NULL, NULL),
  ('platform.ci.main', 'conclusion', 'token', NULL, NULL, NULL, ARRAY[
    'success', 'failure', 'cancelled', 'timed_out', 'action_required',
    'neutral', 'skipped', 'stale', 'unknown'
  ]),
  ('platform.ci.main', 'age_seconds', 'integer', 0, 315576000, NULL, NULL),
  ('platform.security.flags', 'legacy_public_actions_enabled', 'boolean', NULL, NULL, NULL, NULL),
  ('platform.security.flags', 'daily_test_billing_enabled', 'boolean', NULL, NULL, NULL, NULL),
  ('platform.security.flags', 'guardian_ingestion_enabled', 'boolean', NULL, NULL, NULL, NULL),
  ('recovery.backup.status', 'snapshot_age_hours', 'integer', 0, 87600, NULL, NULL),
  ('recovery.backup.status', 'max_age_hours', 'integer', 1, 87600, NULL, NULL),
  ('recovery.backup.status', 'schema_version', 'integer', 1, 2147483647, NULL, NULL),
  ('recovery.backup.status', 'object_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('recovery.backup.status', 'encrypted_bytes', 'integer', 0, 9007199254740991, NULL, NULL),
  ('recovery.backup.object', 'object_count', 'integer', 0, 9007199254740991, NULL, NULL),
  ('recovery.backup.object', 'encrypted_bytes', 'integer', 0, 9007199254740991, NULL, NULL),
  ('recovery.backup.object', 'marker_present', 'boolean', NULL, NULL, NULL, NULL),
  ('recovery.restore.recency', 'age_days', 'integer', 0, 3650, NULL, NULL),
  ('recovery.restore.recency', 'max_age_days', 'integer', 1, 3650, NULL, NULL),
  ('recovery.restore.recency', 'schema_version', 'integer', 1, 2147483647, NULL, NULL),
  ('guardian.deadman', 'heartbeat_age_seconds', 'integer', 0, 2592000, NULL, NULL),
  ('network.dns', 'resolved_address_count', 'integer', 0, 64, NULL, NULL),
  ('network.tls', 'days_remaining', 'integer', -3650, 36500, NULL, NULL),
  ('network.tls', 'not_before_unix', 'integer', 0, 9007199254740991, NULL, NULL),
  ('network.tls', 'not_after_unix', 'integer', 0, 9007199254740991, NULL, NULL)
ON CONFLICT (check_key, metric_key) DO UPDATE SET
  value_type = EXCLUDED.value_type,
  minimum_integer = EXCLUDED.minimum_integer,
  maximum_integer = EXCLUDED.maximum_integer,
  token_pattern = EXCLUDED.token_pattern,
  allowed_token_values = EXCLUDED.allowed_token_values,
  updated_at = now();

CREATE OR REPLACE FUNCTION validate_guardian_credential()
RETURNS TRIGGER AS $$
DECLARE
  v_fingerprint TEXT;
BEGIN
  v_fingerprint := encode(extensions.digest(NEW.public_key, 'sha256'), 'hex');
  NEW.public_key_fingerprint := v_fingerprint;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.key_id <> OLD.key_id
       OR NEW.instance_id <> OLD.instance_id
       OR NEW.public_key <> OLD.public_key
       OR NEW.public_key_fingerprint <> OLD.public_key_fingerprint THEN
      RAISE EXCEPTION 'Guardian credential identity is immutable';
    END IF;

    IF NEW.last_sequence < OLD.last_sequence THEN
      RAISE EXCEPTION 'Guardian sequence cannot decrease';
    END IF;

    IF OLD.status IN ('revoked', 'expired') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Terminal Guardian credential status cannot change';
    END IF;

    IF OLD.status = 'pending' AND NEW.status NOT IN (
      'pending', 'active', 'revoked', 'expired'
    ) THEN
      RAISE EXCEPTION 'Invalid Guardian credential transition';
    END IF;

    IF OLD.status = 'active' AND NEW.status NOT IN (
      'active', 'overlap', 'revoked', 'expired'
    ) THEN
      RAISE EXCEPTION 'Invalid Guardian credential transition';
    END IF;

    IF OLD.status = 'overlap' AND NEW.status NOT IN (
      'overlap', 'revoked', 'expired'
    ) THEN
      RAISE EXCEPTION 'Invalid Guardian credential transition';
    END IF;

    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

DROP TRIGGER IF EXISTS guardian_credentials_validate ON guardian_credentials;
CREATE TRIGGER guardian_credentials_validate
  BEFORE INSERT OR UPDATE ON guardian_credentials
  FOR EACH ROW EXECUTE FUNCTION validate_guardian_credential();

CREATE OR REPLACE FUNCTION prevent_guardian_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('scalesafe.guardian_retention', true) = 'on'
     AND current_user = (
       SELECT pg_get_userbyid(retention.proowner)
       FROM pg_proc retention
       WHERE retention.oid =
         'public.run_guardian_retention(integer)'::regprocedure
     ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Guardian history is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS guardian_ingestion_receipts_immutable
  ON guardian_ingestion_receipts;
CREATE TRIGGER guardian_ingestion_receipts_immutable
  BEFORE UPDATE OR DELETE ON guardian_ingestion_receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_guardian_history_mutation();

DROP TRIGGER IF EXISTS guardian_runs_immutable ON guardian_runs;
CREATE TRIGGER guardian_runs_immutable
  BEFORE UPDATE OR DELETE ON guardian_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_guardian_history_mutation();

DROP TRIGGER IF EXISTS guardian_observations_immutable ON guardian_observations;
CREATE TRIGGER guardian_observations_immutable
  BEFORE UPDATE OR DELETE ON guardian_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_guardian_history_mutation();

DROP TRIGGER IF EXISTS alert_deliveries_immutable ON alert_deliveries;
CREATE TRIGGER alert_deliveries_immutable
  BEFORE UPDATE OR DELETE ON alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION prevent_guardian_history_mutation();

DROP TRIGGER IF EXISTS recovery_verifications_immutable ON recovery_verifications;
CREATE TRIGGER recovery_verifications_immutable
  BEFORE UPDATE OR DELETE ON recovery_verifications
  FOR EACH ROW EXECUTE FUNCTION prevent_guardian_history_mutation();

DROP TRIGGER IF EXISTS guardian_check_catalog_updated_at ON guardian_check_catalog;
CREATE TRIGGER guardian_check_catalog_updated_at
  BEFORE UPDATE ON guardian_check_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS guardian_check_metric_catalog_updated_at
  ON guardian_check_metric_catalog;
CREATE TRIGGER guardian_check_metric_catalog_updated_at
  BEFORE UPDATE ON guardian_check_metric_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS guardian_credential_check_keys_updated_at
  ON guardian_credential_check_keys;
CREATE TRIGGER guardian_credential_check_keys_updated_at
  BEFORE UPDATE ON guardian_credential_check_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS alert_routes_updated_at ON alert_routes;
CREATE TRIGGER alert_routes_updated_at
  BEFORE UPDATE ON alert_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION claim_guardian_request(
  p_key_id UUID,
  p_sequence BIGINT,
  p_protocol_version SMALLINT,
  p_endpoint_path TEXT,
  p_http_method TEXT,
  p_request_timestamp TIMESTAMPTZ,
  p_body_sha256 TEXT,
  p_payload JSONB
)
RETURNS TABLE (
  decision TEXT,
  receipt_id UUID,
  original_receipt_id UUID,
  accepted_sequence BIGINT,
  accepted_observation_count INTEGER,
  record_id UUID,
  rejection_code TEXT,
  server_time TIMESTAMPTZ
) AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_credential guardian_credentials%ROWTYPE;
  v_existing_receipt guardian_ingestion_receipts%ROWTYPE;
  v_existing_run guardian_runs%ROWTYPE;
  v_existing_verification recovery_verifications%ROWTYPE;
  v_bucket guardian_rate_limit_buckets%ROWTYPE;
  v_rate_limit INTEGER;
  v_receipt_id UUID;
  v_original_receipt_id UUID;
  v_record_id UUID;
  v_observation JSONB;
  v_catalog guardian_check_catalog%ROWTYPE;
  v_metric guardian_check_metric_catalog%ROWTYPE;
  v_fact RECORD;
  v_fact_text TEXT;
  v_fact_number NUMERIC;
  v_observation_count INTEGER := 0;
  v_healthy_count INTEGER := 0;
  v_degraded_count INTEGER := 0;
  v_unhealthy_count INTEGER := 0;
  v_unknown_count INTEGER := 0;
  v_recovery_check_key TEXT;
  v_logical_duplicate BOOLEAN := false;
  v_logical_id UUID;
BEGIN
  IF p_sequence IS NULL OR p_sequence < 1
     OR p_protocol_version <> 1
     OR p_body_sha256 !~ '^[0-9a-f]{64}$'
     OR p_endpoint_path NOT IN (
       '/internal/guardian/v1/snapshot',
       '/internal/guardian/v1/runs',
       '/internal/guardian/v1/recovery-verifications',
       '/internal/guardian/v1/alert-deliveries'
     )
     OR p_http_method NOT IN ('GET', 'POST')
     OR (
       p_endpoint_path = '/internal/guardian/v1/snapshot'
       AND p_http_method <> 'GET'
     )
     OR (
       p_endpoint_path IN (
         '/internal/guardian/v1/runs',
         '/internal/guardian/v1/recovery-verifications',
         '/internal/guardian/v1/alert-deliveries'
       )
       AND p_http_method <> 'POST'
    ) THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'INVALID_REQUEST'::TEXT, v_now;
    RETURN;
  END IF;

  IF p_request_timestamp IS NULL
     OR abs(extract(epoch FROM (v_now - p_request_timestamp))) > 300 THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'TIMESTAMP_OUT_OF_RANGE'::TEXT, v_now;
    RETURN;
  END IF;

  SELECT *
  INTO v_credential
  FROM guardian_credentials
  WHERE key_id = p_key_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_credential.status NOT IN ('active', 'overlap')
     OR v_credential.valid_from > v_now
     OR (
       v_credential.valid_until IS NOT NULL
       AND v_credential.valid_until <= v_now
     ) THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'AUTHENTICATION_FAILED'::TEXT, v_now;
    RETURN;
  END IF;

  v_rate_limit := CASE p_endpoint_path
    WHEN '/internal/guardian/v1/snapshot' THEN 120
    WHEN '/internal/guardian/v1/runs' THEN 30
    WHEN '/internal/guardian/v1/alert-deliveries' THEN 120
    ELSE 12
  END;

  INSERT INTO guardian_rate_limit_buckets (
    guardian_credential_id,
    endpoint_path,
    window_started_at,
    request_count,
    updated_at
  ) VALUES (
    v_credential.id,
    p_endpoint_path,
    v_now,
    0,
    v_now
  )
  ON CONFLICT (guardian_credential_id, endpoint_path) DO NOTHING;

  SELECT *
  INTO v_bucket
  FROM guardian_rate_limit_buckets
  WHERE guardian_credential_id = v_credential.id
    AND endpoint_path = p_endpoint_path
  FOR UPDATE;

  IF v_bucket.window_started_at + interval '1 minute' <= v_now THEN
    UPDATE guardian_rate_limit_buckets
    SET
      window_started_at = v_now,
      request_count = 1,
      updated_at = v_now
    WHERE guardian_credential_id = v_credential.id
      AND endpoint_path = p_endpoint_path;
  ELSE
    UPDATE guardian_rate_limit_buckets
    SET
      request_count = request_count + 1,
      updated_at = v_now
    WHERE guardian_credential_id = v_credential.id
      AND endpoint_path = p_endpoint_path
    RETURNING * INTO v_bucket;

    IF v_bucket.request_count > v_rate_limit THEN
      RETURN QUERY SELECT
        'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
        'RATE_LIMITED'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  IF p_sequence = v_credential.last_sequence THEN
    SELECT *
    INTO v_existing_receipt
    FROM guardian_ingestion_receipts
    WHERE guardian_credential_id = v_credential.id
      AND sequence = p_sequence;

    IF FOUND
       AND v_existing_receipt.http_method = p_http_method
       AND v_existing_receipt.endpoint_path = p_endpoint_path
       AND v_existing_receipt.body_sha256 = p_body_sha256 THEN
      v_original_receipt_id := COALESCE(
        v_existing_receipt.duplicate_of_receipt_id,
        v_existing_receipt.id
      );

      v_observation_count := v_existing_receipt.accepted_observation_count;
      SELECT COALESCE(run.id, verification.id, alert.id)
      INTO v_record_id
      FROM guardian_ingestion_receipts original_receipt
      LEFT JOIN guardian_runs run
        ON run.ingestion_receipt_id = original_receipt.id
      LEFT JOIN recovery_verifications verification
        ON verification.ingestion_receipt_id = original_receipt.id
      LEFT JOIN alert_deliveries alert
        ON alert.ingestion_receipt_id = original_receipt.id
      WHERE original_receipt.id = v_original_receipt_id;

      RETURN QUERY SELECT
        'duplicate'::TEXT,
        v_existing_receipt.id,
        CASE
          WHEN v_existing_receipt.duplicate_of_receipt_id IS NOT NULL
          THEN v_original_receipt_id
          ELSE NULL::UUID
        END,
        p_sequence,
        COALESCE(v_observation_count, 0),
        v_record_id,
        NULL::TEXT,
        v_now;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'SEQUENCE_REUSE'::TEXT, v_now;
    RETURN;
  END IF;

  IF p_sequence < v_credential.last_sequence THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'STALE_SEQUENCE'::TEXT, v_now;
    RETURN;
  END IF;

  IF p_sequence <> v_credential.last_sequence + 1 THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'SEQUENCE_GAP'::TEXT, v_now;
    RETURN;
  END IF;

  IF p_endpoint_path = '/internal/guardian/v1/snapshot' THEN
    IF p_payload IS NOT NULL
       OR p_body_sha256 <>
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
       OR NOT EXISTS (
         SELECT 1
         FROM guardian_credential_check_keys allowed
         WHERE allowed.guardian_credential_id = v_credential.id
           AND allowed.check_key = 'platform.snapshot.freshness'
           AND allowed.active
       ) THEN
      RETURN QUERY SELECT
        'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
        'PAYLOAD_NOT_AUTHORIZED'::TEXT, v_now;
      RETURN;
    END IF;
  ELSIF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN QUERY SELECT
      'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
      'INVALID_PAYLOAD'::TEXT, v_now;
    RETURN;
  END IF;

  IF p_endpoint_path = '/internal/guardian/v1/runs' THEN
    IF (p_payload - ARRAY[
         'protocol_version', 'instance_id', 'run_id', 'agent_version',
         'started_at', 'completed_at', 'status', 'observation_count',
         'observations'
       ]::TEXT[]) <> '{}'::jsonb
       OR p_payload->>'protocol_version' <> '1'
       OR COALESCE(p_payload->>'instance_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(p_payload->>'run_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (p_payload->>'instance_id')::UUID <> v_credential.instance_id
       OR COALESCE(p_payload->>'agent_version', '') !~
          '^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,63}$'
       OR COALESCE(p_payload->>'started_at', '') !~
          '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
       OR COALESCE(p_payload->>'completed_at', '') !~
          '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
       OR p_payload->>'status' NOT IN ('complete', 'partial', 'failed')
       OR jsonb_typeof(p_payload->'observations') <> 'array'
       OR jsonb_array_length(p_payload->'observations') NOT BETWEEN 1 AND 64
       OR COALESCE(p_payload->>'observation_count', '') !~ '^[1-9][0-9]?$'
       OR (p_payload->>'observation_count')::INTEGER
          <> jsonb_array_length(p_payload->'observations')
       OR (p_payload->>'completed_at')::TIMESTAMPTZ
          < (p_payload->>'started_at')::TIMESTAMPTZ THEN
      RETURN QUERY SELECT
        'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
        'INVALID_RUN'::TEXT, v_now;
      RETURN;
    END IF;

    v_logical_id := (p_payload->>'run_id')::UUID;
    SELECT *
    INTO v_existing_receipt
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.guardian_instance_id = v_credential.instance_id
      AND receipt.endpoint_path = '/internal/guardian/v1/runs'
      AND receipt.logical_id = v_logical_id
      AND receipt.mutation_result = 'created';

    IF FOUND THEN
      IF v_existing_receipt.body_sha256 <> p_body_sha256 THEN
        RETURN QUERY SELECT
          'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
          'LOGICAL_ID_CONFLICT'::TEXT, v_now;
        RETURN;
      END IF;

      v_logical_duplicate := true;
      v_original_receipt_id := v_existing_receipt.id;
      v_observation_count := v_existing_receipt.accepted_observation_count;
      SELECT run.id
      INTO v_record_id
      FROM guardian_runs run
      WHERE run.ingestion_receipt_id = v_existing_receipt.id;
    ELSE
      FOR v_observation IN
        SELECT value FROM jsonb_array_elements(p_payload->'observations')
      LOOP
        IF jsonb_typeof(v_observation) <> 'object'
           OR (v_observation - ARRAY[
             'check_key', 'observed_at', 'state', 'severity', 'failure_code',
             'summary_code', 'duration_ms', 'facts'
           ]::TEXT[]) <> '{}'::jsonb
           OR COALESCE(v_observation->>'check_key', '') !~
              '^[a-z][a-z0-9_.-]{2,95}$'
           OR COALESCE(v_observation->>'observed_at', '') !~
              '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
           OR v_observation->>'state' NOT IN (
             'healthy', 'degraded', 'unhealthy', 'unknown'
           )
           OR v_observation->>'severity' NOT IN (
             'info', 'warning', 'urgent', 'critical'
           )
           OR COALESCE(v_observation->>'summary_code', '') !~
              '^[A-Z][A-Z0-9_]{0,63}$'
           OR COALESCE(v_observation->>'duration_ms', '') !~ '^[0-9]{1,7}$'
           OR (v_observation->>'duration_ms')::INTEGER NOT BETWEEN 0 AND 3600000
           OR jsonb_typeof(COALESCE(v_observation->'facts', '{}'::jsonb)) <>
              'object'
           OR pg_column_size(COALESCE(v_observation->'facts', '{}'::jsonb)) >
              4096
           OR (
             SELECT count(*)
             FROM jsonb_object_keys(
               COALESCE(v_observation->'facts', '{}'::jsonb)
             )
           ) > 16 THEN
          RETURN QUERY SELECT
            'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
            'INVALID_OBSERVATION'::TEXT, v_now;
          RETURN;
        END IF;

        SELECT catalog.*
        INTO v_catalog
        FROM guardian_check_catalog catalog
        JOIN guardian_credential_check_keys allowed
          ON allowed.check_key = catalog.check_key
         AND allowed.guardian_credential_id = v_credential.id
         AND allowed.active
        WHERE catalog.check_key = v_observation->>'check_key'
          AND catalog.active;

        IF NOT FOUND
           OR NOT (v_observation->>'summary_code' =
             ANY(v_catalog.allowed_summary_codes))
           OR (
             v_observation->>'state' = 'healthy'
             AND (
               v_observation->>'severity' <> 'info'
               OR v_observation->>'failure_code' IS NOT NULL
             )
           )
           OR (
             v_observation->>'state' <> 'healthy'
             AND (
               v_observation->>'failure_code' IS NULL
               OR NOT (v_observation->>'failure_code' =
                 ANY(v_catalog.allowed_failure_codes))
             )
           ) THEN
          RETURN QUERY SELECT
            'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
            'CHECK_NOT_AUTHORIZED'::TEXT, v_now;
          RETURN;
        END IF;

        FOR v_fact IN
          SELECT key, value
          FROM jsonb_each(COALESCE(v_observation->'facts', '{}'::jsonb))
        LOOP
          SELECT *
          INTO v_metric
          FROM guardian_check_metric_catalog
          WHERE check_key = v_catalog.check_key
            AND metric_key = v_fact.key;

          IF NOT FOUND THEN
            RETURN QUERY SELECT
              'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
              NULL::UUID, 'METRIC_NOT_AUTHORIZED'::TEXT, v_now;
            RETURN;
          END IF;

          IF v_metric.value_type = 'integer' THEN
            IF jsonb_typeof(v_fact.value) <> 'number'
               OR v_fact.value::TEXT !~ '^-?(0|[1-9][0-9]*)$' THEN
              RETURN QUERY SELECT
                'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
                NULL::UUID, 'INVALID_METRIC_VALUE'::TEXT, v_now;
              RETURN;
            END IF;

            v_fact_number := (v_fact.value::TEXT)::NUMERIC;
            IF v_fact_number < v_metric.minimum_integer
               OR v_fact_number > v_metric.maximum_integer
               OR v_fact_number < -9007199254740991
               OR v_fact_number > 9007199254740991 THEN
              RETURN QUERY SELECT
                'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
                NULL::UUID, 'INVALID_METRIC_VALUE'::TEXT, v_now;
              RETURN;
            END IF;
          ELSIF v_metric.value_type = 'boolean' THEN
            IF jsonb_typeof(v_fact.value) <> 'boolean' THEN
              RETURN QUERY SELECT
                'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
                NULL::UUID, 'INVALID_METRIC_VALUE'::TEXT, v_now;
              RETURN;
            END IF;
          ELSE
            IF jsonb_typeof(v_fact.value) <> 'string' THEN
              RETURN QUERY SELECT
                'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
                NULL::UUID, 'INVALID_METRIC_VALUE'::TEXT, v_now;
              RETURN;
            END IF;

            v_fact_text := v_fact.value #>> '{}';
            IF length(v_fact_text) NOT BETWEEN 1 AND 64
               OR v_fact_text !~ '^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,63}$'
               OR (
                 v_metric.token_pattern IS NOT NULL
                 AND v_fact_text !~ v_metric.token_pattern
               )
               OR (
                 v_metric.allowed_token_values IS NOT NULL
                 AND NOT (v_fact_text = ANY(v_metric.allowed_token_values))
               ) THEN
              RETURN QUERY SELECT
                'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0,
                NULL::UUID, 'INVALID_METRIC_VALUE'::TEXT, v_now;
              RETURN;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  ELSIF p_endpoint_path =
    '/internal/guardian/v1/recovery-verifications' THEN
    v_recovery_check_key := CASE p_payload->>'verification_type'
      WHEN 'backup_status' THEN 'recovery.backup.status'
      WHEN 'backup_object' THEN 'recovery.backup.object'
      WHEN 'restore_recency' THEN 'recovery.restore.recency'
      ELSE NULL
    END;

    IF (p_payload - ARRAY[
         'protocol_version', 'instance_id', 'verification_id',
         'verification_type', 'verified_at', 'snapshot_id', 'schema_version',
         'object_count', 'encrypted_bytes', 'result', 'failure_code',
         'proof_sha256'
       ]::TEXT[]) <> '{}'::jsonb
       OR p_payload->>'protocol_version' <> '1'
       OR COALESCE(p_payload->>'instance_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(p_payload->>'verification_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (p_payload->>'instance_id')::UUID <> v_credential.instance_id
       OR COALESCE(p_payload->>'verified_at', '') !~
          '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
       OR v_recovery_check_key IS NULL
       OR p_payload->>'result' NOT IN ('healthy', 'failed', 'unknown')
       OR COALESCE(p_payload->>'proof_sha256', '') !~ '^[0-9a-f]{64}$'
       OR (
         p_payload->>'result' = 'healthy'
         AND p_payload->>'failure_code' IS NOT NULL
       )
       OR (
         p_payload->>'result' <> 'healthy'
         AND p_payload->>'failure_code' NOT IN (
           'BACKUP_COMMAND_FAILED',
           'BACKUP_STALE',
           'BACKUP_STATUS_MISSING',
           'BACKUP_OBJECT_MISSING',
           'BACKUP_OBJECT_MISMATCH',
           'RESTORE_OVERDUE',
           'RESTORE_PROOF_MISSING',
           'STATUS_UNAVAILABLE',
           'VERIFICATION_TIMEOUT'
         )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM guardian_credential_check_keys allowed
         JOIN guardian_check_catalog catalog
           ON catalog.check_key = allowed.check_key
          AND catalog.active
         WHERE allowed.guardian_credential_id = v_credential.id
           AND allowed.check_key = v_recovery_check_key
           AND allowed.active
       ) THEN
      RETURN QUERY SELECT
        'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
        'INVALID_RECOVERY_VERIFICATION'::TEXT, v_now;
      RETURN;
    END IF;

    v_logical_id := (p_payload->>'verification_id')::UUID;
    SELECT *
    INTO v_existing_receipt
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.guardian_instance_id = v_credential.instance_id
      AND receipt.endpoint_path =
        '/internal/guardian/v1/recovery-verifications'
      AND receipt.logical_id = v_logical_id
      AND receipt.mutation_result = 'created';

    IF FOUND THEN
      IF v_existing_receipt.body_sha256 <> p_body_sha256 THEN
        RETURN QUERY SELECT
          'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
          'LOGICAL_ID_CONFLICT'::TEXT, v_now;
        RETURN;
      END IF;

      v_logical_duplicate := true;
      v_original_receipt_id := v_existing_receipt.id;
      SELECT verification.id
      INTO v_record_id
      FROM recovery_verifications verification
      WHERE verification.ingestion_receipt_id = v_existing_receipt.id;
    END IF;
  ELSIF p_endpoint_path = '/internal/guardian/v1/alert-deliveries' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_payload)) <> 16
       OR (p_payload - ARRAY[
         'protocol_version', 'instance_id', 'delivery_id', 'alert_id',
         'incident_id', 'provider_name', 'event_type', 'check_key',
         'severity', 'attempt_number', 'state', 'occurred_at',
         'provider_reference_sha256', 'notification_channels',
         'failure_code', 'envelope_sha256'
       ]::TEXT[]) <> '{}'::jsonb
       OR p_payload->>'protocol_version' <> '1'
       OR COALESCE(p_payload->>'instance_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (p_payload->>'instance_id')::UUID <> v_credential.instance_id
       OR COALESCE(p_payload->>'delivery_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(p_payload->>'alert_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(p_payload->>'incident_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_payload->>'provider_name' <> 'ghl'
       OR p_payload->>'event_type' NOT IN ('opened', 'escalated', 'resolved')
       OR COALESCE(p_payload->>'check_key', '') !~
          '^[a-z][a-z0-9_.-]{2,95}$'
       OR p_payload->>'severity' NOT IN (
         'info', 'warning', 'urgent', 'critical'
       )
       OR COALESCE(p_payload->>'attempt_number', '') !~ '^[1-9][0-9]{0,2}$'
       OR (p_payload->>'attempt_number')::INTEGER NOT BETWEEN 1 AND 100
       OR p_payload->>'state' NOT IN ('accepted', 'notified', 'failed')
       OR COALESCE(p_payload->>'occurred_at', '') !~
          '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
       OR COALESCE(p_payload->>'envelope_sha256', '') !~ '^[0-9a-f]{64}$'
       OR (
         p_payload->>'provider_reference_sha256' IS NOT NULL
         AND p_payload->>'provider_reference_sha256' !~ '^[0-9a-f]{64}$'
       )
       OR jsonb_typeof(p_payload->'notification_channels') <> 'array'
       OR jsonb_array_length(p_payload->'notification_channels') > 2
       OR (
         p_payload->>'state' = 'accepted'
         AND (
           p_payload->'notification_channels' <> '[]'::jsonb
           OR p_payload->>'failure_code' IS NOT NULL
         )
       )
       OR (
         p_payload->>'state' = 'notified'
         AND (
           p_payload->'notification_channels' <> CASE
             WHEN p_payload->>'severity' IN ('urgent', 'critical')
             THEN '["email","sms"]'::jsonb
             ELSE '["email"]'::jsonb
           END
           OR p_payload->>'provider_reference_sha256' IS NULL
           OR p_payload->>'failure_code' IS NOT NULL
         )
       )
       OR (
         p_payload->>'state' = 'failed'
         AND (
           p_payload->'notification_channels' <> '[]'::jsonb
           OR p_payload->>'provider_reference_sha256' IS NOT NULL
           OR p_payload->>'failure_code' NOT IN (
             'GHL_ACCEPTANCE_UNKNOWN',
             'GHL_ALERT_UNAVAILABLE',
             'GHL_PROVIDER_ERROR',
             'GHL_RATE_LIMITED',
             'GHL_REJECTED',
             'GHL_UNREACHABLE',
             'PROCESS_INTERRUPTED_AFTER_SEND'
           )
         )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM guardian_credential_check_keys allowed
         JOIN guardian_check_catalog catalog
           ON catalog.check_key = allowed.check_key
          AND catalog.active
         WHERE allowed.guardian_credential_id = v_credential.id
           AND allowed.check_key = p_payload->>'check_key'
           AND allowed.active
       ) THEN
      RETURN QUERY SELECT
        'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
        'INVALID_ALERT_DELIVERY'::TEXT, v_now;
      RETURN;
    END IF;

    v_logical_id := (p_payload->>'delivery_id')::UUID;
    SELECT *
    INTO v_existing_receipt
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.guardian_instance_id = v_credential.instance_id
      AND receipt.endpoint_path = '/internal/guardian/v1/alert-deliveries'
      AND receipt.logical_id = v_logical_id
      AND receipt.mutation_result = 'created';

    IF FOUND THEN
      IF v_existing_receipt.body_sha256 <> p_body_sha256 THEN
        RETURN QUERY SELECT
          'rejected'::TEXT, NULL::UUID, NULL::UUID, NULL::BIGINT, 0, NULL::UUID,
          'LOGICAL_ID_CONFLICT'::TEXT, v_now;
        RETURN;
      END IF;

      v_logical_duplicate := true;
      v_original_receipt_id := v_existing_receipt.id;
      SELECT alert.id
      INTO v_record_id
      FROM alert_deliveries alert
      WHERE alert.ingestion_receipt_id = v_existing_receipt.id;
    END IF;
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
    accepted_observation_count,
    duplicate_of_receipt_id
  ) VALUES (
    v_credential.id,
    v_credential.instance_id,
    p_sequence,
    p_protocol_version,
    p_endpoint_path,
    p_http_method,
    p_request_timestamp,
    v_now,
    p_body_sha256,
    CASE WHEN v_logical_duplicate THEN 'logical_duplicate' ELSE 'created' END,
    v_logical_id,
    CASE
      WHEN p_endpoint_path = '/internal/guardian/v1/runs'
      THEN (p_payload->>'observation_count')::INTEGER
      ELSE 0
    END,
    v_original_receipt_id
  )
  RETURNING id INTO v_receipt_id;

  IF NOT v_logical_duplicate
     AND p_endpoint_path = '/internal/guardian/v1/runs' THEN
    FOR v_observation IN
      SELECT value FROM jsonb_array_elements(p_payload->'observations')
    LOOP
      CASE v_observation->>'state'
        WHEN 'healthy' THEN v_healthy_count := v_healthy_count + 1;
        WHEN 'degraded' THEN v_degraded_count := v_degraded_count + 1;
        WHEN 'unhealthy' THEN v_unhealthy_count := v_unhealthy_count + 1;
        WHEN 'unknown' THEN v_unknown_count := v_unknown_count + 1;
        ELSE
          RAISE EXCEPTION 'INVALID_OBSERVATION_STATE';
      END CASE;
    END LOOP;

    INSERT INTO guardian_runs (
      source_run_id,
      guardian_credential_id,
      guardian_instance_id,
      agent_version,
      started_at,
      completed_at,
      status,
      observation_count,
      healthy_count,
      degraded_count,
      unhealthy_count,
      unknown_count,
      payload_sha256,
      ingestion_receipt_id
    ) VALUES (
      (p_payload->>'run_id')::UUID,
      v_credential.id,
      v_credential.instance_id,
      p_payload->>'agent_version',
      (p_payload->>'started_at')::TIMESTAMPTZ,
      (p_payload->>'completed_at')::TIMESTAMPTZ,
      p_payload->>'status',
      (p_payload->>'observation_count')::INTEGER,
      v_healthy_count,
      v_degraded_count,
      v_unhealthy_count,
      v_unknown_count,
      p_body_sha256,
      v_receipt_id
    )
    RETURNING id INTO v_record_id;

    FOR v_observation IN
      SELECT value FROM jsonb_array_elements(p_payload->'observations')
    LOOP
      SELECT *
      INTO v_catalog
      FROM guardian_check_catalog
      WHERE check_key = v_observation->>'check_key';

      INSERT INTO guardian_observations (
        guardian_run_id,
        guardian_credential_id,
        guardian_instance_id,
        check_key,
        scope_type,
        source_type,
        state,
        severity,
        failure_code,
        summary_code,
        duration_ms,
        facts,
        observed_at,
        valid_until,
        evidence_sha256,
        parent_check_key
      ) VALUES (
        v_record_id,
        v_credential.id,
        v_credential.instance_id,
        v_catalog.check_key,
        v_catalog.scope_type,
        v_catalog.authorized_source,
        v_observation->>'state',
        v_observation->>'severity',
        NULLIF(v_observation->>'failure_code', ''),
        v_observation->>'summary_code',
        (v_observation->>'duration_ms')::INTEGER,
        COALESCE(v_observation->'facts', '{}'::jsonb),
        (v_observation->>'observed_at')::TIMESTAMPTZ,
        (v_observation->>'observed_at')::TIMESTAMPTZ
          + make_interval(secs => v_catalog.freshness_threshold_seconds),
        encode(
          extensions.digest(
            convert_to(v_observation::TEXT, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        v_catalog.parent_check_key
      );
    END LOOP;

    v_observation_count := (p_payload->>'observation_count')::INTEGER;
  ELSIF NOT v_logical_duplicate AND p_endpoint_path =
    '/internal/guardian/v1/recovery-verifications' THEN
    INSERT INTO recovery_verifications (
      source_verification_id,
      guardian_credential_id,
      guardian_instance_id,
      verification_type,
      snapshot_id,
      verified_at,
      result,
      schema_version,
      object_count,
      encrypted_bytes,
      proof_sha256,
      failure_code,
      ingestion_receipt_id
    ) VALUES (
      (p_payload->>'verification_id')::UUID,
      v_credential.id,
      v_credential.instance_id,
      p_payload->>'verification_type',
      NULLIF(p_payload->>'snapshot_id', ''),
      (p_payload->>'verified_at')::TIMESTAMPTZ,
      p_payload->>'result',
      NULLIF(p_payload->>'schema_version', '')::INTEGER,
      NULLIF(p_payload->>'object_count', '')::BIGINT,
      NULLIF(p_payload->>'encrypted_bytes', '')::BIGINT,
      p_payload->>'proof_sha256',
      NULLIF(p_payload->>'failure_code', ''),
      v_receipt_id
    )
    RETURNING id INTO v_record_id;
  ELSIF NOT v_logical_duplicate
     AND p_endpoint_path = '/internal/guardian/v1/alert-deliveries' THEN
    INSERT INTO alert_deliveries (
      source_delivery_id,
      source_alert_id,
      guardian_credential_id,
      guardian_instance_id,
      guardian_incident_id,
      provider_name,
      event_type,
      check_key,
      severity,
      provider_reference_sha256,
      attempt_number,
      state,
      occurred_at,
      notification_channels,
      failure_code,
      envelope_sha256,
      ingestion_receipt_id
    ) VALUES (
      (p_payload->>'delivery_id')::UUID,
      (p_payload->>'alert_id')::UUID,
      v_credential.id,
      v_credential.instance_id,
      (p_payload->>'incident_id')::UUID,
      p_payload->>'provider_name',
      p_payload->>'event_type',
      p_payload->>'check_key',
      p_payload->>'severity',
      NULLIF(p_payload->>'provider_reference_sha256', ''),
      (p_payload->>'attempt_number')::INTEGER,
      p_payload->>'state',
      (p_payload->>'occurred_at')::TIMESTAMPTZ,
      ARRAY(
        SELECT jsonb_array_elements_text(p_payload->'notification_channels')
      ),
      NULLIF(p_payload->>'failure_code', ''),
      p_payload->>'envelope_sha256',
      v_receipt_id
    )
    RETURNING id INTO v_record_id;
  END IF;

  UPDATE guardian_credentials
  SET
    last_sequence = p_sequence,
    last_request_method = p_http_method,
    last_request_path = p_endpoint_path,
    last_request_body_sha256 = p_body_sha256,
    last_receipt_id = v_receipt_id,
    last_accepted_at = v_now,
    updated_at = v_now
  WHERE id = v_credential.id;

  RETURN QUERY SELECT
    CASE
      WHEN v_logical_duplicate THEN 'logical_duplicate'
      ELSE 'accepted'
    END::TEXT,
    v_receipt_id,
    v_original_receipt_id,
    p_sequence,
    v_observation_count,
    v_record_id,
    NULL::TEXT,
    v_now;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION run_guardian_retention(
  p_batch_size INTEGER DEFAULT 5000
)
RETURNS TABLE (
  observations_deleted INTEGER,
  runs_deleted INTEGER,
  receipts_deleted INTEGER,
  alert_deliveries_deleted INTEGER,
  recovery_verifications_deleted INTEGER
) AS $$
DECLARE
  v_limit INTEGER := GREATEST(100, LEAST(COALESCE(p_batch_size, 5000), 10000));
  v_observations INTEGER := 0;
  v_runs INTEGER := 0;
  v_receipts INTEGER := 0;
  v_duplicate_receipts INTEGER := 0;
  v_alerts INTEGER := 0;
  v_recovery INTEGER := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('guardian-retention', 0)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  PERFORM set_config('scalesafe.guardian_retention', 'on', true);

  WITH candidate AS (
    SELECT id
    FROM guardian_observations
    WHERE observed_at < clock_timestamp() - interval '90 days'
    ORDER BY observed_at
    LIMIT v_limit
  )
  DELETE FROM guardian_observations observation
  USING candidate
  WHERE observation.id = candidate.id;
  GET DIAGNOSTICS v_observations = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM guardian_runs
    WHERE completed_at < clock_timestamp() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM guardian_observations observation
        WHERE observation.guardian_run_id = guardian_runs.id
      )
    ORDER BY completed_at
    LIMIT v_limit
  )
  DELETE FROM guardian_runs run
  USING candidate
  WHERE run.id = candidate.id;
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM alert_deliveries
    WHERE occurred_at < clock_timestamp() - interval '3 years'
    ORDER BY occurred_at
    LIMIT v_limit
  )
  DELETE FROM alert_deliveries delivery
  USING candidate
  WHERE delivery.id = candidate.id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM recovery_verifications
    WHERE verified_at < clock_timestamp() - interval '3 years'
    ORDER BY verified_at
    LIMIT v_limit
  )
  DELETE FROM recovery_verifications verification
  USING candidate
  WHERE verification.id = candidate.id;
  GET DIAGNOSTICS v_recovery = ROW_COUNT;

  WITH candidate AS (
    SELECT receipt.id
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.received_at < clock_timestamp() - interval '3 years'
      AND receipt.duplicate_of_receipt_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM guardian_runs run
        WHERE run.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM recovery_verifications verification
        WHERE verification.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM alert_deliveries delivery
        WHERE delivery.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM guardian_credentials credential
        WHERE credential.last_receipt_id = receipt.id
      )
    ORDER BY receipt.received_at
    LIMIT v_limit
  )
  DELETE FROM guardian_ingestion_receipts receipt
  USING candidate
  WHERE receipt.id = candidate.id;
  GET DIAGNOSTICS v_duplicate_receipts = ROW_COUNT;

  WITH candidate AS (
    SELECT receipt.id
    FROM guardian_ingestion_receipts receipt
    WHERE receipt.received_at < clock_timestamp() - interval '3 years'
      AND receipt.duplicate_of_receipt_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM guardian_runs run
        WHERE run.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM recovery_verifications verification
        WHERE verification.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM alert_deliveries delivery
        WHERE delivery.ingestion_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM guardian_ingestion_receipts duplicate
        WHERE duplicate.duplicate_of_receipt_id = receipt.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM guardian_credentials credential
        WHERE credential.last_receipt_id = receipt.id
      )
    ORDER BY receipt.received_at
    LIMIT v_limit
  )
  DELETE FROM guardian_ingestion_receipts receipt
  USING candidate
  WHERE receipt.id = candidate.id;
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  v_receipts := v_receipts + v_duplicate_receipts;

  RETURN QUERY SELECT
    v_observations, v_runs, v_receipts, v_alerts, v_recovery;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'guardian_credentials',
    'guardian_check_catalog',
    'guardian_check_metric_catalog',
    'guardian_credential_check_keys',
    'guardian_ingestion_receipts',
    'guardian_runs',
    'guardian_observations',
    'guardian_rate_limit_buckets',
    'alert_routes',
    'alert_deliveries',
    'recovery_verifications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'Service role full access',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access',
      v_table
    );
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION validate_guardian_credential()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_guardian_history_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_guardian_request(
  UUID, BIGINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION run_guardian_retention(INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_guardian_request(
  UUID, BIGINT, SMALLINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION run_guardian_retention(INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 109;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
