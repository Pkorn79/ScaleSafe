export const GUARDIAN_PROTOCOL_VERSION = 1 as const;
export const GUARDIAN_MAX_SEQUENCE = BigInt('9223372036854775807');
export const GUARDIAN_EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const GUARDIAN_PATHS = {
  snapshot: '/internal/guardian/v1/snapshot',
  runs: '/internal/guardian/v1/runs',
  recoveryVerifications: '/internal/guardian/v1/recovery-verifications',
  alertDeliveries: '/internal/guardian/v1/alert-deliveries',
} as const;

export type GuardianExactPath = typeof GUARDIAN_PATHS[keyof typeof GUARDIAN_PATHS];

export const GUARDIAN_REQUEST_HEADERS = {
  keyId: 'x-scalesafe-guardian-key-id',
  timestamp: 'x-scalesafe-guardian-timestamp',
  sequence: 'x-scalesafe-guardian-sequence',
  bodySha256: 'x-scalesafe-guardian-body-sha256',
  signature: 'x-scalesafe-guardian-signature',
  protocol: 'x-scalesafe-guardian-protocol',
} as const;

export const GUARDIAN_SNAPSHOT_CHECK_KEYS = {
  database: 'platform.database.aggregate',
  workers: 'platform.workers.aggregate',
  queues: 'platform.queues.aggregate',
  jobs: 'platform.jobs.aggregate',
  http: 'platform.http.aggregate',
  security: 'platform.security.flags',
} as const;

export const GUARDIAN_RECOVERY_FAILURE_CODES = new Set([
  'BACKUP_COMMAND_FAILED',
  'BACKUP_STALE',
  'BACKUP_STATUS_MISSING',
  'BACKUP_OBJECT_MISSING',
  'BACKUP_OBJECT_MISMATCH',
  'RESTORE_OVERDUE',
  'RESTORE_PROOF_MISSING',
  'STATUS_UNAVAILABLE',
  'VERIFICATION_TIMEOUT',
]);

export const GUARDIAN_ALERT_FAILURE_CODES = new Set([
  'GHL_ACCEPTANCE_UNKNOWN',
  'GHL_ALERT_UNAVAILABLE',
  'GHL_PROVIDER_ERROR',
  'GHL_RATE_LIMITED',
  'GHL_REJECTED',
  'GHL_UNREACHABLE',
  'PROCESS_INTERRUPTED_AFTER_SEND',
]);
