const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('recurring setup definition applies idempotently against actual health-table constraints', async () => {
  const db = new PGlite();
  try {
    const original = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/108_command_center_health_and_incidents.sql'), 'utf8');
    const start = original.indexOf('CREATE TABLE IF NOT EXISTS health_check_definitions (');
    const end = original.indexOf('\n);', start) + 4;
    assert.ok(start > 0 && end > start);
    await db.exec(original.slice(start, end));
    const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/116_recurring_setup_health.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const result = await db.query("SELECT check_key,scope_type,default_severity,suppressible FROM health_check_definitions");
    assert.deepEqual(result.rows, [{ check_key: 'merchant.recurring_setup', scope_type: 'merchant', default_severity: 'urgent', suppressible: false }]);
  } finally { await db.close(); }
});
