import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/107_operator_identity_and_authorization.sql'),
  'utf8',
);

describe('migration 107 operator identity and authorization', () => {
  const tables = [
    'operator_organizations',
    'operator_users',
    'operator_memberships',
    'reseller_merchant_assignments',
    'operator_support_grants',
    'operator_invitations',
    'operator_auth_attempts',
    'operator_sessions',
    'operator_audit_events',
    'operator_rate_limit_buckets',
  ];

  it.each(tables)('creates and locks down %s', (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(sql).toContain(`'${table}'`);
  });

  it('forces service-role-only RLS for every operator table', () => {
    expect(sql).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FOR ALL TO service_role USING (true) WITH CHECK (true)");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*\sTO\s+(?:anon|authenticated)/i);
  });

  it('enforces one active operator organization and one primary reseller', () => {
    expect(sql).toContain('idx_operator_memberships_one_active_org');
    expect(sql).toContain('WHERE status = \'active\'');
    expect(sql).toContain('idx_reseller_assignments_one_active_primary');
    expect(sql).toContain("WHERE status = 'active' AND relationship_type = 'primary'");
  });

  it('contains atomic service-only claims and assignment transfer', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION transfer_primary_reseller_assignment');
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('operator-assignment:'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION complete_operator_auth_attempt');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION claim_operator_invitation');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION consume_operator_rate_limit');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION transfer_primary_reseller_assignment');
  });

  it('keeps audit append-only and advances schema readiness', () => {
    expect(sql).toContain("RAISE EXCEPTION 'operator_audit_events is append-only'");
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON operator_audit_events');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION scalesafe_schema_version\(\)[\s\S]*SELECT 107;/);
  });

  it('requires distinct support-grant requester and approver', () => {
    expect(sql).toContain('approved_by_operator_user_id <> requested_by_operator_user_id');
    expect(sql).toContain("ARRAY['platform_owner']");
    expect(sql).toContain('Support grants are limited to active platform support users');
  });

  it('binds bootstrap and accepted invitations to confirmed Supabase identities', () => {
    expect(sql).toContain('auth_user.email_confirmed_at IS NOT NULL');
    expect(sql).toContain('Bootstrap authentication identity is not email-confirmed');
    expect(sql).toContain('Invitation authentication identity is not email-confirmed');
    expect(sql).not.toContain('auth_user_id UUID UNIQUE REFERENCES auth.users');
  });
});
