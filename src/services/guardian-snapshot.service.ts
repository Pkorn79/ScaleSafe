import { config } from '../config';
import { GUARDIAN_SNAPSHOT_CHECK_KEYS } from '../constants/guardian-checks';
import { guardianRepository } from '../repositories/guardian.repository';
import {
  GuardianSeverity,
  GuardianSnapshot,
  GuardianSnapshotCheck,
  GuardianState,
} from '../types/guardian';
import { commandCenterHealthService } from './command-center-health.service';

interface HealthRow {
  scope_type: string;
  check_key: string;
  state: string;
  severity: string | null;
  metrics: Record<string, unknown> | null;
  last_observed_at: string;
}

const STATE_RANK: Record<GuardianState, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unhealthy: 3,
};
const SEVERITY_RANK: Record<GuardianSeverity, number> = {
  info: 0,
  warning: 1,
  urgent: 2,
  critical: 3,
};
function stateOf(value: unknown): GuardianState {
  return ['healthy', 'degraded', 'unhealthy', 'unknown'].includes(String(value))
    ? value as GuardianState
    : 'unknown';
}

function severityOf(value: unknown): GuardianSeverity {
  return ['info', 'warning', 'urgent', 'critical'].includes(String(value))
    ? value as GuardianSeverity
    : 'warning';
}

function maximumState(rows: HealthRow[]): GuardianState {
  if (rows.length === 0) return 'unknown';
  return rows
    .map((row) => stateOf(row.state))
    .sort((left, right) => STATE_RANK[right] - STATE_RANK[left])[0];
}

function maximumSeverity(
  rows: HealthRow[],
  state: GuardianState,
  fallback: GuardianSeverity,
): GuardianSeverity {
  if (state === 'healthy') return 'info';
  const supplied = rows
    .filter((row) => stateOf(row.state) !== 'healthy')
    .map((row) => severityOf(row.severity))
    .sort((left, right) => SEVERITY_RANK[right] - SEVERITY_RANK[left])[0];
  return supplied || fallback;
}

function aggregateObservedAt(rows: HealthRow[], fallback: string): string {
  const values = rows
    .map((row) => new Date(row.last_observed_at))
    .filter((value) => Number.isFinite(value.getTime()))
    .map((value) => value.getTime());
  return values.length > 0
    ? new Date(Math.min(...values)).toISOString()
    : fallback;
}

function safeInteger(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return 0;
  return Math.max(0, numeric);
}

function metric(row: HealthRow | undefined, ...keys: string[]): number {
  if (!row?.metrics) return 0;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row.metrics, key)) {
      return safeInteger(row.metrics[key]);
    }
  }
  return 0;
}

function sumMetrics(rows: HealthRow[], ...keys: string[]): number {
  return rows.reduce((sum, row) => {
    const next = metric(row, ...keys);
    return Number.isSafeInteger(sum + next) ? sum + next : Number.MAX_SAFE_INTEGER;
  }, 0);
}

function maxMetric(rows: HealthRow[], ...keys: string[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, metric(row, ...keys)), 0);
}

function aggregateCheck(
  checkKey: string,
  rows: HealthRow[],
  fallbackSeverity: GuardianSeverity,
  observedAtFallback: string,
  metrics: Record<string, number | boolean | string>,
): GuardianSnapshotCheck {
  const state = maximumState(rows);
  return {
    check_key: checkKey,
    state,
    severity: maximumSeverity(rows, state, fallbackSeverity),
    observed_at: aggregateObservedAt(rows, observedAtFallback),
    failure_code: state === 'healthy'
      ? null
      : state === 'degraded'
        ? 'CHECK_DEGRADED'
        : state === 'unhealthy'
          ? 'CHECK_UNHEALTHY'
          : 'CHECK_UNKNOWN',
    metrics,
  };
}

export const guardianSnapshotService = {
  async build(requestSequence: string): Promise<GuardianSnapshot> {
    const generatedAt = new Date();
    const generatedAtIso = generatedAt.toISOString();
    const inputs = await guardianRepository.getSnapshotInputs();
    const rows = inputs.healthRows as HealthRow[];
    const databaseRows = rows.filter((row) => row.check_key.startsWith('database.'));
    const workerRows = rows.filter((row) => row.scope_type === 'worker');
    const queueRows = rows.filter((row) => row.scope_type === 'queue');
    const jobRows = rows.filter((row) => row.scope_type === 'job');
    const httpRows = rows.filter((row) => row.check_key.startsWith('application.http_'));
    const canary = databaseRows.find((row) => row.check_key === 'database.canary_latency');
    const timeout = databaseRows.find((row) => row.check_key === 'database.request_timeouts');
    const latency = httpRows.find((row) => row.check_key === 'application.http_latency');
    const serverErrors = httpRows.find((row) => row.check_key === 'application.http_5xx');
    const safety = commandCenterHealthService.productionSafetyPosture();
    const hasDangerousFlag = safety.dangerousFlags.length > 0;
    const securityState: GuardianState = safety.runtimeEnvironment !== 'production'
      ? 'unknown'
      : hasDangerousFlag
        ? 'unhealthy'
        : 'healthy';

    const checks: GuardianSnapshotCheck[] = [
      aggregateCheck(
        GUARDIAN_SNAPSHOT_CHECK_KEYS.database,
        databaseRows,
        'critical',
        generatedAtIso,
        {
          schema_version: inputs.schemaVersion,
          canary_latency_ms: metric(
            canary,
            'maximum_canary_latency_ms',
            'database_canary_latency_ms',
          ),
          timeout_count: metric(timeout, 'database_timeout_count'),
        },
      ),
      aggregateCheck(
        GUARDIAN_SNAPSHOT_CHECK_KEYS.workers,
        workerRows,
        'urgent',
        generatedAtIso,
        {
          healthy_count: workerRows.filter((row) => stateOf(row.state) === 'healthy').length,
          degraded_count: workerRows.filter((row) => stateOf(row.state) === 'degraded').length,
          unhealthy_count: workerRows.filter((row) => stateOf(row.state) === 'unhealthy').length,
          unknown_count: workerRows.filter((row) => stateOf(row.state) === 'unknown').length,
          stale_count: workerRows.filter((row) => stateOf(row.state) === 'unknown').length,
        },
      ),
      aggregateCheck(
        GUARDIAN_SNAPSHOT_CHECK_KEYS.queues,
        queueRows,
        'urgent',
        generatedAtIso,
        {
          pending_count: sumMetrics(queueRows, 'due_count', 'pending_count'),
          retrying_count: sumMetrics(queueRows, 'retrying_count'),
          failed_count: sumMetrics(
            queueRows,
            'failed_count',
            'stalled_or_exhausted_count',
          ),
          oldest_age_seconds: maxMetric(
            queueRows,
            'oldest_due_age_seconds',
            'oldest_pending_age_seconds',
          ),
        },
      ),
      aggregateCheck(
        GUARDIAN_SNAPSHOT_CHECK_KEYS.jobs,
        jobRows,
        'urgent',
        generatedAtIso,
        {
          healthy_count: jobRows.filter((row) => stateOf(row.state) === 'healthy').length,
          failed_count: jobRows.filter((row) => stateOf(row.state) === 'unhealthy').length,
          missed_count: sumMetrics(jobRows, 'missed_count'),
          stale_count: jobRows.filter((row) => stateOf(row.state) === 'unknown').length,
          oldest_age_seconds: maxMetric(
            jobRows,
            'age_seconds',
            'last_success_age_seconds',
            'oldest_age_seconds',
          ),
        },
      ),
      aggregateCheck(
        GUARDIAN_SNAPSHOT_CHECK_KEYS.http,
        httpRows,
        'urgent',
        generatedAtIso,
        {
          request_count: metric(serverErrors, 'request_count'),
          server_error_count: metric(serverErrors, 'server_error_count'),
          timeout_count: metric(timeout, 'database_timeout_count'),
          latency_p95_ms: metric(latency, 'maximum_bucket_p95_ms', 'latency_p95_ms'),
          latency_max_ms: metric(latency, 'latency_max_ms', 'maximum_bucket_p95_ms'),
        },
      ),
      {
        check_key: GUARDIAN_SNAPSHOT_CHECK_KEYS.security,
        state: securityState,
        severity: securityState === 'healthy' ? 'info' : 'critical',
        observed_at: generatedAtIso,
        failure_code: securityState === 'healthy'
          ? null
          : securityState === 'unknown'
            ? 'CHECK_UNKNOWN'
            : 'CHECK_UNHEALTHY',
        metrics: {
          legacy_public_actions_enabled:
            process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS === 'true',
          daily_test_billing_enabled:
            process.env.VITE_ENABLE_DAILY_TEST_BILLING === 'true',
          guardian_ingestion_enabled: config.guardian.enabled,
        },
      },
    ];

    return {
      protocol_version: 1,
      request_sequence: requestSequence,
      generated_at: generatedAtIso,
      expires_at: new Date(
        generatedAt.getTime() + config.guardian.snapshotTtlSeconds * 1000,
      ).toISOString(),
      build_sha: config.guardian.buildSha,
      application_version: config.guardian.applicationVersion,
      schema_version: inputs.schemaVersion,
      checks,
      open_incidents: inputs.openIncidents,
    };
  },
};
