// One-shot: backfill enrollments.merchant_id from merchants.location_id.
// Run via: railway run --service ScaleSafe node scripts/backfill-merchant-id.js
const { createClient } = require('@supabase/supabase-js');

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 1. Pre-check
  const { data: nullRows, error: nullErr } = await supabase
    .from('enrollments')
    .select('id, location_id')
    .is('merchant_id', null);
  if (nullErr) { console.error('pre-check failed:', nullErr); process.exit(2); }
  console.log(`pre-check: ${nullRows.length} enrollments rows with merchant_id IS NULL`);

  if (nullRows.length === 0) {
    console.log('nothing to backfill — exiting clean');
    return;
  }

  const locationIds = [...new Set(nullRows.map(r => r.location_id))];
  const { data: merchants, error: mErr } = await supabase
    .from('merchants')
    .select('id, location_id')
    .in('location_id', locationIds);
  if (mErr) { console.error('merchants lookup failed:', mErr); process.exit(2); }
  const byLoc = new Map(merchants.map(m => [m.location_id, m.id]));

  let matched = 0, unmatched = 0;
  for (const r of nullRows) {
    const merchantId = byLoc.get(r.location_id);
    if (!merchantId) { unmatched++; continue; }
    const { error: upErr } = await supabase
      .from('enrollments')
      .update({ merchant_id: merchantId })
      .eq('id', r.id);
    if (upErr) {
      console.error(`row ${r.id} update failed:`, upErr.message);
      continue;
    }
    matched++;
  }

  // 3. Post-check
  const { data: stillNull, error: postErr } = await supabase
    .from('enrollments')
    .select('id, location_id')
    .is('merchant_id', null);
  if (postErr) { console.error('post-check failed:', postErr); process.exit(2); }

  console.log('---');
  console.log(`matched & updated:   ${matched}`);
  console.log(`unmatched (skipped): ${unmatched} — locations without a merchants row`);
  console.log(`remaining null:      ${stillNull.length}`);
  if (stillNull.length > 0) {
    console.log('remaining null rows (location_id breakdown):');
    const counts = {};
    stillNull.forEach(r => { counts[r.location_id] = (counts[r.location_id] || 0) + 1; });
    Object.entries(counts).forEach(([loc, n]) => console.log(`  ${loc}: ${n}`));
  }
})();
