-- 104_command_center_health_and_incidents.sql
-- Phase 2 foundation for isolated Command Center health, durable scheduled
-- jobs, merchant rollups, and incidents. Browser roles receive no direct
-- access. Runtime activation remains controlled by a separate feature flag.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS health_check_definitions (
  check_key TEXT PRIMARY KEY CHECK (check_key ~ '^[a-z0-9_.-]{3,160}$'),
  contract_version TEXT NOT NULL CHECK (length(contract_version) BETWEEN 1 AND 80),
  scope_type TEXT NOT NULL CHECK (scope_type IN (
    'platform', 'worker', 'job', 'queue', 'merchant', 'provider'
  )),
  category TEXT NOT NULL CHECK (category IN (
    'application', 'database', 'worker', 'job', 'queue', 'installation',
    'processor', 'workflow', 'evidence', 'defense', 'billing', 'security',
    'recovery'
  )),
  cadence_seconds INTEGER NOT NULL CHECK (cadence_seconds BETWEEN 1 AND 604800),
  timeout_seconds INTEGER CHECK (timeout_seconds BETWEEN 1 AND 604800),
  stale_after_seconds INTEGER CHECK (stale_after_seconds BETWEEN 1 AND 2592000),
  incident_after_seconds INTEGER CHECK (incident_after_seconds BETWEEN 1 AND 2592000),
  consecutive_failure_threshold INTEGER NOT NULL DEFAULT 1
    CHECK (consecutive_failure_threshold BETWEEN 1 AND 100),
  recovery_dwell_seconds INTEGER NOT NULL DEFAULT 300
    CHECK (recovery_dwell_seconds BETWEEN 0 AND 604800),
  default_severity TEXT NOT NULL CHECK (default_severity IN (
    'critical', 'urgent', 'warning', 'info'
  )),
  confirmation_seconds INTEGER NOT NULL DEFAULT 21600
    CHECK (confirmation_seconds BETWEEN 300 AND 2592000),
  suppressible BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_heartbeats (
  worker_key TEXT PRIMARY KEY REFERENCES health_check_definitions(check_key) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'failed', 'timed_out', 'unknown')),
  instance_id TEXT NOT NULL CHECK (length(instance_id) BETWEEN 1 AND 200),
  productive_tick BOOLEAN NOT NULL DEFAULT true CHECK (productive_tick = true),
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ NOT NULL,
  state_changed_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  work_count INTEGER NOT NULL DEFAULT 0 CHECK (work_count >= 0),
  error_class TEXT CHECK (error_class IS NULL OR length(error_class) <= 160),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  last_persisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_heartbeats_completed
  ON service_heartbeats (last_completed_at);

-- Operational scheduling is deliberately independent from health definitions.
-- A broken or disabled health contract must not suppress merchant-facing jobs.
CREATE TABLE IF NOT EXISTS scheduled_job_definitions (
  job_key TEXT PRIMARY KEY CHECK (job_key ~ '^job\.[a-z0-9_.-]{3,156}$'),
  job_class TEXT NOT NULL CHECK (job_class IN (
    'merchant_operation', 'health_monitoring'
  )),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key TEXT NOT NULL REFERENCES scheduled_job_definitions(job_key) ON DELETE RESTRICT,
  scheduled_window_start TIMESTAMPTZ NOT NULL,
  scheduled_window_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'running', 'succeeded', 'failed', 'timed_out', 'exhausted', 'missed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_class TEXT CHECK (error_class IS NULL OR length(error_class) <= 160),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result_summary) = 'object' AND pg_column_size(result_summary) <= 8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheduled_window_end > scheduled_window_start),
  CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running')
  ),
  UNIQUE (job_key, scheduled_window_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_job_runs_one_running
  ON scheduled_job_runs (job_key)
  WHERE status IN ('running', 'timed_out');

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_claim
  ON scheduled_job_runs (status, available_at, scheduled_window_start)
  WHERE status IN ('scheduled', 'failed');

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_history
  ON scheduled_job_runs (job_key, scheduled_window_start DESC);

CREATE TABLE IF NOT EXISTS health_current (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN (
    'platform', 'worker', 'job', 'queue', 'merchant', 'provider'
  )),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 200),
  location_id TEXT,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL REFERENCES health_check_definitions(check_key) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
  )),
  severity TEXT CHECK (severity IS NULL OR severity IN (
    'critical', 'urgent', 'warning', 'info'
  )),
  failure_class TEXT CHECK (failure_class IS NULL OR length(failure_class) <= 160),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metrics) = 'object' AND pg_column_size(metrics) <= 8192),
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  last_evaluated_at TIMESTAMPTZ NOT NULL,
  state_changed_at TIMESTAMPTZ NOT NULL,
  healthy_since TIMESTAMPTZ,
  nonhealthy_since TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  consecutive_healthy INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_healthy >= 0),
  last_history_at TIMESTAMPTZ,
  contract_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, check_key),
  CHECK (
    (scope_type = 'merchant' AND location_id IS NOT NULL AND merchant_id IS NOT NULL)
    OR scope_type <> 'merchant'
  )
);

CREATE INDEX IF NOT EXISTS idx_health_current_location
  ON health_current (location_id, state, severity)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_health_current_check_state
  ON health_current (check_key, state, last_observed_at);

CREATE INDEX IF NOT EXISTS idx_health_current_page
  ON health_current (last_observed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS health_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_current_id UUID NOT NULL REFERENCES health_current(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  location_id TEXT,
  check_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
  )),
  severity TEXT CHECK (severity IS NULL OR severity IN (
    'critical', 'urgent', 'warning', 'info'
  )),
  failure_class TEXT,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metrics) = 'object' AND pg_column_size(metrics) <= 8192),
  observation_type TEXT NOT NULL CHECK (observation_type IN (
    'initial', 'transition', 'confirmation', 'recovery'
  )),
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_observations_current_time
  ON health_observations (health_current_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_observations_location_time
  ON health_observations (location_id, observed_at DESC)
  WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS merchant_health_rollups (
  location_id TEXT PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL CHECK (length(merchant_name) BETWEEN 1 AND 300),
  overall_state TEXT NOT NULL DEFAULT 'unknown' CHECK (overall_state IN (
    'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
  )),
  highest_incident_severity TEXT CHECK (highest_incident_severity IS NULL OR highest_incident_severity IN (
    'critical', 'urgent', 'warning', 'info'
  )),
  installation_state TEXT NOT NULL DEFAULT 'unknown',
  processor_state TEXT NOT NULL DEFAULT 'unknown',
  workflow_state TEXT NOT NULL DEFAULT 'unknown',
  evidence_state TEXT NOT NULL DEFAULT 'unknown',
  defense_state TEXT NOT NULL DEFAULT 'unknown',
  billing_state TEXT NOT NULL DEFAULT 'unknown',
  open_critical_count INTEGER NOT NULL DEFAULT 0 CHECK (open_critical_count >= 0),
  open_urgent_count INTEGER NOT NULL DEFAULT 0 CHECK (open_urgent_count >= 0),
  open_warning_count INTEGER NOT NULL DEFAULT 0 CHECK (open_warning_count >= 0),
  needs_attention_count INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention_count >= 0),
  last_observed_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_version TEXT NOT NULL DEFAULT 'command-center-health-v1.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (installation_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')),
  CHECK (processor_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')),
  CHECK (workflow_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')),
  CHECK (evidence_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')),
  CHECK (defense_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')),
  CHECK (billing_state IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_health_rollups_state
  ON merchant_health_rollups (overall_state, highest_incident_severity, last_reconciled_at);

CREATE INDEX IF NOT EXISTS idx_merchant_health_rollups_page
  ON merchant_health_rollups (
    needs_attention_count DESC,
    last_reconciled_at DESC,
    location_id ASC
  );

CREATE TABLE IF NOT EXISTS platform_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key CHAR(64) NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN (
    'platform', 'worker', 'job', 'queue', 'merchant', 'provider'
  )),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 200),
  location_id TEXT,
  check_key TEXT NOT NULL REFERENCES health_check_definitions(check_key) ON DELETE RESTRICT,
  failure_class TEXT NOT NULL CHECK (length(failure_class) BETWEEN 1 AND 160),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'urgent', 'warning', 'info')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'acknowledged', 'mitigating', 'resolved', 'suppressed'
  )),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  recovery_candidate_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  mitigating_at TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ,
  suppressed_until TIMESTAMPTZ,
  suppressed_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  suppression_reason TEXT CHECK (suppression_reason IS NULL OR length(suppression_reason) <= 500),
  resolved_at TIMESTAMPTZ,
  parent_incident_id UUID REFERENCES platform_incidents(id) ON DELETE SET NULL,
  suppressible BOOLEAN NOT NULL DEFAULT true,
  runbook_key TEXT CHECK (runbook_key IS NULL OR length(runbook_key) <= 160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  ),
  CHECK (
    (status = 'suppressed' AND suppressed_at IS NOT NULL AND suppressed_until IS NOT NULL
      AND suppressed_by_operator_user_id IS NOT NULL AND suppression_reason IS NOT NULL)
    OR status <> 'suppressed'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_incidents_one_active
  ON platform_incidents (dedupe_key)
  WHERE status IN ('open', 'acknowledged', 'mitigating', 'suppressed');

CREATE INDEX IF NOT EXISTS idx_platform_incidents_location_status
  ON platform_incidents (location_id, status, severity, last_seen_at DESC)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_incidents_status_severity
  ON platform_incidents (status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_incidents_active_page
  ON platform_incidents (last_seen_at DESC, id DESC)
  WHERE status <> 'resolved';

CREATE INDEX IF NOT EXISTS idx_platform_incidents_all_page
  ON platform_incidents (last_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'opened', 'observed', 'acknowledged', 'mitigating', 'suppressed',
    'suppression_expired', 'recovery_started', 'resolved', 'reopened',
    'parent_linked', 'parent_unlinked'
  )),
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN (
    'system', 'operator', 'guardian'
  )),
  actor_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident_time
  ON incident_events (incident_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS health_dirty_scopes (
  location_id TEXT PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  first_marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  claimed_through_at TIMESTAMPTZ,
  last_error_class TEXT,
  last_error_message TEXT CHECK (last_error_message IS NULL OR length(last_error_message) <= 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_dirty_scopes_claim
  ON health_dirty_scopes (available_at, lease_expires_at, last_marked_at);

CREATE TABLE IF NOT EXISTS application_metric_buckets (
  instance_id TEXT NOT NULL CHECK (length(instance_id) BETWEEN 1 AND 200),
  bucket_started_at TIMESTAMPTZ NOT NULL,
  bucket_ended_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  client_error_count INTEGER NOT NULL DEFAULT 0 CHECK (client_error_count >= 0),
  server_error_count INTEGER NOT NULL DEFAULT 0 CHECK (server_error_count >= 0),
  supabase_request_count INTEGER NOT NULL DEFAULT 0 CHECK (supabase_request_count >= 0),
  command_center_supabase_request_count INTEGER NOT NULL DEFAULT 0
    CHECK (command_center_supabase_request_count >= 0),
  provider_request_count INTEGER NOT NULL DEFAULT 0
    CHECK (provider_request_count >= 0),
  database_timeout_count INTEGER NOT NULL DEFAULT 0 CHECK (database_timeout_count >= 0),
  database_canary_latency_ms INTEGER
    CHECK (database_canary_latency_ms IS NULL OR database_canary_latency_ms >= 0),
  database_canary_failed BOOLEAN NOT NULL DEFAULT false,
  latency_p50_ms INTEGER CHECK (latency_p50_ms IS NULL OR latency_p50_ms >= 0),
  latency_p95_ms INTEGER CHECK (latency_p95_ms IS NULL OR latency_p95_ms >= 0),
  latency_max_ms INTEGER CHECK (latency_max_ms IS NULL OR latency_max_ms >= 0),
  route_groups JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(route_groups) = 'object' AND pg_column_size(route_groups) <= 8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, bucket_started_at),
  CHECK (bucket_ended_at > bucket_started_at)
);

CREATE INDEX IF NOT EXISTS idx_application_metric_buckets_time
  ON application_metric_buckets (bucket_started_at DESC);

CREATE OR REPLACE FUNCTION command_center_database_canary()
RETURNS TIMESTAMPTZ AS $$
  SELECT clock_timestamp();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

INSERT INTO health_check_definitions (
  check_key, contract_version, scope_type, category, cadence_seconds,
  timeout_seconds, stale_after_seconds, incident_after_seconds,
  consecutive_failure_threshold, recovery_dwell_seconds, default_severity,
  confirmation_seconds, suppressible, config
) VALUES
  ('worker.trigger_delivery', 'command-center-health-v1.1', 'worker', 'worker', 60, 120, 600, 900, 1, 600, 'urgent', 21600, true, '{"lease_seconds":180}'::jsonb),
  ('worker.external_evidence', 'command-center-health-v1.1', 'worker', 'worker', 60, 75, 600, 900, 1, 600, 'urgent', 21600, true, '{"lease_seconds":90}'::jsonb),
  ('worker.money_reconciliation', 'command-center-health-v1.1', 'worker', 'worker', 60, 90, 300, 600, 1, 600, 'urgent', 21600, false, '{"lease_seconds":120}'::jsonb),
  ('worker.defense_compilation', 'command-center-health-v1.1', 'worker', 'worker', 60, 270, 600, 900, 1, 600, 'urgent', 21600, true, '{"lease_seconds":300}'::jsonb),
  ('job.provisioning_recovery', 'command-center-health-v1.1', 'job', 'job', 300, 240, 900, 1200, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('job.payment_reminder_check', 'command-center-health-v1.1', 'job', 'job', 3600, 600, 4500, 7200, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('job.pulse_cadence_check', 'command-center-health-v1.1', 'job', 'job', 3600, 600, 4500, 7200, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('job.daily_account_health', 'command-center-health-v1.1', 'job', 'job', 86400, 3600, 108000, 172800, 1, 600, 'warning', 21600, true, '{"max_supported_merchants":2000,"urgent_after_seconds":172800}'::jsonb),
  ('job.pif_completion_check', 'command-center-health-v1.1', 'job', 'job', 86400, 1800, 108000, 172800, 1, 600, 'warning', 21600, true, '{"urgent_after_seconds":172800}'::jsonb),
  ('job.command_center_health_reconcile', 'command-center-health-v1.1', 'job', 'job', 300, 240, 900, 1200, 1, 600, 'urgent', 21600, true, '{"includes":["global_evaluation","dirty_merchant_reconciliation"]}'::jsonb),
  ('job.merchant_health_full_sweep', 'command-center-health-v1.1', 'job', 'job', 86400, 1800, 108000, 172800, 1, 600, 'warning', 21600, true, '{"urgent_after_seconds":172800}'::jsonb),
  ('job.health_retention', 'command-center-health-v1.1', 'job', 'job', 86400, 600, 172800, 259200, 1, 300, 'warning', 21600, true, '{}'::jsonb),
  ('queue.trigger_delivery.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 180, 600, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('queue.external_evidence.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 300, 1800, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('queue.money_reconciliation.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 120, 300, 1, 600, 'urgent', 21600, false, '{"unknown_critical_seconds":300,"unresolved_urgent_seconds":600}'::jsonb),
  ('queue.refund_reconciliation.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 120, 300, 1, 600, 'urgent', 21600, false, '{"unresolved_urgent_seconds":300}'::jsonb),
  ('queue.defense_compilation.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 300, 1800, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('queue.provisioning.pending', 'command-center-health-v1.1', 'queue', 'queue', 300, NULL, 1200, 2400, 1, 300, 'warning', 21600, true, '{"entitled_urgent_seconds":3600}'::jsonb),
  ('platform.schema_version', 'command-center-health-v1.1', 'platform', 'database', 300, 30, 300, 300, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('database.canary_latency', 'command-center-health-v1.1', 'platform', 'database', 300, 30, 900, 600, 1, 600, 'urgent', 21600, true, '{"degraded_ms":750,"unhealthy_ms":2000}'::jsonb),
  ('database.request_timeouts', 'command-center-health-v1.1', 'platform', 'database', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{"degraded_count":3,"unhealthy_count":10,"unhealthy_percent":5}'::jsonb),
  ('application.http_5xx', 'command-center-health-v1.1', 'platform', 'application', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{"degraded_count":5,"degraded_percent":2,"unhealthy_count":20,"unhealthy_percent":5}'::jsonb),
  ('application.http_latency', 'command-center-health-v1.1', 'platform', 'application', 300, NULL, 900, 900, 1, 300, 'warning', 21600, true, '{"degraded_p95_ms":1500,"unhealthy_p95_ms":3000}'::jsonb),
  ('security.dangerous_flag_posture', 'command-center-health-v1.1', 'platform', 'security', 900, 30, 900, 900, 1, 600, 'critical', 21600, false, '{}'::jsonb),
  ('merchant.installation', 'command-center-health-v1.1', 'merchant', 'installation', 300, NULL, 1200, 3600, 1, 300, 'warning', 21600, true, '{}'::jsonb),
  ('merchant.money_outcome', 'command-center-health-v1.1', 'merchant', 'processor', 300, NULL, 120, 300, 1, 600, 'critical', 21600, false, '{}'::jsonb),
  ('merchant.refund_outcome', 'command-center-health-v1.1', 'merchant', 'processor', 300, NULL, 120, 300, 1, 600, 'urgent', 21600, false, '{}'::jsonb),
  ('merchant.trigger_delivery', 'command-center-health-v1.1', 'merchant', 'workflow', 300, NULL, 180, 600, 1, 600, 'warning', 21600, true, '{}'::jsonb),
  ('merchant.evidence_connection', 'command-center-health-v1.1', 'merchant', 'evidence', 300, NULL, 300, 1800, 1, 600, 'warning', 21600, true, '{}'::jsonb),
  ('merchant.defense', 'command-center-health-v1.1', 'merchant', 'defense', 300, NULL, 300, 1800, 1, 600, 'warning', 21600, true, '{}'::jsonb),
  ('merchant.billing', 'command-center-health-v1.1', 'merchant', 'billing', 300, NULL, 900, 1800, 1, 600, 'warning', 21600, true, '{}'::jsonb),
  ('provider.supabase', 'command-center-health-v1.1', 'provider', 'database', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.ghl', 'command-center-health-v1.1', 'provider', 'workflow', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.stripe', 'command-center-health-v1.1', 'provider', 'processor', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.nmi', 'command-center-health-v1.1', 'provider', 'processor', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.whop', 'command-center-health-v1.1', 'provider', 'processor', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.zoom', 'command-center-health-v1.1', 'provider', 'evidence', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb),
  ('provider.anthropic', 'command-center-health-v1.1', 'provider', 'defense', 300, NULL, 900, 900, 1, 600, 'urgent', 21600, true, '{}'::jsonb)
ON CONFLICT (check_key) DO UPDATE SET
  contract_version = EXCLUDED.contract_version,
  scope_type = EXCLUDED.scope_type,
  category = EXCLUDED.category,
  cadence_seconds = EXCLUDED.cadence_seconds,
  timeout_seconds = EXCLUDED.timeout_seconds,
  stale_after_seconds = EXCLUDED.stale_after_seconds,
  incident_after_seconds = EXCLUDED.incident_after_seconds,
  consecutive_failure_threshold = EXCLUDED.consecutive_failure_threshold,
  recovery_dwell_seconds = EXCLUDED.recovery_dwell_seconds,
  default_severity = EXCLUDED.default_severity,
  confirmation_seconds = EXCLUDED.confirmation_seconds,
  suppressible = EXCLUDED.suppressible,
  active = true,
  config = EXCLUDED.config,
  updated_at = now();

INSERT INTO scheduled_job_definitions (
  job_key, job_class, description, active
) VALUES
  ('job.provisioning_recovery', 'merchant_operation', 'Recover interrupted merchant provisioning work.', true),
  ('job.payment_reminder_check', 'merchant_operation', 'Find and deliver due payment reminders.', true),
  ('job.pulse_cadence_check', 'merchant_operation', 'Find and deliver due client pulse check-ins.', true),
  ('job.daily_account_health', 'merchant_operation', 'Compute merchant processor account-health snapshots.', true),
  ('job.pif_completion_check', 'merchant_operation', 'Complete paid-in-full enrollments whose program term ended.', true),
  ('job.command_center_health_reconcile', 'health_monitoring', 'Evaluate platform health and reconcile dirty merchant health.', true),
  ('job.merchant_health_full_sweep', 'health_monitoring', 'Reconcile every merchant health rollup in bounded batches.', true),
  ('job.health_retention', 'health_monitoring', 'Apply bounded retention to Command Center health history.', true)
ON CONFLICT (job_key) DO UPDATE SET
  job_class = EXCLUDED.job_class,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = now();

CREATE OR REPLACE FUNCTION record_service_heartbeat(
  p_worker_key TEXT,
  p_instance_id TEXT,
  p_state TEXT,
  p_started_at TIMESTAMPTZ,
  p_completed_at TIMESTAMPTZ,
  p_duration_ms INTEGER,
  p_work_count INTEGER,
  p_error_class TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS service_heartbeats AS $$
DECLARE
  v_result service_heartbeats%ROWTYPE;
BEGIN
  IF p_state NOT IN ('healthy', 'failed', 'timed_out', 'unknown')
     OR p_completed_at IS NULL
     OR p_completed_at > clock_timestamp() + interval '1 minute'
     OR p_completed_at < clock_timestamp() - interval '1 day'
     OR p_instance_id IS NULL
     OR length(p_instance_id) > 200
     OR p_work_count < 0 THEN
    RAISE EXCEPTION 'Invalid service heartbeat';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM health_check_definitions
    WHERE check_key = p_worker_key AND scope_type = 'worker' AND active = true
  ) THEN
    RAISE EXCEPTION 'Unknown worker heartbeat key';
  END IF;

  INSERT INTO service_heartbeats (
    worker_key, state, instance_id, productive_tick, last_started_at,
    last_completed_at, state_changed_at, last_success_at, last_failure_at, duration_ms,
    work_count, error_class, error_message, last_persisted_at, updated_at
  ) VALUES (
    p_worker_key,
    p_state,
    left(p_instance_id, 200),
    true,
    p_started_at,
    p_completed_at,
    p_completed_at,
    CASE WHEN p_state = 'healthy' THEN p_completed_at ELSE NULL END,
    CASE WHEN p_state <> 'healthy' THEN p_completed_at ELSE NULL END,
    p_duration_ms,
    p_work_count,
    NULLIF(left(COALESCE(p_error_class, ''), 160), ''),
    NULLIF(left(COALESCE(p_error_message, ''), 1000), ''),
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (worker_key) DO UPDATE SET
    state = EXCLUDED.state,
    instance_id = EXCLUDED.instance_id,
    last_started_at = EXCLUDED.last_started_at,
    last_completed_at = GREATEST(service_heartbeats.last_completed_at, EXCLUDED.last_completed_at),
    state_changed_at = CASE
      WHEN service_heartbeats.state IS DISTINCT FROM EXCLUDED.state
      THEN EXCLUDED.last_completed_at
      ELSE service_heartbeats.state_changed_at
    END,
    last_success_at = CASE
      WHEN EXCLUDED.state = 'healthy'
      THEN GREATEST(COALESCE(service_heartbeats.last_success_at, '-infinity'::timestamptz), EXCLUDED.last_completed_at)
      ELSE service_heartbeats.last_success_at
    END,
    last_failure_at = CASE
      WHEN EXCLUDED.state <> 'healthy'
      THEN GREATEST(COALESCE(service_heartbeats.last_failure_at, '-infinity'::timestamptz), EXCLUDED.last_completed_at)
      ELSE service_heartbeats.last_failure_at
    END,
    duration_ms = EXCLUDED.duration_ms,
    work_count = EXCLUDED.work_count,
    error_class = EXCLUDED.error_class,
    error_message = EXCLUDED.error_message,
    last_persisted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE EXCLUDED.last_completed_at >= service_heartbeats.last_completed_at
    AND (
      service_heartbeats.state IS DISTINCT FROM EXCLUDED.state
      OR service_heartbeats.error_class IS DISTINCT FROM EXCLUDED.error_class
      -- The money worker has a five-minute stale threshold, so persist its
      -- completed ticks every minute. Other workers have ten-minute stale
      -- thresholds and retain the five-minute write throttle.
      OR EXCLUDED.last_completed_at
        >= service_heartbeats.last_completed_at
          + CASE
              WHEN EXCLUDED.worker_key = 'worker.money_reconciliation'
              THEN interval '1 minute'
              ELSE interval '5 minutes'
            END
    )
  RETURNING * INTO v_result;

  IF v_result.worker_key IS NULL THEN
    SELECT * INTO v_result FROM service_heartbeats WHERE worker_key = p_worker_key;
  END IF;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION claim_scheduled_job_run(
  p_job_key TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_worker_id TEXT,
  p_lease_seconds INTEGER,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS SETOF scheduled_job_runs AS $$
DECLARE
  v_run scheduled_job_runs%ROWTYPE;
BEGIN
  IF p_window_end <= p_window_start
     OR p_worker_id IS NULL
     OR length(p_worker_id) > 200
     OR p_lease_seconds < 30
     OR p_lease_seconds > 86400
     OR p_max_attempts < 1
     OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'Invalid scheduled job claim';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM scheduled_job_definitions
    WHERE job_key = p_job_key AND active = true
  ) THEN
    RAISE EXCEPTION 'Unknown scheduled job key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('scheduled-job:' || p_job_key, 0));

  UPDATE scheduled_job_runs
  SET
    status = CASE WHEN attempt_count >= max_attempts THEN 'exhausted' ELSE 'failed' END,
    completed_at = clock_timestamp(),
    error_class = 'LEASE_EXPIRED',
    error_message = 'Scheduled job lease expired before completion.',
    lease_owner = NULL,
    lease_expires_at = NULL,
    available_at = CASE
      WHEN attempt_count >= max_attempts THEN available_at
      ELSE clock_timestamp() + interval '5 minutes'
    END,
    updated_at = clock_timestamp()
  WHERE job_key = p_job_key
    AND status = 'running'
    AND lease_expires_at <= clock_timestamp();

  UPDATE scheduled_job_runs
  SET
    status = 'missed',
    completed_at = clock_timestamp(),
    error_class = 'MISSED_WINDOW',
    error_message = 'A newer scheduled window superseded this current-state job.',
    updated_at = clock_timestamp()
  WHERE job_key = p_job_key
    AND status IN ('scheduled', 'failed')
    AND scheduled_window_start < p_window_start;

  INSERT INTO scheduled_job_runs (
    job_key, scheduled_window_start, scheduled_window_end, status,
    max_attempts, available_at
  ) VALUES (
    p_job_key, p_window_start, p_window_end, 'scheduled',
    p_max_attempts, clock_timestamp()
  )
  ON CONFLICT (job_key, scheduled_window_start) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM scheduled_job_runs
    WHERE job_key = p_job_key AND status IN ('running', 'timed_out')
  ) THEN
    RETURN;
  END IF;

  UPDATE scheduled_job_runs
  SET
    status = 'running',
    attempt_count = attempt_count + 1,
    lease_owner = left(p_worker_id, 200),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    started_at = clock_timestamp(),
    completed_at = NULL,
    duration_ms = NULL,
    error_class = NULL,
    error_message = NULL,
    updated_at = clock_timestamp()
  WHERE job_key = p_job_key
    AND scheduled_window_start = p_window_start
    AND status IN ('scheduled', 'failed')
    AND attempt_count < max_attempts
    AND available_at <= clock_timestamp()
  RETURNING * INTO v_run;

  IF v_run.id IS NOT NULL THEN
    RETURN NEXT v_run;
  END IF;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION complete_scheduled_job_run(
  p_run_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_processed_count INTEGER DEFAULT 0,
  p_failed_count INTEGER DEFAULT 0,
  p_skipped_count INTEGER DEFAULT 0,
  p_error_class TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_result_summary JSONB DEFAULT '{}'::jsonb
)
RETURNS scheduled_job_runs AS $$
DECLARE
  v_result scheduled_job_runs%ROWTYPE;
  v_final_status TEXT;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed', 'timed_out')
     OR p_processed_count < 0
     OR p_failed_count < 0
     OR p_skipped_count < 0
     OR jsonb_typeof(COALESCE(p_result_summary, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_result_summary, '{}'::jsonb)) > 8192 THEN
    RAISE EXCEPTION 'Invalid scheduled job completion';
  END IF;

  SELECT
    CASE
      WHEN p_status IN ('failed', 'timed_out') AND attempt_count >= max_attempts THEN 'exhausted'
      ELSE p_status
    END
  INTO v_final_status
  FROM scheduled_job_runs
  WHERE id = p_run_id
    AND status = 'running'
    AND lease_owner = p_worker_id
  FOR UPDATE;

  IF v_final_status IS NULL THEN
    RAISE EXCEPTION 'Scheduled job claim is no longer active';
  END IF;

  UPDATE scheduled_job_runs
  SET
    status = v_final_status,
    completed_at = clock_timestamp(),
    duration_ms = CASE
      WHEN started_at IS NULL THEN NULL
      ELSE LEAST(86400000, GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - started_at)) * 1000)::integer))
    END,
    processed_count = GREATEST(processed_count, p_processed_count),
    failed_count = GREATEST(failed_count, p_failed_count),
    skipped_count = GREATEST(skipped_count, p_skipped_count),
    error_class = NULLIF(left(COALESCE(p_error_class, ''), 160), ''),
    error_message = NULLIF(left(COALESCE(p_error_message, ''), 1000), ''),
    result_summary = result_summary || COALESCE(p_result_summary, '{}'::jsonb),
    lease_owner = CASE
      WHEN v_final_status = 'timed_out' THEN lease_owner
      ELSE NULL
    END,
    lease_expires_at = NULL,
    available_at = CASE
      WHEN v_final_status = 'failed' THEN clock_timestamp() + interval '5 minutes'
      ELSE available_at
    END,
    updated_at = clock_timestamp()
  WHERE id = p_run_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION settle_timed_out_scheduled_job_run(
  p_run_id UUID,
  p_worker_id TEXT,
  p_late_outcome TEXT
)
RETURNS scheduled_job_runs AS $$
DECLARE
  v_result scheduled_job_runs%ROWTYPE;
BEGIN
  IF p_late_outcome NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid timed-out job settlement';
  END IF;

  UPDATE scheduled_job_runs
  SET
    status = 'exhausted',
    error_class = 'JOB_TIMEOUT_SETTLED',
    error_message = CASE
      WHEN p_late_outcome = 'completed'
      THEN 'The timed-out execution settled after its approved execution window.'
      ELSE 'The timed-out execution failed after its approved execution window.'
    END,
    result_summary = result_summary || jsonb_build_object(
      'late_outcome',
      p_late_outcome,
      'late_settled_at',
      clock_timestamp()
    ),
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND status = 'timed_out'
    AND lease_owner = p_worker_id
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Timed-out scheduled job quarantine is no longer active';
  END IF;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION record_health_observation(
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_location_id TEXT,
  p_merchant_id UUID,
  p_check_key TEXT,
  p_state TEXT,
  p_severity TEXT,
  p_failure_class TEXT,
  p_summary TEXT,
  p_metrics JSONB,
  p_observed_at TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS TABLE (
  health_current_id UUID,
  incident_id UUID,
  incident_status TEXT,
  history_written BOOLEAN
) AS $$
DECLARE
  v_definition health_check_definitions%ROWTYPE;
  v_previous health_current%ROWTYPE;
  v_current health_current%ROWTYPE;
  v_incident platform_incidents%ROWTYPE;
  v_dedupe_key TEXT;
  v_state_changed BOOLEAN;
  v_write_history BOOLEAN;
  v_observation_type TEXT;
  v_recovery_seconds INTEGER;
  v_required_recovery_observations INTEGER;
  v_incident_failure_class TEXT;
  v_previous_dedupe_key TEXT;
  v_previous_incident platform_incidents%ROWTYPE;
  v_reopened BOOLEAN := false;
  v_provider TEXT;
BEGIN
  SELECT * INTO v_definition
  FROM health_check_definitions
  WHERE check_key = p_check_key AND active = true;

  IF v_definition.check_key IS NULL
     OR p_scope_type <> v_definition.scope_type
     OR p_state NOT IN ('healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable')
     OR (p_severity IS NOT NULL AND p_severity NOT IN ('critical', 'urgent', 'warning', 'info'))
     OR p_scope_id IS NULL
     OR length(p_scope_id) > 200
     OR p_summary IS NULL
     OR length(p_summary) > 1000
     OR jsonb_typeof(COALESCE(p_metrics, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_metrics, '{}'::jsonb)) > 8192
     OR p_observed_at IS NULL
     OR p_observed_at > clock_timestamp() + interval '1 minute'
     OR (
       p_scope_type = 'merchant'
       AND (p_location_id IS NULL OR p_merchant_id IS NULL)
     ) THEN
    RAISE EXCEPTION 'Invalid health observation';
  END IF;

  IF p_merchant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM merchants
    WHERE id = p_merchant_id AND location_id = p_location_id
  ) THEN
    RAISE EXCEPTION 'Health observation merchant does not match location';
  END IF;

  v_provider := lower(NULLIF(left(COALESCE(p_metrics->>'provider', ''), 40), ''));
  IF v_provider IS NOT NULL
     AND v_provider NOT IN ('supabase', 'ghl', 'stripe', 'nmi', 'whop', 'zoom', 'anthropic') THEN
    v_provider := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'health-current:' || p_scope_type || '|' || p_scope_id || '|' || p_check_key,
    0
  ));

  SELECT * INTO v_previous
  FROM health_current
  WHERE scope_type = p_scope_type
    AND scope_id = p_scope_id
    AND check_key = p_check_key
  FOR UPDATE;

  -- Suppression is a bounded notification state, never durable health truth.
  -- Expire it before the unchanged-observation fast path so a quiet or
  -- recovering check cannot leave an incident suppressed past its deadline.
  WITH expired AS (
    UPDATE platform_incidents
    SET
      status = 'open',
      suppressed_at = NULL,
      suppressed_until = NULL,
      suppressed_by_operator_user_id = NULL,
      suppression_reason = NULL,
      updated_at = clock_timestamp()
    WHERE scope_type = p_scope_type
      AND scope_id = p_scope_id
      AND check_key = p_check_key
      AND status = 'suppressed'
      AND suppressed_until <= p_observed_at
    RETURNING id
  )
  INSERT INTO incident_events (
    incident_id, event_type, summary, metadata, occurred_at
  )
  SELECT
    expired.id,
    'suppression_expired',
    'Incident suppression expired.',
    jsonb_build_object('check_key', p_check_key),
    p_observed_at
  FROM expired;

  -- Durable job rows prove evaluation cadence. Do not rewrite unchanged current
  -- health merely to move a timestamp or refresh volatile healthy metrics.
  -- Contract-version changes carry semantic copy/metric changes. Non-healthy
  -- confirmation remains bounded by the definition's confirmation window, while
  -- an active incident's healthy recovery observations must continue through the
  -- recovery dwell.
  IF v_previous.id IS NOT NULL
     AND v_previous.state = p_state
     AND v_previous.severity IS NOT DISTINCT FROM p_severity
     AND v_previous.failure_class IS NOT DISTINCT FROM NULLIF(left(COALESCE(p_failure_class, ''), 160), '')
     AND v_previous.contract_version = v_definition.contract_version
     AND (
       (
         p_state IN ('healthy', 'not_applicable')
         AND NOT (
           p_state = 'healthy'
           AND EXISTS (
             SELECT 1
             FROM platform_incidents active_incident
             WHERE active_incident.scope_type = p_scope_type
               AND active_incident.scope_id = p_scope_id
               AND active_incident.check_key = p_check_key
               AND active_incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
           )
         )
       )
       OR (
         p_state IN ('degraded', 'unhealthy', 'unknown')
         AND v_previous.summary = left(p_summary, 1000)
         AND v_previous.metrics = COALESCE(p_metrics, '{}'::jsonb)
         AND v_previous.last_history_at IS NOT NULL
         AND v_previous.last_history_at
           > p_observed_at - make_interval(secs => v_definition.confirmation_seconds)
       )
     ) THEN
    RETURN QUERY SELECT v_previous.id, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  IF v_previous.id IS NOT NULL AND p_observed_at <= v_previous.last_observed_at THEN
    RETURN QUERY SELECT v_previous.id, NULL::UUID, NULL::TEXT, false;
    RETURN;
  END IF;

  IF p_state = 'healthy'
     AND NULLIF(left(COALESCE(p_failure_class, ''), 160), '') IS NULL THEN
    SELECT incident.failure_class INTO v_incident_failure_class
    FROM platform_incidents incident
    WHERE incident.scope_type = p_scope_type
      AND incident.scope_id = p_scope_id
      AND incident.check_key = p_check_key
      AND incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
    ORDER BY
      CASE incident.severity
        WHEN 'critical' THEN 1
        WHEN 'urgent' THEN 2
        WHEN 'warning' THEN 3
        ELSE 4
      END,
      incident.last_seen_at DESC
    LIMIT 1;
  END IF;

  v_incident_failure_class := COALESCE(
    v_incident_failure_class,
    NULLIF(left(COALESCE(p_failure_class, ''), 160), ''),
    CASE
      WHEN p_state <> 'unhealthy' THEN v_previous.failure_class
      ELSE NULL
    END,
    'unspecified'
  );

  v_state_changed := v_previous.id IS NULL
    OR v_previous.state IS DISTINCT FROM p_state
    OR v_previous.failure_class IS DISTINCT FROM NULLIF(left(COALESCE(p_failure_class, ''), 160), '');

  INSERT INTO health_current (
    scope_type, scope_id, location_id, merchant_id, check_key, state, severity,
    failure_class, summary, metrics, first_observed_at, last_observed_at,
    last_evaluated_at, state_changed_at, healthy_since, nonhealthy_since,
    consecutive_failures, consecutive_healthy, contract_version, updated_at
  ) VALUES (
    p_scope_type,
    p_scope_id,
    NULLIF(left(COALESCE(p_location_id, ''), 100), ''),
    p_merchant_id,
    p_check_key,
    p_state,
    p_severity,
    NULLIF(left(COALESCE(p_failure_class, ''), 160), ''),
    left(p_summary, 1000),
    COALESCE(p_metrics, '{}'::jsonb),
    p_observed_at,
    p_observed_at,
    p_observed_at,
    p_observed_at,
    CASE WHEN p_state = 'healthy' THEN p_observed_at ELSE NULL END,
    CASE WHEN p_state IN ('degraded', 'unhealthy', 'unknown') THEN p_observed_at ELSE NULL END,
    CASE WHEN p_state IN ('degraded', 'unhealthy', 'unknown') THEN 1 ELSE 0 END,
    CASE WHEN p_state = 'healthy' THEN 1 ELSE 0 END,
    v_definition.contract_version,
    clock_timestamp()
  )
  ON CONFLICT (scope_type, scope_id, check_key) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    merchant_id = EXCLUDED.merchant_id,
    state = EXCLUDED.state,
    severity = EXCLUDED.severity,
    failure_class = EXCLUDED.failure_class,
    summary = EXCLUDED.summary,
    metrics = EXCLUDED.metrics,
    last_observed_at = GREATEST(health_current.last_observed_at, EXCLUDED.last_observed_at),
    last_evaluated_at = GREATEST(health_current.last_evaluated_at, EXCLUDED.last_evaluated_at),
    state_changed_at = CASE
      WHEN health_current.state IS DISTINCT FROM EXCLUDED.state
        OR health_current.failure_class IS DISTINCT FROM EXCLUDED.failure_class
      THEN EXCLUDED.last_observed_at
      ELSE health_current.state_changed_at
    END,
    healthy_since = CASE
      WHEN EXCLUDED.state = 'healthy' AND health_current.state <> 'healthy' THEN EXCLUDED.last_observed_at
      WHEN EXCLUDED.state = 'healthy' THEN COALESCE(health_current.healthy_since, EXCLUDED.last_observed_at)
      ELSE NULL
    END,
    nonhealthy_since = CASE
      WHEN EXCLUDED.state IN ('degraded', 'unhealthy', 'unknown')
        AND health_current.state NOT IN ('degraded', 'unhealthy', 'unknown')
      THEN EXCLUDED.last_observed_at
      WHEN EXCLUDED.state IN ('degraded', 'unhealthy', 'unknown')
      THEN COALESCE(health_current.nonhealthy_since, EXCLUDED.last_observed_at)
      ELSE NULL
    END,
    consecutive_failures = CASE
      WHEN EXCLUDED.state IN ('degraded', 'unhealthy', 'unknown')
      THEN health_current.consecutive_failures + 1
      ELSE 0
    END,
    consecutive_healthy = CASE
      WHEN EXCLUDED.state = 'healthy' THEN health_current.consecutive_healthy + 1
      ELSE 0
    END,
    contract_version = EXCLUDED.contract_version,
    updated_at = clock_timestamp()
  WHERE EXCLUDED.last_observed_at >= health_current.last_observed_at
  RETURNING * INTO v_current;

  IF v_current.id IS NULL THEN
    SELECT * INTO v_current FROM health_current
    WHERE scope_type = p_scope_type AND scope_id = p_scope_id AND check_key = p_check_key;
  END IF;

  v_write_history := v_previous.id IS NULL
    OR v_state_changed
    OR (
      p_state <> 'healthy'
      AND (
        v_previous.last_history_at IS NULL
        OR v_previous.last_history_at <= p_observed_at - make_interval(secs => v_definition.confirmation_seconds)
      )
    );

  v_observation_type := CASE
    WHEN v_previous.id IS NULL THEN 'initial'
    WHEN p_state = 'healthy' AND v_previous.state <> 'healthy' THEN 'recovery'
    WHEN v_state_changed THEN 'transition'
    ELSE 'confirmation'
  END;

  IF v_write_history THEN
    INSERT INTO health_observations (
      health_current_id, scope_type, scope_id, location_id, check_key, state,
      severity, failure_class, summary, metrics, observation_type, observed_at
    ) VALUES (
      v_current.id, p_scope_type, p_scope_id, p_location_id, p_check_key, p_state,
      p_severity, NULLIF(left(COALESCE(p_failure_class, ''), 160), ''),
      left(p_summary, 1000), COALESCE(p_metrics, '{}'::jsonb),
      v_observation_type, p_observed_at
    );
    UPDATE health_current SET last_history_at = p_observed_at WHERE id = v_current.id;
  END IF;

  IF p_state = 'unhealthy'
     AND v_previous.id IS NOT NULL
     AND v_previous.state = 'unhealthy'
     AND COALESCE(v_previous.failure_class, 'unspecified') <> v_incident_failure_class THEN
    v_previous_dedupe_key := encode(extensions.digest(
      convert_to(
        p_scope_type || '|' || p_scope_id || '|' || p_check_key || '|' ||
        COALESCE(v_previous.failure_class, 'unspecified'),
        'UTF8'
      ),
      'sha256'
    ), 'hex');

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'health-incident:' || v_previous_dedupe_key,
      0
    ));

    SELECT * INTO v_previous_incident
    FROM platform_incidents
    WHERE dedupe_key = v_previous_dedupe_key
      AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
    FOR UPDATE;

    IF v_previous_incident.id IS NOT NULL THEN
      UPDATE platform_incidents
      SET
        status = 'resolved',
        resolved_at = p_observed_at,
        recovery_candidate_at = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_previous_incident.id;

      INSERT INTO incident_events (
        incident_id, event_type, summary, metadata, occurred_at
      ) VALUES (
        v_previous_incident.id,
        'resolved',
        'The observed failure class changed; this incident was superseded.',
        jsonb_build_object('superseded_by_failure_class', v_incident_failure_class),
        p_observed_at
      );
    END IF;
  END IF;

  v_dedupe_key := encode(extensions.digest(
    convert_to(
      p_scope_type || '|' || p_scope_id || '|' || p_check_key || '|' ||
      v_incident_failure_class,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended('health-incident:' || v_dedupe_key, 0));

  IF p_state = 'unhealthy' THEN
    SELECT * INTO v_incident
    FROM platform_incidents
    WHERE dedupe_key = v_dedupe_key
      AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
    FOR UPDATE;

    IF v_incident.id IS NOT NULL
       AND v_incident.status = 'suppressed'
       AND (
         v_incident.suppressed_until <= p_observed_at
         OR COALESCE(p_severity, v_definition.default_severity) = 'critical'
       ) THEN
      UPDATE platform_incidents
      SET
        status = 'open',
        suppressed_at = NULL,
        suppressed_until = NULL,
        suppressed_by_operator_user_id = NULL,
        suppression_reason = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_incident.id
      RETURNING * INTO v_incident;

      INSERT INTO incident_events (
        incident_id, event_type, summary, metadata, occurred_at
      ) VALUES (
        v_incident.id,
        'suppression_expired',
        CASE
          WHEN COALESCE(p_severity, v_definition.default_severity) = 'critical'
          THEN 'Suppression ended because the incident escalated to critical.'
          ELSE 'Incident suppression expired.'
        END,
        jsonb_build_object('check_key', p_check_key),
        p_observed_at
      );
    END IF;

    IF v_incident.id IS NULL THEN
      SELECT * INTO v_incident
      FROM platform_incidents
      WHERE dedupe_key = v_dedupe_key
        AND status = 'resolved'
        AND resolved_at >= p_observed_at - interval '24 hours'
      ORDER BY resolved_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_incident.id IS NOT NULL THEN
        UPDATE platform_incidents
        SET
          status = 'open',
          severity = COALESCE(p_severity, v_definition.default_severity),
          summary = left(p_summary, 1000),
          occurrence_count = occurrence_count + 1,
          last_seen_at = p_observed_at,
          recovery_candidate_at = NULL,
          resolved_at = NULL,
          suppressed_at = NULL,
          suppressed_until = NULL,
          suppressed_by_operator_user_id = NULL,
          suppression_reason = NULL,
          metadata = metadata || jsonb_strip_nulls(jsonb_build_object('provider', v_provider)),
          updated_at = clock_timestamp()
        WHERE id = v_incident.id
        RETURNING * INTO v_incident;

        INSERT INTO incident_events (
          incident_id, event_type, summary, metadata, occurred_at
        ) VALUES (
          v_incident.id, 'reopened', left(p_summary, 1000),
          jsonb_build_object('check_key', p_check_key), p_observed_at
        );
        v_reopened := true;
      END IF;
    END IF;

    IF v_incident.id IS NULL THEN
      INSERT INTO platform_incidents (
        dedupe_key, scope_type, scope_id, location_id, check_key, failure_class,
        severity, status, title, summary, first_seen_at, last_seen_at,
        suppressible, metadata
      ) VALUES (
        v_dedupe_key, p_scope_type, p_scope_id, p_location_id, p_check_key,
        COALESCE(NULLIF(left(COALESCE(p_failure_class, ''), 160), ''), 'unspecified'),
        COALESCE(p_severity, v_definition.default_severity),
        'open',
        left(replace(p_check_key, '.', ' '), 300),
        left(p_summary, 1000),
        p_observed_at,
        p_observed_at,
        v_definition.suppressible
          AND COALESCE(p_severity, v_definition.default_severity) <> 'critical',
        jsonb_strip_nulls(jsonb_build_object(
          'contract_version', v_definition.contract_version,
          'provider', v_provider
        ))
      )
      RETURNING * INTO v_incident;

      INSERT INTO incident_events (
        incident_id, event_type, summary, metadata, occurred_at
      ) VALUES (
        v_incident.id, 'opened', left(p_summary, 1000),
        jsonb_build_object('check_key', p_check_key), p_observed_at
      );
    ELSIF NOT v_reopened THEN
      UPDATE platform_incidents
      SET
        severity = COALESCE(p_severity, severity),
        summary = left(p_summary, 1000),
        occurrence_count = occurrence_count + 1,
        last_seen_at = GREATEST(last_seen_at, p_observed_at),
        recovery_candidate_at = NULL,
        metadata = metadata || jsonb_strip_nulls(jsonb_build_object('provider', v_provider)),
        updated_at = clock_timestamp()
      WHERE id = v_incident.id
      RETURNING * INTO v_incident;
    END IF;
  ELSE
    SELECT * INTO v_incident
    FROM platform_incidents
    WHERE dedupe_key = v_dedupe_key
      AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
    FOR UPDATE;

    IF v_incident.id IS NOT NULL AND p_state = 'healthy' THEN
      v_recovery_seconds := CASE
        WHEN v_incident.severity IN ('critical', 'urgent') THEN 600
        WHEN v_incident.severity = 'warning' THEN 300
        ELSE 0
      END;
      v_required_recovery_observations := CASE
        WHEN v_incident.severity IN ('critical', 'urgent') THEN 3
        WHEN v_incident.severity = 'warning' THEN 2
        ELSE 1
      END;

      IF v_incident.recovery_candidate_at IS NULL THEN
        UPDATE platform_incidents
        SET recovery_candidate_at = p_observed_at, updated_at = clock_timestamp()
        WHERE id = v_incident.id
        RETURNING * INTO v_incident;
        INSERT INTO incident_events (
          incident_id, event_type, summary, occurred_at
        ) VALUES (
          v_incident.id, 'recovery_started', 'Healthy recovery dwell started.', p_observed_at
        );
      ELSIF p_observed_at >= v_incident.recovery_candidate_at + make_interval(secs => v_recovery_seconds)
        AND v_current.consecutive_healthy >= v_required_recovery_observations THEN
        UPDATE platform_incidents
        SET
          status = 'resolved',
          resolved_at = p_observed_at,
          last_seen_at = GREATEST(last_seen_at, p_observed_at),
          updated_at = clock_timestamp()
        WHERE id = v_incident.id
        RETURNING * INTO v_incident;
        INSERT INTO incident_events (
          incident_id, event_type, summary, occurred_at
        ) VALUES (
          v_incident.id, 'resolved', 'Health remained recovered through the required dwell.', p_observed_at
        );
      END IF;
    ELSIF v_incident.id IS NOT NULL THEN
      UPDATE platform_incidents
      SET recovery_candidate_at = NULL, updated_at = clock_timestamp()
      WHERE id = v_incident.id
      RETURNING * INTO v_incident;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_current.id,
    v_incident.id,
    v_incident.status,
    v_write_history;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reconcile_command_center_provider_incidents()
RETURNS INTEGER AS $$
DECLARE
  v_provider RECORD;
  v_candidate RECORD;
  v_active_locations INTEGER;
  v_parent_id UUID;
  v_evaluated INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR v_provider IN
    SELECT *
    FROM (VALUES
      ('supabase', 'provider.supabase'),
      ('ghl', 'provider.ghl'),
      ('stripe', 'provider.stripe'),
      ('nmi', 'provider.nmi'),
      ('whop', 'provider.whop'),
      ('zoom', 'provider.zoom'),
      ('anthropic', 'provider.anthropic')
    ) AS providers(provider_key, check_key)
  LOOP
    v_active_locations := CASE v_provider.provider_key
      WHEN 'stripe' THEN (
        SELECT count(DISTINCT merchant.location_id)::integer
        FROM merchants merchant
        WHERE merchant.status = 'active'
          AND (
            merchant.stripe_connected = true
            OR EXISTS (
              SELECT 1
              FROM processor_configs config
              WHERE config.merchant_id = merchant.id
                AND config.location_id = merchant.location_id
                AND config.processor_type = 'stripe'
                AND config.is_active = true
            )
          )
      )
      WHEN 'nmi' THEN (
        SELECT count(DISTINCT merchant.location_id)::integer
        FROM merchants merchant
        WHERE merchant.status = 'active'
          AND EXISTS (
            SELECT 1
            FROM processor_configs config
            WHERE config.merchant_id = merchant.id
              AND config.location_id = merchant.location_id
              AND config.processor_type = 'nmi'
              AND config.is_active = true
          )
      )
      WHEN 'whop' THEN (
        SELECT count(DISTINCT merchant.location_id)::integer
        FROM merchants merchant
        WHERE merchant.status = 'active'
          AND EXISTS (
            SELECT 1
            FROM whop_configs config
            WHERE config.merchant_id = merchant.id
              AND config.location_id = merchant.location_id
              AND config.status = 'connected'
          )
      )
      WHEN 'zoom' THEN (
        SELECT count(DISTINCT merchant.location_id)::integer
        FROM merchants merchant
        WHERE merchant.status = 'active'
          AND EXISTS (
            SELECT 1
            FROM evidence_connections connection
            WHERE connection.merchant_id = merchant.id
              AND connection.location_id = merchant.location_id
              AND connection.provider_key = 'zoom'
              AND connection.status = 'active'
              AND connection.setup_status = 'active'
          )
      )
      ELSE (
        SELECT count(*)::integer
        FROM merchants
        WHERE status = 'active'
      )
    END;

    SELECT
      incident.failure_class,
      count(DISTINCT incident.location_id)::integer AS affected_locations
    INTO v_candidate
    FROM platform_incidents incident
    WHERE incident.scope_type = 'merchant'
      AND incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
      AND incident.last_seen_at >= v_now - interval '15 minutes'
      AND incident.metadata->>'provider' = v_provider.provider_key
      AND incident.severity <> 'critical'
      AND incident.suppressible = true
      AND incident.check_key NOT IN ('merchant.money_outcome', 'merchant.refund_outcome')
      AND incident.failure_class IN (
        'DEPENDENCY_NETWORK_ERROR',
        'PROVIDER_API_UNAVAILABLE',
        'PROVIDER_RATE_LIMIT',
        'PROVIDER_TIMEOUT',
        'GHL_TRIGGER_DELIVERY_FAILED',
        'STRIPE_API_UNAVAILABLE',
        'NMI_API_UNAVAILABLE',
        'WHOP_API_UNAVAILABLE',
        'ZOOM_API_UNAVAILABLE',
        'ANTHROPIC_API_UNAVAILABLE',
        'SUPABASE_TIMEOUT'
      )
      AND incident.failure_class !~ '(CROSS_TENANT|WRONG_MONEY|DUPLICATE_MONEY|MONEY_OUTCOME|REFUND_OUTCOME)'
    GROUP BY incident.failure_class
    HAVING count(DISTINCT incident.location_id) >= 10
       OR (
         count(DISTINCT incident.location_id) >= 3
         AND v_active_locations > 0
         AND count(DISTINCT incident.location_id) * 2 >= v_active_locations
       )
    ORDER BY count(DISTINCT incident.location_id) DESC, incident.failure_class
    LIMIT 1;

    IF v_candidate.failure_class IS NOT NULL THEN
      PERFORM record_health_observation(
        'provider',
        v_provider.provider_key,
        NULL,
        NULL,
        v_provider.check_key,
        'unhealthy',
        'urgent',
        v_candidate.failure_class,
        'Multiple active merchant locations are reporting the same provider failure.',
        jsonb_build_object(
          'provider', v_provider.provider_key,
          'affected_locations', v_candidate.affected_locations,
          'active_locations', v_active_locations,
          'window_minutes', 15
        ),
        v_now
      );
    ELSE
      PERFORM record_health_observation(
        'provider',
        v_provider.provider_key,
        NULL,
        NULL,
        v_provider.check_key,
        'healthy',
        NULL,
        NULL,
        'No provider-wide merchant failure threshold is active.',
        jsonb_build_object(
          'provider', v_provider.provider_key,
          'active_locations', v_active_locations,
          'window_minutes', 15
        ),
        v_now
      );
    END IF;
    v_evaluated := v_evaluated + 1;

    SELECT incident.id INTO v_parent_id
    FROM platform_incidents incident
    WHERE incident.scope_type = 'provider'
      AND incident.scope_id = v_provider.provider_key
      AND incident.check_key = v_provider.check_key
      AND incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
    ORDER BY incident.last_seen_at DESC
    LIMIT 1;

    IF v_parent_id IS NOT NULL AND v_candidate.failure_class IS NOT NULL THEN
      WITH linked AS (
        UPDATE platform_incidents child
        SET
          parent_incident_id = v_parent_id,
          updated_at = clock_timestamp()
        WHERE child.scope_type = 'merchant'
          AND child.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
          AND child.last_seen_at >= v_now - interval '15 minutes'
          AND child.metadata->>'provider' = v_provider.provider_key
          AND child.failure_class = v_candidate.failure_class
          AND child.severity <> 'critical'
          AND child.suppressible = true
          AND child.check_key NOT IN ('merchant.money_outcome', 'merchant.refund_outcome')
          AND child.parent_incident_id IS DISTINCT FROM v_parent_id
        RETURNING child.id
      )
      INSERT INTO incident_events (
        incident_id, event_type, summary, metadata, occurred_at
      )
      SELECT
        linked.id,
        'parent_linked',
        'Merchant notification was linked to an active provider-wide incident.',
        jsonb_build_object('parent_incident_id', v_parent_id),
        v_now
      FROM linked;
    END IF;
  END LOOP;

  WITH unlinked AS (
    UPDATE platform_incidents child
    SET
      parent_incident_id = NULL,
      updated_at = clock_timestamp()
    FROM platform_incidents parent
    WHERE child.parent_incident_id = parent.id
      AND child.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
      AND parent.scope_type = 'provider'
      AND parent.status = 'resolved'
    RETURNING child.id, parent.id AS prior_parent_id
  )
  INSERT INTO incident_events (
    incident_id, event_type, summary, metadata, occurred_at
  )
  SELECT
    unlinked.id,
    'parent_unlinked',
    'Provider-wide notification suppression ended.',
    jsonb_build_object('prior_parent_incident_id', unlinked.prior_parent_id),
    v_now
  FROM unlinked;

  RETURN v_evaluated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION evaluate_command_center_global_health(
  p_code_schema_version INTEGER,
  p_runtime_environment TEXT DEFAULT 'production',
  p_dangerous_flags TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS TABLE (
  evaluated_count INTEGER,
  database_schema_version INTEGER
) AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_database_version INTEGER;
  v_evaluated INTEGER := 0;
  v_definition health_check_definitions%ROWTYPE;
  v_heartbeat service_heartbeats%ROWTYPE;
  v_latest_job scheduled_job_runs%ROWTYPE;
  v_last_success_at TIMESTAMPTZ;
  v_reference_at TIMESTAMPTZ;
  v_oldest_due TIMESTAMPTZ;
  v_age_seconds NUMERIC;
  v_count INTEGER;
  v_secondary_count INTEGER;
  v_exhausted_count INTEGER;
  v_unknown_count INTEGER;
  v_request_count INTEGER;
  v_server_error_count INTEGER;
  v_database_timeout_count INTEGER;
  v_bucket_count INTEGER;
  v_high_bucket_count INTEGER;
  v_latency_p95_ms INTEGER;
  v_canary_latency_ms INTEGER;
  v_canary_failed_count INTEGER;
  v_error_percent NUMERIC;
  v_state TEXT;
  v_severity TEXT;
  v_failure_class TEXT;
  v_summary TEXT;
BEGIN
  IF p_code_schema_version IS NULL OR p_code_schema_version < 1 THEN
    RAISE EXCEPTION 'Code schema version is required';
  END IF;

  SELECT scalesafe_schema_version() INTO v_database_version;
  IF v_database_version < p_code_schema_version THEN
    v_state := 'unhealthy';
    v_severity := 'urgent';
    v_failure_class := 'DATABASE_SCHEMA_BEHIND_CODE';
    v_summary := 'The database schema is behind the running application code.';
  ELSIF v_database_version > p_code_schema_version THEN
    v_state := 'degraded';
    v_severity := 'info';
    v_failure_class := 'DATABASE_SCHEMA_AHEAD_OF_CODE';
    v_summary := 'The database schema is ahead of the running application code.';
  ELSE
    v_state := 'healthy';
    v_severity := NULL;
    v_failure_class := NULL;
    v_summary := 'The database schema matches the running application code.';
  END IF;

  PERFORM record_health_observation(
    'platform', 'database', NULL, NULL, 'platform.schema_version',
    v_state, v_severity, v_failure_class, v_summary,
    jsonb_build_object(
      'database_schema_version', v_database_version,
      'code_schema_version', p_code_schema_version
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  IF lower(COALESCE(p_runtime_environment, '')) <> 'production'
     OR COALESCE(cardinality(p_dangerous_flags), 0) > 0 THEN
    v_state := 'unhealthy';
    v_severity := 'critical';
    v_failure_class := 'DANGEROUS_PRODUCTION_FLAG_POSTURE';
    v_summary := 'The running service is not using the approved production safety posture.';
  ELSE
    v_state := 'healthy';
    v_severity := NULL;
    v_failure_class := NULL;
    v_summary := 'Production safety flags are in the approved posture.';
  END IF;

  PERFORM record_health_observation(
    'platform', 'application', NULL, NULL, 'security.dangerous_flag_posture',
    v_state, v_severity, v_failure_class, v_summary,
    jsonb_build_object(
      'runtime_environment', left(COALESCE(p_runtime_environment, 'missing'), 40),
      'unsafe_flag_names', to_jsonb(COALESCE(p_dangerous_flags, ARRAY[]::TEXT[]))
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  FOR v_definition IN
    SELECT * FROM health_check_definitions
    WHERE active = true AND scope_type = 'worker'
    ORDER BY check_key
  LOOP
    SELECT * INTO v_heartbeat
    FROM service_heartbeats
    WHERE worker_key = v_definition.check_key;

    v_reference_at := COALESCE(v_heartbeat.last_completed_at, v_definition.created_at);
    v_age_seconds := GREATEST(0, extract(epoch FROM (v_now - v_reference_at)));
    v_severity := NULL;
    v_failure_class := NULL;

    IF v_heartbeat.worker_key IS NULL THEN
      IF v_age_seconds > v_definition.incident_after_seconds THEN
        v_state := 'unhealthy';
        v_severity := v_definition.default_severity;
        v_failure_class := 'WORKER_HEARTBEAT_MISSING';
        v_summary := 'The worker has not completed a productive tick.';
      ELSE
        v_state := 'unknown';
        v_severity := 'info';
        v_summary := 'The worker has not reported its first productive tick.';
      END IF;
    ELSIF v_age_seconds > v_definition.incident_after_seconds THEN
      v_state := 'unhealthy';
      v_severity := v_definition.default_severity;
      v_failure_class := 'WORKER_HEARTBEAT_STALE';
      v_summary := 'The worker heartbeat exceeded its incident window.';
    ELSIF v_age_seconds > v_definition.stale_after_seconds THEN
      v_state := 'degraded';
      v_severity := v_definition.default_severity;
      v_failure_class := 'WORKER_HEARTBEAT_STALE';
      v_summary := 'The worker heartbeat is stale.';
    ELSIF v_heartbeat.state <> 'healthy'
      AND extract(epoch FROM (v_now - v_heartbeat.state_changed_at))
        > v_definition.incident_after_seconds THEN
      v_state := 'unhealthy';
      v_severity := v_definition.default_severity;
      v_failure_class := COALESCE(v_heartbeat.error_class, 'WORKER_TICK_FAILED');
      v_summary := 'The worker has remained failed through its incident window.';
    ELSIF v_heartbeat.state <> 'healthy' THEN
      v_state := 'degraded';
      v_severity := v_definition.default_severity;
      v_failure_class := COALESCE(v_heartbeat.error_class, 'WORKER_TICK_FAILED');
      v_summary := 'The latest worker tick did not complete normally.';
    ELSE
      v_state := 'healthy';
      v_summary := 'The worker is completing productive ticks.';
    END IF;

    PERFORM record_health_observation(
      'worker', v_definition.check_key, NULL, NULL, v_definition.check_key,
      v_state, v_severity, v_failure_class, v_summary,
      jsonb_build_object(
        'heartbeat_age_seconds', floor(v_age_seconds),
        'last_state', COALESCE(v_heartbeat.state, 'missing'),
        'work_count', COALESCE(v_heartbeat.work_count, 0)
      ),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_definition IN
    SELECT * FROM health_check_definitions
    WHERE active = true AND scope_type = 'job'
    ORDER BY check_key
  LOOP
    SELECT * INTO v_latest_job
    FROM scheduled_job_runs
    WHERE job_key = v_definition.check_key
    ORDER BY scheduled_window_start DESC
    LIMIT 1;

    SELECT max(completed_at) INTO v_last_success_at
    FROM scheduled_job_runs
    WHERE job_key = v_definition.check_key
      AND status = 'succeeded'
      AND failed_count = 0;

    v_reference_at := COALESCE(v_last_success_at, v_definition.created_at);
    v_age_seconds := GREATEST(0, extract(epoch FROM (v_now - v_reference_at)));
    v_severity := NULL;
    v_failure_class := NULL;

    IF v_latest_job.id IS NOT NULL AND v_latest_job.status = 'exhausted' THEN
      v_state := 'unhealthy';
      v_severity := v_definition.default_severity;
      v_failure_class := 'SCHEDULED_JOB_EXHAUSTED';
      v_summary := 'The latest scheduled window exhausted all attempts.';
    ELSIF v_latest_job.status = 'succeeded'
      AND v_latest_job.failed_count > 0
      AND v_latest_job.processed_count = 0 THEN
      v_state := 'unhealthy';
      v_severity := v_definition.default_severity;
      v_failure_class := 'SCHEDULED_JOB_ALL_ITEMS_FAILED';
      v_summary := 'Every attempted item in the latest scheduled job window failed.';
    ELSIF v_age_seconds > v_definition.incident_after_seconds THEN
      v_state := 'unhealthy';
      v_severity := v_definition.default_severity;
      v_failure_class := 'SCHEDULED_JOB_OVERDUE';
      v_summary := 'The scheduled job has no success inside its incident window.';
    ELSIF v_latest_job.status = 'succeeded'
      AND v_latest_job.failed_count > 0 THEN
      v_state := 'degraded';
      v_severity := v_definition.default_severity;
      v_failure_class := 'SCHEDULED_JOB_PARTIAL_FAILURE';
      v_summary := 'One or more items in the latest scheduled job window failed.';
    ELSIF v_age_seconds > v_definition.stale_after_seconds THEN
      v_state := 'degraded';
      v_severity := v_definition.default_severity;
      v_failure_class := 'SCHEDULED_JOB_OVERDUE';
      v_summary := 'The scheduled job success is stale.';
    ELSIF v_latest_job.id IS NULL THEN
      v_state := 'unknown';
      v_severity := 'info';
      v_summary := 'The scheduled job has not completed its first window.';
    ELSIF v_latest_job.status IN ('failed', 'timed_out') THEN
      v_state := 'degraded';
      v_severity := v_definition.default_severity;
      v_failure_class := CASE
        WHEN v_latest_job.status = 'timed_out' THEN 'SCHEDULED_JOB_TIMED_OUT'
        ELSE COALESCE(v_latest_job.error_class, 'SCHEDULED_JOB_FAILED')
      END;
      v_summary := 'The latest scheduled job window did not complete normally.';
    ELSE
      v_state := 'healthy';
      v_summary := 'The scheduled job has a current successful run.';
    END IF;

    IF v_state = 'unhealthy'
       AND v_definition.config ? 'urgent_after_seconds'
       AND v_age_seconds >= (v_definition.config->>'urgent_after_seconds')::integer THEN
      v_severity := 'urgent';
    END IF;

    PERFORM record_health_observation(
      'job', v_definition.check_key, NULL, NULL, v_definition.check_key,
      v_state, v_severity, v_failure_class, v_summary,
      jsonb_build_object(
        'success_age_seconds', floor(v_age_seconds),
        'latest_status', COALESCE(v_latest_job.status, 'missing'),
        'latest_attempt_count', COALESCE(v_latest_job.attempt_count, 0),
        'latest_processed_count', COALESCE(v_latest_job.processed_count, 0),
        'latest_failed_count', COALESCE(v_latest_job.failed_count, 0),
        'latest_skipped_count', COALESCE(v_latest_job.skipped_count, 0)
      ),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  SELECT
    count(*)::integer,
    min(CASE
      WHEN status = 'pending' THEN GREATEST(created_at, available_at)
      ELSE created_at
    END),
    count(*) FILTER (WHERE status = 'unknown')::integer
  INTO v_count, v_oldest_due, v_unknown_count
  FROM trigger_delivery_jobs
  WHERE (status = 'pending' AND available_at <= v_now)
     OR (status = 'processing' AND lease_expires_at <= v_now)
     OR status = 'unknown';
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  v_state := CASE WHEN v_age_seconds > 600 THEN 'unhealthy'
    WHEN v_age_seconds > 180 OR v_unknown_count > 0 THEN 'degraded' ELSE 'healthy' END;
  PERFORM record_health_observation(
    'queue', 'queue.trigger_delivery.pending', NULL, NULL, 'queue.trigger_delivery.pending',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'TRIGGER_DELIVERY_BACKLOG' END,
    CASE WHEN v_state = 'healthy' THEN 'The trigger delivery queue is current.'
      ELSE 'Trigger delivery work requires attention.' END,
    jsonb_build_object('due_count', v_count, 'oldest_due_age_seconds', floor(v_age_seconds), 'unknown_count', v_unknown_count),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    count(*)::integer,
    min(COALESCE(next_attempt_at, received_at))
  INTO v_count, v_oldest_due
  FROM external_evidence_events
  WHERE (
      status IN ('received', 'verified', 'retrying')
      AND COALESCE(next_attempt_at, received_at) <= v_now
    )
    OR (
      status = 'resolving'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= v_now
    );
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  v_state := CASE WHEN v_age_seconds > 1800 THEN 'unhealthy'
    WHEN v_age_seconds > 300 THEN 'degraded' ELSE 'healthy' END;
  PERFORM record_health_observation(
    'queue', 'queue.external_evidence.pending', NULL, NULL, 'queue.external_evidence.pending',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'EXTERNAL_EVIDENCE_BACKLOG' END,
    CASE WHEN v_state = 'healthy' THEN 'The external evidence queue is current.'
      ELSE 'External evidence processing is behind.' END,
    jsonb_build_object('due_count', v_count, 'oldest_due_age_seconds', floor(v_age_seconds)),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    count(*) FILTER (
      WHERE status = 'provider_accepted'
        AND reconciliation_attempts < 10
        AND COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at) <= v_now
        AND (reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at <= v_now)
    )::integer,
    min(COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at)) FILTER (
      WHERE status = 'provider_accepted'
        AND reconciliation_attempts < 10
        AND COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at) <= v_now
        AND (reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at <= v_now)
    ),
    count(*) FILTER (
      WHERE status = 'unknown'
        AND COALESCE(provider_started_at, created_at) <= v_now - interval '5 minutes'
    )::integer,
    count(*) FILTER (
      WHERE status = 'provider_accepted'
        AND (
          reconciliation_attempts >= 10
          OR COALESCE(provider_accepted_at, created_at) <= v_now - interval '10 minutes'
        )
    )::integer
  INTO v_count, v_oldest_due, v_unknown_count, v_exhausted_count
  FROM money_operations
  WHERE status IN ('processing', 'provider_accepted', 'unknown');
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  IF v_unknown_count > 0 THEN
    v_state := 'unhealthy'; v_severity := 'critical'; v_failure_class := 'MONEY_OUTCOME_UNKNOWN';
  ELSIF v_exhausted_count > 0 OR v_age_seconds > 300 THEN
    v_state := 'unhealthy'; v_severity := 'urgent'; v_failure_class := 'MONEY_RECONCILIATION_STALLED';
  ELSIF v_age_seconds > 120 THEN
    v_state := 'degraded'; v_severity := 'urgent'; v_failure_class := 'MONEY_RECONCILIATION_BACKLOG';
  ELSE
    v_state := 'healthy'; v_severity := NULL; v_failure_class := NULL;
  END IF;
  PERFORM record_health_observation(
    'queue', 'queue.money_reconciliation.pending', NULL, NULL, 'queue.money_reconciliation.pending',
    v_state, v_severity, v_failure_class,
    CASE WHEN v_state = 'healthy' THEN 'Money reconciliation is current.'
      ELSE 'Unresolved money operations require attention.' END,
    jsonb_build_object(
      'due_count', v_count,
      'oldest_due_age_seconds', floor(v_age_seconds),
      'unknown_over_five_minutes', v_unknown_count,
      'stalled_or_exhausted_count', v_exhausted_count
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    count(*) FILTER (
      WHERE status = 'provider_accepted'
        AND reconciliation_attempts < 10
        AND COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at) <= v_now
        AND (reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at <= v_now)
    )::integer,
    min(COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at)) FILTER (
      WHERE status = 'provider_accepted'
        AND reconciliation_attempts < 10
        AND COALESCE(reconciliation_next_attempt_at, provider_accepted_at, created_at) <= v_now
        AND (reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at <= v_now)
    ),
    count(*) FILTER (
      WHERE status IN ('provider_accepted', 'unknown')
        AND (
          reconciliation_attempts >= 10
          OR COALESCE(provider_accepted_at, provider_started_at, created_at) <= v_now - interval '5 minutes'
        )
    )::integer
  INTO v_count, v_oldest_due, v_exhausted_count
  FROM payment_refund_claims
  WHERE status IN ('processing', 'provider_accepted', 'unknown');
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  v_state := CASE WHEN v_exhausted_count > 0 OR v_age_seconds > 300 THEN 'unhealthy'
    WHEN v_age_seconds > 120 THEN 'degraded' ELSE 'healthy' END;
  PERFORM record_health_observation(
    'queue', 'queue.refund_reconciliation.pending', NULL, NULL, 'queue.refund_reconciliation.pending',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'REFUND_RECONCILIATION_STALLED' END,
    CASE WHEN v_state = 'healthy' THEN 'Refund reconciliation is current.'
      ELSE 'Unresolved processor refunds require attention.' END,
    jsonb_build_object(
      'due_count', v_count,
      'oldest_due_age_seconds', floor(v_age_seconds),
      'stalled_or_exhausted_count', v_exhausted_count
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT count(*)::integer, min(COALESCE(compilation_next_attempt_at, created_at))
  INTO v_count, v_oldest_due
  FROM defense_packets
  WHERE compilation_input IS NOT NULL
    AND compilation_completed_at IS NULL
    AND lifecycle_status = 'pending_submission'
    AND status IN ('pending', 'processing')
    AND COALESCE(compilation_next_attempt_at, created_at) <= v_now
    AND (compilation_lease_expires_at IS NULL OR compilation_lease_expires_at <= v_now);
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  v_state := CASE WHEN v_age_seconds > 1800 THEN 'unhealthy'
    WHEN v_age_seconds > 300 THEN 'degraded' ELSE 'healthy' END;
  PERFORM record_health_observation(
    'queue', 'queue.defense_compilation.pending', NULL, NULL, 'queue.defense_compilation.pending',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'DEFENSE_COMPILATION_BACKLOG' END,
    CASE WHEN v_state = 'healthy' THEN 'The defense compilation queue is current.'
      ELSE 'Defense compilation is behind.' END,
    jsonb_build_object('due_count', v_count, 'oldest_due_age_seconds', floor(v_age_seconds)),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT count(*)::integer, min(updated_at)
  INTO v_count, v_oldest_due
  FROM merchants
  WHERE status = 'active'
    AND snapshot_status IN ('pending', 'failed', 'installing');
  v_age_seconds := CASE WHEN v_oldest_due IS NULL THEN 0
    ELSE GREATEST(0, extract(epoch FROM (v_now - v_oldest_due))) END;
  v_state := CASE WHEN v_age_seconds > 2400 THEN 'unhealthy'
    WHEN v_age_seconds > 1200 THEN 'degraded' ELSE 'healthy' END;
  v_severity := CASE
    WHEN v_state = 'healthy' THEN NULL
    WHEN v_age_seconds > 3600 THEN 'urgent'
    ELSE 'warning'
  END;
  PERFORM record_health_observation(
    'queue', 'queue.provisioning.pending', NULL, NULL, 'queue.provisioning.pending',
    v_state, v_severity,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'PROVISIONING_BACKLOG' END,
    CASE WHEN v_state = 'healthy' THEN 'Provisioning recovery is current.'
      ELSE 'Merchant provisioning requires attention.' END,
    jsonb_build_object('pending_count', v_count, 'oldest_pending_age_seconds', floor(v_age_seconds)),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    COALESCE(sum(period.request_count), 0)::integer,
    COALESCE(sum(period.server_error_count), 0)::integer,
    COALESCE(sum(period.database_timeout_count), 0)::integer,
    count(*)::integer,
    max(period.latency_p95_ms)::integer,
    max(period.database_canary_latency_ms)::integer,
    count(*) FILTER (WHERE period.database_canary_failed)::integer
  INTO
    v_request_count,
    v_server_error_count,
    v_database_timeout_count,
    v_bucket_count,
    v_latency_p95_ms,
    v_canary_latency_ms,
    v_canary_failed_count
  FROM (
    SELECT
      bucket_started_at,
      sum(request_count) AS request_count,
      sum(server_error_count) AS server_error_count,
      sum(database_timeout_count) AS database_timeout_count,
      max(latency_p95_ms) AS latency_p95_ms,
      max(database_canary_latency_ms) AS database_canary_latency_ms,
      bool_or(database_canary_failed) AS database_canary_failed
    FROM application_metric_buckets
    WHERE bucket_started_at >= v_now - interval '15 minutes'
    GROUP BY bucket_started_at
  ) AS period;

  v_error_percent := CASE
    WHEN v_request_count > 0 THEN (v_server_error_count::numeric * 100) / v_request_count
    ELSE 0
  END;
  v_state := CASE
    WHEN v_server_error_count >= 20 AND v_error_percent >= 5 THEN 'unhealthy'
    WHEN v_server_error_count >= 5 AND v_error_percent >= 2 THEN 'degraded'
    ELSE 'healthy'
  END;
  PERFORM record_health_observation(
    'platform', 'application', NULL, NULL, 'application.http_5xx',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'HTTP_5XX_RATE' END,
    CASE WHEN v_state = 'healthy' THEN 'Application server-error volume is within its threshold.'
      ELSE 'Application server-error volume exceeded its threshold.' END,
    jsonb_build_object(
      'window_minutes', 15,
      'request_count', v_request_count,
      'server_error_count', v_server_error_count,
      'server_error_percent', round(v_error_percent, 2)
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  v_state := CASE
    WHEN v_database_timeout_count >= 10
      OR (v_request_count > 0 AND (v_database_timeout_count::numeric * 100) / v_request_count >= 5)
    THEN 'unhealthy'
    WHEN v_database_timeout_count >= 3 THEN 'degraded'
    ELSE 'healthy'
  END;
  PERFORM record_health_observation(
    'platform', 'database', NULL, NULL, 'database.request_timeouts',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'DATABASE_REQUEST_TIMEOUTS' END,
    CASE WHEN v_state = 'healthy' THEN 'Database request timeouts are within their threshold.'
      ELSE 'Database request timeouts exceeded their threshold.' END,
    jsonb_build_object(
      'window_minutes', 15,
      'request_count', v_request_count,
      'database_timeout_count', v_database_timeout_count
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    count(*) FILTER (WHERE period.latency_p95_ms > 1500)::integer,
    count(*) FILTER (WHERE period.latency_p95_ms > 3000)::integer
  INTO v_high_bucket_count, v_secondary_count
  FROM (
    SELECT bucket_started_at, max(latency_p95_ms) AS latency_p95_ms
    FROM application_metric_buckets
    WHERE bucket_started_at >= v_now - interval '15 minutes'
    GROUP BY bucket_started_at
  ) AS period;
  v_state := CASE
    WHEN v_bucket_count >= 3 AND v_secondary_count >= 3 THEN 'unhealthy'
    WHEN v_bucket_count >= 3 AND v_latency_p95_ms > 1500 AND v_high_bucket_count >= 3 THEN 'degraded'
    ELSE 'healthy'
  END;
  PERFORM record_health_observation(
    'platform', 'application', NULL, NULL, 'application.http_latency',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'warning' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'HTTP_LATENCY' END,
    CASE WHEN v_state = 'healthy' THEN 'Application request latency is within its threshold.'
      ELSE 'Application request latency remained above its threshold.' END,
    jsonb_build_object(
      'window_minutes', 15,
      'bucket_count', v_bucket_count,
      'maximum_bucket_p95_ms', v_latency_p95_ms
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  SELECT
    count(*) FILTER (WHERE period.database_canary_latency_ms > 750)::integer,
    count(*) FILTER (WHERE period.database_canary_latency_ms > 2000)::integer
  INTO v_high_bucket_count, v_secondary_count
  FROM (
    SELECT bucket_started_at, max(database_canary_latency_ms) AS database_canary_latency_ms
    FROM application_metric_buckets
    WHERE bucket_started_at >= v_now - interval '15 minutes'
    GROUP BY bucket_started_at
  ) AS period;
  v_state := CASE
    WHEN v_canary_failed_count >= 3 THEN 'unhealthy'
    WHEN v_bucket_count >= 3 AND v_secondary_count >= 2 THEN 'unhealthy'
    WHEN v_bucket_count >= 3 AND v_canary_latency_ms > 750 AND v_high_bucket_count >= 3 THEN 'degraded'
    ELSE 'healthy'
  END;
  PERFORM record_health_observation(
    'platform', 'database', NULL, NULL, 'database.canary_latency',
    v_state, CASE WHEN v_state = 'healthy' THEN NULL ELSE 'urgent' END,
    CASE WHEN v_state = 'healthy' THEN NULL ELSE 'DATABASE_CANARY_LATENCY' END,
    CASE WHEN v_state = 'healthy' THEN 'Database canary latency is within its threshold.'
      ELSE 'Database canary checks exceeded their threshold.' END,
    jsonb_build_object(
      'window_minutes', 15,
      'bucket_count', v_bucket_count,
      'maximum_canary_latency_ms', v_canary_latency_ms,
      'failed_canary_count', v_canary_failed_count
    ),
    v_now
  );
  v_evaluated := v_evaluated + 1;

  v_evaluated := v_evaluated + reconcile_command_center_provider_incidents();

  RETURN QUERY SELECT v_evaluated, v_database_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION acknowledge_platform_incident(
  p_incident_id UUID,
  p_actor_operator_user_id UUID,
  p_summary TEXT
)
RETURNS platform_incidents AS $$
DECLARE
  v_result platform_incidents%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(
    p_actor_operator_user_id,
    ARRAY['platform_owner', 'platform_ops']
  ) THEN
    RAISE EXCEPTION 'Incident acknowledgement requires platform operations access';
  END IF;

  UPDATE platform_incidents
  SET
    status = 'acknowledged',
    acknowledged_at = clock_timestamp(),
    acknowledged_by_operator_user_id = p_actor_operator_user_id,
    updated_at = clock_timestamp()
  WHERE id = p_incident_id
    AND status = 'open'
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Incident is not open';
  END IF;

  INSERT INTO incident_events (
    incident_id, event_type, actor_type, actor_operator_user_id, summary
  ) VALUES (
    v_result.id, 'acknowledged', 'operator', p_actor_operator_user_id,
    left(COALESCE(NULLIF(btrim(p_summary), ''), 'Incident acknowledged.'), 1000)
  );
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION suppress_platform_incident(
  p_incident_id UUID,
  p_actor_operator_user_id UUID,
  p_reason TEXT,
  p_until TIMESTAMPTZ
)
RETURNS platform_incidents AS $$
DECLARE
  v_result platform_incidents%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(
    p_actor_operator_user_id,
    ARRAY['platform_owner', 'platform_ops']
  ) THEN
    RAISE EXCEPTION 'Incident suppression requires platform operations access';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0
     OR p_until <= clock_timestamp()
     OR p_until > clock_timestamp() + interval '24 hours' THEN
    RAISE EXCEPTION 'Incident suppression reason or expiration is invalid';
  END IF;

  UPDATE platform_incidents
  SET
    status = 'suppressed',
    suppressed_at = clock_timestamp(),
    suppressed_until = p_until,
    suppressed_by_operator_user_id = p_actor_operator_user_id,
    suppression_reason = left(btrim(p_reason), 500),
    updated_at = clock_timestamp()
  WHERE id = p_incident_id
    AND status IN ('open', 'acknowledged', 'mitigating')
    AND suppressible = true
    AND severity <> 'critical'
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Incident cannot be suppressed';
  END IF;

  INSERT INTO incident_events (
    incident_id, event_type, actor_type, actor_operator_user_id, summary,
    metadata
  ) VALUES (
    v_result.id, 'suppressed', 'operator', p_actor_operator_user_id,
    left(btrim(p_reason), 1000),
    jsonb_build_object('suppressed_until', p_until)
  );
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_health_dirty(
  p_location_id TEXT,
  p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
  v_merchant_id UUID;
  v_reason TEXT;
BEGIN
  v_reason := left(regexp_replace(lower(btrim(COALESCE(p_reason, ''))), '[^a-z0-9_.-]+', '_', 'g'), 80);
  IF length(v_reason) = 0 THEN
    RAISE EXCEPTION 'Health dirty reason is required';
  END IF;

  SELECT id INTO v_merchant_id FROM merchants WHERE location_id = p_location_id;
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Health dirty location does not exist';
  END IF;

  INSERT INTO health_dirty_scopes (
    location_id, merchant_id, reasons, first_marked_at, last_marked_at,
    available_at, updated_at
  ) VALUES (
    p_location_id, v_merchant_id, ARRAY[v_reason], clock_timestamp(),
    clock_timestamp(), clock_timestamp(), clock_timestamp()
  )
  ON CONFLICT (location_id) DO UPDATE SET
    merchant_id = EXCLUDED.merchant_id,
    reasons = (
      SELECT ARRAY(
        SELECT DISTINCT reason
        FROM unnest(health_dirty_scopes.reasons || EXCLUDED.reasons) AS reason
        LIMIT 20
      )
    ),
    last_marked_at = clock_timestamp(),
    available_at = LEAST(health_dirty_scopes.available_at, clock_timestamp()),
    updated_at = clock_timestamp();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION claim_health_dirty_scopes(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 240
)
RETURNS SETOF health_dirty_scopes AS $$
BEGIN
  IF p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 500
     OR p_worker_id IS NULL
     OR length(p_worker_id) < 1
     OR length(p_worker_id) > 200
     OR p_lease_seconds < 30
     OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid health dirty-scope claim';
  END IF;

  RETURN QUERY
  UPDATE health_dirty_scopes dirty
  SET
    attempt_count = dirty.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    claimed_through_at = dirty.last_marked_at,
    updated_at = clock_timestamp()
  WHERE dirty.location_id IN (
    SELECT candidate.location_id
    FROM health_dirty_scopes candidate
    WHERE candidate.available_at <= clock_timestamp()
      AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= clock_timestamp())
    ORDER BY candidate.last_marked_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING dirty.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION complete_health_dirty_scope(
  p_location_id TEXT,
  p_worker_id TEXT,
  p_success BOOLEAN,
  p_error_class TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF p_location_id IS NULL
     OR p_worker_id IS NULL
     OR length(p_worker_id) < 1
     OR length(p_worker_id) > 200 THEN
    RAISE EXCEPTION 'Invalid health dirty-scope completion';
  END IF;

  IF p_success THEN
    DELETE FROM health_dirty_scopes
    WHERE location_id = p_location_id
      AND lease_owner = p_worker_id
      AND last_marked_at <= claimed_through_at;

    UPDATE health_dirty_scopes
    SET
      lease_owner = NULL,
      lease_expires_at = NULL,
      claimed_through_at = NULL,
      attempt_count = 0,
      available_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE location_id = p_location_id
      AND lease_owner = p_worker_id;
  ELSE
    UPDATE health_dirty_scopes
    SET
      lease_owner = NULL,
      lease_expires_at = NULL,
      claimed_through_at = NULL,
      available_at = clock_timestamp() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(attempt_count, 7))::integer)),
      last_error_class = NULLIF(left(COALESCE(p_error_class, ''), 160), ''),
      last_error_message = NULLIF(left(COALESCE(p_error_message, ''), 1000), ''),
      updated_at = clock_timestamp()
    WHERE location_id = p_location_id
      AND lease_owner = p_worker_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reconcile_command_center_merchant_incidents(
  p_location_ids TEXT[] DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_row RECORD;
  v_evaluated INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        merchant.location_id,
        CASE
          WHEN merchant.status = 'active'
            AND (
              merchant.snapshot_status = 'failed'
              OR (
                merchant.snapshot_status IN ('pending', 'installing')
                AND merchant.updated_at <= v_now - interval '60 minutes'
              )
            )
          THEN true
          ELSE false
        END AS active_issue
      FROM merchants merchant
      WHERE p_location_ids IS NULL OR merchant.location_id = ANY(p_location_ids)
    )
    SELECT
      issue.merchant_id,
      issue.location_id,
      issue.active_issue
    FROM issue
    LEFT JOIN health_current current_health
      ON current_health.scope_type = 'merchant'
      AND current_health.scope_id = issue.location_id
      AND current_health.check_key = 'merchant.installation'
    WHERE issue.active_issue OR current_health.id IS NOT NULL
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.installation',
      CASE WHEN v_row.active_issue THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.active_issue THEN 'urgent' ELSE NULL END,
      CASE WHEN v_row.active_issue THEN 'INSTALLATION_UNAVAILABLE' ELSE NULL END,
      CASE WHEN v_row.active_issue
        THEN 'The entitled merchant installation has remained unavailable past its recovery window.'
        ELSE 'The merchant installation is available.' END,
      '{}'::jsonb,
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        operation.location_id,
        lower(operation.processor_type) AS provider,
        count(*) FILTER (
          WHERE operation.status = 'unknown'
            AND COALESCE(operation.provider_started_at, operation.created_at)
              <= v_now - interval '5 minutes'
        )::integer AS unknown_count,
        count(*) FILTER (
          WHERE operation.status = 'provider_accepted'
            AND (
              operation.reconciliation_attempts >= 10
              OR COALESCE(operation.provider_accepted_at, operation.created_at)
                <= v_now - interval '10 minutes'
            )
        )::integer AS stalled_count
      FROM money_operations operation
      JOIN merchants merchant
        ON merchant.location_id = operation.location_id
      WHERE operation.status IN ('provider_accepted', 'unknown')
        AND operation.processor_type IS NOT NULL
        AND (p_location_ids IS NULL OR operation.location_id = ANY(p_location_ids))
      GROUP BY merchant.id, operation.location_id, lower(operation.processor_type)
      HAVING count(*) FILTER (
        WHERE operation.status = 'unknown'
          AND COALESCE(operation.provider_started_at, operation.created_at)
            <= v_now - interval '5 minutes'
      ) > 0
      OR count(*) FILTER (
        WHERE operation.status = 'provider_accepted'
          AND (
            operation.reconciliation_attempts >= 10
            OR COALESCE(operation.provider_accepted_at, operation.created_at)
              <= v_now - interval '10 minutes'
          )
      ) > 0
    ),
    scopes AS (
      SELECT
        issue.merchant_id,
        issue.location_id,
        issue.provider
      FROM issue
      UNION
      SELECT
        current_health.merchant_id,
        current_health.location_id,
        COALESCE(current_health.metrics->>'provider', 'unknown')
      FROM health_current current_health
      WHERE current_health.scope_type = 'merchant'
        AND current_health.check_key = 'merchant.money_outcome'
        AND (p_location_ids IS NULL OR current_health.location_id = ANY(p_location_ids))
    )
    SELECT
      scopes.merchant_id,
      scopes.location_id,
      scopes.provider,
      COALESCE(issue.unknown_count, 0) AS unknown_count,
      COALESCE(issue.stalled_count, 0) AS stalled_count
    FROM scopes
    LEFT JOIN issue
      ON issue.location_id = scopes.location_id
      AND issue.provider = scopes.provider
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id || ':' || v_row.provider,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.money_outcome',
      CASE WHEN v_row.unknown_count > 0 OR v_row.stalled_count > 0 THEN 'unhealthy' ELSE 'healthy' END,
      CASE
        WHEN v_row.unknown_count > 0 THEN 'critical'
        WHEN v_row.stalled_count > 0 THEN 'urgent'
        ELSE NULL
      END,
      CASE
        WHEN v_row.unknown_count > 0 THEN 'MONEY_OUTCOME_UNKNOWN'
        WHEN v_row.stalled_count > 0 THEN 'MONEY_RECONCILIATION_STALLED'
        ELSE NULL
      END,
      CASE
        WHEN v_row.unknown_count > 0 THEN 'A provider-bound money outcome remains unknown past five minutes.'
        WHEN v_row.stalled_count > 0 THEN 'A provider-accepted money operation has not reconciled.'
        ELSE 'Money operations for this processor are reconciled.'
      END,
      jsonb_build_object(
        'provider', v_row.provider,
        'unknown_count', v_row.unknown_count,
        'stalled_count', v_row.stalled_count
      ),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        claim.location_id,
        lower(claim.processor) AS provider,
        count(*)::integer AS issue_count
      FROM payment_refund_claims claim
      JOIN merchants merchant
        ON merchant.location_id = claim.location_id
      WHERE claim.status IN ('provider_accepted', 'unknown')
        AND claim.processor IS NOT NULL
        AND (
          claim.reconciliation_attempts >= 10
          OR COALESCE(claim.provider_accepted_at, claim.provider_started_at, claim.created_at)
            <= v_now - interval '5 minutes'
        )
        AND (p_location_ids IS NULL OR claim.location_id = ANY(p_location_ids))
      GROUP BY merchant.id, claim.location_id, lower(claim.processor)
    ),
    scopes AS (
      SELECT issue.merchant_id, issue.location_id, issue.provider FROM issue
      UNION
      SELECT
        current_health.merchant_id,
        current_health.location_id,
        COALESCE(current_health.metrics->>'provider', 'unknown')
      FROM health_current current_health
      WHERE current_health.scope_type = 'merchant'
        AND current_health.check_key = 'merchant.refund_outcome'
        AND (p_location_ids IS NULL OR current_health.location_id = ANY(p_location_ids))
    )
    SELECT
      scopes.merchant_id,
      scopes.location_id,
      scopes.provider,
      COALESCE(issue.issue_count, 0) AS issue_count
    FROM scopes
    LEFT JOIN issue
      ON issue.location_id = scopes.location_id
      AND issue.provider = scopes.provider
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id || ':' || v_row.provider,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.refund_outcome',
      CASE WHEN v_row.issue_count > 0 THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.issue_count > 0 THEN 'urgent' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0 THEN 'REFUND_RECONCILIATION_STALLED' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0
        THEN 'A provider-accepted refund has not reconciled.'
        ELSE 'Refund operations for this processor are reconciled.' END,
      jsonb_build_object('provider', v_row.provider, 'issue_count', v_row.issue_count),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        job.location_id,
        count(*) FILTER (WHERE job.status = 'failed')::integer AS failed_count,
        count(*) FILTER (WHERE job.status = 'unknown')::integer AS unknown_count
      FROM trigger_delivery_jobs job
      JOIN merchants merchant ON merchant.location_id = job.location_id
      WHERE job.status IN ('failed', 'unknown')
        AND job.updated_at >= v_now - interval '30 days'
        AND (p_location_ids IS NULL OR job.location_id = ANY(p_location_ids))
      GROUP BY merchant.id, job.location_id
    ),
    scopes AS (
      SELECT issue.merchant_id, issue.location_id FROM issue
      UNION
      SELECT current_health.merchant_id, current_health.location_id
      FROM health_current current_health
      WHERE current_health.scope_type = 'merchant'
        AND current_health.check_key = 'merchant.trigger_delivery'
        AND (p_location_ids IS NULL OR current_health.location_id = ANY(p_location_ids))
    )
    SELECT
      scopes.merchant_id,
      scopes.location_id,
      COALESCE(issue.failed_count, 0) AS failed_count,
      COALESCE(issue.unknown_count, 0) AS unknown_count
    FROM scopes
    LEFT JOIN issue ON issue.location_id = scopes.location_id
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id || ':ghl',
      v_row.location_id,
      v_row.merchant_id,
      'merchant.trigger_delivery',
      CASE WHEN v_row.failed_count > 0 OR v_row.unknown_count > 0 THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.failed_count > 0 OR v_row.unknown_count > 0 THEN 'warning' ELSE NULL END,
      CASE
        WHEN v_row.failed_count > 0 THEN 'GHL_TRIGGER_DELIVERY_FAILED'
        WHEN v_row.unknown_count > 0 THEN 'GHL_TRIGGER_DELIVERY_UNKNOWN'
        ELSE NULL
      END,
      CASE
        WHEN v_row.failed_count > 0 THEN 'One or more GHL trigger deliveries exhausted their attempts.'
        WHEN v_row.unknown_count > 0 THEN 'A GHL trigger delivery has an ambiguous outcome and requires review.'
        ELSE 'GHL trigger delivery has no unresolved terminal result.'
      END,
      jsonb_build_object(
        'provider', 'ghl',
        'failed_count', v_row.failed_count,
        'unknown_count', v_row.unknown_count
      ),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        merchant.location_id,
        (
          SELECT count(*)::integer
          FROM external_evidence_events event
          WHERE event.location_id = merchant.location_id
            AND event.status IN ('quarantined', 'rejected')
            AND event.received_at >= v_now - interval '30 days'
        ) + (
          SELECT count(*)::integer
          FROM evidence_connections connection
          WHERE connection.location_id = merchant.location_id
            AND connection.status = 'active'
            AND connection.health_status = 'error'
        ) AS issue_count
      FROM merchants merchant
      WHERE p_location_ids IS NULL OR merchant.location_id = ANY(p_location_ids)
    ),
    scopes AS (
      SELECT issue.merchant_id, issue.location_id, issue.issue_count
      FROM issue
      WHERE issue.issue_count > 0
      UNION
      SELECT
        current_health.merchant_id,
        current_health.location_id,
        0
      FROM health_current current_health
      WHERE current_health.scope_type = 'merchant'
        AND current_health.check_key = 'merchant.evidence_connection'
        AND (p_location_ids IS NULL OR current_health.location_id = ANY(p_location_ids))
        AND NOT EXISTS (
          SELECT 1 FROM issue
          WHERE issue.location_id = current_health.location_id
            AND issue.issue_count > 0
        )
    )
    SELECT * FROM scopes
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.evidence_connection',
      CASE WHEN v_row.issue_count > 0 THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.issue_count > 0 THEN 'warning' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0 THEN 'EVIDENCE_CONNECTION_NEEDS_ATTENTION' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0
        THEN 'An evidence connection or unresolved intake event requires operator attention.'
        ELSE 'Evidence connections have no unresolved intake failures.' END,
      jsonb_build_object('issue_count', v_row.issue_count),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        merchant.location_id,
        count(packet.id)::integer AS issue_count
      FROM merchants merchant
      JOIN defense_packets packet
        ON packet.location_id = merchant.location_id
        AND packet.lifecycle_status = 'pending_submission'
        AND packet.status = 'failed'
      WHERE p_location_ids IS NULL OR merchant.location_id = ANY(p_location_ids)
      GROUP BY merchant.id, merchant.location_id
    ),
    scopes AS (
      SELECT issue.merchant_id, issue.location_id, issue.issue_count FROM issue
      UNION
      SELECT current_health.merchant_id, current_health.location_id, 0
      FROM health_current current_health
      WHERE current_health.scope_type = 'merchant'
        AND current_health.check_key = 'merchant.defense'
        AND (p_location_ids IS NULL OR current_health.location_id = ANY(p_location_ids))
        AND NOT EXISTS (
          SELECT 1 FROM issue WHERE issue.location_id = current_health.location_id
        )
    )
    SELECT * FROM scopes
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.defense',
      CASE WHEN v_row.issue_count > 0 THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.issue_count > 0 THEN 'warning' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0 THEN 'DEFENSE_COMPILATION_FAILED' ELSE NULL END,
      CASE WHEN v_row.issue_count > 0
        THEN 'A pending-submission defense packet failed to compile.'
        ELSE 'Defense compilation has no unresolved failures.' END,
      jsonb_build_object('failed_packet_count', v_row.issue_count),
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  FOR v_row IN
    WITH issue AS (
      SELECT
        merchant.id AS merchant_id,
        merchant.location_id,
        merchant.marketplace_billing_status = 'failed' AS active_issue
      FROM merchants merchant
      WHERE p_location_ids IS NULL OR merchant.location_id = ANY(p_location_ids)
    )
    SELECT issue.merchant_id, issue.location_id, issue.active_issue
    FROM issue
    LEFT JOIN health_current current_health
      ON current_health.scope_type = 'merchant'
      AND current_health.scope_id = issue.location_id
      AND current_health.check_key = 'merchant.billing'
    WHERE issue.active_issue OR current_health.id IS NOT NULL
  LOOP
    PERFORM record_health_observation(
      'merchant',
      v_row.location_id,
      v_row.location_id,
      v_row.merchant_id,
      'merchant.billing',
      CASE WHEN v_row.active_issue THEN 'unhealthy' ELSE 'healthy' END,
      CASE WHEN v_row.active_issue THEN 'warning' ELSE NULL END,
      CASE WHEN v_row.active_issue THEN 'MARKETPLACE_BILLING_FAILED' ELSE NULL END,
      CASE WHEN v_row.active_issue
        THEN 'Marketplace billing requires owner attention.'
        ELSE 'Marketplace billing has no failed state.' END,
      '{}'::jsonb,
      v_now
    );
    v_evaluated := v_evaluated + 1;
  END LOOP;

  RETURN v_evaluated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reconcile_command_center_merchant_health(
  p_location_ids TEXT[] DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_reconciled INTEGER := 0;
BEGIN
  PERFORM reconcile_command_center_merchant_incidents(p_location_ids);

  WITH target AS (
    SELECT
      merchant.id AS merchant_id,
      merchant.location_id,
      COALESCE(NULLIF(btrim(merchant.business_name), ''), merchant.location_id) AS merchant_name,
      merchant.status,
      merchant.snapshot_status,
      merchant.stripe_connected,
      merchant.marketplace_plan_key,
      merchant.marketplace_billing_status
    FROM merchants merchant
    WHERE p_location_ids IS NULL
       OR merchant.location_id = ANY(p_location_ids)
  ),
  processor AS (
    SELECT
      target.location_id,
      count(config.id) FILTER (WHERE config.is_active = true)
        + count(whop.id) FILTER (WHERE whop.status = 'connected') AS connected_count
    FROM target
    LEFT JOIN processor_configs config
      ON config.merchant_id = target.merchant_id
      AND config.location_id = target.location_id
    LEFT JOIN whop_configs whop
      ON whop.merchant_id = target.merchant_id
      AND whop.location_id = target.location_id
    GROUP BY target.location_id
  ),
  workflow AS (
    SELECT target.location_id, count(subscription.id) FILTER (WHERE subscription.is_active = true) AS active_count
    FROM target
    LEFT JOIN trigger_subscriptions subscription
      ON subscription.location_id = target.location_id
    GROUP BY target.location_id
  ),
  evidence_issue AS (
    SELECT
      target.location_id,
      count(event.id) FILTER (
        WHERE event.status IN ('quarantined', 'rejected')
          AND event.received_at >= clock_timestamp() - interval '30 days'
      ) AS issue_count
    FROM target
    LEFT JOIN external_evidence_events event
      ON event.location_id = target.location_id
    GROUP BY target.location_id
  ),
  defense_issue AS (
    SELECT
      target.location_id,
      count(packet.id) FILTER (WHERE packet.status = 'failed') AS failed_count,
      count(packet.id) FILTER (WHERE packet.status = 'needs_review') AS review_count
    FROM target
    LEFT JOIN defense_packets packet
      ON packet.location_id = target.location_id
      AND packet.lifecycle_status = 'pending_submission'
    GROUP BY target.location_id
  ),
  incidents AS (
    SELECT
      target.location_id,
      count(incident.id) FILTER (
        WHERE incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
          AND incident.severity = 'critical'
      ) AS critical_count,
      count(incident.id) FILTER (
        WHERE incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
          AND incident.severity = 'urgent'
      ) AS urgent_count,
      count(incident.id) FILTER (
        WHERE incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')
          AND incident.severity = 'warning'
      ) AS warning_count
    FROM target
    LEFT JOIN platform_incidents incident
      ON incident.location_id = target.location_id
    GROUP BY target.location_id
  ),
  component AS (
    SELECT
      target.*,
      CASE
        WHEN target.status <> 'active' THEN 'not_applicable'
        WHEN target.snapshot_status = 'installed' THEN 'healthy'
        WHEN target.snapshot_status IN ('pending', 'installing') THEN 'degraded'
        WHEN target.snapshot_status = 'failed' THEN 'unhealthy'
        ELSE 'unknown'
      END AS installation_state,
      CASE WHEN COALESCE(processor.connected_count, 0) > 0 THEN 'healthy' ELSE 'unknown' END AS processor_state,
      CASE WHEN COALESCE(workflow.active_count, 0) > 0 THEN 'healthy' ELSE 'unknown' END AS workflow_state,
      CASE WHEN COALESCE(evidence_issue.issue_count, 0) > 0 THEN 'degraded' ELSE 'healthy' END AS evidence_state,
      CASE
        WHEN COALESCE(defense_issue.failed_count, 0) > 0 THEN 'degraded'
        WHEN COALESCE(defense_issue.review_count, 0) > 0 THEN 'degraded'
        ELSE 'healthy'
      END AS defense_state,
      CASE
        WHEN target.marketplace_plan_key = 'legacy' THEN 'not_applicable'
        WHEN target.marketplace_billing_status = 'complete' THEN 'healthy'
        WHEN target.marketplace_billing_status = 'failed' THEN 'unhealthy'
        WHEN target.marketplace_billing_status = 'pending' THEN 'degraded'
        ELSE 'unknown'
      END AS billing_state,
      COALESCE(incidents.critical_count, 0)::integer AS critical_count,
      COALESCE(incidents.urgent_count, 0)::integer AS urgent_count,
      COALESCE(incidents.warning_count, 0)::integer AS warning_count,
      COALESCE(evidence_issue.issue_count, 0)::integer AS evidence_issue_count,
      COALESCE(defense_issue.failed_count, 0)::integer AS defense_failed_count,
      COALESCE(defense_issue.review_count, 0)::integer AS defense_review_count
    FROM target
    LEFT JOIN processor ON processor.location_id = target.location_id
    LEFT JOIN workflow ON workflow.location_id = target.location_id
    LEFT JOIN evidence_issue ON evidence_issue.location_id = target.location_id
    LEFT JOIN defense_issue ON defense_issue.location_id = target.location_id
    LEFT JOIN incidents ON incidents.location_id = target.location_id
  ),
  upserted AS (
    INSERT INTO merchant_health_rollups (
      location_id, merchant_id, merchant_name, overall_state, highest_incident_severity,
      installation_state, processor_state, workflow_state, evidence_state,
      defense_state, billing_state, open_critical_count, open_urgent_count,
      open_warning_count, needs_attention_count, last_observed_at,
      last_reconciled_at, source_version, updated_at
    )
    SELECT
      component.location_id,
      component.merchant_id,
      component.merchant_name,
      CASE
        WHEN component.critical_count > 0
          OR component.urgent_count > 0
          OR component.installation_state = 'unhealthy'
          OR component.billing_state = 'unhealthy'
        THEN 'unhealthy'
        WHEN component.warning_count > 0
          OR component.installation_state = 'degraded'
          OR component.processor_state = 'degraded'
          OR component.workflow_state = 'degraded'
          OR component.evidence_state = 'degraded'
          OR component.defense_state = 'degraded'
          OR component.billing_state = 'degraded'
        THEN 'degraded'
        WHEN 'unknown' IN (
          component.installation_state,
          component.processor_state,
          component.workflow_state,
          component.evidence_state,
          component.defense_state,
          component.billing_state
        )
        THEN 'unknown'
        ELSE 'healthy'
      END,
      CASE
        WHEN component.critical_count > 0 THEN 'critical'
        WHEN component.urgent_count > 0 THEN 'urgent'
        WHEN component.warning_count > 0 THEN 'warning'
        ELSE NULL
      END,
      component.installation_state,
      component.processor_state,
      component.workflow_state,
      component.evidence_state,
      component.defense_state,
      component.billing_state,
      component.critical_count,
      component.urgent_count,
      component.warning_count,
      (
        component.critical_count
        + component.urgent_count
        + component.warning_count
        + component.evidence_issue_count
        + component.defense_failed_count
        + component.defense_review_count
        + CASE WHEN component.installation_state IN ('degraded', 'unhealthy') THEN 1 ELSE 0 END
        + CASE WHEN component.billing_state IN ('degraded', 'unhealthy') THEN 1 ELSE 0 END
      )::integer,
      clock_timestamp(),
      clock_timestamp(),
      'command-center-health-v1.1',
      clock_timestamp()
    FROM component
    ON CONFLICT (location_id) DO UPDATE SET
      merchant_id = EXCLUDED.merchant_id,
      merchant_name = EXCLUDED.merchant_name,
      overall_state = EXCLUDED.overall_state,
      highest_incident_severity = EXCLUDED.highest_incident_severity,
      installation_state = EXCLUDED.installation_state,
      processor_state = EXCLUDED.processor_state,
      workflow_state = EXCLUDED.workflow_state,
      evidence_state = EXCLUDED.evidence_state,
      defense_state = EXCLUDED.defense_state,
      billing_state = EXCLUDED.billing_state,
      open_critical_count = EXCLUDED.open_critical_count,
      open_urgent_count = EXCLUDED.open_urgent_count,
      open_warning_count = EXCLUDED.open_warning_count,
      needs_attention_count = EXCLUDED.needs_attention_count,
      last_observed_at = EXCLUDED.last_observed_at,
      last_reconciled_at = EXCLUDED.last_reconciled_at,
      source_version = EXCLUDED.source_version,
      updated_at = clock_timestamp()
    WHERE merchant_health_rollups.merchant_id IS DISTINCT FROM EXCLUDED.merchant_id
       OR merchant_health_rollups.merchant_name IS DISTINCT FROM EXCLUDED.merchant_name
       OR merchant_health_rollups.overall_state IS DISTINCT FROM EXCLUDED.overall_state
       OR merchant_health_rollups.highest_incident_severity IS DISTINCT FROM EXCLUDED.highest_incident_severity
       OR merchant_health_rollups.installation_state IS DISTINCT FROM EXCLUDED.installation_state
       OR merchant_health_rollups.processor_state IS DISTINCT FROM EXCLUDED.processor_state
       OR merchant_health_rollups.workflow_state IS DISTINCT FROM EXCLUDED.workflow_state
       OR merchant_health_rollups.evidence_state IS DISTINCT FROM EXCLUDED.evidence_state
       OR merchant_health_rollups.defense_state IS DISTINCT FROM EXCLUDED.defense_state
       OR merchant_health_rollups.billing_state IS DISTINCT FROM EXCLUDED.billing_state
       OR merchant_health_rollups.open_critical_count IS DISTINCT FROM EXCLUDED.open_critical_count
       OR merchant_health_rollups.open_urgent_count IS DISTINCT FROM EXCLUDED.open_urgent_count
       OR merchant_health_rollups.open_warning_count IS DISTINCT FROM EXCLUDED.open_warning_count
       OR merchant_health_rollups.needs_attention_count IS DISTINCT FROM EXCLUDED.needs_attention_count
       OR merchant_health_rollups.source_version IS DISTINCT FROM EXCLUDED.source_version
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_reconciled FROM upserted;

  RETURN v_reconciled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reconcile_command_center_full_sweep_batch(
  p_run_id UUID,
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (
  processed_in_batch INTEGER,
  total_processed INTEGER,
  next_cursor TEXT,
  complete BOOLEAN
) AS $$
DECLARE
  v_run scheduled_job_runs%ROWTYPE;
  v_locations TEXT[];
  v_cursor TEXT;
  v_next_cursor TEXT;
  v_processed INTEGER := 0;
  v_total INTEGER := 0;
  v_complete BOOLEAN := false;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
     OR p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid full-sweep batch request';
  END IF;

  SELECT * INTO v_run
  FROM scheduled_job_runs
  WHERE id = p_run_id
    AND job_key = 'job.merchant_health_full_sweep'
    AND status = 'running'
    AND lease_owner = p_worker_id
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Merchant health full-sweep claim is no longer active';
  END IF;

  v_cursor := NULLIF(v_run.result_summary->>'full_sweep_cursor', '');
  SELECT array_agg(candidate.location_id ORDER BY candidate.location_id)
  INTO v_locations
  FROM (
    SELECT location_id
    FROM merchants
    WHERE v_cursor IS NULL OR location_id > v_cursor
    ORDER BY location_id
    LIMIT p_limit
  ) AS candidate;

  IF COALESCE(array_length(v_locations, 1), 0) > 0 THEN
    v_processed := reconcile_command_center_merchant_health(v_locations);
    v_next_cursor := v_locations[array_length(v_locations, 1)];
    v_complete := NOT EXISTS (
      SELECT 1 FROM merchants WHERE location_id > v_next_cursor
    );
  ELSE
    v_next_cursor := v_cursor;
    v_complete := true;
  END IF;

  UPDATE scheduled_job_runs
  SET
    processed_count = processed_count + v_processed,
    result_summary = result_summary || jsonb_strip_nulls(jsonb_build_object(
      'full_sweep_cursor',
      v_next_cursor,
      'full_sweep_complete',
      v_complete
    )),
    updated_at = clock_timestamp()
  WHERE id = v_run.id
    AND status = 'running'
    AND lease_owner = p_worker_id
  RETURNING processed_count INTO v_total;

  RETURN QUERY SELECT v_processed, v_total, v_next_cursor, v_complete;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reconcile_command_center_dirty_health(
  p_limit INTEGER,
  p_worker_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
  v_locations TEXT[];
  v_reconciled INTEGER := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500
     OR p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid merchant-health reconciliation claim';
  END IF;

  SELECT array_agg(candidate.location_id ORDER BY candidate.last_marked_at)
  INTO v_locations
  FROM (
    SELECT location_id, last_marked_at
    FROM health_dirty_scopes
    WHERE available_at <= clock_timestamp()
      AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
    ORDER BY last_marked_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) candidate;

  IF COALESCE(array_length(v_locations, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  v_reconciled := reconcile_command_center_merchant_health(v_locations);
  DELETE FROM health_dirty_scopes WHERE location_id = ANY(v_locations);
  RETURN v_reconciled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION run_command_center_retention(
  p_batch_size INTEGER DEFAULT 5000
)
RETURNS TABLE (
  metric_buckets_deleted INTEGER,
  job_runs_deleted INTEGER,
  observations_deleted INTEGER,
  incidents_deleted INTEGER
) AS $$
DECLARE
  v_limit INTEGER := GREATEST(100, LEAST(COALESCE(p_batch_size, 5000), 10000));
  v_metrics INTEGER := 0;
  v_jobs INTEGER := 0;
  v_observations INTEGER := 0;
  v_incidents INTEGER := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('command-center-retention', 0)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  PERFORM set_config('scalesafe.health_retention', 'on', true);

  WITH candidate AS (
    SELECT instance_id, bucket_started_at
    FROM application_metric_buckets
    WHERE bucket_started_at < clock_timestamp() - interval '90 days'
    ORDER BY bucket_started_at
    LIMIT v_limit
  )
  DELETE FROM application_metric_buckets bucket
  USING candidate
  WHERE bucket.instance_id = candidate.instance_id
    AND bucket.bucket_started_at = candidate.bucket_started_at;
  GET DIAGNOSTICS v_metrics = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM scheduled_job_runs
    WHERE scheduled_window_start < clock_timestamp() - interval '90 days'
      AND status IN ('succeeded', 'failed', 'timed_out', 'exhausted', 'missed')
    ORDER BY scheduled_window_start
    LIMIT v_limit
  )
  DELETE FROM scheduled_job_runs run
  USING candidate
  WHERE run.id = candidate.id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM health_observations
    WHERE observed_at < clock_timestamp() - interval '180 days'
    ORDER BY observed_at
    LIMIT v_limit
  )
  DELETE FROM health_observations observation
  USING candidate
  WHERE observation.id = candidate.id;
  GET DIAGNOSTICS v_observations = ROW_COUNT;

  WITH candidate AS (
    SELECT id
    FROM platform_incidents
    WHERE status = 'resolved'
      AND resolved_at < clock_timestamp() - interval '365 days'
    ORDER BY resolved_at
    LIMIT v_limit
  )
  DELETE FROM platform_incidents incident
  USING candidate
  WHERE incident.id = candidate.id;
  GET DIAGNOSTICS v_incidents = ROW_COUNT;

  RETURN QUERY SELECT v_metrics, v_jobs, v_observations, v_incidents;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION resolve_operator_session_context(
  p_session_token_hash TEXT
)
RETURNS TABLE (
  session_id UUID,
  operator_user_id UUID,
  organization_id UUID,
  membership_id UUID,
  auth_assurance TEXT,
  csrf_token_hash TEXT,
  last_seen_at TIMESTAMPTZ,
  absolute_expires_at TIMESTAMPTZ,
  user_id UUID,
  user_status TEXT,
  membership_operator_user_id UUID,
  membership_organization_id UUID,
  membership_status TEXT,
  membership_role TEXT,
  organization_status TEXT,
  organization_type TEXT,
  location_access_mode TEXT,
  location_ids TEXT[]
) AS $$
  SELECT
    session.id,
    session.operator_user_id,
    session.organization_id,
    session.membership_id,
    session.auth_assurance,
    session.csrf_token_hash::TEXT,
    session.last_seen_at,
    session.absolute_expires_at,
    operator_user.id,
    operator_user.status,
    membership.operator_user_id,
    membership.organization_id,
    membership.status,
    membership.role,
    organization.status,
    organization.organization_type,
    CASE
      WHEN membership.role IN ('platform_owner', 'platform_ops') THEN 'all'
      WHEN membership.role = 'platform_support' THEN 'support_grants'
      WHEN organization.organization_type = 'reseller' THEN 'assigned'
      ELSE 'none'
    END,
    CASE
      WHEN membership.role = 'platform_support' THEN ARRAY(
        SELECT DISTINCT support_grant.location_id
        FROM operator_support_grants support_grant
        WHERE support_grant.grantee_operator_user_id = session.operator_user_id
          AND support_grant.status = 'active'
          AND support_grant.starts_at <= clock_timestamp()
          AND support_grant.expires_at > clock_timestamp()
        ORDER BY support_grant.location_id
      )
      WHEN organization.organization_type = 'reseller' THEN ARRAY(
        SELECT DISTINCT assignment.location_id
        FROM reseller_merchant_assignments assignment
        WHERE assignment.reseller_organization_id = session.organization_id
          AND assignment.status = 'active'
        ORDER BY assignment.location_id
      )
      ELSE ARRAY[]::TEXT[]
    END
  FROM operator_sessions session
  JOIN operator_users operator_user
    ON operator_user.id = session.operator_user_id
  JOIN operator_memberships membership
    ON membership.id = session.membership_id
  JOIN operator_organizations organization
    ON organization.id = session.organization_id
  WHERE p_session_token_hash ~ '^[0-9a-f]{64}$'
    AND session.session_token_hash = p_session_token_hash
    AND session.revoked_at IS NULL
    AND session.idle_expires_at > clock_timestamp()
    AND session.absolute_expires_at > clock_timestamp()
  LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_command_center_platform_overview(
  p_limit INTEGER DEFAULT 50,
  p_health_before TIMESTAMPTZ DEFAULT NULL,
  p_health_before_id UUID DEFAULT NULL,
  p_incident_before TIMESTAMPTZ DEFAULT NULL,
  p_incident_before_id UUID DEFAULT NULL,
  p_merchant_attention_before INTEGER DEFAULT NULL,
  p_merchant_reconciled_before TIMESTAMPTZ DEFAULT NULL,
  p_merchant_location_after TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_checks JSONB;
  v_incidents JSONB;
  v_merchants JSONB;
  v_check_next JSONB;
  v_incident_next JSONB;
  v_merchant_next JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR ((p_health_before IS NULL) <> (p_health_before_id IS NULL))
     OR ((p_incident_before IS NULL) <> (p_incident_before_id IS NULL))
     OR (
       (p_merchant_attention_before IS NULL)
       <> (p_merchant_reconciled_before IS NULL)
     )
     OR (
       (p_merchant_attention_before IS NULL)
       <> (p_merchant_location_after IS NULL)
     )
     OR COALESCE(p_merchant_attention_before, 0) < 0
     OR length(COALESCE(p_merchant_location_after, '')) > 100 THEN
    RAISE EXCEPTION 'Invalid Command Center overview page request';
  END IF;

  WITH page AS (
    SELECT
      current.id,
      current.scope_type,
      current.scope_id,
      current.location_id,
      current.check_key,
      current.state,
      current.severity,
      current.failure_class,
      current.summary,
      current.metrics,
      current.last_observed_at,
      current.state_changed_at,
      current.contract_version
    FROM health_current current
    WHERE p_health_before IS NULL
       OR (current.last_observed_at, current.id)
          < (p_health_before, p_health_before_id)
    ORDER BY current.last_observed_at DESC, current.id DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(to_jsonb(page) ORDER BY page.last_observed_at DESC, page.id DESC),
      '[]'::jsonb
    ),
    CASE WHEN count(*) = p_limit THEN (
      SELECT jsonb_build_object(
        'lastObservedAt', last_page.last_observed_at,
        'id', last_page.id
      )
      FROM page last_page
      ORDER BY last_page.last_observed_at ASC, last_page.id ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_checks, v_check_next
  FROM page;

  WITH page AS (
    SELECT
      incident.id,
      incident.scope_type,
      incident.scope_id,
      incident.location_id,
      incident.check_key,
      incident.failure_class,
      incident.severity,
      incident.status,
      incident.title,
      incident.summary,
      incident.occurrence_count,
      incident.first_seen_at,
      incident.last_seen_at,
      incident.recovery_candidate_at,
      incident.acknowledged_at,
      incident.suppressed_until,
      incident.resolved_at,
      incident.parent_incident_id,
      incident.suppressible,
      incident.runbook_key,
      incident.metadata
    FROM platform_incidents incident
    WHERE incident.status <> 'resolved'
      AND (
        p_incident_before IS NULL
        OR (incident.last_seen_at, incident.id)
           < (p_incident_before, p_incident_before_id)
      )
    ORDER BY incident.last_seen_at DESC, incident.id DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(to_jsonb(page) ORDER BY page.last_seen_at DESC, page.id DESC),
      '[]'::jsonb
    ),
    CASE WHEN count(*) = p_limit THEN (
      SELECT jsonb_build_object(
        'lastSeenAt', last_page.last_seen_at,
        'id', last_page.id
      )
      FROM page last_page
      ORDER BY last_page.last_seen_at ASC, last_page.id ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_incidents, v_incident_next
  FROM page;

  WITH page AS (
    SELECT
      rollup.location_id,
      rollup.merchant_id,
      rollup.merchant_name,
      rollup.overall_state,
      rollup.highest_incident_severity,
      rollup.installation_state,
      rollup.processor_state,
      rollup.workflow_state,
      rollup.evidence_state,
      rollup.defense_state,
      rollup.billing_state,
      rollup.open_critical_count,
      rollup.open_urgent_count,
      rollup.open_warning_count,
      rollup.needs_attention_count,
      rollup.last_observed_at,
      rollup.last_reconciled_at,
      rollup.source_version
    FROM merchant_health_rollups rollup
    WHERE p_merchant_attention_before IS NULL
       OR rollup.needs_attention_count < p_merchant_attention_before
       OR (
         rollup.needs_attention_count = p_merchant_attention_before
         AND rollup.last_reconciled_at < p_merchant_reconciled_before
       )
       OR (
         rollup.needs_attention_count = p_merchant_attention_before
         AND rollup.last_reconciled_at = p_merchant_reconciled_before
         AND rollup.location_id > p_merchant_location_after
       )
    ORDER BY
      rollup.needs_attention_count DESC,
      rollup.last_reconciled_at DESC,
      rollup.location_id ASC
    LIMIT p_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(
        to_jsonb(page)
        ORDER BY
          page.needs_attention_count DESC,
          page.last_reconciled_at DESC,
          page.location_id ASC
      ),
      '[]'::jsonb
    ),
    CASE WHEN count(*) = p_limit THEN (
      SELECT jsonb_build_object(
        'needsAttentionCount', last_page.needs_attention_count,
        'lastReconciledAt', last_page.last_reconciled_at,
        'locationId', last_page.location_id
      )
      FROM page last_page
      ORDER BY
        last_page.needs_attention_count ASC,
        last_page.last_reconciled_at ASC,
        last_page.location_id DESC
      LIMIT 1
    ) ELSE NULL END
  INTO v_merchants, v_merchant_next
  FROM page;

  RETURN jsonb_build_object(
    'checks', v_checks,
    'incidents', v_incidents,
    'merchants', v_merchants,
    'next', jsonb_build_object(
      'checks', v_check_next,
      'incidents', v_incident_next,
      'merchants', v_merchant_next
    )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION list_command_center_incidents_page(
  p_limit INTEGER DEFAULT 50,
  p_include_resolved BOOLEAN DEFAULT false,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_incidents JSONB;
  v_next JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR ((p_before IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid Command Center incident page request';
  END IF;

  WITH page AS (
    SELECT
      incident.id,
      incident.scope_type,
      incident.scope_id,
      incident.location_id,
      incident.check_key,
      incident.failure_class,
      incident.severity,
      incident.status,
      incident.title,
      incident.summary,
      incident.occurrence_count,
      incident.first_seen_at,
      incident.last_seen_at,
      incident.recovery_candidate_at,
      incident.acknowledged_at,
      incident.suppressed_until,
      incident.resolved_at,
      incident.parent_incident_id,
      incident.suppressible,
      incident.runbook_key,
      incident.metadata
    FROM platform_incidents incident
    WHERE (p_include_resolved OR incident.status <> 'resolved')
      AND (
        p_before IS NULL
        OR (incident.last_seen_at, incident.id) < (p_before, p_before_id)
      )
    ORDER BY incident.last_seen_at DESC, incident.id DESC
    LIMIT p_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(to_jsonb(page) ORDER BY page.last_seen_at DESC, page.id DESC),
      '[]'::jsonb
    ),
    CASE WHEN count(*) = p_limit THEN (
      SELECT jsonb_build_object(
        'lastSeenAt', last_page.last_seen_at,
        'id', last_page.id
      )
      FROM page last_page
      ORDER BY last_page.last_seen_at ASC, last_page.id ASC
      LIMIT 1
    ) ELSE NULL END
  INTO v_incidents, v_next
  FROM page;

  RETURN jsonb_build_object('incidents', v_incidents, 'next', v_next);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION validate_command_center_tenant_binding()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'health_current' THEN
    IF NEW.scope_type = 'merchant'
       AND (NEW.merchant_id IS NULL OR NEW.location_id IS NULL) THEN
      RAISE EXCEPTION 'Merchant health requires merchant and location';
    END IF;
  ELSIF TG_TABLE_NAME IN ('merchant_health_rollups', 'health_dirty_scopes') THEN
    IF NEW.merchant_id IS NULL OR NEW.location_id IS NULL THEN
      RAISE EXCEPTION 'Command Center merchant and location are required';
    END IF;
  END IF;
  IF NEW.merchant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM merchants
    WHERE id = NEW.merchant_id AND location_id = NEW.location_id
  ) THEN
    RAISE EXCEPTION 'Command Center merchant does not match location';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS health_current_tenant_binding ON health_current;
CREATE TRIGGER health_current_tenant_binding
  BEFORE INSERT OR UPDATE ON health_current
  FOR EACH ROW EXECUTE FUNCTION validate_command_center_tenant_binding();

DROP TRIGGER IF EXISTS merchant_health_rollups_tenant_binding ON merchant_health_rollups;
CREATE TRIGGER merchant_health_rollups_tenant_binding
  BEFORE INSERT OR UPDATE ON merchant_health_rollups
  FOR EACH ROW EXECUTE FUNCTION validate_command_center_tenant_binding();

DROP TRIGGER IF EXISTS health_dirty_scopes_tenant_binding ON health_dirty_scopes;
CREATE TRIGGER health_dirty_scopes_tenant_binding
  BEFORE INSERT OR UPDATE ON health_dirty_scopes
  FOR EACH ROW EXECUTE FUNCTION validate_command_center_tenant_binding();

CREATE OR REPLACE FUNCTION prevent_command_center_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('scalesafe.health_retention', true) = 'on'
     AND current_user = 'postgres' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Command Center history is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS health_observations_immutable ON health_observations;
CREATE TRIGGER health_observations_immutable
  BEFORE UPDATE OR DELETE ON health_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_command_center_history_mutation();

DROP TRIGGER IF EXISTS incident_events_immutable ON incident_events;
CREATE TRIGGER incident_events_immutable
  BEFORE UPDATE OR DELETE ON incident_events
  FOR EACH ROW EXECUTE FUNCTION prevent_command_center_history_mutation();

DROP TRIGGER IF EXISTS health_check_definitions_updated_at ON health_check_definitions;
CREATE TRIGGER health_check_definitions_updated_at
  BEFORE UPDATE ON health_check_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS merchant_health_rollups_updated_at ON merchant_health_rollups;
CREATE TRIGGER merchant_health_rollups_updated_at
  BEFORE UPDATE ON merchant_health_rollups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS platform_incidents_updated_at ON platform_incidents;
CREATE TRIGGER platform_incidents_updated_at
  BEFORE UPDATE ON platform_incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'health_check_definitions',
    'service_heartbeats',
    'scheduled_job_definitions',
    'scheduled_job_runs',
    'health_current',
    'health_observations',
    'merchant_health_rollups',
    'platform_incidents',
    'incident_events',
    'health_dirty_scopes',
    'application_metric_buckets'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "Service role full access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION record_service_heartbeat(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_scheduled_job_run(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_scheduled_job_run(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_timed_out_scheduled_job_run(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_health_observation(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION evaluate_command_center_global_health(INTEGER, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION acknowledge_platform_incident(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION suppress_platform_incident(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_health_dirty(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_health_dirty_scopes(INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_health_dirty_scope(TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION command_center_database_canary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reconcile_command_center_provider_incidents() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reconcile_command_center_merchant_incidents(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reconcile_command_center_merchant_health(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reconcile_command_center_full_sweep_batch(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reconcile_command_center_dirty_health(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION run_command_center_retention(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resolve_operator_session_context(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_command_center_platform_overview(INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_command_center_incidents_page(INTEGER, BOOLEAN, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_service_heartbeat(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_scheduled_job_run(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_scheduled_job_run(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION settle_timed_out_scheduled_job_run(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_health_observation(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION evaluate_command_center_global_health(INTEGER, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION acknowledge_platform_incident(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION suppress_platform_incident(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION mark_health_dirty(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_health_dirty_scopes(INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_health_dirty_scope(TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION command_center_database_canary() TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_command_center_provider_incidents() TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_command_center_merchant_incidents(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_command_center_merchant_health(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_command_center_full_sweep_batch(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_command_center_dirty_health(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION run_command_center_retention(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_operator_session_context(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_command_center_platform_overview(INTEGER, TIMESTAMPTZ, UUID, TIMESTAMPTZ, UUID, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION list_command_center_incidents_page(INTEGER, BOOLEAN, TIMESTAMPTZ, UUID) TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 104;
$$ LANGUAGE SQL IMMUTABLE;
