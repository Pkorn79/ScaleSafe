// Loopback-only, fictional UI preview. No config, credentials, databases or provider calls.
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const express = require('express');
const path = require('path');
const app = express();
const requests = [];
function loadPageModule(name) {
  if (!['operator-command-center-page', 'operator-access-page'].includes(name)) throw new Error('Preview module not allowed');
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/' + name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, require: name => loadPageModule(name.replace('./', '')) }; vm.runInNewContext(output, sandbox); return sandbox.exports;
}
const page = () => loadPageModule('operator-command-center-page');
app.use(express.json());
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); requests.push(req.path); next(); });
app.get('/__preview/requests', (_req, res) => res.json(requests));
app.get('/__preview/mobile', (_req, res) => res.type('html').send('<!doctype html><html><head><title>Fictional mobile layout</title></head><body style="margin:0;background:#ddd"><iframe title="390px mobile preview" src="/#merchants" style="display:block;width:390px;height:844px;border:0"></iframe></body></html>'));
app.get('/internal/operator/assets/command-center.css', (_req, res) => res.type('css').send(page().operatorCommandCenterCss));
app.get('/internal/operator/assets/command-center.js', (_req, res) => res.type('js').send(page().operatorCommandCenterJs));
app.get('/internal/operator/api/session', (req, res) => {
  const role = new URL(req.headers.referer || 'http://localhost').searchParams.get('role');
  res.json({ role: role || 'platform_owner', organizationType: 'platform', authAssurance: 'aal2', capabilities: { evidenceRead: role !== 'platform_support', merchantAccessRead: role !== 'platform_support', merchantAccessApprove: !role || role === 'platform_owner' } });
});
app.get('/internal/operator/api/health', (_req, res) => res.status(503).json({ message: 'Fictional Enrollments outage' }));
app.get('/internal/operator/api/resellers', (_req, res) => res.json({ items: [] }));
const access = Object.fromEntries(['enrollments', 'evidence'].map(product => [product, Array.from({length:51}, (_, i) => ({
  product, locationId:'FICTIONAL-' + String(i+1).padStart(2,'0'), businessName:product === 'enrollments' ? ['Fictional Alpha','Fictional Bravo','Fictional WholePay'][i] || 'Fictional Merchant ' + i : null,
  installed:true, planKey:product === 'evidence' ? 'beta' : i === 1 ? 'standard' : i === 2 ? 'wholepay' : 'test',
  planLabel:product === 'evidence' ? 'Free beta' : i === 1 ? 'Standard (paid plan)' : i === 2 ? 'WholePay merchant plan' : 'Free / Test Access',
  billingStatus:product === 'evidence' ? 'not_applicable' : i === 1 ? 'complete' : 'unknown',
  accessAllowed:i === 1,accessLabel:i === 1 ? 'Access active' : 'Approval needed',approvalKind:product === 'evidence' ? 'beta' : i === 1 ? null : i === 2 ? 'wholepay' : 'test',
  needsApproval:i !== 1,approvedAt:null,approvedBy:null,note:null,version:'a'.repeat(64)
}))]));
app.get('/internal/operator/api/access/:product', (req,res) => {
  const items=access[req.params.product]; if(!items)return res.sendStatus(404);
  const q=String(req.query.query || '').toLowerCase(); const status=req.query.status || 'all'; const offset=Number(req.query.offset || 0);
  const matching=items.filter(item=>(item.locationId.toLowerCase().includes(q)||(item.businessName||'').toLowerCase().includes(q)) && (status === 'all' || status === 'pending' && item.needsApproval || status === 'active' && item.accessAllowed));
  res.json({product:req.params.product,items:matching.slice(offset,offset+50),total:matching.length,pending:items.filter(i=>i.needsApproval).length,installed:items.length,limit:50,offset,generatedAt:new Date().toISOString(),approvalAvailable:true});
});
app.get('/internal/operator/api/access/:product/:locationId', (req,res) => {
  const merchant=access[req.params.product]?.find(item=>item.locationId===req.params.locationId);
  if(!merchant)return res.sendStatus(404);res.json({merchant,approvalAvailable:true});
});
app.post('/internal/operator/api/access/:product/:locationId/approve', (req,res) => {
  const mode=new URL(req.headers.referer || 'http://localhost').searchParams.get('approval');
  if(mode==='fail')return res.status(409).json({message:'Fictional concurrent plan change'});
  const merchant=access[req.params.product]?.find(item=>item.locationId===req.params.locationId);
  if(!merchant)return res.sendStatus(404);
  Object.assign(merchant,{accessAllowed:true,needsApproval:false,accessLabel:'Access active',approvedAt:new Date().toISOString(),approvedBy:'Fictional owner',note:req.body.note});
  res.json({merchant,auditComplete:true,correlationId:'fictional-audit'});
});
app.get('/internal/operator/api/evidence/overview', (req, res) => {
  const mode = new URL(req.headers.referer || 'http://localhost').searchParams.get('evidence');
  if (mode === 'offline') return res.json({ connection: 'unavailable' });
  if (mode === 'unconfigured') return res.json({ connection: 'not_configured' });
  const total = mode === 'empty' ? 0 : 51;
  const offset = Number(req.query.offset || 0);
  const merchants = Array.from({ length: total }, (_, i) => ({ location_id: 'FICTIONAL-LOCATION-' + String(i + 1).padStart(2, '0'),
    active: true, beta_enabled: true, customers: 2, purchases: 3, open_disputes: i === 0 ? 1 : 0,
    capture_issues: i === 0 ? 1 : 0, queued_jobs: 1, evidence_records: 10,
    installed_at: '2026-09-01T00:00:00Z', last_capture_at: i === 0 ? null : new Date().toISOString() }));
  res.json({ connection: 'connected', product: 'scalesafe-client-evidence', contractVersion: 'command-center-evidence-v1',
    generatedAt: new Date(Date.now() - (mode === 'stale' ? 7200000 : 0)).toISOString(),
    summary: { merchants: total, active_merchants: total, customers: total * 2, purchases: total * 3,
      open_disputes: total ? 1 : 0, capture_issues: total ? 1 : 0, queued_jobs: total, evidence_records: total * 10 },
    merchants: merchants.slice(offset, offset + 50), pagination: { limit: 50, offset, total } });
});
app.get('/', (_req, res) => res.type('html').send(page().operatorCommandCenterHtml()
  .replace('Command Center</span>', 'Command Center · fictional preview</span>')));
const server = app.listen(4387, '127.0.0.1', () => console.log('Fictional preview: http://127.0.0.1:4387/#evidence'));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
