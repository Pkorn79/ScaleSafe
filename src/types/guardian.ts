import { GuardianExactPath } from '../constants/guardian-checks';

export type GuardianState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type GuardianSeverity = 'info' | 'warning' | 'urgent' | 'critical';
export type GuardianErrorCode =
  | 'NOT_FOUND'
  | 'AUTHENTICATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'SEQUENCE_CONFLICT'
  | 'LOGICAL_ID_CONFLICT'
  | 'INTERNAL_ERROR';

export interface GuardianCredential {
  id: string;
  keyId: string;
  instanceId: string;
  publicKey: Buffer;
  status: 'pending' | 'active' | 'overlap' | 'revoked' | 'expired';
  validFrom: string;
  validUntil: string | null;
}

export interface GuardianAuthentication {
  credential: GuardianCredential;
  exactPath: GuardianExactPath;
  method: 'GET' | 'POST';
  timestampSeconds: string;
  sequence: string;
  bodySha256: string;
  rawBody: Buffer;
}

export interface GuardianObservation {
  check_key: string;
  observed_at: string;
  state: GuardianState;
  severity: GuardianSeverity;
  failure_code: string | null;
  summary_code: string;
  duration_ms: number;
  facts: Record<string, number | boolean | string>;
}

export interface GuardianRun {
  protocol_version: 1;
  instance_id: string;
  run_id: string;
  agent_version: string;
  started_at: string;
  completed_at: string;
  status: 'complete' | 'partial' | 'failed';
  observation_count: number;
  observations: GuardianObservation[];
}

export interface GuardianRecoveryVerification {
  protocol_version: 1;
  instance_id: string;
  verification_id: string;
  verification_type: 'backup_status' | 'backup_object' | 'restore_recency';
  verified_at: string;
  snapshot_id: string | null;
  schema_version: number | null;
  object_count: number | null;
  encrypted_bytes: number | null;
  result: 'healthy' | 'failed' | 'unknown';
  failure_code: string | null;
  proof_sha256: string;
}

export interface GuardianAlertDelivery {
  protocol_version: 1;
  instance_id: string;
  delivery_id: string;
  alert_id: string;
  incident_id: string;
  provider_name: 'ghl';
  event_type: 'opened' | 'escalated' | 'resolved';
  check_key: string;
  severity: GuardianSeverity;
  attempt_number: number;
  state: 'accepted' | 'notified' | 'failed';
  occurred_at: string;
  provider_reference_sha256: string | null;
  notification_channels: Array<'email' | 'sms'>;
  failure_code: string | null;
  envelope_sha256: string;
}

export interface GuardianClaimResult {
  decision: 'accepted' | 'duplicate' | 'logical_duplicate' | 'rejected';
  receiptId: string | null;
  originalReceiptId: string | null;
  acceptedSequence: string | null;
  acceptedObservationCount: number;
  recordId: string | null;
  rejectionCode: string | null;
  serverTime: string;
}

export interface GuardianSnapshotCheck {
  check_key: string;
  state: GuardianState;
  severity: GuardianSeverity;
  observed_at: string;
  failure_code: string | null;
  metrics: Record<string, number | boolean | string>;
}

export interface GuardianSnapshot {
  protocol_version: 1;
  request_sequence: string;
  generated_at: string;
  expires_at: string;
  build_sha: string | null;
  application_version: string;
  schema_version: number;
  checks: GuardianSnapshotCheck[];
  open_incidents: {
    info: number;
    warning: number;
    urgent: number;
    critical: number;
  };
}

export class GuardianRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: GuardianErrorCode,
  ) {
    super(errorCode);
    this.name = 'GuardianRequestError';
  }
}
