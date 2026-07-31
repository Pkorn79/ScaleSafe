'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// RFC 8032 test vector 1. This is public test material, never a runtime key.
const TEST_ONLY_RFC8032_SEED_HEX =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_ONLY_RFC8032_PUBLIC_HEX =
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const PKCS8_ED25519_SEED_PREFIX = '302e020100300506032b657004220420';
const MAX_BIGINT_SEQUENCE = 9223372036854775807n;

const keyId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000001001';
const verificationClock = '1784998800';
const verificationTime = '2026-07-25T17:00:00.000Z';
const activeFrom = '2026-07-25T16:00:00.000Z';
const activeUntil = '2026-07-26T16:00:00.000Z';
const emptyBodyHash =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(PKCS8_ED25519_SEED_PREFIX + TEST_ONLY_RFC8032_SEED_HEX, 'hex'),
  format: 'der',
  type: 'pkcs8',
});
const derivedPublicKey = crypto.createPublicKey(privateKey).export({
  format: 'der',
  type: 'spki',
}).subarray(-32).toString('hex');

if (derivedPublicKey !== TEST_ONLY_RFC8032_PUBLIC_HEX) {
  throw new Error('RFC 8032 test key derivation mismatch');
}

function normalizeSequence(sequence) {
  const value = typeof sequence === 'bigint' ? sequence : BigInt(sequence);
  if (value < 1n || value > MAX_BIGINT_SEQUENCE) {
    throw new Error(`Sequence outside PostgreSQL BIGINT range: ${sequence}`);
  }
  return value.toString();
}

function signingInput(method, exactPath, timestamp, sequence, bodyHash) {
  return [
    'v1',
    method,
    exactPath,
    String(timestamp),
    normalizeSequence(sequence),
    bodyHash,
  ].join('\n');
}

function signedRequest({
  method,
  signedPath,
  requestPath = signedPath,
  timestamp = verificationClock,
  sequence,
  rawBody = Buffer.alloc(0),
  contentType,
}) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const input = signingInput(method, signedPath, timestamp, sequence, bodyHash);
  const signature = crypto.sign(null, Buffer.from(input, 'utf8'), privateKey);
  const headers = {
    'x-scalesafe-guardian-key-id': keyId,
    'x-scalesafe-guardian-timestamp': String(timestamp),
    'x-scalesafe-guardian-sequence': normalizeSequence(sequence),
    'x-scalesafe-guardian-body-sha256': bodyHash,
    'x-scalesafe-guardian-signature': signature.toString('base64url'),
    'x-scalesafe-guardian-protocol': '1',
  };
  if (contentType) headers['content-type'] = contentType;

  return {
    method,
    request_path: requestPath,
    signed_path: signedPath,
    headers,
    raw_body_base64url: rawBody.toString('base64url'),
    signing_input_utf8: input,
  };
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function credentialState(lastSequence, extra = {}) {
  return {
    key_id: keyId,
    instance_id: instanceId,
    status: 'active',
    valid_from: activeFrom,
    valid_until: activeUntil,
    last_sequence: String(lastSequence),
    accepted_receipts: [],
    logical_records: [],
    ...extra,
  };
}

function expected({
  httpStatus,
  status = null,
  errorCode = null,
  lastSequence,
  receiptDelta = 0,
  domainMutationDelta = 0,
}) {
  return {
    http_status: httpStatus,
    status,
    error_code: errorCode,
    resulting_last_sequence: String(lastSequence),
    receipt_delta: receiptDelta,
    domain_mutation_delta: domainMutationDelta,
  };
}

function vector(name, request, databaseState, outcome) {
  return {
    name,
    verification_clock_unix: verificationClock,
    verification_time_utc: verificationTime,
    database_state: databaseState,
    request,
    expected: outcome,
  };
}

const run = {
  protocol_version: 1,
  instance_id: instanceId,
  run_id: '00000000-0000-4000-8000-000000002001',
  agent_version: 'guardian-test/1.0.0',
  started_at: '2026-07-25T16:59:58.000Z',
  completed_at: '2026-07-25T17:00:00.000Z',
  status: 'complete',
  observation_count: 2,
  observations: [
    {
      check_key: 'public.api.reachability',
      observed_at: '2026-07-25T16:59:59.500Z',
      state: 'healthy',
      severity: 'info',
      failure_code: null,
      summary_code: 'CHECK_OK',
      duration_ms: 143,
      facts: {
        http_status: 200,
      },
    },
    {
      check_key: 'network.tls',
      observed_at: '2026-07-25T16:59:59.750Z',
      state: 'healthy',
      severity: 'info',
      failure_code: null,
      summary_code: 'CHECK_OK',
      duration_ms: 81,
      facts: {
        days_remaining: 73,
      },
    },
  ],
};

const recoveryFailureRun = {
  protocol_version: 1,
  instance_id: instanceId,
  run_id: '00000000-0000-4000-8000-000000002002',
  agent_version: 'guardian-test/1.0.0',
  started_at: '2026-07-25T16:59:58.000Z',
  completed_at: '2026-07-25T17:00:00.000Z',
  status: 'partial',
  observation_count: 1,
  observations: [
    {
      check_key: 'recovery.backup.status',
      observed_at: '2026-07-25T16:59:59.900Z',
      state: 'unhealthy',
      severity: 'critical',
      failure_code: 'BACKUP_ATTEMPT_FAILED',
      summary_code: 'CHECK_UNHEALTHY',
      duration_ms: 0,
      facts: {
        snapshot_age_hours: 40,
      },
    },
  ],
};

const recovery = {
  protocol_version: 1,
  instance_id: instanceId,
  verification_id: '00000000-0000-4000-8000-000000003001',
  verification_type: 'backup_status',
  verified_at: '2026-07-25T17:00:00.000Z',
  snapshot_id: '20260725T170000Z',
  schema_version: 104,
  object_count: 105,
  encrypted_bytes: 21011034,
  result: 'healthy',
  failure_code: null,
  proof_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const alertDelivery = {
  protocol_version: 1,
  instance_id: instanceId,
  delivery_id: '00000000-0000-4000-8000-000000004001',
  alert_id: '00000000-0000-4000-8000-000000004101',
  incident_id: '00000000-0000-4000-8000-000000004201',
  provider_name: 'ghl',
  event_type: 'opened',
  check_key: 'public.api.reachability',
  severity: 'critical',
  attempt_number: 1,
  state: 'accepted',
  occurred_at: '2026-07-25T17:00:00.000Z',
  provider_reference_sha256:
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  notification_channels: [],
  failure_code: null,
  envelope_sha256:
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
};

const alertNotification = {
  ...alertDelivery,
  delivery_id: '00000000-0000-4000-8000-000000004002',
  state: 'notified',
  occurred_at: '2026-07-25T17:00:01.000Z',
  notification_channels: ['email', 'sms'],
};

const runBody = jsonBody(run);
const runBodyHash = crypto.createHash('sha256').update(runBody).digest('hex');
const recoveryFailureRunBody = jsonBody(recoveryFailureRun);
const recoveryBody = jsonBody(recovery);
const alertDeliveryBody = jsonBody(alertDelivery);
const alertNotificationBody = jsonBody(alertNotification);
const receiptId = '00000000-0000-4000-8000-000000009001';
const recordId = '00000000-0000-4000-8000-000000009002';

const vectors = [];

vectors.push(vector(
  'accept_snapshot',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    sequence: '40',
  }),
  credentialState('39'),
  expected({
    httpStatus: 200,
    status: 'snapshot',
    lastSequence: '40',
    receiptDelta: 1,
  }),
));

vectors.push(vector(
  'accept_run',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: runBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 201,
    status: 'accepted',
    lastSequence: '40',
    receiptDelta: 1,
    domainMutationDelta: 3,
  }),
));

vectors.push(vector(
  'accept_recovery_failure_run',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: recoveryFailureRunBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 201,
    status: 'accepted',
    lastSequence: '40',
    receiptDelta: 1,
    domainMutationDelta: 2,
  }),
));

vectors.push(vector(
  'accept_recovery_verification',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/recovery-verifications',
    sequence: '40',
    rawBody: recoveryBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 201,
    status: 'accepted',
    lastSequence: '40',
    receiptDelta: 1,
    domainMutationDelta: 1,
  }),
));

vectors.push(vector(
  'accept_alert_delivery',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/alert-deliveries',
    sequence: '40',
    rawBody: alertDeliveryBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 201,
    status: 'accepted',
    lastSequence: '40',
    receiptDelta: 1,
    domainMutationDelta: 1,
  }),
));

vectors.push(vector(
  'accept_alert_notification_proof',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/alert-deliveries',
    sequence: '40',
    rawBody: alertNotificationBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 201,
    status: 'accepted',
    lastSequence: '40',
    receiptDelta: 1,
    domainMutationDelta: 1,
  }),
));

const partialCriticalNotification = {
  ...alertNotification,
  delivery_id: '00000000-0000-4000-8000-000000004003',
  notification_channels: ['email'],
};
signedJsonVector(
  'partial_critical_notification_fails_validation',
  partialCriticalNotification,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
  { path: '/internal/guardian/v1/alert-deliveries' },
);

const alertWithTenantSelector = {
  ...alertDelivery,
  delivery_id: '00000000-0000-4000-8000-000000004004',
  location_id: 'forbidden',
};
signedJsonVector(
  'alert_tenant_selector_fails_validation',
  alertWithTenantSelector,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
  { path: '/internal/guardian/v1/alert-deliveries' },
);

const alertWithUnknownFailure = {
  ...alertDelivery,
  delivery_id: '00000000-0000-4000-8000-000000004005',
  state: 'failed',
  provider_reference_sha256: null,
  failure_code: 'ARBITRARY_FAILURE_TEXT',
};
signedJsonVector(
  'unknown_alert_failure_code_fails_validation',
  alertWithUnknownFailure,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
  { path: '/internal/guardian/v1/alert-deliveries' },
);

vectors.push(vector(
  'accept_bigint_sequence_boundary',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    sequence: MAX_BIGINT_SEQUENCE,
  }),
  credentialState(MAX_BIGINT_SEQUENCE - 1n),
  expected({
    httpStatus: 200,
    status: 'snapshot',
    lastSequence: MAX_BIGINT_SEQUENCE,
    receiptDelta: 1,
  }),
));

vectors.push(vector(
  'exact_retry_returns_original_receipt',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: runBody,
    contentType: 'application/json',
  }),
  credentialState('40', {
    accepted_receipts: [{
      sequence: '40',
      method: 'POST',
      path: '/internal/guardian/v1/runs',
      body_sha256: runBodyHash,
      receipt_id: receiptId,
      record_id: recordId,
      observation_count: 2,
    }],
    logical_records: [{
      kind: 'run',
      logical_id: run.run_id,
      body_sha256: runBodyHash,
      receipt_id: receiptId,
      record_id: recordId,
      observation_count: 2,
    }],
  }),
  expected({
    httpStatus: 200,
    status: 'duplicate',
    lastSequence: '40',
  }),
));

vectors.push(vector(
  'logical_duplicate_consumes_new_sequence_without_domain_mutation',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '41',
    rawBody: runBody,
    contentType: 'application/json',
  }),
  credentialState('40', {
    accepted_receipts: [{
      sequence: '40',
      method: 'POST',
      path: '/internal/guardian/v1/runs',
      body_sha256: runBodyHash,
      receipt_id: receiptId,
      record_id: recordId,
      observation_count: 2,
    }],
    logical_records: [{
      kind: 'run',
      logical_id: run.run_id,
      body_sha256: runBodyHash,
      receipt_id: receiptId,
      record_id: recordId,
      observation_count: 2,
    }],
  }),
  expected({
    httpStatus: 200,
    status: 'logical_duplicate',
    lastSequence: '41',
    receiptDelta: 1,
  }),
));

function signedJsonVector(
  name,
  body,
  outcome,
  {
    sequence = '40',
    lastSequence = '39',
    path = '/internal/guardian/v1/runs',
    state = credentialState(lastSequence),
  } = {},
) {
  vectors.push(vector(
    name,
    signedRequest({
      method: 'POST',
      signedPath: path,
      sequence,
      rawBody: Buffer.isBuffer(body) ? body : jsonBody(body),
      contentType: 'application/json',
    }),
    state,
    outcome,
  ));
}

const alteredBodyRequest = signedRequest({
  method: 'POST',
  signedPath: '/internal/guardian/v1/runs',
  sequence: '40',
  rawBody: runBody,
  contentType: 'application/json',
});
alteredBodyRequest.raw_body_base64url = Buffer.concat([
  runBody.subarray(0, runBody.length - 1),
  Buffer.from(' '),
]).toString('base64url');
vectors.push(vector(
  'altered_body_fails_authentication',
  alteredBodyRequest,
  credentialState('39'),
  expected({
    httpStatus: 401,
    errorCode: 'AUTHENTICATION_FAILED',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'altered_valid_path_fails_signature',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    requestPath: '/internal/guardian/v1/recovery-verifications',
    sequence: '40',
    rawBody: runBody,
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 401,
    errorCode: 'AUTHENTICATION_FAILED',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'query_string_is_not_found',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    requestPath: '/internal/guardian/v1/snapshot?probe=1',
    sequence: '40',
  }),
  credentialState('39'),
  expected({
    httpStatus: 404,
    errorCode: 'NOT_FOUND',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'stale_timestamp_fails_authentication',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    timestamp: '1784998400',
    sequence: '40',
  }),
  credentialState('39'),
  expected({
    httpStatus: 401,
    errorCode: 'AUTHENTICATION_FAILED',
    lastSequence: '39',
  }),
));

const badSignatureRequest = signedRequest({
  method: 'GET',
  signedPath: '/internal/guardian/v1/snapshot',
  sequence: '40',
});
const validSignature =
  badSignatureRequest.headers['x-scalesafe-guardian-signature'];
badSignatureRequest.headers['x-scalesafe-guardian-signature'] =
  `${validSignature.slice(0, -1)}${validSignature.endsWith('A') ? 'B' : 'A'}`;
vectors.push(vector(
  'bad_signature_fails_authentication',
  badSignatureRequest,
  credentialState('39'),
  expected({
    httpStatus: 401,
    errorCode: 'AUTHENTICATION_FAILED',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'revoked_credential_fails_authentication',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    sequence: '40',
  }),
  credentialState('39', {
    status: 'revoked',
  }),
  expected({
    httpStatus: 401,
    errorCode: 'AUTHENTICATION_FAILED',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'post_without_json_content_type_is_rejected',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: runBody,
  }),
  credentialState('39'),
  expected({
    httpStatus: 415,
    errorCode: 'UNSUPPORTED_MEDIA_TYPE',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'durable_rate_limit_is_enforced',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: runBody,
    contentType: 'application/json',
  }),
  credentialState('39', {
    rate_limit_buckets: [{
      endpoint_path: '/internal/guardian/v1/runs',
      window_started_at: '2026-07-25T16:59:30.000Z',
      request_count: 30,
    }],
  }),
  expected({
    httpStatus: 429,
    errorCode: 'RATE_LIMITED',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'sequence_gap_is_conflict',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    sequence: '41',
  }),
  credentialState('39'),
  expected({
    httpStatus: 409,
    errorCode: 'SEQUENCE_CONFLICT',
    lastSequence: '39',
  }),
));

vectors.push(vector(
  'stale_sequence_is_conflict',
  signedRequest({
    method: 'GET',
    signedPath: '/internal/guardian/v1/snapshot',
    sequence: '39',
  }),
  credentialState('40'),
  expected({
    httpStatus: 409,
    errorCode: 'SEQUENCE_CONFLICT',
    lastSequence: '40',
  }),
));

const changedRun = structuredClone(run);
changedRun.agent_version = 'guardian-test/1.0.1';
signedJsonVector(
  'logical_id_changed_content_is_conflict',
  changedRun,
  expected({
    httpStatus: 409,
    errorCode: 'LOGICAL_ID_CONFLICT',
    lastSequence: '40',
  }),
  {
    sequence: '41',
    lastSequence: '40',
    state: credentialState('40', {
      logical_records: [{
        kind: 'run',
        logical_id: run.run_id,
        body_sha256: runBodyHash,
        receipt_id: receiptId,
        record_id: recordId,
        observation_count: 2,
      }],
    }),
  },
);

const unknownProperty = structuredClone(run);
unknownProperty.unexpected = true;
signedJsonVector(
  'unknown_property_fails_validation',
  unknownProperty,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const tenantSelector = structuredClone(run);
tenantSelector.location_id = 'forbidden';
signedJsonVector(
  'tenant_selector_fails_validation',
  tenantSelector,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

vectors.push(vector(
  'oversized_body_is_rejected_before_parse',
  signedRequest({
    method: 'POST',
    signedPath: '/internal/guardian/v1/runs',
    sequence: '40',
    rawBody: Buffer.alloc(65537, 0x20),
    contentType: 'application/json',
  }),
  credentialState('39'),
  expected({
    httpStatus: 413,
    errorCode: 'PAYLOAD_TOO_LARGE',
    lastSequence: '39',
  }),
));

const unsafeIntegerBody = Buffer.from(
  runBody.toString('utf8').replace(
    '"http_status":200',
    '"http_status":9007199254740993',
  ),
  'utf8',
);
signedJsonVector(
  'unsafe_integer_fails_validation',
  unsafeIntegerBody,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const hugeExponentBody = Buffer.from(
  runBody.toString('utf8').replace('"http_status":200', '"http_status":1e400'),
  'utf8',
);
signedJsonVector(
  'nonfinite_number_fails_validation',
  hugeExponentBody,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const wrongCount = structuredClone(run);
wrongCount.observation_count = 1;
signedJsonVector(
  'observation_count_mismatch_fails_validation',
  wrongCount,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const reversedTime = structuredClone(run);
reversedTime.completed_at = '2026-07-25T16:59:57.000Z';
signedJsonVector(
  'completion_before_start_fails_validation',
  reversedTime,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const invalidUuid = structuredClone(run);
invalidUuid.run_id = 'not-a-uuid';
signedJsonVector(
  'invalid_uuid_fails_validation',
  invalidUuid,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const nonUtcTime = structuredClone(run);
nonUtcTime.started_at = '2026-07-25T11:59:58.000-05:00';
signedJsonVector(
  'non_utc_timestamp_fails_validation',
  nonUtcTime,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const impossibleCalendarDate = structuredClone(run);
impossibleCalendarDate.started_at = '2026-02-31T16:59:58.000Z';
signedJsonVector(
  'impossible_calendar_date_fails_validation',
  impossibleCalendarDate,
  expected({
    httpStatus: 422,
    errorCode: 'VALIDATION_FAILED',
    lastSequence: '39',
  }),
);

const databaseExpectations = {
  accept_snapshot: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  accept_run: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  accept_recovery_failure_run: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  accept_recovery_verification: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  accept_alert_delivery: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  accept_alert_notification_proof: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  partial_critical_notification_fails_validation: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'INVALID_ALERT_DELIVERY',
  },
  alert_tenant_selector_fails_validation: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'INVALID_ALERT_DELIVERY',
  },
  unknown_alert_failure_code_fails_validation: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'INVALID_ALERT_DELIVERY',
  },
  accept_bigint_sequence_boundary: {
    reaches_rpc: true,
    decision: 'accepted',
    rejection_code: null,
  },
  exact_retry_returns_original_receipt: {
    reaches_rpc: true,
    decision: 'duplicate',
    rejection_code: null,
  },
  logical_duplicate_consumes_new_sequence_without_domain_mutation: {
    reaches_rpc: true,
    decision: 'logical_duplicate',
    rejection_code: null,
  },
  durable_rate_limit_is_enforced: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'RATE_LIMITED',
  },
  sequence_gap_is_conflict: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'SEQUENCE_GAP',
  },
  stale_sequence_is_conflict: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'STALE_SEQUENCE',
  },
  logical_id_changed_content_is_conflict: {
    reaches_rpc: true,
    decision: 'rejected',
    rejection_code: 'LOGICAL_ID_CONFLICT',
  },
};

for (const item of vectors) {
  item.database_expectation = databaseExpectations[item.name] || {
    reaches_rpc: false,
    decision: null,
    rejection_code: null,
  };
}

const responseVectors = [
  {
    name: 'accepted_run_response',
    http_status: 201,
    schema: 'ingestion-response.schema.json',
    body: {
      protocol_version: 1,
      status: 'accepted',
      receipt_id: '00000000-0000-4000-8000-000000009101',
      original_receipt_id: null,
      accepted_sequence: '40',
      accepted_observation_count: 2,
      record_id: '00000000-0000-4000-8000-000000009102',
      server_time: verificationTime,
    },
    expected_valid: true,
  },
  {
    name: 'exact_duplicate_response',
    http_status: 200,
    schema: 'ingestion-response.schema.json',
    body: {
      protocol_version: 1,
      status: 'duplicate',
      receipt_id: '00000000-0000-4000-8000-000000009101',
      original_receipt_id: null,
      accepted_sequence: '40',
      accepted_observation_count: 2,
      record_id: '00000000-0000-4000-8000-000000009102',
      server_time: verificationTime,
    },
    expected_valid: true,
  },
  {
    name: 'logical_duplicate_response',
    http_status: 200,
    schema: 'ingestion-response.schema.json',
    body: {
      protocol_version: 1,
      status: 'logical_duplicate',
      receipt_id: '00000000-0000-4000-8000-000000009103',
      original_receipt_id: '00000000-0000-4000-8000-000000009101',
      accepted_sequence: '41',
      accepted_observation_count: 2,
      record_id: '00000000-0000-4000-8000-000000009102',
      server_time: verificationTime,
    },
    expected_valid: true,
  },
  {
    name: 'logical_duplicate_without_original_receipt',
    http_status: 200,
    schema: 'ingestion-response.schema.json',
    body: {
      protocol_version: 1,
      status: 'logical_duplicate',
      receipt_id: '00000000-0000-4000-8000-000000009103',
      original_receipt_id: null,
      accepted_sequence: '41',
      accepted_observation_count: 2,
      record_id: '00000000-0000-4000-8000-000000009102',
      server_time: verificationTime,
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  {
    name: 'ingestion_sequence_overflow',
    http_status: 200,
    schema: 'ingestion-response.schema.json',
    body: {
      protocol_version: 1,
      status: 'duplicate',
      receipt_id: '00000000-0000-4000-8000-000000009101',
      original_receipt_id: null,
      accepted_sequence: '9223372036854775808',
      accepted_observation_count: 2,
      record_id: '00000000-0000-4000-8000-000000009102',
      server_time: verificationTime,
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  {
    name: 'snapshot_response',
    http_status: 200,
    schema: 'snapshot.schema.json',
    body: {
      protocol_version: 1,
      request_sequence: '40',
      generated_at: verificationTime,
      expires_at: '2026-07-25T17:05:00.000Z',
      build_sha: '67d9ea3f40d8882b0bbcd32163f0736261257597',
      application_version: '1.0.0',
      schema_version: 105,
      checks: [],
      open_incidents: {
        info: 0,
        warning: 0,
        urgent: 0,
        critical: 0,
      },
    },
    expected_valid: true,
  },
  {
    name: 'snapshot_too_many_metrics',
    http_status: 200,
    schema: 'snapshot.schema.json',
    body: {
      protocol_version: 1,
      request_sequence: '40',
      generated_at: verificationTime,
      expires_at: '2026-07-25T17:05:00.000Z',
      build_sha: null,
      application_version: '1.0.0',
      schema_version: 105,
      checks: [{
        check_key: 'public.api.reachability',
        state: 'healthy',
        severity: 'info',
        observed_at: verificationTime,
        failure_code: null,
        metrics: Object.fromEntries(Array.from(
          { length: 17 },
          (_, index) => [`metric_${String(index).padStart(2, '0')}`, index],
        )),
      }],
      open_incidents: {
        info: 0,
        warning: 0,
        urgent: 0,
        critical: 0,
      },
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  {
    name: 'snapshot_expiry_before_generation',
    http_status: 200,
    schema: 'snapshot.schema.json',
    body: {
      protocol_version: 1,
      request_sequence: '40',
      generated_at: verificationTime,
      expires_at: '2026-07-25T16:59:59.000Z',
      build_sha: null,
      application_version: '1.0.0',
      schema_version: 105,
      checks: [],
      open_incidents: {
        info: 0,
        warning: 0,
        urgent: 0,
        critical: 0,
      },
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  {
    name: 'snapshot_impossible_calendar_date',
    http_status: 200,
    schema: 'snapshot.schema.json',
    body: {
      protocol_version: 1,
      request_sequence: '40',
      generated_at: '2026-02-31T17:00:00.000Z',
      expires_at: '2026-03-03T17:05:00.000Z',
      build_sha: null,
      application_version: '1.0.0',
      schema_version: 105,
      checks: [],
      open_incidents: {
        info: 0,
        warning: 0,
        urgent: 0,
        critical: 0,
      },
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  {
    name: 'snapshot_sequence_overflow',
    http_status: 200,
    schema: 'snapshot.schema.json',
    body: {
      protocol_version: 1,
      request_sequence: '9223372036854775808',
      generated_at: verificationTime,
      expires_at: '2026-07-25T17:05:00.000Z',
      build_sha: null,
      application_version: '1.0.0',
      schema_version: 105,
      checks: [],
      open_incidents: {
        info: 0,
        warning: 0,
        urgent: 0,
        critical: 0,
      },
    },
    expected_valid: false,
    expected_error_code: 'SEMANTIC_VALIDATION_FAILED',
  },
  ...[
    [404, 'NOT_FOUND'],
    [401, 'AUTHENTICATION_FAILED'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [422, 'VALIDATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [409, 'SEQUENCE_CONFLICT'],
    [409, 'LOGICAL_ID_CONFLICT'],
    [500, 'INTERNAL_ERROR'],
  ].map(([httpStatus, errorCode], index) => ({
    name: `error_response_${String(errorCode).toLowerCase()}`,
    http_status: httpStatus,
    schema: 'error-response.schema.json',
    body: {
      protocol_version: 1,
      error_code: errorCode,
      request_id: `00000000-0000-4000-8000-${String(9200 + index).padStart(12, '0')}`,
      server_time: verificationTime,
    },
    expected_valid: true,
  })),
];

const output = {
  protocol_version: 1,
  test_key: {
    source: 'RFC 8032 test vector 1',
    key_id: keyId,
    public_key_hex: TEST_ONLY_RFC8032_PUBLIC_HEX,
    public_key_base64url: Buffer.from(
      TEST_ONLY_RFC8032_PUBLIC_HEX,
      'hex',
    ).toString('base64url'),
  },
  constants: {
    timestamp_tolerance_seconds: 300,
    maximum_body_bytes: 65536,
    maximum_sequence: MAX_BIGINT_SEQUENCE.toString(),
    empty_body_sha256: emptyBodyHash,
  },
  vectors,
  response_vectors: responseVectors,
};

const destination = path.resolve(
  __dirname,
  '..',
  'protocol',
  'guardian',
  'v1',
  'test-vectors.json',
);
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o644,
});
console.log(`Wrote ${destination}`);
