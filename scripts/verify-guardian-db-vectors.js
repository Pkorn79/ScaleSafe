'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '105_guardian_and_independent_alerting.sql',
);
const vectorsPath = path.join(
  root,
  'protocol',
  'guardian',
  'v1',
  'test-vectors.json',
);

function requiredLocalDatabaseUrl() {
  const value = process.env.GUARDIAN_VECTOR_DATABASE_URL;
  if (!value) {
    throw new Error(
      'GUARDIAN_VECTOR_DATABASE_URL is required and must target the isolated local database',
    );
  }

  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(
      `Refusing non-loopback database host for rollback-only verification: ${parsed.hostname}`,
    );
  }
  return value;
}

function bodyFor(vector) {
  const raw = Buffer.from(vector.request.raw_body_base64url, 'base64url');
  return vector.request.method === 'GET'
    ? null
    : JSON.parse(raw.toString('utf8'));
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM guardian_ingestion_receipts) AS receipts,
      (
        (SELECT count(*) FROM guardian_runs)
        + (SELECT count(*) FROM guardian_observations)
        + (SELECT count(*) FROM recovery_verifications)
        + (SELECT count(*) FROM alert_deliveries)
      )::integer AS domain_rows
  `);
  return result.rows[0];
}

async function claim(client, vector) {
  const headers = vector.request.headers;
  const result = await client.query(
    `
      SELECT *
      FROM claim_guardian_request(
        $1::uuid,
        $2::bigint,
        1::smallint,
        $3::text,
        $4::text,
        clock_timestamp(),
        $5::text,
        $6::jsonb
      )
    `,
    [
      vector.database_state.key_id,
      headers['x-scalesafe-guardian-sequence'],
      vector.request.signed_path,
      vector.request.method,
      headers['x-scalesafe-guardian-body-sha256'],
      bodyFor(vector),
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error(`${vector.name}: RPC returned ${result.rows.length} rows`);
  }
  return result.rows[0];
}

async function seedCredential(client, vector, publicKeyHex) {
  const state = vector.database_state;
  const needsLogicalSeed = state.logical_records.length > 0;
  const initialSequence = needsLogicalSeed
    ? (BigInt(state.last_sequence) - BigInt(1)).toString()
    : state.last_sequence;

  const inserted = await client.query(
    `
      INSERT INTO guardian_credentials (
        key_id,
        instance_id,
        display_name,
        public_key,
        public_key_fingerprint,
        status,
        valid_from,
        valid_until,
        last_sequence,
        activated_at,
        nonsecret_audit_reference
      ) VALUES (
        $1::uuid,
        $2::uuid,
        'Protocol vector database verifier',
        decode($3::text, 'hex'),
        encode(extensions.digest(convert_to($1::text, 'UTF8'), 'sha256'), 'hex'),
        'active',
        clock_timestamp() - interval '1 hour',
        clock_timestamp() + interval '1 hour',
        $4::bigint,
        clock_timestamp(),
        'rollback-only-vector-verifier'
      )
      RETURNING id
    `,
    [
      state.key_id,
      state.instance_id,
      publicKeyHex,
      initialSequence,
    ],
  );
  const credentialId = inserted.rows[0].id;

  await client.query(
    `
      INSERT INTO guardian_credential_check_keys (
        guardian_credential_id,
        check_key,
        nonsecret_audit_reference
      )
      SELECT $1::uuid, check_key, 'rollback-only-vector-verifier'
      FROM guardian_check_catalog
      WHERE active
    `,
    [credentialId],
  );

  return { credentialId, needsLogicalSeed };
}

async function seedLogicalRecord(client, vector, acceptedRunVector) {
  const expectedHash = vector.database_state.logical_records[0]?.body_sha256;
  const seedHash =
    acceptedRunVector.request.headers['x-scalesafe-guardian-body-sha256'];
  if (expectedHash !== seedHash) {
    throw new Error(`${vector.name}: logical seed hash does not match accept_run`);
  }

  const seed = structuredClone(acceptedRunVector);
  seed.database_state = vector.database_state;
  seed.request.headers['x-scalesafe-guardian-sequence'] =
    vector.database_state.last_sequence;
  const result = await claim(client, seed);
  if (result.decision !== 'accepted') {
    throw new Error(
      `${vector.name}: logical seed was not accepted (${result.rejection_code})`,
    );
  }
}

async function seedRateLimit(client, credentialId, vector) {
  for (const bucket of vector.database_state.rate_limit_buckets || []) {
    await client.query(
      `
        INSERT INTO guardian_rate_limit_buckets (
          guardian_credential_id,
          endpoint_path,
          window_started_at,
          request_count,
          updated_at
        ) VALUES (
          $1::uuid,
          $2::text,
          clock_timestamp(),
          $3::integer,
          clock_timestamp()
        )
      `,
      [credentialId, bucket.endpoint_path, bucket.request_count],
    );
  }
}

function assertEqual(actual, expected, message) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

async function verifyVector(client, vector, acceptedRunVector, publicKeyHex) {
  await client.query('SAVEPOINT guardian_vector');
  try {
    const { credentialId, needsLogicalSeed } = await seedCredential(
      client,
      vector,
      publicKeyHex,
    );
    if (needsLogicalSeed) {
      await seedLogicalRecord(client, vector, acceptedRunVector);
    }
    await seedRateLimit(client, credentialId, vector);

    const before = await counts(client);
    const result = await claim(client, vector);
    const after = await counts(client);
    const expectation = vector.database_expectation;

    assertEqual(
      result.decision,
      expectation.decision,
      `${vector.name}: decision`,
    );
    assertEqual(
      result.rejection_code,
      expectation.rejection_code,
      `${vector.name}: rejection code`,
    );
    assertEqual(
      after.receipts - before.receipts,
      vector.expected.receipt_delta,
      `${vector.name}: receipt delta`,
    );
    assertEqual(
      after.domain_rows - before.domain_rows,
      vector.expected.domain_mutation_delta,
      `${vector.name}: domain mutation delta`,
    );

    const sequence = await client.query(
      'SELECT last_sequence::text FROM guardian_credentials WHERE id = $1::uuid',
      [credentialId],
    );
    assertEqual(
      sequence.rows[0].last_sequence,
      vector.expected.resulting_last_sequence,
      `${vector.name}: resulting sequence`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT guardian_vector');
    await client.query('RELEASE SAVEPOINT guardian_vector');
  }
}

async function main() {
  const databaseUrl = requiredLocalDatabaseUrl();
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const contract = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  const databaseVectors = contract.vectors.filter(
    (vector) => vector.database_expectation?.reaches_rpc,
  );
  const acceptedRunVector = contract.vectors.find(
    (vector) => vector.name === 'accept_run',
  );

  if (!acceptedRunVector || databaseVectors.length < 10) {
    throw new Error('Guardian database vector coverage is incomplete');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let began = false;
  try {
    const before = await client.query('SELECT scalesafe_schema_version() AS version');
    assertEqual(before.rows[0].version, 104, 'isolated schema before verification');

    await client.query('BEGIN');
    began = true;
    await client.query(migration);
    const migrated = await client.query(
      'SELECT scalesafe_schema_version() AS version',
    );
    assertEqual(migrated.rows[0].version, 105, 'schema inside verification');

    for (const vector of databaseVectors) {
      await verifyVector(
        client,
        vector,
        acceptedRunVector,
        contract.test_key.public_key_hex,
      );
      process.stdout.write(`PASS ${vector.name}\n`);
    }

    await client.query('ROLLBACK');
    began = false;
    const after = await client.query('SELECT scalesafe_schema_version() AS version');
    assertEqual(after.rows[0].version, 104, 'isolated schema after rollback');
    process.stdout.write(
      `GUARDIAN_DB_VECTORS_VERIFIED ${databaseVectors.length} schema=104\n`,
    );
  } catch (error) {
    if (began) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
