import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  validateGuardianErrorResponse,
  validateGuardianIngestionResponse,
  validateGuardianSnapshotResponse,
} from '../../src/services/guardian-protocol.service';

const protocolDir = path.join(process.cwd(), 'protocol', 'guardian', 'v1');
const vectors = JSON.parse(
  fs.readFileSync(path.join(protocolDir, 'test-vectors.json'), 'utf8'),
);
const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '105_guardian_and_independent_alerting.sql',
  ),
  'utf8',
);
const migrationVerifier = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'security',
    'verify_migration_105.sql',
  ),
  'utf8',
);

describe('Guardian protocol v1 contract', () => {
  it('keeps every protocol artifact valid JSON', () => {
    [
      'check-catalog.json',
      'run.schema.json',
      'recovery-verification.schema.json',
      'alert-delivery.schema.json',
      'snapshot.schema.json',
      'ingestion-response.schema.json',
      'error-response.schema.json',
      'test-vectors.json',
    ].forEach((file) => {
      expect(() => JSON.parse(
        fs.readFileSync(path.join(protocolDir, file), 'utf8'),
      )).not.toThrow();
    });
  });

  it('keeps migration 105 check dependencies identical to the shared catalog', () => {
    const catalog = JSON.parse(fs.readFileSync(
      path.join(protocolDir, 'check-catalog.json'),
      'utf8',
    ));
    const valuesBlock = migration
      .split('INSERT INTO guardian_check_catalog (')[1]
      .split('ON CONFLICT (check_key)')[0];
    const rowPattern = /\(\s*'([^']+)',\s*'[^']+',\s*'[^']+',\s*'([^']+)',\s*\d+,\s*\d+,\s*'([^']+)',\s*(NULL|'[^']+'),\s*\d+,\s*true\s*\)/g;
    const migrationChecks = Array.from(valuesBlock.matchAll(rowPattern)).map(
      (match) => ({
        check_key: match[1],
        authorized_source: match[2],
        default_severity: match[3],
        parent_check_key: match[4] === 'NULL'
          ? null
          : match[4].slice(1, -1),
      }),
    );

    expect(catalog.protocol_version).toBe(1);
    expect(migrationChecks).toEqual(catalog.checks);
  });

  it('reconstructs canonical input from actual request bytes and path', () => {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(vectors.test_key.public_key_hex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });

    for (const vector of vectors.vectors) {
      const signature = vector.request.headers[
        'x-scalesafe-guardian-signature'
      ];
      const valid = crypto.verify(
        null,
        Buffer.from([
          'v1',
          vector.request.method,
          vector.request.request_path,
          vector.request.headers['x-scalesafe-guardian-timestamp'],
          vector.request.headers['x-scalesafe-guardian-sequence'],
          crypto.createHash('sha256').update(
            Buffer.from(vector.request.raw_body_base64url, 'base64url'),
          ).digest('hex'),
        ].join('\n'), 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64url'),
      );
      expect(valid).toBe(![
        'altered_body_fails_authentication',
        'altered_valid_path_fails_signature',
        'query_string_is_not_found',
        'bad_signature_fails_authentication',
      ].includes(vector.name));
    }
  });

  it('defines executable state and outcomes for every vector', () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(20);

    for (const vector of vectors.vectors) {
      expect(vector.verification_clock_unix).toMatch(/^[0-9]+$/);
      expect(vector.database_state.key_id).toBe(vectors.test_key.key_id);
      expect(vector.database_state.last_sequence).toMatch(/^[0-9]+$/);
      expect(vector.request.method).toMatch(/^(GET|POST)$/);
      expect(vector.request.request_path).toMatch(/^\/internal\/guardian\//);
      expect(vector.request.raw_body_base64url).toEqual(expect.any(String));
      expect(vector.expected.http_status).toBeGreaterThanOrEqual(200);
      expect(vector.expected.resulting_last_sequence).toMatch(/^[0-9]+$/);
      expect(vector.database_expectation).toEqual(expect.objectContaining({
        reaches_rpc: expect.any(Boolean),
      }));
      if (vector.database_expectation.reaches_rpc) {
        expect([
          'accepted',
          'duplicate',
          'logical_duplicate',
          'rejected',
        ]).toContain(vector.database_expectation.decision);
      } else {
        expect(vector.database_expectation.decision).toBeNull();
        expect(vector.database_expectation.rejection_code).toBeNull();
      }

      const sequence = BigInt(
        vector.request.headers['x-scalesafe-guardian-sequence'],
      );
      expect(sequence > BigInt(0)).toBe(true);
      expect(sequence <= BigInt('9223372036854775807')).toBe(true);
    }
  });

  it('assigns real RPC expectations to every database-reaching vector', () => {
    const databaseVectors = vectors.vectors.filter(
      (vector: any) => vector.database_expectation.reaches_rpc,
    );
    expect(databaseVectors.map((vector: any) => vector.name)).toEqual([
      'accept_snapshot',
      'accept_run',
      'accept_recovery_failure_run',
      'accept_recovery_verification',
      'accept_alert_delivery',
      'accept_alert_notification_proof',
      'partial_critical_notification_fails_validation',
      'alert_tenant_selector_fails_validation',
      'unknown_alert_failure_code_fails_validation',
      'accept_bigint_sequence_boundary',
      'exact_retry_returns_original_receipt',
      'logical_duplicate_consumes_new_sequence_without_domain_mutation',
      'durable_rate_limit_is_enforced',
      'sequence_gap_is_conflict',
      'stale_sequence_is_conflict',
      'logical_id_changed_content_is_conflict',
    ]);
  });

  it('covers the protocol security and retry boundaries', () => {
    const names = new Set(vectors.vectors.map((vector: any) => vector.name));
    [
      'accept_snapshot',
      'accept_run',
      'accept_recovery_failure_run',
      'accept_recovery_verification',
      'accept_alert_delivery',
      'accept_alert_notification_proof',
      'partial_critical_notification_fails_validation',
      'alert_tenant_selector_fails_validation',
      'unknown_alert_failure_code_fails_validation',
      'accept_bigint_sequence_boundary',
      'exact_retry_returns_original_receipt',
      'logical_duplicate_consumes_new_sequence_without_domain_mutation',
      'logical_id_changed_content_is_conflict',
      'altered_body_fails_authentication',
      'altered_valid_path_fails_signature',
      'query_string_is_not_found',
      'stale_timestamp_fails_authentication',
      'unknown_credential_key_fails_authentication',
      'bad_signature_fails_authentication',
      'revoked_credential_fails_authentication',
      'post_without_json_content_type_is_rejected',
      'durable_rate_limit_is_enforced',
      'sequence_gap_is_conflict',
      'stale_sequence_is_conflict',
      'unknown_property_fails_validation',
      'tenant_selector_fails_validation',
      'oversized_body_is_rejected_before_parse',
      'unsafe_integer_fails_validation',
      'nonfinite_number_fails_validation',
      'observation_count_mismatch_fails_validation',
      'completion_before_start_fails_validation',
      'invalid_uuid_fails_validation',
      'non_utc_timestamp_fails_validation',
      'impossible_calendar_date_fails_validation',
    ].forEach((name) => expect(names).toContain(name));
  });

  it('defines strict success, duplicate, snapshot, and error responses', () => {
    const names = new Set(
      vectors.response_vectors.map((vector: any) => vector.name),
    );
    [
      'accepted_run_response',
      'exact_duplicate_response',
      'logical_duplicate_response',
      'logical_duplicate_without_original_receipt',
      'ingestion_sequence_overflow',
      'snapshot_response',
      'snapshot_too_many_metrics',
      'snapshot_expiry_before_generation',
      'snapshot_impossible_calendar_date',
      'snapshot_sequence_overflow',
      'error_response_not_found',
      'error_response_authentication_failed',
      'error_response_payload_too_large',
      'error_response_unsupported_media_type',
      'error_response_validation_failed',
      'error_response_rate_limited',
      'error_response_sequence_conflict',
      'error_response_logical_id_conflict',
      'error_response_internal_error',
    ].forEach((name) => expect(names).toContain(name));

    const invalidExpiry = vectors.response_vectors.find(
      (vector: any) => vector.name === 'snapshot_expiry_before_generation',
    );
    expect(new Date(invalidExpiry.body.expires_at).getTime()).toBeLessThan(
      new Date(invalidExpiry.body.generated_at).getTime(),
    );
    expect(invalidExpiry.expected_valid).toBe(false);
  });

  it('executes semantic validation for every response vector', () => {
    for (const vector of vectors.response_vectors) {
      const valid = vector.schema === 'snapshot.schema.json'
        ? validateGuardianSnapshotResponse(vector.body)
        : vector.schema === 'ingestion-response.schema.json'
          ? validateGuardianIngestionResponse(vector.body)
          : validateGuardianErrorResponse(vector.body);
      expect(valid).toBe(vector.expected_valid);
    }
  });

  it('does not permit arbitrary summaries or unsafe numeric facts', () => {
    const runSchema = JSON.parse(
      fs.readFileSync(path.join(protocolDir, 'run.schema.json'), 'utf8'),
    );
    const observation = runSchema.$defs.observation;
    const factValue = runSchema.$defs.factValue;

    expect(observation.required).toContain('summary_code');
    expect(observation.properties).not.toHaveProperty('summary');
    expect(factValue.oneOf).toContainEqual(
      expect.objectContaining({
        type: 'integer',
        minimum: -9007199254740991,
        maximum: 9007199254740991,
      }),
    );
    expect(factValue.oneOf).not.toContainEqual(
      expect.objectContaining({ type: 'number' }),
    );
  });
});

describe('migration 105 Guardian persistence contract', () => {
  const tables = [
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
    'recovery_verifications',
  ];

  it.each(tables)('creates and locks down %s', (table) => {
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(migration).toContain(`'${table}'`);
  });

  it('forces service-role-only access', () => {
    expect(migration).toContain(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'FOR ALL TO service_role USING (true) WITH CHECK (true)',
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*\sTO\s+(?:anon|authenticated)/i,
    );
  });

  it('claims sequence, rate limit, receipt, and payload atomically', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION claim_guardian_request',
    );
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain('guardian_rate_limit_buckets');
    expect(migration).toContain(
      'UNIQUE (guardian_credential_id, sequence)',
    );
    expect(migration).toContain("'logical_duplicate'");
    expect(migration).toContain("'LOGICAL_ID_CONFLICT'");
    expect(migration).toContain(
      'UNIQUE (guardian_instance_id, source_run_id)',
    );
    expect(migration).toContain(
      'UNIQUE (guardian_instance_id, source_verification_id)',
    );
    expect(migration).toContain(
      'UNIQUE (guardian_instance_id, source_delivery_id)',
    );
    expect(migration).toContain(
      "p_endpoint_path = '/internal/guardian/v1/alert-deliveries'",
    );
    expect(migration).toContain('provider_reference_sha256 CHAR(64)');
    expect(migration).not.toContain('provider_reference TEXT');
    expect(migration).toContain('idx_guardian_receipts_original_logical_id');
    expect(migration).toContain('guardian_instance_id = v_credential.instance_id');
  });

  it('derives safe codes and typed metrics from migration-owned catalogs', () => {
    expect(migration).toContain('allowed_summary_codes');
    expect(migration).toContain('allowed_failure_codes');
    expect(migration).toContain('guardian_check_metric_catalog');
    expect(migration).toContain("'integer', 'boolean', 'token'");
    expect(migration).toContain('summary_code TEXT NOT NULL');
    expect(migration).not.toContain('summary TEXT NOT NULL');
    for (const failureCode of [
      'BACKUP_ATTEMPT_FAILED',
      'BACKUP_TIMER_DISABLED',
      'BACKUP_VERIFY_FAILED',
      'B2_CAPABILITY_INVALID',
      'B2_OBJECT_INVALID',
      'B2_SOURCE_UNAVAILABLE',
    ]) {
      expect(migration).toContain(`'${failureCode}'`);
    }
    expect(migration).toMatch(
      /WHERE check_key IN \(\s*'recovery\.backup\.status',\s*'recovery\.backup\.object'\s*\);/,
    );
  });

  it('proves a real backup-attempt failure can be ingested', () => {
    expect(migrationVerifier).toContain(
      '"failure_code": "BACKUP_ATTEMPT_FAILED"',
    );
    expect(migrationVerifier).toContain('"observation_count": 3');
    expect(migrationVerifier).toContain(
      'v_result.accepted_observation_count <> 3',
    );
    expect(migrationVerifier).toContain(
      '(SELECT count(*) FROM guardian_observations) <> 3',
    );
  });

  it('keeps history append-only with bounded approved retention', () => {
    expect(migration).toContain('Guardian history is append-only');
    expect(migration).toContain(
      "current_setting('scalesafe.guardian_retention', true) = 'on'",
    );
    expect(migration).toContain(
      "'public.run_guardian_retention(integer)'::regprocedure",
    );
    expect(migration).not.toContain("current_user = 'postgres'");
    expect(migration).toContain("interval '90 days'");
    expect(migration).toContain("interval '3 years'");
    expect(migration).toContain(
      'WHERE duplicate.duplicate_of_receipt_id = receipt.id',
    );
    expect(migration).toContain(
      'WHERE credential.last_receipt_id = receipt.id',
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION scalesafe_schema_version\(\)[\s\S]*SELECT 105;/,
    );
    expect(migrationVerifier).toContain('owner_role.rolbypassrls');
    expect(migrationVerifier).toContain(
      'Retention failed to delete an eligible old receipt',
    );
    expect(migrationVerifier).toMatch(
      /'00000000-0000-4000-8000-000000002098',\s*1\s*\);/,
    );
  });
});
