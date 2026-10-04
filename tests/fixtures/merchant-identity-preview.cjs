// Local-only UI fixture. No app server, credentials, providers or database.
// Run after build: node tests/fixtures/merchant-identity-preview.cjs
const http = require('node:http');
const { operatorCommandCenterHtml, operatorCommandCenterCss, operatorCommandCenterJs } = require('../../dist/operator-command-center-page');
const { projectLocationIdentity } = require('../../dist/utils/merchant-location-identity');
const now = new Date().toISOString();
const fixtures = ['Ali', 'Matt', 'Unavailable', 'Stale'].map((name, index) => {
  const locationId = 'fixture-location-' + name.toLowerCase();
  return { product: 'enrollments', locationId, businessName: 'Shared Merchant Business', installed: true,
    planKey: 'test', planLabel: 'Free / Test Access', billingStatus: 'unknown', accessAllowed: false,
    accessLabel: 'Approval needed', approvalKind: 'test', needsApproval: true, approvedAt: null, approvedBy: null,
    note: null, version: 'a'.repeat(64), identity: projectLocationIdentity({
      ghl_location_name: index === 2 ? null : 'Fictional Kingdom - ' + name,
      ghl_location_name_source: index === 2 ? null : 'ghl_location_api',
      ghl_location_name_verified_at: index === 2 ? null : index === 3 ? '2026-01-01T12:00:00Z' : now,
      ghl_location_name_checked_at: now, ghl_location_name_error: index === 3 ? 'provider_unavailable' : null,
      ghl_identity_authorized: index !== 2,
    }) };
});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname.endsWith('/command-center.css')) { res.setHeader('Content-Type', 'text/css'); return res.end(operatorCommandCenterCss); }
  if (url.pathname.endsWith('/command-center.js')) { res.setHeader('Content-Type', 'text/javascript'); return res.end(operatorCommandCenterJs); }
  if (url.pathname.endsWith('/api/session')) return json({ displayName: 'Local fixture owner', role: 'platform_owner',
    organizationName: 'Local preview only', capabilities: { merchantAccessRead: true, merchantAccessApprove: true, evidenceRead: true } });
  const access = url.pathname.match(/\/api\/access\/enrollments(?:\/([^/]+))?(?:\/(refresh-identity|approve))?$/);
  if (access) {
    if (!access[1]) {
      const query = (url.searchParams.get('query') || '').toLowerCase();
      const items = fixtures.filter(item => !query || [item.locationId, item.businessName, item.identity.name || ''].some(value => value.toLowerCase().includes(query)));
      return json({ items, total: items.length, pending: fixtures.length, installed: fixtures.length, limit: 50, offset: 0, generatedAt: now, approvalAvailable: true });
    }
    const merchant = fixtures.find(item => item.locationId === access[1]);
    if (access[2] === 'refresh-identity' && merchant.identity.authorization === 'authorized') {
      merchant.identity = projectLocationIdentity({ ghl_location_name: 'Renamed Fictional Kingdom - Matt',
        ghl_location_name_source: 'ghl_location_api', ghl_location_name_verified_at: new Date().toISOString(), ghl_location_name_checked_at: new Date().toISOString(), ghl_identity_authorized: true });
    }
    return json({ merchant, approvalAvailable: true, auditComplete: true });
  }
  if (url.pathname.endsWith('/api/merchants')) return json({ items: fixtures.map(item => ({ ...item, location_id: item.locationId,
    business_name: item.businessName, marketplace_plan_key: 'test', installation_state: 'healthy', overall_state: 'healthy',
    processor_types: [], needs_attention_count: 0 })), total: fixtures.length });
  const detail = url.pathname.match(/\/api\/merchants\/([^/]+)$/);
  if (detail) return json({ merchant: fixtures.find(item => item.locationId === detail[1]) });
  if (url.pathname.includes('/api/access/evidence')) return json({ items: [], total: 0, pending: 0, installed: 0, generatedAt: now, approvalAvailable: false });
  if (url.pathname.endsWith('/api/health')) return json({ checks: [], incidents: [], merchants: [], summary: {}, generatedAt: now });
  if (url.pathname.includes('/api/')) return json({ items: [], total: 0 });
  res.setHeader('Content-Type', 'text/html'); res.end(operatorCommandCenterHtml());
});
server.listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log('Fictional identity preview at http://127.0.0.1:' + server.address().port + '/#merchants'));
