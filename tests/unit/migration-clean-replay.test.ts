import fs from 'fs';
import path from 'path';

function readMigration(fileName: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', fileName),
    'utf8',
  );
}

describe('clean migration replay safeguards', () => {
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
});
