import { TextDecoder } from 'util';
import {
  GUARDIAN_ALERT_FAILURE_CODES,
  GUARDIAN_PATHS,
  GUARDIAN_RECOVERY_FAILURE_CODES,
} from '../constants/guardian-checks';
import {
  GuardianAlertDelivery,
  GuardianClaimResult,
  GuardianSnapshot,
  GuardianSnapshotCheck,
  GuardianObservation,
  GuardianRecoveryVerification,
  GuardianRequestError,
  GuardianRun,
} from '../types/guardian';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;
const AGENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,63}$/;
const CHECK_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,95}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const FACT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,63}$/;
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BIGINT_SEQUENCE_PATTERN = /^[1-9][0-9]{0,18}$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(): never {
  throw new GuardianRequestError(422, 'VALIDATION_FAILED');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function validGuardianTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

export function validGuardianSequence(value: unknown): value is string {
  if (typeof value !== 'string' || !BIGINT_SEQUENCE_PATTERN.test(value)) {
    return false;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= BigInt(1) && parsed <= BigInt('9223372036854775807');
  } catch {
    return false;
  }
}

function validateFacts(value: unknown): value is GuardianObservation['facts'] {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 16) return false;

  return entries.every(([key, fact]) => {
    if (!FACT_KEY_PATTERN.test(key)) return false;
    if (typeof fact === 'boolean') return true;
    if (typeof fact === 'number') {
      return Number.isSafeInteger(fact);
    }
    return typeof fact === 'string' && TOKEN_PATTERN.test(fact);
  });
}

function validateObservation(value: unknown): value is GuardianObservation {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'check_key',
    'observed_at',
    'state',
    'severity',
    'failure_code',
    'summary_code',
    'duration_ms',
    'facts',
  ])) {
    return false;
  }

  const state = value.state;
  const severity = value.severity;
  const failureCode = value.failure_code;
  if (
    typeof value.check_key !== 'string'
    || !CHECK_KEY_PATTERN.test(value.check_key)
    || !validGuardianTimestamp(value.observed_at)
    || !['healthy', 'degraded', 'unhealthy', 'unknown'].includes(String(state))
    || !['info', 'warning', 'urgent', 'critical'].includes(String(severity))
    || typeof value.summary_code !== 'string'
    || !CODE_PATTERN.test(value.summary_code)
    || !validSafeInteger(value.duration_ms, 0, 3_600_000)
    || !validateFacts(value.facts)
  ) {
    return false;
  }

  if (state === 'healthy') {
    return severity === 'info' && failureCode === null;
  }
  return typeof failureCode === 'string' && CODE_PATTERN.test(failureCode);
}

function parseJsonObject(rawBody: Buffer): Record<string, unknown> {
  try {
    const decoded = utf8Decoder.decode(rawBody);
    const parsed = JSON.parse(decoded);
    if (!isPlainObject(parsed)) invalid();
    return parsed;
  } catch (error) {
    if (error instanceof GuardianRequestError) throw error;
    invalid();
  }
}

function parseRun(rawBody: Buffer): GuardianRun {
  const value = parseJsonObject(rawBody);
  if (!hasExactKeys(value, [
    'protocol_version',
    'instance_id',
    'run_id',
    'agent_version',
    'started_at',
    'completed_at',
    'status',
    'observation_count',
    'observations',
  ])) {
    invalid();
  }

  if (
    value.protocol_version !== 1
    || !validUuid(value.instance_id)
    || !validUuid(value.run_id)
    || typeof value.agent_version !== 'string'
    || !AGENT_VERSION_PATTERN.test(value.agent_version)
    || !validGuardianTimestamp(value.started_at)
    || !validGuardianTimestamp(value.completed_at)
    || !['complete', 'partial', 'failed'].includes(String(value.status))
    || !validSafeInteger(value.observation_count, 1, 64)
    || !Array.isArray(value.observations)
    || value.observations.length < 1
    || value.observations.length > 64
    || value.observation_count !== value.observations.length
    || value.observations.some((observation) => !validateObservation(observation))
    || new Date(value.completed_at).getTime() < new Date(value.started_at).getTime()
  ) {
    invalid();
  }

  return value as unknown as GuardianRun;
}

function nullableInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return value === null || validSafeInteger(value, minimum, maximum);
}

function parseRecoveryVerification(rawBody: Buffer): GuardianRecoveryVerification {
  const value = parseJsonObject(rawBody);
  if (!hasExactKeys(value, [
    'protocol_version',
    'instance_id',
    'verification_id',
    'verification_type',
    'verified_at',
    'snapshot_id',
    'schema_version',
    'object_count',
    'encrypted_bytes',
    'result',
    'failure_code',
    'proof_sha256',
  ])) {
    invalid();
  }

  const result = String(value.result);
  const failureCode = value.failure_code;
  if (
    value.protocol_version !== 1
    || !validUuid(value.instance_id)
    || !validUuid(value.verification_id)
    || !['backup_status', 'backup_object', 'restore_recency'].includes(
      String(value.verification_type),
    )
    || !validGuardianTimestamp(value.verified_at)
    || !(
      value.snapshot_id === null
      || (typeof value.snapshot_id === 'string' && SNAPSHOT_ID_PATTERN.test(value.snapshot_id))
    )
    || !nullableInteger(value.schema_version, 1, 2_147_483_647)
    || !nullableInteger(value.object_count, 0, Number.MAX_SAFE_INTEGER)
    || !nullableInteger(value.encrypted_bytes, 0, Number.MAX_SAFE_INTEGER)
    || !['healthy', 'failed', 'unknown'].includes(result)
    || typeof value.proof_sha256 !== 'string'
    || !SHA256_PATTERN.test(value.proof_sha256)
  ) {
    invalid();
  }

  if (result === 'healthy') {
    if (failureCode !== null) invalid();
  } else if (
    typeof failureCode !== 'string'
    || !GUARDIAN_RECOVERY_FAILURE_CODES.has(failureCode)
  ) {
    invalid();
  }

  return value as unknown as GuardianRecoveryVerification;
}

function parseAlertDelivery(rawBody: Buffer): GuardianAlertDelivery {
  const value = parseJsonObject(rawBody);
  if (!hasExactKeys(value, [
    'protocol_version',
    'instance_id',
    'delivery_id',
    'alert_id',
    'incident_id',
    'provider_name',
    'event_type',
    'check_key',
    'severity',
    'attempt_number',
    'state',
    'occurred_at',
    'provider_reference_sha256',
    'notification_channels',
    'failure_code',
    'envelope_sha256',
  ])) {
    invalid();
  }

  const state = String(value.state);
  const severity = String(value.severity);
  const channels = value.notification_channels;
  const expectedChannels = ['urgent', 'critical'].includes(severity)
    ? ['email', 'sms']
    : ['email'];
  if (
    value.protocol_version !== 1
    || !validUuid(value.instance_id)
    || !validUuid(value.delivery_id)
    || !validUuid(value.alert_id)
    || !validUuid(value.incident_id)
    || value.provider_name !== 'ghl'
    || !['opened', 'escalated', 'resolved'].includes(String(value.event_type))
    || typeof value.check_key !== 'string'
    || !CHECK_KEY_PATTERN.test(value.check_key)
    || !['info', 'warning', 'urgent', 'critical'].includes(severity)
    || !validSafeInteger(value.attempt_number, 1, 100)
    || !['accepted', 'notified', 'failed'].includes(state)
    || !validGuardianTimestamp(value.occurred_at)
    || !Array.isArray(channels)
    || channels.length > 2
    || channels.some((channel) => !['email', 'sms'].includes(String(channel)))
    || new Set(channels).size !== channels.length
    || typeof value.envelope_sha256 !== 'string'
    || !SHA256_PATTERN.test(value.envelope_sha256)
    || !(
      value.provider_reference_sha256 === null
      || (
        typeof value.provider_reference_sha256 === 'string'
        && SHA256_PATTERN.test(value.provider_reference_sha256)
      )
    )
    || !(
      value.failure_code === null
      || (
        typeof value.failure_code === 'string'
        && GUARDIAN_ALERT_FAILURE_CODES.has(value.failure_code)
      )
    )
  ) {
    invalid();
  }

  if (
    state === 'accepted'
    && (channels.length !== 0 || value.failure_code !== null)
  ) invalid();
  if (
    state === 'notified'
    && (
      JSON.stringify(channels) !== JSON.stringify(expectedChannels)
      || value.failure_code !== null
      || value.provider_reference_sha256 === null
    )
  ) invalid();
  if (
    state === 'failed'
    && (
      channels.length !== 0
      || typeof value.failure_code !== 'string'
      || value.provider_reference_sha256 !== null
    )
  ) invalid();

  return value as unknown as GuardianAlertDelivery;
}

export function parseGuardianPayload(
  exactPath: string,
  rawBody: Buffer,
): GuardianRun | GuardianRecoveryVerification | GuardianAlertDelivery | null {
  if (exactPath === GUARDIAN_PATHS.snapshot) {
    if (rawBody.length !== 0) invalid();
    return null;
  }
  if (exactPath === GUARDIAN_PATHS.runs) return parseRun(rawBody);
  if (exactPath === GUARDIAN_PATHS.recoveryVerifications) {
    return parseRecoveryVerification(rawBody);
  }
  if (exactPath === GUARDIAN_PATHS.alertDeliveries) {
    return parseAlertDelivery(rawBody);
  }
  invalid();
}

function validateMetricMap(value: unknown, maximumProperties: number): boolean {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > maximumProperties) return false;
  return entries.every(([key, metricValue]) => {
    if (!FACT_KEY_PATTERN.test(key)) return false;
    if (typeof metricValue === 'boolean') return true;
    if (typeof metricValue === 'number') return Number.isSafeInteger(metricValue);
    return typeof metricValue === 'string' && TOKEN_PATTERN.test(metricValue);
  });
}

function validateSnapshotCheck(value: unknown): value is GuardianSnapshotCheck {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'check_key',
    'state',
    'severity',
    'observed_at',
    'failure_code',
    'metrics',
  ])) {
    return false;
  }
  const state = String(value.state);
  const severity = String(value.severity);
  if (
    typeof value.check_key !== 'string'
    || !CHECK_KEY_PATTERN.test(value.check_key)
    || !['healthy', 'degraded', 'unhealthy', 'unknown'].includes(state)
    || !['info', 'warning', 'urgent', 'critical'].includes(severity)
    || !validGuardianTimestamp(value.observed_at)
    || !validateMetricMap(value.metrics, 16)
  ) {
    return false;
  }
  if (state === 'healthy') {
    return severity === 'info' && value.failure_code === null;
  }
  return typeof value.failure_code === 'string'
    && CODE_PATTERN.test(value.failure_code);
}

export function validateGuardianSnapshotResponse(value: unknown): value is GuardianSnapshot {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'protocol_version',
    'request_sequence',
    'generated_at',
    'expires_at',
    'build_sha',
    'application_version',
    'schema_version',
    'checks',
    'open_incidents',
  ])) {
    return false;
  }
  if (
    value.protocol_version !== 1
    || !validGuardianSequence(value.request_sequence)
    || !validGuardianTimestamp(value.generated_at)
    || !validGuardianTimestamp(value.expires_at)
    || new Date(value.expires_at).getTime() <= new Date(value.generated_at).getTime()
    || !(
      value.build_sha === null
      || (
        typeof value.build_sha === 'string'
        && /^[A-Fa-f0-9]{7,64}$/.test(value.build_sha)
      )
    )
    || typeof value.application_version !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/.test(value.application_version)
    || !validSafeInteger(value.schema_version, 1, 2_147_483_647)
    || !Array.isArray(value.checks)
    || value.checks.length > 64
    || value.checks.some((check) => !validateSnapshotCheck(check))
    || !isPlainObject(value.open_incidents)
    || !hasExactKeys(value.open_incidents, ['info', 'warning', 'urgent', 'critical'])
    || !Object.values(value.open_incidents).every(
      (count) => validSafeInteger(count, 0, Number.MAX_SAFE_INTEGER),
    )
  ) {
    return false;
  }
  return true;
}

export function validateGuardianIngestionResponse(
  value: unknown,
): value is ReturnType<typeof guardianIngestionResponseShape> {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'protocol_version',
    'status',
    'receipt_id',
    'original_receipt_id',
    'accepted_sequence',
    'accepted_observation_count',
    'record_id',
    'server_time',
  ])) {
    return false;
  }
  const status = String(value.status);
  if (
    value.protocol_version !== 1
    || !['accepted', 'duplicate', 'logical_duplicate'].includes(status)
    || !validUuid(value.receipt_id)
    || !(
      value.original_receipt_id === null
      || validUuid(value.original_receipt_id)
    )
    || !validGuardianSequence(value.accepted_sequence)
    || !validSafeInteger(value.accepted_observation_count, 0, 64)
    || !(value.record_id === null || validUuid(value.record_id))
    || !validGuardianTimestamp(value.server_time)
  ) {
    return false;
  }
  if (status === 'accepted' && value.original_receipt_id !== null) return false;
  if (status === 'logical_duplicate' && !validUuid(value.original_receipt_id)) {
    return false;
  }
  return true;
}

export function validateGuardianErrorResponse(value: unknown): boolean {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'protocol_version',
    'error_code',
    'request_id',
    'server_time',
  ])) {
    return false;
  }
  return value.protocol_version === 1
    && [
      'NOT_FOUND',
      'AUTHENTICATION_FAILED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'SEQUENCE_CONFLICT',
      'LOGICAL_ID_CONFLICT',
      'INTERNAL_ERROR',
    ].includes(String(value.error_code))
    && validUuid(value.request_id)
    && validGuardianTimestamp(value.server_time);
}

function guardianIngestionResponseShape(claim: GuardianClaimResult) {
  return {
    protocol_version: 1 as const,
    status: claim.decision,
    receipt_id: claim.receiptId,
    original_receipt_id: claim.originalReceiptId,
    accepted_sequence: claim.acceptedSequence,
    accepted_observation_count: claim.acceptedObservationCount,
    record_id: claim.recordId,
    server_time: claim.serverTime,
  };
}
