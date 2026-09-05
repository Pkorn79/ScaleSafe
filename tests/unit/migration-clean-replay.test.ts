import fs from 'fs';
import path from 'path';

function readMigration(fileName: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', fileName),
    'utf8',
  );
}

function readScript(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', fileName), 'utf8');
}

describe('clean migration replay safeguards', () => {
  it('uses each Supabase migration version exactly once', () => {
    const migrationFiles = fs
      .readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
      .filter((fileName) => fileName.endsWith('.sql'));
    const versions = migrationFiles.map((fileName) => fileName.split('_', 1)[0]);

    expect(new Set(versions).size).toBe(versions.length);
  });

  it('keeps both historical migration 055 changes in one replayable file', () => {
    const sql = readMigration('055_engagement_enabled.sql');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS engagement_enabled');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trigger_delivery_logs');
  });

  it('extends the migration 019 health table before migration 031 indexes newer columns', () => {
    const sql = readMigration('031_stripe_health_radar_tables.sql');

    expect(sql).toContain('ALTER TABLE account_health_snapshots');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS computed_at');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS risk_level');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_health_snapshots_computed');
  });

  it('guards migration 086 backfills that only exist in drifted legacy databases', () => {
    const sql = readMigration('086_defense_live_test_fixes.sql');

    for (const legacyColumn of [
      'consent_date',
      'payment_date',
      'transaction_id',
      'card_last_four',
    ]) {
      expect(sql).toContain(`AND column_name = '${legacyColumn}'`);
    }
    expect(sql).toContain("EXECUTE 'UPDATE evidence_consent");
    expect(sql).toContain("EXECUTE 'UPDATE evidence_enrollment_payment");
  });

  it('avoids the reserved authorization alias in migration 095', () => {
    const sql = readMigration('095_activate_authorized_zoom_connections.sql');

    expect(sql).toContain('AS provider_auth');
    expect(sql).not.toMatch(/\bAS\s+authorization\b/i);
  });

  it('keeps isolated replay loopback-bound and each pending migration atomic', () => {
    const script = readScript('replay-isolated-pending-migrations.sh');

    expect(script).toContain('NETWORK_ID="${3:-}"');
    expect(script).toContain('com.docker.network.bridge.host_binding_ipv4');
    expect(script).toContain('NETWORK_BINDING" != "127.0.0.1"');
    expect(script).toContain('supabase db reset --local --no-seed --network-id "$NETWORK_ID"');
    expect(script).toContain("grep -E '0\\.0\\.0\\.0:|\\[::\\]:'");
    expect(script).toContain('psql "$DB_URL" --single-transaction');
    expect(script).toContain('Refusing migration with incomplete transaction boundary');
  });
});
