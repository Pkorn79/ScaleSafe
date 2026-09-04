import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '110_command_center_operator_views.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('migration 110 Command Center operator views', () => {
  it('requires the fully integrated Guardian schema and advances the version', () => {
    expect(sql).toMatch(/scalesafe_schema_version\(\) <> 109/);
    expect(sql).toMatch(/SELECT 110;/);
  });

  it('provides bounded read models for merchants, detail, and resellers', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION list_operator_merchants_page');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION get_operator_platform_summary');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION get_operator_merchant_detail');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION list_operator_resellers_page');
    expect(sql).toContain('p_limit > 200');
    expect(sql).toContain('p_offset > 100000');
  });

  it('includes merchants that have not received their first health rollup', () => {
    expect(sql).toMatch(/FROM merchants merchant\n\s+LEFT JOIN merchant_health_rollups/);
    expect(sql).toContain("COALESCE(rollup.overall_state, 'unknown')");
  });

  it('projects processor and connector state without credential material', () => {
    expect(sql).toContain("'processors'");
    expect(sql).toContain("'connectors'");
    expect(sql).not.toMatch(/access_token|refresh_token|security_key|api_key|webhook_secret|last_error_message/i);
  });

  it('joins tenant-owned processor, connector, and rollup rows by merchant and location', () => {
    expect(sql).toMatch(/processors\.location_id = merchant\.location_id\s+AND processors\.merchant_id = merchant\.id/);
    expect(sql).toMatch(/config\.location_id = merchant\.location_id\s+AND config\.merchant_id = merchant\.id/g);
    expect(sql).toMatch(/connection\.location_id = merchant\.location_id\s+AND connection\.merchant_id = merchant\.id/);
    expect(sql).toMatch(/rollup\.location_id = merchant\.location_id\s+AND rollup\.merchant_id = merchant\.id/);
  });

  it('uses exact aggregate totals and preaggregated reseller counts', () => {
    expect(sql).toContain('count(*) AS merchant_count');
    expect(sql).toContain('count(*) AS health_checks_total');
    expect(sql).toContain('WITH staff_counts AS MATERIALIZED');
    expect(sql).toContain('merchant_counts AS MATERIALIZED');
    expect(sql).not.toMatch(/JOIN operator_memberships membership[\s\S]{0,400}JOIN reseller_merchant_assignments assignment/);
  });

  it('validates advanced filters and escapes wildcard search input', () => {
    expect(sql).toContain("p_reseller <> 'unassigned'");
    expect(sql).toContain("p_incident_severity NOT IN");
    expect(sql).toContain("p_component_state NOT IN");
    expect(sql).toContain('((p_component IS NULL) <> (p_component_state IS NULL))');
    expect(sql).toContain("replace(replace(replace(v_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_')");
    expect(sql).toContain("LIKE v_query_pattern ESCAPE '\\'");
  });

  it('exposes every function only to the service role', () => {
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(5);
    expect(sql.match(/GRANT EXECUTE ON FUNCTION/g)).toHaveLength(5);
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });
});
