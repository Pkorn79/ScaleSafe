const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Synthetic pre-migration schema only. No live connection and no replay of 107-112.
test('114: identity proof, credential bindings, literal search, pagination and grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE merchants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id text UNIQUE, business_name text,
        company_id text, status text, ghl_access_token text, ghl_access_token_encrypted text,
        ghl_refresh_token text, ghl_refresh_token_encrypted text, ghl_scopes text, config jsonb,
        installed_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        snapshot_status text, marketplace_plan_key text, marketplace_billing_status text,
        test_access_approved_at timestamptz
      );
      ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON merchants FROM PUBLIC, anon, authenticated;
      GRANT ALL ON merchants TO service_role;
      CREATE TABLE processor_configs (location_id text, merchant_id uuid, processor_type text, is_active boolean);
      CREATE TABLE whop_configs (location_id text, merchant_id uuid, status text);
      CREATE TABLE reseller_merchant_assignments (location_id text, reseller_organization_id uuid, status text);
      CREATE TABLE operator_organizations (id uuid, name text, organization_type text);
      CREATE TABLE merchant_health_rollups (
        merchant_id uuid, location_id text, merchant_name text, overall_state text, highest_incident_severity text,
        installation_state text, processor_state text, workflow_state text, evidence_state text, defense_state text,
        billing_state text, open_critical_count integer, open_urgent_count integer, open_warning_count integer,
        needs_attention_count integer, last_observed_at timestamptz, last_reconciled_at timestamptz
      );
      INSERT INTO merchants (location_id, business_name, status, company_id, ghl_access_token, ghl_refresh_token,
        ghl_scopes, config, test_access_approved_at, marketplace_plan_key, marketplace_billing_status)
      SELECT name, 'Shared editable business', 'active', 'agency-a', 'fixture-access', 'fixture-refresh',
        'contacts.readonly locations.readonly', jsonb_build_object('ghl_token_scope', 'location',
        'ghl_token_company_id', 'agency-a', 'ghl_token_location_id', name), '2026-01-01'::timestamptz, 'test', 'unknown'
      FROM unnest(ARRAY['ali', 'matt', 'no-auth']) AS name;
      UPDATE merchants SET ghl_access_token = NULL WHERE location_id = 'no-auth';
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/114_enrollments_location_identity.sql'), 'utf8');
    await db.exec(migration);
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    const page = async (query, limit = 50, offset = 0) => (await q(
      'SELECT list_operator_merchants_page($1, $2, $3) AS page', [limit, offset, query]))[0].page;
    let rows = await q('SELECT location_id, business_name, ghl_location_name, ghl_identity_authorized, test_access_approved_at FROM merchants ORDER BY location_id');
    assert.equal(rows[0].ghl_location_name, null, 'never backfill from business_name');
    assert.equal(rows[0].business_name, 'Shared editable business');
    assert.equal(rows[0].ghl_identity_authorized, true);
    assert.equal(rows[2].ghl_identity_authorized, false);
    assert.ok(rows.every(row => row.test_access_approved_at), 'approvals preserved');
    assert.equal((await page('shared editable')).total, 3, 'business remains separately searchable');
    assert.equal((await page('ali')).items[0].merchant_name, 'ali', 'unverified business is never authoritative');
    await assert.rejects(db.exec("UPDATE merchants SET ghl_location_name = 'No proof' WHERE location_id = 'ali'"), /merchants_location_identity_proof/);
    await db.exec(`UPDATE merchants SET ghl_location_name = CASE location_id WHEN 'ali' THEN 'Kingdom - Ali' ELSE 'Kingdom - Matt' END,
      ghl_location_name_source = 'ghl_location_api', ghl_location_name_verified_at = now(), ghl_location_name_checked_at = now()
      WHERE location_id IN ('ali', 'matt');`);
    assert.equal((await page('kingdom', 1, 0)).total, 2, 'count evaluated before pagination');
    assert.equal((await page('kingdom', 1, 0)).items[0].location_id, 'ali');
    assert.equal((await page('kingdom', 1, 1)).items[0].location_id, 'matt');
    assert.equal((await page('kingdom - matt')).items[0].merchant_name, 'Kingdom - Matt');
    assert.equal((await page('%')).total, 0, 'percent is literal, not wildcard');
    assert.equal((await page('_')).total, 0, 'underscore is literal');
    assert.equal((await page("' OR true --")).total, 0);
    await db.exec("UPDATE merchants SET ghl_location_name = 'Renamed subaccount' WHERE location_id = 'matt'");
    assert.equal((await page('kingdom - matt')).total, 0);
    assert.equal((await page('renamed')).items[0].location_id, 'matt');
    assert.equal((await page('MATT')).items[0].business_name, 'Shared editable business');
    await db.exec(`UPDATE merchants SET config = '{"ghl_token_scope":"location","ghl_token_location_id":"ali"}' WHERE location_id = 'matt'`);
    assert.equal((await page('matt')).items[0].ghl_identity_authorized, false, 'wrong tenant credentials fail closed');
    await db.exec(`UPDATE merchants SET config = '{"ghl_token_scope":"company","ghl_token_company_id":"agency-a"}' WHERE location_id = 'matt'`);
    assert.equal((await page('matt')).items[0].ghl_identity_authorized, true);
    await db.exec("UPDATE merchants SET ghl_scopes = 'contacts.readonly' WHERE location_id = 'matt'");
    assert.equal((await page('matt')).items[0].ghl_identity_authorized, false);
    const privileges = (await q(`SELECT
      has_table_privilege('anon','merchants','SELECT') AS anon_table,
      has_table_privilege('service_role','merchants','SELECT') AS service_table,
      has_function_privilege('anon','list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text)','EXECUTE') AS anon_rpc,
      has_function_privilege('authenticated','list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text)','EXECUTE') AS auth_rpc,
      has_function_privilege('service_role','list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text)','EXECUTE') AS service_rpc
    `))[0];
    assert.deepEqual(privileges, { anon_table: false, service_table: true, anon_rpc: false, auth_rpc: false, service_rpc: true });
    const serialized = JSON.stringify(await page(null));
    assert.ok(!serialized.includes('fixture-access') && !serialized.includes('fixture-refresh'));
    await assert.rejects(page(null, 201), /Invalid operator merchant page request/);
    // A second application must stop without partially changing existing proof.
    const beforeRepeat = await page(null);
    await assert.rejects(db.exec(migration), /already exists/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await page(null), beforeRepeat);
  } finally { await db.close(); }
});
