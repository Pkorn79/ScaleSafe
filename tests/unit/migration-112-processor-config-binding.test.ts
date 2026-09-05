import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '112_immutable_processor_config_binding.sql',
);
const verificationPath = path.join(
  process.cwd(),
  'supabase',
  'security',
  'verify_migration_112.sql',
);
const blockedRollbackVerificationPath = path.join(
  process.cwd(),
  'supabase',
  'security',
  'verify_migration_112_blocked_rollback.sql',
);

const readSql = (filePath: string): string =>
  fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

describe('migration 112 immutable processor configuration binding contract', () => {
  const migrationSql = readSql(migrationPath);
  const verificationSql = readSql(verificationPath);
  const blockedRollbackVerificationSql = readSql(blockedRollbackVerificationPath);

  it('requires schema 111 and advances the schema version to 112', () => {
    expect(migrationSql.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/);
    expect(migrationSql.trimEnd()).toMatch(/COMMIT;$/);
    expect(migrationSql).toMatch(/scalesafe_schema_version\(\) <> 111/);
    expect(migrationSql).toMatch(/SELECT 112;/);
  });

  it('adds nullable processor configuration foreign keys that preserve financial bindings', () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.enrollments[\s\S]*ADD COLUMN IF NOT EXISTS processor_config_id UUID/,
    );
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.payment_events[\s\S]*ADD COLUMN IF NOT EXISTS processor_config_id UUID/,
    );
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.payment_methods[\s\S]*ADD COLUMN IF NOT EXISTS processor_config_id UUID/,
    );
    expect(migrationSql.match(/REFERENCES public\.processor_configs\s*\(id\)[\s\S]{0,80}ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(migrationSql).not.toMatch(/processor_config_id UUID NOT NULL/);
  });

  it('backfills NMI and Stripe enrollments only when one tenant config exists', () => {
    expect(migrationSql).toMatch(/e\.processor_type IN \('nmi', 'stripe'\)/);
    expect(migrationSql).toMatch(/c\.merchant_id = e\.merchant_id/);
    expect(migrationSql).toMatch(/c\.location_id = e\.location_id/);
    expect(migrationSql).toMatch(/c\.processor_type = e\.processor_type/);
    expect(migrationSql).toMatch(/candidate_count = 1/);
    expect(migrationSql).not.toMatch(/offers_mirror[\s\S]*resolved_enrollment_bindings/);
  });

  it('blocks every nonterminal recurring enrollment that cannot be bound safely', () => {
    expect(migrationSql).toMatch(/e\.processor_type IN \('nmi', 'stripe'\) OR e\.processor_type IS NULL/);
    expect(migrationSql).toMatch(/e\.processor_subscription_id IS NOT NULL/);
    expect(migrationSql).toMatch(/e\.status NOT IN \('cancelled', 'completed'\)/);
    expect(migrationSql).toContain(
      'Migration 112 found active recurring enrollments with missing or ambiguous processor configuration ownership',
    );
  });

  it('copies a resolved enrollment binding to matching processor payment events', () => {
    expect(migrationSql).toMatch(
      /UPDATE public\.payment_events AS pe[\s\S]*SET processor_config_id = e\.processor_config_id[\s\S]*FROM public\.enrollments AS e/,
    );
    expect(migrationSql).toMatch(/pe\.enrollment_id = e\.id/);
    expect(migrationSql).toMatch(/pe\.processor = e\.processor_type/);
    expect(migrationSql).toMatch(/pe\.location_id = e\.location_id/);
    expect(migrationSql).toMatch(/pe\.merchant_id IS NULL OR pe\.merchant_id = e\.merchant_id/);
  });

  it('backfills payment methods only when one tenant processor config matches', () => {
    expect(migrationSql).toMatch(
      /UPDATE public\.payment_methods AS pm[\s\S]*SET processor_config_id = resolved\.processor_config_id/,
    );
    expect(migrationSql).toMatch(/c\.merchant_id = pm\.merchant_id/);
    expect(migrationSql).toMatch(/c\.location_id = pm\.location_id/);
    expect(migrationSql).toMatch(/c\.processor_type = pm\.processor_type/);
    expect(migrationSql).toMatch(/payment_method_candidates[\s\S]*candidate_count = 1/);
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_payment_methods_processor_config_id[\s\S]*payment_methods \(processor_config_id\)/,
    );
  });

  it('rejects pre-existing cross-tenant or cross-processor bindings', () => {
    expect(migrationSql).toContain('Migration 112 found an invalid enrollment processor configuration binding');
    expect(migrationSql).toContain('Migration 112 found an invalid payment method processor configuration binding');
    expect(migrationSql).toContain('Migration 112 found an invalid payment event processor configuration binding');
    expect(migrationSql).toMatch(/config\.merchant_id IS DISTINCT FROM e\.merchant_id/);
    expect(migrationSql).toMatch(/config\.merchant_id IS DISTINCT FROM pm\.merchant_id/);
    expect(migrationSql).toMatch(/config\.processor_type IS DISTINCT FROM pe\.processor/);
  });

  it('enforces immutable tenant-scoped bindings at write time', () => {
    expect(migrationSql).toContain('validate_immutable_processor_config_binding');
    expect(migrationSql).toContain('processor configuration binding is immutable once set');
    expect(migrationSql).toContain('processor configuration binding does not belong to this tenant and processor');
    expect(migrationSql.match(/CREATE TRIGGER \w+_validate_processor_config_binding/g)).toHaveLength(3);
    expect(migrationSql).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('prechecks sentinel and transaction collisions before replacing the dedupe index', () => {
    expect(migrationSql).toContain('Migration 112 found the reserved zero UUID');
    expect(migrationSql).toContain('processor_configs_id_not_zero_check');
    expect(migrationSql).toContain('Migration 112 found duplicate processor-scoped transaction identities');
    expect(migrationSql).toMatch(/GROUP BY[\s\S]*location_id[\s\S]*processor[\s\S]*COALESCE\(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid\)[\s\S]*processor_transaction_id/i);
    expect(migrationSql).toMatch(/DROP INDEX public\.uq_payment_events_location_processor_txn/);
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX uq_payment_events_location_processor_txn[\s\S]*COALESCE\s*\(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid\)/i,
    );
    expect(migrationSql).toMatch(/processor_transaction_id IS NOT NULL[\s\S]*processor_transaction_id <> ''/);
  });

  it('replaces the old RPC with one unambiguous processor-config-aware signature', () => {
    expect(migrationSql).toMatch(
      /DROP FUNCTION public\.record_recurring_payment\(uuid, text, text, text, numeric, date, text, text, text, jsonb\)/,
    );
    expect(migrationSql).toMatch(
      /CREATE FUNCTION public\.record_recurring_payment\([\s\S]*p_processor_config_id\s+uuid\s+DEFAULT NULL/,
    );
    expect(migrationSql).toMatch(/processor_config_id[\s\S]*p_processor_config_id/);
    expect(migrationSql).toMatch(
      /ON CONFLICT\s*\([\s\S]*COALESCE\(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid\)[\s\S]*processor_transaction_id[\s\S]*\)/i,
    );
    expect(migrationSql).toContain('does not belong to the enrollment tenant and processor');
    expect(migrationSql).toContain('does not match immutable enrollment binding');
  });

  it('ships a rollback-only verifier covering binding, config-scoped dedupe, and null identity', () => {
    expect(verificationSql).toContain('BEGIN;');
    expect(verificationSql).toContain('ROLLBACK;');
    expect(verificationSql).toContain('Expected ScaleSafe schema version 112');
    expect(verificationSql).toContain('RPC processor configuration binding was not persisted');
    expect(verificationSql).toContain('Processor-scoped transaction identities collided');
    expect(verificationSql).toContain('NULL processor configuration did not remain one identity');
    expect(verificationSql).toContain('Processor configuration deletion was not restricted');
    expect(verificationSql).toContain('Immutable enrollment binding accepted a different configuration');
    expect(verificationSql).toContain('A deterministically resolvable payment method was not backfilled');
    expect(verificationSql).toContain('Processor configuration supporting indexes are missing or malformed');
  });

  it('ships an isolated verifier proving a blocked migration leaves no partial schema', () => {
    expect(blockedRollbackVerificationSql).toContain('Blocked migration 112 did not preserve schema version 111');
    expect(blockedRollbackVerificationSql).toContain('Blocked migration 112 left partial processor binding columns');
    expect(blockedRollbackVerificationSql).toContain('Blocked migration 112 left the schema-112 recurring payment RPC');
    expect(blockedRollbackVerificationSql).toContain('MIGRATION_112_BLOCKED_ROLLBACK_PASSED');
  });
});
