const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Accept connection string OR build from components
let connString = process.argv[2];
if (!connString) {
  const passFile = path.join(__dirname, '.dbpass');
  let pass = process.env.DB_PASSWORD;
  if (!pass && fs.existsSync(passFile)) {
    pass = fs.readFileSync(passFile, 'utf-8').trim();
  }
  const host = process.env.DB_HOST || 'aws-1-us-east-1.pooler.supabase.com';
  const port = process.env.DB_PORT || '6543';
  const user = process.env.DB_USER || 'postgres.zddyagfotdtfbcdursqu';
  const db = process.env.DB_NAME || 'postgres';
  if (!pass) {
    console.error('Usage: DB_PASSWORD=xxx node scripts/migrate.js');
    console.error('   or: put password in scripts/.dbpass');
    process.exit(1);
  }
  connString = `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}
console.log('Connecting with user:', connString.split(':')[1].replace('//', '').split(':')[0]);

const MIGRATION_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const FILES = [
  '001_core_tables.sql',
  '002_defense_tables.sql',
  '003_evidence_tables.sql',
  '004_evidence_timeline_view.sql',
  '005_storage_bucket.sql',
  '006_seed_reason_codes.sql',
];

async function run() {
  const client = new Client({ connectionString: connString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase.');

  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Existing tables (' + rows.length + '):', rows.map(r => r.table_name).join(', ') || 'none');
  console.log('');

  for (const file of FILES) {
    const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), 'utf-8');
    console.log('Running ' + file + '...');
    try {
      await client.query(sql);
      console.log('  OK');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  Already exists, skipping');
      } else {
        console.error('  FAILED:', err.message);
      }
    }
  }

  console.log('');
  const { rows: final } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Final tables (' + final.length + '):');
  final.forEach(r => console.log('  - ' + r.table_name));

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
