import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { merchantRepository, MerchantRecord } from '../repositories/merchant.repository';
import { config } from '../config';
import { debugLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { evidenceConnectionService } from '../services/evidence-connection.service';

const router = Router();

function tokenConfigured(): boolean {
  return !!config.hqAdminToken;
}

function bearerToken(req: Request): string {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function requireHqToken(req: Request, res: Response, next: NextFunction): void {
  if (!tokenConfigured()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const supplied = bearerToken(req) || String(req.headers['x-scalesafe-hq-token'] || '');
  if (!timingSafeStringEqual(supplied, config.hqAdminToken)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function adminLabel(req: Request): string {
  return String(req.headers['x-scalesafe-admin-label'] || 'internal_admin').slice(0, 100);
}

function clientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

async function audit(req: Request, action: string, details: {
  targetLocationId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
} = {}): Promise<void> {
  try {
    await getSupabase().from('hq_admin_audit_logs').insert({
      action,
      target_location_id: details.targetLocationId || null,
      target_type: details.targetType || null,
      target_id: details.targetId || null,
      admin_label: adminLabel(req),
      ip_address: clientIp(req),
      user_agent: req.headers['user-agent'] || '',
      metadata: details.metadata || {},
    });
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err), action }, 'HQ audit log write failed');
  }
}

async function countRows(table: string, build: (query: any) => any): Promise<number> {
  try {
    const query = build(getSupabase().from(table).select('id', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err), table }, 'HQ count query failed');
    return 0;
  }
}

async function processorSummary(merchant: MerchantRecord) {
  const supabase = getSupabase();
  const summary = {
    defaultProcessor: merchant.default_processor || '',
    stripeConnected: !!merchant.stripe_connected,
    nmiConfigured: false,
    stripeConfigured: false,
    whopConfigured: false,
    fanbasisConfigured: false,
  };
  try {
    const [{ data: processors }, { data: whop }, { data: fanbasis }] = await Promise.all([
      supabase.from('processor_configs').select('processor_type, status').eq('merchant_id', merchant.id),
      supabase.from('whop_configs').select('status').eq('merchant_id', merchant.id).maybeSingle(),
      supabase.from('fanbasis_configs').select('status').eq('merchant_id', merchant.id).maybeSingle(),
    ]);
    const processorRows = processors || [];
    summary.nmiConfigured = processorRows.some((row: any) => row.processor_type === 'nmi' && row.status !== 'disconnected');
    summary.stripeConfigured = processorRows.some((row: any) => row.processor_type === 'stripe' && row.status !== 'disconnected') || summary.stripeConnected;
    summary.whopConfigured = !!whop;
    summary.fanbasisConfigured = !!fanbasis;
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err), locationId: merchant.location_id }, 'HQ processor summary failed');
  }
  return summary;
}

async function merchantOverview(merchant: MerchantRecord) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [processors, activeEnrollments, billingIssues, recentPayments, failedTriggerDeliveries, triggerSubscriptions] = await Promise.all([
    processorSummary(merchant),
    countRows('enrollments', (q) => q.eq('location_id', merchant.location_id).in('status', ['enrolled', 'active', 'paid_pending_enrollment'])),
    countRows('enrollments', (q) => q.eq('location_id', merchant.location_id).neq('billing_setup_status', 'ok').not('billing_setup_status', 'is', null)),
    countRows('payment_events', (q) => q.eq('location_id', merchant.location_id).gte('created_at', since)),
    countRows('trigger_delivery_logs', (q) => q.eq('location_id', merchant.location_id).in('status', ['failed', 'no_subscription']).gte('created_at', recent)),
    countRows('trigger_subscriptions', (q) => q.eq('location_id', merchant.location_id).eq('is_active', true)),
  ]);
  return {
    id: merchant.id,
    locationId: merchant.location_id,
    companyId: merchant.company_id || '',
    businessName: merchant.business_name || '(unnamed merchant)',
    supportEmail: merchant.support_email || '',
    status: merchant.status,
    snapshotStatus: merchant.snapshot_status,
    installedAt: merchant.installed_at,
    updatedAt: merchant.updated_at,
    processors,
    counts: {
      activeEnrollments,
      billingIssues,
      recentPayments,
      failedTriggerDeliveries,
      triggerSubscriptions,
    },
  };
}

router.get('/internal/hq', (_req: Request, res: Response) => {
  if (!tokenConfigured()) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  res.send(hqHtml());
});

router.get('/internal/hq/api/merchants', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const merchants = await merchantRepository.listActive();
    await audit(req, 'hq.list_merchants', { metadata: { count: merchants.length } });
    const rows = await Promise.all(merchants.map((merchant) => merchantOverview(merchant)));
    res.json({ merchants: rows });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, 'HQ merchant list failed');
    res.status(500).json({ error: err?.message || 'HQ merchant list failed' });
  }
});

router.get('/internal/hq/api/merchants/:locationId', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const merchant = await merchantRepository.getByLocationId(locationId);
    await audit(req, 'hq.view_merchant', { targetLocationId: locationId, targetType: 'merchant', targetId: merchant.id });
    const supabase = getSupabase();
    const [overview, payments, triggers, enrollments] = await Promise.all([
      merchantOverview(merchant),
      supabase
        .from('payment_events')
        .select('id, event_type, processor, amount, payment_status, processor_transaction_id, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('trigger_delivery_logs')
        .select('trigger_key, status, http_status, error_message, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('enrollments')
        .select('id, offer_name, status, billing_setup_status, processor_type, processor_subscription_id, whop_membership_id, next_billing_date, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    res.json({
      merchant: overview,
      recentPayments: payments.data || [],
      recentTriggers: triggers.data || [],
      recentEnrollments: enrollments.data || [],
      warnings: [payments.error, triggers.error, enrollments.error].filter(Boolean).map((err: any) => err.message),
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err), locationId: req.params.locationId }, 'HQ merchant detail failed');
    res.status(500).json({ error: err?.message || 'HQ merchant detail failed' });
  }
});

router.get('/internal/hq/api/evidence-connections', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connections = await evidenceConnectorRepository.getHqSummary();
    const rows = await Promise.all(connections.map(async (connection: any) => {
      const { data: events, error } = await getSupabase()
        .from('external_evidence_events')
        .select('status, is_test, received_at')
        .eq('connection_id', connection.id)
        .gte('received_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const event of events || []) counts[event.status] = (counts[event.status] || 0) + 1;
      return { ...connection, counts };
    }));
    await audit(req, 'hq.list_evidence_connections', { metadata: { count: rows.length } });
    res.json({ connections: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'HQ evidence connection list failed');
    res.status(500).json({ error: 'HQ evidence connection list failed' });
  }
});

async function hqConnection(id: string): Promise<any> {
  const { data, error } = await getSupabase()
    .from('evidence_connections')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) throw error || new Error('Connection not found');
  return data;
}

router.post('/internal/hq/api/evidence-connections', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const locationId = String(req.body?.locationId || '').trim();
    if (!locationId) throw new Error('locationId is required');
    await merchantRepository.getByLocationId(locationId);
    const result = await evidenceConnectionService.create(locationId, adminLabel(req), req.body || {});
    await audit(req, 'hq.evidence_connection_create', {
      targetLocationId: locationId,
      targetType: 'evidence_connection',
      targetId: result.connection.id,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection creation failed' });
  }
});

router.get('/internal/hq/api/evidence-connections/:id/setup', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const [mappings, subjects, offers, credentials, events] = await Promise.all([
      evidenceConnectorRepository.listResourceMappings(connection.location_id, connection.id),
      evidenceConnectorRepository.listSubjects(connection.location_id, 200),
      getSupabase().from('offers_mirror').select('id, offer_name, tracking_id, checkout_mode, active').eq('location_id', connection.location_id).order('offer_name'),
      evidenceConnectorRepository.listActiveCredentials(connection.id),
      evidenceConnectorRepository.listEvents(connection.location_id, connection.id, 50),
    ]);
    await audit(req, 'hq.evidence_connection_view_setup', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
    });
    res.json({
      connection,
      mappings,
      subjects: subjects.map((subject: any) => ({
        enrollmentId: subject.enrollment_id,
        offerId: subject.offer_id,
        offerName: subject.offer?.offer_name || subject.enrollment?.offer_name || '',
        email: subject.normalized_email || '',
        status: subject.enrollment?.status || '',
      })),
      offers: offers.data || [],
      credentials: credentials.map((credential) => ({
        id: credential.id,
        type: credential.credential_type,
        prefix: credential.key_prefix,
        status: credential.status,
        expiresAt: credential.expires_at,
      })),
      recentEvents: events.map((event: any) => ({
        id: event.id,
        sourceEventId: event.source_event_id,
        eventType: event.event_type,
        status: event.status,
        isTest: event.is_test,
        enrollmentId: event.enrollment_id,
        offerId: event.offer_id,
        offerName: event.offer?.offer_name || event.enrollment?.offer_name || '',
        client: event.enrollment?.email || '',
        matchMethod: event.resolution_method,
        errorCode: event.error_code,
        receivedAt: event.received_at,
      })),
      warnings: [offers.error].filter(Boolean).map((error: any) => error.message),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection setup could not be loaded' });
  }
});

router.put('/internal/hq/api/evidence-connections/:id', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const updated = await evidenceConnectionService.update(connection.location_id, connection.id, adminLabel(req), req.body || {});
    await audit(req, 'hq.evidence_connection_update', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection update failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/preview', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const result = await evidenceConnectionService.preview(connection.location_id, connection.id, req.body?.payload || {});
    await audit(req, 'hq.evidence_connection_preview', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
      metadata: { valid: result.valid },
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection preview failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/test', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const result = await evidenceConnectionService.sendTest(
      connection.location_id,
      connection.id,
      String(req.body?.enrollmentId || ''),
      adminLabel(req),
      String(req.body?.eventType || 'service.login'),
    );
    await audit(req, 'hq.evidence_connection_test', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
      metadata: result.target,
    });
    res.status(202).json({
      eventId: result.event.id,
      status: result.event.status,
      createsEvidence: false,
      target: result.target,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection test failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/activate', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const updated = await evidenceConnectionService.activate(connection.location_id, connection.id, adminLabel(req));
    await audit(req, 'hq.evidence_connection_activate', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection activation failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/replay', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const result = await evidenceConnectionService.replay(connection.location_id, connection.id, adminLabel(req));
    await audit(req, 'hq.evidence_connection_replay', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
      metadata: result,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection replay failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/suggest-mappings', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const connection = await hqConnection(req.params.id);
    const suggestions = await evidenceConnectionService.suggestMappings(
      connection.location_id,
      connection.id,
      Array.isArray(req.body?.resources) ? req.body.resources : [],
    );
    await audit(req, 'hq.evidence_connection_suggest_mappings', {
      targetLocationId: connection.location_id,
      targetType: 'evidence_connection',
      targetId: connection.id,
      metadata: { count: suggestions.length },
    });
    res.json({ suggestions });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Mapping suggestions failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/status', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const { data: connection, error } = await getSupabase().from('evidence_connections').select('id, location_id').eq('id', req.params.id).single();
    if (error || !connection) throw error || new Error('Connection not found');
    const updated = await evidenceConnectionService.setStatus(connection.location_id, connection.id, adminLabel(req), req.body?.enabled === true);
    await audit(req, 'hq.evidence_connection_status', { targetLocationId: connection.location_id, targetType: 'evidence_connection', targetId: connection.id, metadata: { enabled: req.body?.enabled === true } });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection status update failed' });
  }
});

router.post('/internal/hq/api/evidence-connections/:id/rotate', debugLimiter, requireHqToken, async (req: Request, res: Response) => {
  try {
    const { data: connection, error } = await getSupabase().from('evidence_connections').select('id, location_id').eq('id', req.params.id).single();
    if (error || !connection) throw error || new Error('Connection not found');
    const result = await evidenceConnectionService.rotate(connection.location_id, connection.id, adminLabel(req), Number(req.body?.graceHours || 0));
    await audit(req, 'hq.evidence_connection_rotate', { targetLocationId: connection.location_id, targetType: 'evidence_connection', targetId: connection.id });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Connection rotation failed' });
  }
});

export function hqHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ScaleSafe HQ</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:1180px;margin:0 auto;padding:28px}
h1{font-size:26px;margin:0 0 4px}.muted{color:#64748b;font-size:14px}.bar{display:flex;gap:8px;margin:18px 0}
input,select,textarea{border:1px solid #cbd5e1;border-radius:6px;padding:10px;font-size:14px}input{min-width:220px}textarea{width:100%;min-height:110px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}button{border:0;border-radius:6px;background:#0f766e;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer}.secondary{background:#fff;color:#334155;border:1px solid #cbd5e1}.danger{background:#b91c1c}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px}.card h2{font-size:16px;margin:0 0 6px}
.pill{display:inline-block;border-radius:999px;padding:2px 8px;background:#ecfeff;color:#155e75;font-size:12px;margin:2px}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;background:#f8fafc}
a{color:#0f766e;cursor:pointer;text-decoration:none;font-weight:700}.error{color:#991b1b;background:#fee2e2;border:1px solid #fecaca;padding:10px;border-radius:6px;margin:10px 0;display:none}
pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;max-height:420px;overflow:auto}.panel{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:12px 0}.fields,.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mapping{display:grid;grid-template-columns:1fr 1fr 1.2fr 1.2fr 40px;gap:7px;margin:7px 0}.notice{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:10px;border-radius:6px;margin:10px 0;word-break:break-all;display:none}@media(max-width:800px){.mapping{grid-template-columns:1fr}.fields{align-items:stretch;flex-direction:column}.fields>*{width:100%}}
</style>
</head>
<body><main>
<h1>ScaleSafe HQ</h1><div class="muted">Internal operator console. Connector setup changes are audit logged.</div>
<div class="bar"><input id="token" type="password" placeholder="HQ admin token" /><button id="load">Load installs</button></div>
<div id="error" class="error"></div><div id="notice" class="notice"></div><div id="summary" class="grid"></div><div id="table"></div><div id="newConnector"></div><div id="connectors"></div><div id="connectorSetup"></div><div id="detail"></div>
</main>
<script>
const $=id=>document.getElementById(id); const err=$('error');
let merchantRows=[];let activeSetup=null;
function token(){return $('token').value || sessionStorage.getItem('ss_hq_token') || ''}
function headers(){return {Authorization:'Bearer '+token(),'Content-Type':'application/json','x-scalesafe-admin-label':'hq_console'}}
function showError(msg){err.textContent=msg;err.style.display='block'} function clearError(){err.style.display='none'}
function fmtDate(v){return v?new Date(v).toLocaleString():''}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{...headers(),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||'Request failed');return d}
function request(path,method,body){return api(path,{method,body:JSON.stringify(body||{})})}
function showNotice(message){const node=$('notice');node.textContent=message;node.style.display='block'}
function pills(p){return ['stripeConfigured','nmiConfigured','whopConfigured','fanbasisConfigured'].map(k=>'<span class="pill '+(p[k]?'':'warn')+'">'+k.replace('Configured','')+': '+(p[k]?'yes':'no')+'</span>').join(' ')}
async function load(){clearError();sessionStorage.setItem('ss_hq_token',$('token').value);try{const [d,c]=await Promise.all([api('/internal/hq/api/merchants'),api('/internal/hq/api/evidence-connections')]);merchantRows=d.merchants||[];render(merchantRows);renderNewConnector();renderConnectors(c.connections||[])}catch(e){showError(e.message)}}
function render(rows){$('summary').innerHTML='<div class="card"><h2>'+rows.length+'</h2><div class="muted">Active merchants</div></div><div class="card"><h2>'+rows.reduce((s,r)=>s+r.counts.failedTriggerDeliveries,0)+'</h2><div class="muted">Recent trigger issues</div></div><div class="card"><h2>'+rows.reduce((s,r)=>s+r.counts.billingIssues,0)+'</h2><div class="muted">Billing setup issues</div></div>';
$('table').innerHTML='<table><thead><tr><th>Merchant</th><th>Status</th><th>Processors</th><th>Counts</th><th>Updated</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><a onclick="detail(\\''+r.locationId+'\\')">'+escapeHtml(r.businessName)+'</a><div class="muted">'+escapeHtml(r.locationId)+'</div></td><td><span class="pill">'+r.status+'</span> <span class="pill '+(r.snapshotStatus==='installed'?'':'warn')+'">'+r.snapshotStatus+'</span></td><td>'+pills(r.processors)+'</td><td>'+r.counts.activeEnrollments+' enrollments<br>'+r.counts.recentPayments+' payments/30d<br>'+r.counts.failedTriggerDeliveries+' trigger issues/7d</td><td>'+fmtDate(r.updatedAt)+'</td></tr>').join('')+'</tbody></table>'}
function renderConnectors(rows){$('connectors').innerHTML='<h2>Evidence connections</h2><table><thead><tr><th>Connection</th><th>Location</th><th>Health</th><th>Events / 7d</th><th>Last event</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escapeHtml(r.name)+'<div class="muted">'+escapeHtml(r.source_label)+' · '+escapeHtml(r.connection_type)+'</div></td><td>'+escapeHtml(r.location_id)+'</td><td><span class="pill '+(r.health_status==='error'?'bad':r.health_status==='warning'?'warn':'')+'">'+escapeHtml(r.health_status)+'</span></td><td>'+escapeHtml(JSON.stringify(r.counts||{}))+'</td><td>'+fmtDate(r.last_event_at)+'</td></tr>').join('')+'</tbody></table>'}
function renderNewConnector(){const options=merchantRows.map(r=>'<option value="'+attr(r.locationId)+'">'+escapeHtml(r.businessName)+' · '+escapeHtml(r.locationId)+'</option>').join('');$('newConnector').innerHTML='<h2>New evidence connection</h2><div class="panel fields"><select id="newLocation"><option value="">Select sub-account</option>'+options+'</select><input id="newName" placeholder="Connection name"/><input id="newSource" placeholder="Source name"/><select id="newType"><option value="canonical_api">Canonical API</option><option value="raw_webhook">Raw webhook</option></select><select id="newAuth"><option value="api_key">API key</option><option value="hmac">HMAC</option><option value="url_secret">Secret URL</option></select><button onclick="createConnector()">Create draft</button></div>'}
function renderConnectors(rows){$('connectors').innerHTML='<h2>Evidence connections</h2><table><thead><tr><th>Connection</th><th>Location</th><th>Setup</th><th>Health</th><th>Events / 7d</th><th>Last event</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><a onclick="openSetup(\\''+r.id+'\\')">'+escapeHtml(r.name)+'</a><div class="muted">'+escapeHtml(r.source_label)+' · '+escapeHtml(r.connection_type)+'</div></td><td>'+escapeHtml(r.location_id)+'</td><td><span class="pill '+(r.setup_status==='active'?'':r.setup_status==='needs_attention'?'bad':'warn')+'">'+escapeHtml(r.setup_status||'draft')+'</span></td><td><span class="pill '+(r.health_status==='error'?'bad':r.health_status==='warning'?'warn':'')+'">'+escapeHtml(r.health_status)+'</span></td><td>'+escapeHtml(JSON.stringify(r.counts||{}))+'</td><td>'+fmtDate(r.last_event_at)+'</td></tr>').join('')+'</tbody></table>'}
async function createConnector(){clearError();try{const type=$('newType').value;const result=await request('/internal/hq/api/evidence-connections','POST',{locationId:$('newLocation').value,name:$('newName').value,sourceLabel:$('newSource').value||$('newName').value,connectionType:type,credentialType:type==='canonical_api'?'api_key':$('newAuth').value,identityStrategy:'enrollment_context',mappingConfig:type==='raw_webhook'?{eventIdPath:'id',eventTypePath:'event',occurredAtPath:'occurred_at',externalContactIdPath:'contact.id',externalEnrollmentIdPath:'enrollment.id',resourceTypePath:'resource.type',resourceIdPath:'resource.id'}:undefined});showNotice('Credential shown once: '+result.credential.secret+' | Endpoint: '+(type==='canonical_api'?result.endpoints.canonicalUrl:result.endpoints.webhookUrl));await load();await openSetup(result.connection.id)}catch(e){showError(e.message)}}
function mappingRow(row){row=row||{};return '<div class="mapping"><input data-k="type" placeholder="Resource type" value="'+attr(row.resource_type||'')+'"/><input data-k="id" placeholder="External resource ID" value="'+attr(row.external_resource_id||'')+'"/><input data-k="name" placeholder="Resource name" value="'+attr(row.external_resource_name||'')+'"/><select data-k="offer"><option value="">Select offer</option>'+activeSetup.offers.map(o=>'<option value="'+attr(o.id)+'" '+(o.id===row.offer_id?'selected':'')+'>'+escapeHtml(o.offer_name)+'</option>').join('')+'</select><button class="secondary" onclick="this.parentElement.remove()" title="Remove mapping">×</button></div>'}
function addMapping(){ $('mappingRows').insertAdjacentHTML('beforeend',mappingRow({})) }
function mappingInputs(){return Array.from(document.querySelectorAll('#mappingRows .mapping')).map(row=>({element:row,resourceType:row.querySelector('[data-k=type]').value,externalResourceId:row.querySelector('[data-k=id]').value,externalResourceName:row.querySelector('[data-k=name]').value,offerId:row.querySelector('[data-k=offer]').value}))}
function readMappings(){return mappingInputs().map(row=>({resourceType:row.resourceType,externalResourceId:row.externalResourceId,externalResourceName:row.externalResourceName,offerId:row.offerId,approvalStatus:'approved',approvedBy:'hq_console'})).filter(row=>row.resourceType&&row.externalResourceId&&row.offerId)}
async function suggestMappings(){clearError();try{const rows=mappingInputs();const result=await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/suggest-mappings','POST',{resources:rows});result.suggestions.forEach(s=>{const row=rows.find(r=>r.resourceType===s.resourceType&&r.externalResourceId===s.externalResourceId);if(row&&s.suggestedOfferId)row.element.querySelector('[data-k=offer]').value=s.suggestedOfferId});$('testOutput').textContent=JSON.stringify(result,null,2)}catch(e){showError(e.message)}}
async function openSetup(id){clearError();try{activeSetup=await api('/internal/hq/api/evidence-connections/'+encodeURIComponent(id)+'/setup');renderSetup()}catch(e){showError(e.message)}}
function renderSetup(){const d=activeSetup,c=d.connection,subjects=d.subjects.map(s=>'<option value="'+attr(s.enrollmentId)+'">'+escapeHtml(s.offerName)+' · '+escapeHtml(s.email)+'</option>').join(''),tests=d.recentEvents.filter(e=>e.isTest).slice(0,5);$('connectorSetup').innerHTML='<h2>Connection setup</h2><div class="panel"><div class="actions"><strong>'+escapeHtml(c.name)+'</strong><span class="pill">'+escapeHtml(c.setup_status)+'</span><button class="secondary" onclick="rotateConnector()">Rotate credential</button><button class="secondary" onclick="replayConnector()">Replay eligible</button><button class="danger" onclick="disableConnector()">Disable</button><button onclick="activateConnector()">Activate</button></div><p class="muted">'+escapeHtml(c.location_id)+' · '+escapeHtml(c.health_status)+'</p><div class="fields"><input id="setupName" value="'+attr(c.name)+'"/><input id="setupSource" value="'+attr(c.source_label)+'"/><select id="setupIdentity"><option value="enrollment_context">Enrollment context</option><option value="external_enrollment">External enrollment</option><option value="external_contact_resource">Contact + resource</option><option value="email_resource_bootstrap">Email bootstrap</option></select></div><h3>Approved resource mappings</h3><div id="mappingRows">'+d.mappings.map(mappingRow).join('')+'</div><div class="actions"><button class="secondary" onclick="addMapping()">Add mapping</button><button class="secondary" onclick="suggestMappings()">Suggest matches</button><button onclick="saveSetup()">Save and approve</button></div>'+(c.connection_type==='raw_webhook'?'<h3>Raw mapping and sample preview</h3><textarea id="mapperJson">'+escapeHtml(JSON.stringify(c.mapping_config||{},null,2))+'</textarea><textarea id="sampleJson" placeholder="Paste sample JSON. Preview does not create evidence."></textarea><button class="secondary" onclick="previewSample()">Preview</button>':'')+'<h3>Tenant and enrollment test</h3><div class="fields"><select id="testEnrollment"><option value="">Select exact enrollment</option>'+subjects+'</select><input id="testEvent" value="service.login"/><button onclick="testConnector()">Run test</button></div><pre id="testOutput">'+escapeHtml(JSON.stringify(tests,null,2))+'</pre></div>';$('setupIdentity').value=c.identity_strategy||'enrollment_context'}
async function saveSetup(){clearError();try{const body={name:$('setupName').value,sourceLabel:$('setupSource').value,identityStrategy:$('setupIdentity').value,resourceMappings:readMappings()};if($('mapperJson'))body.mappingConfig=JSON.parse($('mapperJson').value);await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id,'PUT',body);showNotice('Setup saved. Run a successful test before activation.');await openSetup(activeSetup.connection.id);await load()}catch(e){showError(e.message)}}
async function previewSample(){clearError();try{const result=await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/preview','POST',{payload:JSON.parse($('sampleJson').value)});$('testOutput').textContent=JSON.stringify(result,null,2)}catch(e){showError(e.message)}}
async function testConnector(){clearError();try{const result=await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/test','POST',{enrollmentId:$('testEnrollment').value,eventType:$('testEvent').value});$('testOutput').textContent=JSON.stringify(result,null,2);showNotice('Test accepted. It cannot become evidence. Refresh setup to see its final match result.')}catch(e){showError(e.message)}}
async function activateConnector(){clearError();try{await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/activate','POST',{});showNotice('Connection activated.');await load();await openSetup(activeSetup.connection.id)}catch(e){showError(e.message)}}
async function disableConnector(){clearError();try{await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/status','POST',{enabled:false});showNotice('Connection disabled.');await load();await openSetup(activeSetup.connection.id)}catch(e){showError(e.message)}}
async function rotateConnector(){clearError();try{const result=await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/rotate','POST',{graceHours:24});showNotice('New credential shown once: '+result.credential.secret+' | Endpoint: '+(result.endpoints.canonicalUrl||result.endpoints.webhookUrl));await openSetup(activeSetup.connection.id)}catch(e){showError(e.message)}}
async function replayConnector(){clearError();try{const result=await request('/internal/hq/api/evidence-connections/'+activeSetup.connection.id+'/replay','POST',{});showNotice(result.replayed+' eligible events queued for replay.');await openSetup(activeSetup.connection.id)}catch(e){showError(e.message)}}
async function detail(locationId){clearError();try{const d=await api('/internal/hq/api/merchants/'+encodeURIComponent(locationId));$('detail').innerHTML='<h2>Merchant detail</h2><pre>'+escapeHtml(JSON.stringify(d,null,2))+'</pre>'}catch(e){showError(e.message)}}
function escapeHtml(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function attr(s){return escapeHtml(s).replace(/'/g,'&#39;')}
$('load').addEventListener('click',load); if(sessionStorage.getItem('ss_hq_token')){$('token').value=sessionStorage.getItem('ss_hq_token')}
</script></body></html>`;
}

export default router;
