import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

function migrationNumber(fileName: string): number {
  const match = fileName.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

describe('Supabase migration security guardrails', () => {
  it('keeps the public schema locked down for service-role backend access only', () => {
    const hardening = fs.readFileSync(
      path.join(migrationsDir, '059_security_hardening_public_schema.sql'),
      'utf8',
    ).toLowerCase();

    expect(hardening).toContain('enable row level security');
    expect(hardening).toContain('force row level security');
    expect(hardening).toContain('revoke all on all tables in schema public from anon');
    expect(hardening).toContain('revoke all on all tables in schema public from authenticated');
    expect(hardening).toContain('grant all on all tables in schema public to service_role');
    expect(hardening).toContain('alter default privileges in schema public');
  });

  it('requires new public tables after the hardening migration to enable RLS in the same migration', () => {
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && migrationNumber(file) > 59);

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').toLowerCase();
      if (!sql.includes('create table')) continue;
      expect(sql).toContain('enable row level security');
    }
  });
});
