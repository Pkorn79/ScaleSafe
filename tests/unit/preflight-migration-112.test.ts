import fs from 'fs';
import path from 'path';

const preflightPath = path.join(
  process.cwd(),
  'supabase',
  'security',
  'preflight_migration_112.sql',
);

describe('migration 112 production preflight', () => {
  const sql = fs.readFileSync(preflightPath, 'utf8');
  const executableSql = sql.replace(/^\s*--.*$/gm, '');

  it('is a schema 111 read-only aggregate report', () => {
    expect(sql).toMatch(/scalesafe_schema_version\(\) <> 111/);
    expect(executableSql).not.toMatch(
      /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i,
    );
    expect(sql).toContain("'contains_customer_data', false");
  });

  it('reports every rollout ownership and retry-context risk', () => {
    expect(sql).toContain("'active_recurring_enrollments'");
    expect(sql).toContain("'missing_processor_type'");
    expect(sql).toMatch(/e\.processor_type IS NULL AND e\.processor_subscription_id IS NOT NULL/);
    expect(sql).toMatch(/e\.status NOT IN \('cancelled', 'completed'\)/);
    expect(sql).toContain("'stored_payment_methods'");
    expect(sql).toContain("'configuration_unmatched'");
    expect(sql).toContain("'configuration_ambiguous'");
    expect(sql).toContain("'stripe_missing_invoice_id'");
    expect(sql).toContain("'stripe_missing_account_id'");
    expect(sql).toContain("'nmi_missing_processor_id'");
    expect(sql).toContain("'ambiguous_groups'");
  });
});
