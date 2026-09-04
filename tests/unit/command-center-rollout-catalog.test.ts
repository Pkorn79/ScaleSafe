import fs from 'fs';
import path from 'path';

const root = path.join(process.cwd(), 'supabase');
const gate = fs.readFileSync(path.join(root, 'security', 'check_command_center_rollout.sql'), 'utf8');
const guardianVerifier = fs.readFileSync(path.join(root, 'security', 'verify_migration_109.sql'), 'utf8');
const dashboardVerifier = fs.readFileSync(path.join(root, 'security', 'verify_migration_110.sql'), 'utf8');
const migrationNames = fs.readdirSync(path.join(root, 'migrations'))
  .filter(name => /^(107|108|109|110|111|112)_.*\.sql$/.test(name));
const ddl = migrationNames.map(name => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n');

describe('Command Center rollout catalog gate', () => {
  it('runs in a bounded read-only transaction without changing application data', () => {
    expect(gate).toContain('BEGIN READ ONLY;');
    expect(gate).toContain("SET LOCAL statement_timeout = '15s'");
    expect(gate).toContain("SET LOCAL lock_timeout = '3s'");
    expect(gate).toContain('ROLLBACK;');
    expect(gate).not.toMatch(/^\s*(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP\s+\w+)/im);
  });

  it('covers every new table and routine in release migrations 107 through 112', () => {
    expect(migrationNames).toHaveLength(6);
    for (const match of ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
      expect(gate).toContain(`'${match[1]}'`);
    }
    for (const match of ddl.matchAll(/CREATE OR REPLACE FUNCTION (\w+)/g)) {
      if (match[1] !== 'scalesafe_schema_version') expect(gate).toContain(`'${match[1]}'`);
    }
  });

  it('refuses partial migrations and checks both table and function access', () => {
    expect(gate).toContain('v_version NOT IN (106, 112)');
    expect(gate).toContain('relrowsecurity AND relforcerowsecurity');
    expect(gate).toContain("has_table_privilege('anon'");
    expect(gate).toContain("has_table_privilege('authenticated'");
    expect(gate).toContain("has_function_privilege('anon'");
    expect(gate).toContain("has_function_privilege('authenticated'");
    expect(gate).toContain('Missing or unexpected overloaded');
  });

  it('requires the tenant-scoped EFW constraint at schema 111', () => {
    expect(gate).toContain("conname = 'efw_events_merchant_stripe_efw_id_key'");
    expect(gate).toContain("UNIQUE (merchant_id, stripe_efw_id)");
  });

  it('keeps prior behavior verifiers rollback-only and compatible with schema 111', () => {
    for (const verifier of [guardianVerifier, dashboardVerifier]) {
      expect(verifier).toContain('\\set ON_ERROR_STOP on');
      expect(verifier).toMatch(/\bBEGIN;/);
      expect(verifier).toMatch(/\bROLLBACK;/);
      expect(verifier).toContain('111');
    }
  });

  it('revokes direct public execution of the health trigger helpers', () => {
    expect(ddl).toContain('REVOKE ALL ON FUNCTION validate_command_center_tenant_binding() FROM PUBLIC, anon, authenticated;');
    expect(ddl).toContain('REVOKE ALL ON FUNCTION prevent_command_center_history_mutation() FROM PUBLIC, anon, authenticated;');
  });
});
