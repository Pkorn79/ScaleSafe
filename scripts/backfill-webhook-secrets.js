/* eslint-disable no-console */
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('id, location_id, webhook_secret')
    .is('webhook_secret', null);

  if (error) throw error;

  let updated = 0;
  for (const merchant of merchants || []) {
    const secret = crypto.randomBytes(32).toString('hex');
    const { error: updateError } = await supabase
      .from('merchants')
      .update({ webhook_secret: secret })
      .eq('id', merchant.id);

    if (updateError) throw updateError;
    updated += 1;
    console.log(`Backfilled webhook secret for ${merchant.location_id}`);
  }

  console.log(`Done. Backfilled ${updated} merchant webhook secret(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
