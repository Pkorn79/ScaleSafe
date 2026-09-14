// Loopback-only, fictional UI preview. No config, credentials, databases or provider calls.
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const express = require('express');
const path = require('path');
const app = express();
const requests = [];
function page() {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/operator-command-center-page.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {} }; vm.runInNewContext(output, sandbox); return sandbox.exports;
}
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); requests.push(req.path); next(); });
app.get('/__preview/requests', (_req, res) => res.json(requests));
app.get('/internal/operator/assets/command-center.css', (_req, res) => res.type('css').send(page().operatorCommandCenterCss));
app.get('/internal/operator/assets/command-center.js', (_req, res) => res.type('js').send(page().operatorCommandCenterJs));
app.get('/internal/operator/api/session', (req, res) => {
  const role = new URL(req.headers.referer || 'http://localhost').searchParams.get('role');
  res.json({ role: role || 'platform_owner', organizationType: 'platform', authAssurance: 'aal2', capabilities: { evidenceRead: role !== 'platform_support' } });
});
app.get('/internal/operator/api/health', (_req, res) => res.status(503).json({ message: 'Fictional Enrollments outage' }));
app.get('/internal/operator/api/resellers', (_req, res) => res.json({ items: [] }));
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
