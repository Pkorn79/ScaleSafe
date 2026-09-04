import fs from 'fs';
import path from 'path';

const migrationSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '111_stripe_efw_integrity.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

const serviceSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'services', 'stripe-efw.service.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('migration 111 Stripe EFW integrity contract', () => {
  it('requires schema 110 and advances the schema version to 111', () => {
    expect(migrationSql).toMatch(/scalesafe_schema_version\(\) <> 110/);
    expect(migrationSql).toMatch(/SELECT 111;/);
  });

  it('adds the tenant-scoped uniqueness boundary used by EFW ingestion', () => {
    expect(migrationSql).toMatch(
      /UNIQUE\s*\(\s*merchant_id\s*,\s*stripe_efw_id\s*\)/,
    );
    expect(serviceSource).toContain("{ onConflict: 'merchant_id,stripe_efw_id' }");
  });

  it('guards the constraint and exposes persistence failures', () => {
    expect(migrationSql).toContain("conname = 'efw_events_merchant_stripe_efw_id_key'");
    expect(serviceSource).toMatch(/if \(upsertError\) \{[\s\S]*throw upsertError;/);
  });
});
