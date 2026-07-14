import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '099_durable_trigger_delivery_jobs.sql'),
  'utf8',
);

test('migration 099 installs a tenant-idempotent service-only trigger queue', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS trigger_delivery_jobs');
  expect(sql).toContain('UNIQUE (location_id, idempotency_key)');
  expect(sql).toContain('ALTER TABLE trigger_delivery_jobs ENABLE ROW LEVEL SECURITY');
  expect(sql).toContain('TO service_role');
  expect(sql).toContain('REVOKE ALL ON TABLE trigger_delivery_jobs FROM anon, authenticated');
});

test('expired processing leases become unknown instead of being replayed', () => {
  expect(sql).toContain("status = 'unknown'");
  expect(sql).toContain("WHERE status = 'processing'");
  expect(sql).toContain("WHERE candidate.status = 'pending'");
  expect(sql).not.toMatch(/candidate\.status\s*=\s*'processing'/);
});

test('defense regeneration is queued under one locked target version', () => {
  expect(sql).toContain('CREATE OR REPLACE FUNCTION queue_defense_regeneration');
  expect(sql).toContain('FOR UPDATE');
  expect(sql).toContain("'operation', 'regenerate'");
  expect(sql).toContain("'targetVersion', next_version");
  expect(sql).toContain("compilation_category = '__regenerate__'");
});
