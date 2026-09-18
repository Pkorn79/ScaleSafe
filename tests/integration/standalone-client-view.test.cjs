const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Runs real PostgreSQL SQL in memory; never connects to Supabase or a processor.
test('standalone clients: migration compatibility, visibility, dedupe, tenancy and grants', async () => {
  const db = new PGlite();
  const migration = name => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id text, contact_id text,
        email text, first_name text, last_name text, digital_signature text, status text,
        payment_type text, payment_amount numeric(10,2), payments_made integer,
        payments_total integer, next_billing_date date, enrolled_at timestamptz,
        current_milestone integer, offer_id uuid, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE offers_mirror (id uuid, location_id text, offer_name text);
      CREATE TABLE payment_methods (location_id text, contact_id text, is_default boolean);
      CREATE TABLE evidence (location_id text, contact_id text, created_at timestamptz);
      CREATE TABLE payment_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id text, contact_id text,
        enrollment_id uuid, customer_email text, raw_webhook_payload jsonb,
        amount numeric(10,2), event_type text, payment_status text,
        created_at timestamptz DEFAULT now()
      );
      INSERT INTO payment_events (location_id, contact_id, customer_email, raw_webhook_payload, amount, event_type)
      VALUES ('matt', 'shared-id', 'payer@example.com', '{"first_name":"Test","last_name":"Payer"}', 0.05, 'sale');
    `);
    await db.exec(migration('050_client_list_view_status_priority.sql'));
    assert.equal((await db.query('SELECT * FROM client_list_view')).rows.length, 0, 'reproduces old invisible client');
    await db.exec(migration('113_standalone_payment_clients.sql'));
    await db.exec(migration('113_standalone_payment_clients.sql'));
    const rows = async () => (await db.query('SELECT * FROM client_list_view ORDER BY location_id')).rows;
    const [client] = await rows();
    assert.equal(client.contact_id, 'shared-id');
    assert.equal(client.email, 'payer@example.com');
    assert.equal(client.first_name, 'Test');
    assert.equal(client.status, 'active');
    assert.equal(client.enrollment_id, null);
    assert.equal(client.offer_id, null);
    assert.equal(client.offer_name, null);
    assert.equal(client.enrolled_at, null);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM enrollments')).rows[0].n, 0);

    await db.exec(`
      INSERT INTO payment_events (location_id, contact_id, amount, event_type)
        VALUES ('matt', 'shared-id', 0.05, 'sale'), ('matt', '', 1, 'sale'),
          ('matt', 'declined', 1, 'payment_failed');
      INSERT INTO payment_events (location_id, contact_id, amount, event_type, payment_status)
        VALUES ('matt', 'failed-ach', 1, 'sale', 'failed');
      INSERT INTO enrollments (location_id, contact_id, status, first_name)
        VALUES ('ali', 'shared-id', 'cancelled', 'Other tenant');
      INSERT INTO payment_methods VALUES ('ali', 'shared-id', true);
    `);
    assert.equal((await rows()).length, 2, 'duplicate events do not duplicate clients');
    assert.equal((await rows())[1].status, 'active', 'other tenant does not hide standalone client');
    assert.equal((await rows())[1].has_card, false, 'other tenant card never leaks');

    await db.exec(`
      INSERT INTO offers_mirror VALUES ('00000000-0000-0000-0000-000000000001', 'matt', 'Real Program');
      INSERT INTO enrollments (location_id, contact_id, status, offer_id, first_name, enrolled_at)
        VALUES ('matt', 'shared-id', 'enrolled', '00000000-0000-0000-0000-000000000001', 'Test', now()),
          ('matt', 'shared-id', 'cancelled', NULL, 'Test', now() + interval '1 day');
    `);
    assert.equal((await rows()).length, 2, 'later checkout merges with same client');
    assert.equal((await rows())[1].status, 'enrolled', 'preserves active enrollment priority');
    assert.equal((await rows())[1].offer_name, 'Real Program');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_events')).rows[0].n, 5, 'view never rewrites payments');
    const grants = (await db.query(`SELECT
      has_table_privilege('anon', 'client_list_view', 'select') AS anon,
      has_table_privilege('authenticated', 'client_list_view', 'select') AS authenticated,
      has_table_privilege('service_role', 'client_list_view', 'select') AS service`)).rows[0];
    assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
  } finally {
    await db.close();
  }
});
