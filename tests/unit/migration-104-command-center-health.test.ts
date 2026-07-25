import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '104_command_center_health_and_incidents.sql'),
  'utf8',
);

describe('migration 104 command center health and incidents', () => {
  const tables = [
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
    'application_metric_buckets',
  ];

  it.each(tables)('creates and locks down %s', (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(sql).toContain(`'${table}'`);
  });

  it('forces service-role-only RLS for every command center table', () => {
    expect(sql).toContain('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR ALL TO service_role USING (true) WITH CHECK (true)');
    expect(sql).toContain('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*\sTO\s+(?:anon|authenticated)/i,
    );
  });

  it('serializes scheduled jobs and health incident transitions', () => {
    expect(sql).toContain(
      'job_key TEXT NOT NULL REFERENCES scheduled_job_definitions(job_key)',
    );
    expect(sql).toContain(
      "SELECT 1 FROM scheduled_job_definitions\n    WHERE job_key = p_job_key AND active = true",
    );
    expect(sql).not.toContain(
      'job_key TEXT NOT NULL REFERENCES health_check_definitions(check_key)',
    );
    expect(sql).toContain(
      "('job.provisioning_recovery', 'merchant_operation'",
    );
    expect(sql).toContain(
      "('job.command_center_health_reconcile', 'health_monitoring'",
    );
    expect(sql).toContain('idx_scheduled_job_runs_one_running');
    expect(sql).toContain("WHERE status IN ('running', 'timed_out')");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('scheduled-job:'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION settle_timed_out_scheduled_job_run');
    expect(sql).toContain("'JOB_TIMEOUT_SETTLED'");
    expect(sql).toContain("'health-current:' || p_scope_type");
    expect(sql).toContain("'health-incident:' || v_dedupe_key");
    expect(sql).toContain('idx_platform_incidents_one_active');
  });

  it('does not report partial or total item failure as healthy job success', () => {
    expect(sql).toContain("AND status = 'succeeded'\n      AND failed_count = 0");
    expect(sql).toContain("'SCHEDULED_JOB_ALL_ITEMS_FAILED'");
    expect(sql).toContain("'SCHEDULED_JOB_PARTIAL_FAILURE'");
    expect(sql).toContain("'latest_failed_count'");
  });

  it('evaluates global health in one service-only database call', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION evaluate_command_center_global_health');
    expect(sql).toContain('queue.money_reconciliation.pending');
    expect(sql).toContain('unknown_over_five_minutes');
    expect(sql).toContain('stalled_or_exhausted_count');
    expect(sql).toContain('queue.refund_reconciliation.pending');
    expect(sql).toContain('queue.external_evidence.pending');
    expect(sql).toContain('queue.defense_compilation.pending');
    expect(sql).toContain('queue.provisioning.pending');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION evaluate_command_center_global_health');
  });

  it('preserves dirty marks that arrive while a scope is being reconciled', () => {
    expect(sql).toContain('claimed_through_at TIMESTAMPTZ');
    expect(sql).toContain('claimed_through_at = dirty.last_marked_at');
    expect(sql).toContain('last_marked_at <= claimed_through_at');
    expect(sql).toContain('claimed_through_at = NULL');
  });

  it('checkpoints the full merchant sweep atomically in bounded batches', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION reconcile_command_center_full_sweep_batch',
    );
    expect(sql).toContain('p_limit INTEGER DEFAULT 1000');
    expect(sql).toContain("'job.merchant_health_full_sweep'");
    expect(sql).toContain("'full_sweep_cursor'");
    expect(sql).toContain("'full_sweep_complete'");
    expect(sql).toContain('processed_count = processed_count + v_processed');
    expect(sql).toContain('AND lease_expires_at > clock_timestamp()');
  });

  it('does not rewrite unchanged health outside bounded confirmations', () => {
    expect(sql).toContain('v_previous.contract_version = v_definition.contract_version');
    expect(sql).toContain('refresh volatile healthy metrics');
    expect(sql).toContain("p_state IN ('healthy', 'not_applicable')");
    expect(sql).toContain('FROM platform_incidents active_incident');
    expect(sql).toContain("p_state IN ('degraded', 'unhealthy', 'unknown')");
    expect(sql).toMatch(
      /p_state IN \('degraded', 'unhealthy', 'unknown'\)[\s\S]*v_previous\.summary = left\(p_summary, 1000\)[\s\S]*v_previous\.metrics = COALESCE\(p_metrics, '\{\}'::jsonb\)/,
    );
    expect(sql).toContain(
      'p_observed_at - make_interval(secs => v_definition.confirmation_seconds)',
    );
  });

  it('persists money heartbeats inside their stale window and throttles other workers', () => {
    expect(sql).toContain(
      "WHEN EXCLUDED.worker_key = 'worker.money_reconciliation'\n              THEN interval '1 minute'\n              ELSE interval '5 minutes'",
    );
    expect(sql).not.toContain(
      "service_heartbeats.last_persisted_at <= clock_timestamp() - interval '5 minutes'",
    );
  });

  it('rejects stale observations and enforces tenant binding', () => {
    expect(sql).toContain('p_observed_at <= v_previous.last_observed_at');
    expect(sql).toContain('Health observation merchant does not match location');
    expect(sql).toContain('validate_command_center_tenant_binding');
    expect(sql).toContain('health_current_tenant_binding');
    expect(sql).toContain('merchant_health_rollups_tenant_binding');
    expect(sql).toContain('health_dirty_scopes_tenant_binding');
  });

  it('keeps history append-only and suppression bounded', () => {
    expect(sql).toContain('Command Center history is append-only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON health_observations');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON incident_events');
    expect(sql).toContain("current_setting('scalesafe.health_retention', true) = 'on'");
    expect(sql).toContain("current_user = 'postgres'");
    expect(sql).toContain("p_until > clock_timestamp() + interval '24 hours'");
    expect(sql).toContain("'suppression_expired'");
    expect(sql).toContain('Expire it before the unchanged-observation fast path');
    expect(sql).toMatch(
      /WITH expired AS \([\s\S]*status = 'suppressed'[\s\S]*suppressed_until <= p_observed_at[\s\S]*INSERT INTO incident_events/,
    );
    expect(sql).toContain("severity <> 'critical'");
  });

  it('escalates approved daily jobs from warning to urgent after 48 hours', () => {
    expect(sql.match(/"urgent_after_seconds":172800/g)).toHaveLength(3);
    expect(sql).toContain("v_definition.config ? 'urgent_after_seconds'");
    expect(sql).toContain(
      "v_age_seconds >= (v_definition.config->>'urgent_after_seconds')::integer",
    );
    expect(sql).toContain("v_severity := 'urgent'");
  });

  it('seeds the approved v1.1 worker timeout and lease contract', () => {
    expect(sql).toContain("'command-center-health-v1.1'");
    expect(sql).toContain(
      "('worker.trigger_delivery', 'command-center-health-v1.1', 'worker', 'worker', 60, 120",
    );
    expect(sql).toContain('\'{"lease_seconds":180}\'::jsonb');
    expect(sql).toContain(
      "('worker.external_evidence', 'command-center-health-v1.1', 'worker', 'worker', 60, 75",
    );
    expect(sql).toContain('\'{"lease_seconds":90}\'::jsonb');
    expect(sql).toContain(
      "('worker.money_reconciliation', 'command-center-health-v1.1', 'worker', 'worker', 60, 90",
    );
    expect(sql).toContain('\'{"lease_seconds":120}\'::jsonb');
    expect(sql).toContain(
      "('worker.defense_compilation', 'command-center-health-v1.1', 'worker', 'worker', 60, 270",
    );
    expect(sql).toContain('\'{"lease_seconds":300}\'::jsonb');
    expect(sql).toContain("'job.command_center_health_reconcile'");
    expect(sql).not.toContain("'job.command_center_global_evaluation'");
    expect(sql).not.toContain("'job.merchant_health_reconcile'");
    expect(sql).toContain("'job.health_retention'");
  });

  it('separates all Supabase traffic from Command Center resource accounting', () => {
    expect(sql).toContain('supabase_request_count INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain(
      'command_center_supabase_request_count INTEGER NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('provider_request_count INTEGER NOT NULL DEFAULT 0');
  });

  it('evaluates multi-instance metrics by distinct UTC time bucket', () => {
    expect(sql).toMatch(
      /FROM application_metric_buckets[\s\S]*GROUP BY bucket_started_at[\s\S]*\) AS period;/,
    );
    expect(sql).toContain('bool_or(database_canary_failed)');
    expect(sql).toContain('count(*) FILTER (WHERE period.latency_p95_ms > 1500)');
    expect(sql).toContain(
      'count(*) FILTER (WHERE period.database_canary_latency_ms > 750)',
    );
  });

  it('seeds merchant and provider checks without weakening protected money incidents', () => {
    [
      'merchant.installation',
      'merchant.money_outcome',
      'merchant.refund_outcome',
      'merchant.trigger_delivery',
      'merchant.evidence_connection',
      'merchant.defense',
      'merchant.billing',
      'provider.supabase',
      'provider.ghl',
      'provider.stripe',
      'provider.nmi',
      'provider.whop',
      'provider.zoom',
      'provider.anthropic',
    ].forEach((checkKey) => expect(sql).toContain(`'${checkKey}'`));

    expect(sql).toContain("child.check_key NOT IN ('merchant.money_outcome', 'merchant.refund_outcome')");
    expect(sql).toContain("incident.severity <> 'critical'");
    expect(sql).toContain('count(DISTINCT incident.location_id) >= 10');
    expect(sql).toContain('count(DISTINCT incident.location_id) >= 3');
    expect(sql).toContain('count(DISTINCT incident.location_id) * 2 >= v_active_locations');
    expect(sql).toContain("incident.last_seen_at >= v_now - interval '15 minutes'");
  });

  it('preserves incident recovery identity after a health row becomes healthy', () => {
    expect(sql).toContain("IF p_state = 'healthy'");
    expect(sql).toContain('SELECT incident.failure_class INTO v_incident_failure_class');
    expect(sql).toContain("incident.status IN ('open', 'acknowledged', 'mitigating', 'suppressed')");
    expect(sql).toContain("'parent_unlinked'");
  });

  it('keeps table-specific tenant trigger checks from reading nonexistent fields', () => {
    expect(sql).toContain("IF TG_TABLE_NAME = 'health_current' THEN");
    expect(sql).toContain("ELSIF TG_TABLE_NAME IN ('merchant_health_rollups', 'health_dirty_scopes') THEN");
    expect(sql).not.toContain(
      "IF TG_TABLE_NAME = 'health_current'\n     AND NEW.scope_type",
    );
  });

  it('uses identical grouped processor expressions in merchant reconciliation', () => {
    expect(sql).toContain('lower(operation.processor_type) AS provider');
    expect(sql).toContain('GROUP BY merchant.id, operation.location_id, lower(operation.processor_type)');
    expect(sql).toContain('lower(claim.processor) AS provider');
    expect(sql).toContain('GROUP BY merchant.id, claim.location_id, lower(claim.processor)');
    expect(sql).not.toContain("lower(COALESCE(operation.processor_type, 'unknown')) AS provider");
    expect(sql).not.toContain("lower(COALESCE(claim.processor, 'unknown')) AS provider");
  });

  it('implements bounded retention and a dangerous-production-posture check', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION run_command_center_retention');
    expect(sql).toContain("interval '90 days'");
    expect(sql).toContain("interval '180 days'");
    expect(sql).toContain("interval '365 days'");
    expect(sql).toContain('LEAST(COALESCE(p_batch_size, 5000), 10000)');
    expect(sql).toContain("pg_try_advisory_xact_lock(hashtextextended('command-center-retention'");
    expect(sql).toContain("p_runtime_environment TEXT DEFAULT 'production'");
    expect(sql).toContain("p_dangerous_flags TEXT[] DEFAULT ARRAY[]::TEXT[]");
    expect(sql).toContain("'security.dangerous_flag_posture'");
    expect(sql).toContain("'DANGEROUS_PRODUCTION_FLAG_POSTURE'");
  });

  it('advances schema readiness without enabling browser access', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION scalesafe_schema_version\(\)[\s\S]*SELECT 104;/,
    );
    expect(sql).not.toContain('TO authenticated');
    expect(sql).not.toContain('TO anon');
  });

  it('consolidates live operator authorization and paginated overview reads', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION resolve_operator_session_context');
    expect(sql).toContain('session.idle_expires_at > clock_timestamp()');
    expect(sql).toContain("support_grant.status = 'active'");
    expect(sql).toContain("assignment.status = 'active'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION get_command_center_platform_overview');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION list_command_center_incidents_page');
    expect(sql).toContain('p_limit > 200');
    expect(sql).toContain('idx_health_current_page');
    expect(sql).toContain('idx_platform_incidents_active_page');
    expect(sql).toContain('idx_merchant_health_rollups_page');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION resolve_operator_session_context(TEXT) FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION get_command_center_platform_overview',
    );
  });
});
