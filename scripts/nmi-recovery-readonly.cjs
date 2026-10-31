// Read-only incident verification. Never sends requests to NMI's transaction endpoint.
const fs = require('fs');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { createClient } = require('@supabase/supabase-js');
const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(process.argv[2])) };
const location = process.argv[3];
const configId = process.argv[4];
const transactionIds = process.argv.slice(5);
if (env.SUPABASE_URL !== 'https://zddyagfotdtfbcdursqu.supabase.co' || !location || !configId || !transactionIds.length) {
  throw new Error('Explicit production project, location, config and transaction IDs required');
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const array = value => value ? (Array.isArray(value) ? value : [value]) : [];
let stage = 'config lookup';
async function main() {
  const { data: config, error } = await db.from('processor_configs')
    .select('id,location_id,processor_type,is_active,nmi_security_key_encrypted,nmi_processor_id')
    .eq('id', configId).eq('location_id', location).eq('processor_type', 'nmi').single();
  if (error || !config?.is_active) throw new Error('Exact active NMI config unavailable');
  stage = 'credential decryption';
  const k = env.PROCESSOR_ENCRYPTION_KEY || '';
  const key = Buffer.from(k, /^[a-f0-9]{64}$/i.test(k) ? 'hex' : 'base64');
  const encrypted = Buffer.from(config.nmi_security_key_encrypted, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
  decipher.setAuthTag(encrypted.subarray(12, 28));
  const securityKey = decipher.update(encrypted.subarray(28), undefined, 'utf8') + decipher.final('utf8');
  async function query(fields) {
    stage = `read-only NMI ${fields.report_type || 'transaction'} query`;
    const body = new URLSearchParams({ security_key: securityKey, ...fields });
    if (config.nmi_processor_id) body.set('processor_id', config.nmi_processor_id);
    const response = await fetch('https://secure.nmi.com/api/query.php', {
      method: 'POST', body, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`NMI query HTTP ${response.status}`);
    const parsed = parser.parse(await response.text());
    const result = parsed.nm_response;
    if (result === '' && Object.prototype.hasOwnProperty.call(parsed, 'nm_response')) return {};
    if (!result || result.error_response || result.error) {
      const detail = String(result?.error_response || result?.error || 'Unexpected report shape')
        .split(securityKey).join('[redacted]').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 240);
      console.log(JSON.stringify({ type: 'query_rejection', report: fields.report_type || 'transaction', detail }));
      throw new Error('NMI query did not return a valid report');
    }
    return result;
  }
  const result = await query({ transaction_id: transactionIds.join(',') });
  for (const tx of array(result.transaction)) {
    console.log(JSON.stringify({ type: 'transaction', id: tx.transaction_id, condition: tx.condition,
      name: `${tx.first_name || ''} ${tx.last_name || ''}`.trim(), order: tx.order_id,
      subscription: tx.subscription_id || null,
      actions: array(tx.action).map(a => ({ type: a.action_type, amount: a.amount, success: a.success, date: a.date })) }));
  }
  // Inspect all subscription headers, bounded and paginated, not just active subscriptions.
  for (let page = 0; page < 100; page++) {
    const report = await query({ report_type: 'recurring', result_limit: '100', page_number: String(page) });
    console.log(JSON.stringify({ type: 'report_shape', keys: Object.keys(report), page }));
    const rows = array(report.subscription);
    for (const row of rows) console.log(JSON.stringify({ type: 'subscription', id: row.subscription_id,
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim(), order: row.order_id,
      status: row.status, amount: row.plan_amount, next: row.next_charge_date,
      remaining: row.remaining_payments, day: row.day_of_month }));
    if (rows.length < 100) { console.log(JSON.stringify({ subscriptionScanComplete: true, pages: page + 1 })); return; }
  }
  throw new Error('Subscription scan reached safety cap; absence is not proven');
}
main().catch(() => { console.error(`Read-only verification failed at ${stage}; no changes made. Credentials and raw provider response withheld.`); process.exitCode = 1; });
