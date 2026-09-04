const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SAFE_LOCATION_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const SCOPE_TYPES = new Set(['platform', 'worker', 'job', 'queue', 'merchant', 'provider']);
const HEALTH_STATES = new Set(['healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable']);
const INCIDENT_STATES = new Set(['open', 'acknowledged', 'mitigating', 'resolved', 'suppressed']);
const SEVERITIES = new Set(['critical', 'urgent', 'warning', 'info']);

function safeEnum(value: unknown, allowed: ReadonlySet<string>, fallback: string): string {
  const normalized = String(value || '');
  return allowed.has(normalized) ? normalized : fallback;
}

function safeKey(value: unknown, fallback = 'unknown'): string {
  const normalized = String(value || '');
  return SAFE_KEY_PATTERN.test(normalized) ? normalized : fallback;
}

function safeLocation(value: unknown): string | null {
  const normalized = String(value || '');
  return SAFE_LOCATION_PATTERN.test(normalized) ? normalized : null;
}

function safeUuid(value: unknown): string | null {
  const normalized = String(value || '');
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return null;
  return value;
}

function safeCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function readableKey(value: string): string {
  return value
    .split(/[._:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Operational check';
}

export function projectOperatorHealthCheck(
  row: Record<string, unknown>,
  canViewMerchantIdentity: boolean,
): Record<string, unknown> | null {
  const scopeType = safeEnum(row.scope_type, SCOPE_TYPES, 'platform');
  const locationId = safeLocation(row.location_id);
  if ((scopeType === 'merchant' || locationId) && !canViewMerchantIdentity) return null;

  const checkKey = safeKey(row.check_key, 'platform.unknown');
  const state = safeEnum(row.state, HEALTH_STATES, 'unknown');
  const severity = row.severity === null || row.severity === undefined
    ? null
    : safeEnum(row.severity, SEVERITIES, 'warning');
  const failureClass = row.failure_class === null || row.failure_class === undefined
    ? null
    : safeKey(row.failure_class, 'UNCLASSIFIED');

  return {
    id: safeUuid(row.id),
    scope_type: scopeType,
    scope_id: safeKey(row.scope_id),
    location_id: locationId,
    check_key: checkKey,
    state,
    severity,
    failure_class: failureClass,
    summary: `${readableKey(checkKey)} reported ${state.replace(/_/g, ' ')}.`,
    last_observed_at: safeTimestamp(row.last_observed_at),
    state_changed_at: safeTimestamp(row.state_changed_at),
    contract_version: safeKey(row.contract_version, 'unknown'),
  };
}

export function projectOperatorIncident(
  row: Record<string, unknown>,
  canViewMerchantIdentity: boolean,
): Record<string, unknown> | null {
  const scopeType = safeEnum(row.scope_type, SCOPE_TYPES, 'platform');
  const locationId = safeLocation(row.location_id);
  if ((scopeType === 'merchant' || locationId) && !canViewMerchantIdentity) return null;

  const checkKey = safeKey(row.check_key, 'platform.unknown');
  const status = safeEnum(row.status, INCIDENT_STATES, 'open');
  const severity = safeEnum(row.severity, SEVERITIES, 'warning');
  const failureClass = safeKey(row.failure_class, 'UNCLASSIFIED');
  const title = readableKey(checkKey);

  return {
    id: safeUuid(row.id),
    scope_type: scopeType,
    scope_id: safeKey(row.scope_id),
    location_id: locationId,
    check_key: checkKey,
    failure_class: failureClass,
    severity,
    status,
    title,
    summary: `${title} is ${status}. Failure class: ${failureClass}.`,
    occurrence_count: safeCount(row.occurrence_count),
    first_seen_at: safeTimestamp(row.first_seen_at),
    last_seen_at: safeTimestamp(row.last_seen_at),
    recovery_candidate_at: safeTimestamp(row.recovery_candidate_at),
    acknowledged_at: safeTimestamp(row.acknowledged_at),
    suppressed_until: safeTimestamp(row.suppressed_until),
    resolved_at: safeTimestamp(row.resolved_at),
    parent_incident_id: safeUuid(row.parent_incident_id),
    suppressible: row.suppressible === true,
    runbook_key: safeKey(row.runbook_key, 'RUNBOOK-API'),
  };
}
