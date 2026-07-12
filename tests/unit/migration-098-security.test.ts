import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '098_durable_money_operations.sql'),
  'utf8',
);

test('migration 098 re-locks every post-046 table that recreated a public policy', () => {
  for (const table of [
    'ghl_activity_events',
    'ghl_appointment_mappings',
    'evidence_appointments',
    'evidence_invoices',
    'ghl_activity_match_rules',
    'ghl_activity_enrollment_links',
    'dual_pricing_controls',
    'offer_checkout_addons',
    'hq_admin_audit_logs',
    'payment_refund_claims',
    'evidence_scheduling_events',
  ]) {
    expect(sql).toContain(`'${table}'`);
  }
  expect(sql).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY");
  expect(sql).toContain("DROP POLICY IF EXISTS %I ON public.%I");
  expect(sql).toContain("CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)");
});

test('migration 098 installs leased workers for money and defense recovery', () => {
  expect(sql).toContain('claim_money_reconciliation_operations');
  expect(sql).toContain('claim_refund_reconciliation_claims');
  expect(sql).toContain('claim_defense_compilations');
  expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  expect(sql).toContain("candidate.status = 'provider_accepted'");
});

test('migration 098 makes query URL refund request fingerprints durable', () => {
  expect(sql).toContain('uq_payment_refund_claims_query_request');
  expect(sql).toContain('ON payment_refund_claims (location_id, request_fingerprint)');
  expect(sql).toContain("WHERE claimed_by = 'query_url' AND request_fingerprint IS NOT NULL");
});
