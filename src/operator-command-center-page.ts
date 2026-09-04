export const operatorCommandCenterHtml = (): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Command Center | ScaleSafe</title>
  <link rel="stylesheet" href="/internal/operator/assets/command-center.css">
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Command Center navigation">
      <div class="brand"><strong>ScaleSafe</strong><span>Command Center</span><button id="mobile-menu" class="mobile-menu" type="button" aria-expanded="false" aria-controls="navigation">Menu</button></div>
      <nav id="navigation">
        <button class="nav-item active" data-view="overview" type="button"><span>Overview</span><i id="overview-dot"></i></button>
        <button class="nav-item" data-view="merchants" type="button"><span>Merchants</span><b id="merchant-nav-count"></b></button>
        <button class="nav-item" data-view="incidents" type="button"><span>Incidents</span><b id="incident-nav-count"></b></button>
        <p class="nav-label">Operations</p>
        <button class="nav-item" data-view="money" type="button"><span>Payments</span><i id="money-dot"></i></button>
        <button class="nav-item" data-view="fulfillment" type="button"><span>Workflows &amp; evidence</span><i id="fulfillment-dot"></i></button>
        <button class="nav-item" data-view="recovery" type="button"><span>Recovery &amp; deploys</span><i id="recovery-dot"></i></button>
        <p class="nav-label">Administration</p>
        <button class="nav-item" data-view="resellers" type="button"><span>Resellers</span></button>
        <button class="nav-item" data-view="audit" type="button"><span>Audit</span></button>
        <button class="nav-item" data-view="runbooks" type="button"><span>Runbooks</span></button>
      </nav>
      <div class="sidebar-footer">
        <div id="identity" class="identity"><strong>Loading</strong><span>Secure operator session</span></div>
        <button id="logout" class="quiet-button" type="button">Sign out</button>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Platform operations</p>
          <h1 id="view-title">Platform overview</h1>
          <p id="view-subtitle">Current service health and merchant attention across ScaleSafe.</p>
        </div>
        <div class="topbar-actions">
          <span id="freshness" class="freshness unknown">Waiting for current data</span>
          <button id="refresh" class="secondary-button" type="button">Refresh</button>
        </div>
      </header>
      <p id="status" class="status" aria-live="polite"></p>

      <section class="view active" data-panel="overview">
        <div id="summary" class="summary-grid" aria-label="Platform summary"></div>
        <div class="split-grid">
          <section class="surface">
            <div class="section-heading"><div><h2>Needs attention</h2><p>Active incidents ordered by severity and recency.</p></div><button class="text-button" data-jump="incidents" type="button">View all</button></div>
            <div id="overview-incidents" class="stack-list"></div>
          </section>
          <section class="surface">
            <div class="section-heading"><div><h2>Operating systems</h2><p>Current state across the critical paths.</p></div></div>
            <div id="system-groups" class="system-list"></div>
          </section>
        </div>
        <section class="surface">
          <div class="section-heading"><div><h2>Merchant attention</h2><p>Accounts with the highest current operational risk.</p></div><button class="text-button" data-jump="merchants" type="button">Open merchants</button></div>
          <div class="table-wrap"><table><thead><tr><th>Merchant</th><th>Overall</th><th>Attention</th><th>Critical path</th><th>Evaluated</th></tr></thead><tbody id="overview-merchants"></tbody></table></div>
        </section>
      </section>

      <section class="view" data-panel="merchants">
        <section class="surface toolbar-surface">
          <form id="merchant-filters" class="filter-grid">
            <label class="search-field">Search<input name="query" type="search" maxlength="100" placeholder="Business name or exact location ID"></label>
            <label>Health<select name="state"><option value="">All</option><option>healthy</option><option>degraded</option><option>unhealthy</option><option>unknown</option></select></label>
            <label>Installation<select name="installation"><option value="">All</option><option>healthy</option><option>degraded</option><option>unhealthy</option><option>unknown</option><option value="not_applicable">not applicable</option></select></label>
            <label>Processor<select name="processor"><option value="">All</option><option>stripe</option><option>nmi</option><option>whop</option></select></label>
            <label>Plan<select name="plan"><option value="">All</option><option>test</option><option>standard</option><option>wholepay</option><option>legacy</option><option>unknown</option></select></label>
            <label>Reseller<select id="merchant-reseller" name="reseller"><option value="">All</option><option value="unassigned">Unassigned</option></select></label>
            <label>Incident severity<select name="incidentSeverity"><option value="">All</option><option>critical</option><option>urgent</option><option>warning</option><option>info</option></select></label>
            <label>Component<select name="component"><option value="">All</option><option value="processor">Payments</option><option value="workflow">Workflows</option><option>evidence</option><option>defense</option><option>billing</option></select></label>
            <label>Component state<select name="componentState"><option value="">All</option><option>healthy</option><option>degraded</option><option>unhealthy</option><option>unknown</option><option value="not_applicable">not applicable</option></select></label>
            <button type="submit">Apply</button>
          </form>
        </section>
        <section class="surface">
          <div class="section-heading"><div><h2>Merchant accounts</h2><p id="merchant-result-count">Loading accounts.</p></div></div>
          <div class="table-wrap"><table><thead><tr><th>Merchant</th><th>Installation</th><th>Plan</th><th>Processors</th><th>Health</th><th>Attention</th><th></th></tr></thead><tbody id="merchant-rows"></tbody></table></div>
          <div class="pager"><button id="merchant-prev" class="secondary-button" type="button">Previous</button><span id="merchant-page"></span><button id="merchant-next" class="secondary-button" type="button">Next</button></div>
        </section>
      </section>

      <section class="view" data-panel="incidents">
        <section class="surface toolbar-surface">
          <label class="toggle"><input id="include-resolved" type="checkbox"><span>Include resolved incidents</span></label>
        </section>
        <section class="surface">
          <div class="section-heading"><div><h2>Incident history</h2><p>Operational incidents, acknowledgement state, and runbook ownership.</p></div><span id="incident-count" class="count"></span></div>
          <div class="table-wrap"><table><thead><tr><th>Severity</th><th>Incident</th><th>Scope</th><th>Status</th><th>Last seen</th><th>Runbook</th><th>Action</th></tr></thead><tbody id="incident-rows"></tbody></table></div>
          <div class="pager"><button id="more-incidents" class="secondary-button" type="button" hidden>Load more</button></div>
        </section>
      </section>

      <section class="view" data-panel="money">
        <section class="context-band"><strong>Payment and reconciliation health</strong><span>Unknown provider outcomes and exhausted retries stay separate from work that is still retrying.</span></section>
        <section class="surface"><div class="section-heading"><div><h2>Money movement checks</h2><p>Processor, payment, refund, billing, and reconciliation paths.</p></div><span id="money-freshness" class="count"></span></div><div id="money-checks" class="check-grid"></div></section>
      </section>

      <section class="view" data-panel="fulfillment">
        <section class="context-band"><strong>Delivery chain health</strong><span>GHL workflows, connector intake, enrollment resolution, evidence, and defense processing.</span></section>
        <section class="surface"><div class="section-heading"><div><h2>Workflow and evidence checks</h2><p>Each result reflects its own authoritative stage.</p></div><span id="fulfillment-freshness" class="count"></span></div><div id="fulfillment-checks" class="check-grid"></div></section>
      </section>

      <section class="view" data-panel="recovery">
        <section class="context-band"><strong>Recovery and release proof</strong><span>Backup completion, encrypted objects, restore recency, deployment, CI, network, and dead-man checks.</span></section>
        <section class="surface"><div class="section-heading"><div><h2>Recovery and deployment checks</h2><p>No recovery action is available from this read-only release.</p></div><span id="recovery-freshness" class="count"></span></div><div id="recovery-checks" class="check-grid"></div></section>
      </section>

      <section class="view" data-panel="resellers">
        <section class="surface"><div class="section-heading"><div><h2>Reseller organizations</h2><p>Read-only organization, staff, and assigned merchant counts.</p></div><span id="reseller-count" class="count"></span></div><div class="table-wrap"><table><thead><tr><th>Organization</th><th>Status</th><th>Active staff</th><th>Assigned merchants</th><th>Created</th></tr></thead><tbody id="reseller-rows"></tbody></table></div></section>
      </section>

      <section class="view" data-panel="audit">
        <section class="surface"><div class="section-heading"><div><h2>Operator audit</h2><p>Attributed access, denials, sensitive reads, and administrative intent.</p></div><span id="audit-count" class="count"></span></div><div class="table-wrap"><table><thead><tr><th>Result</th><th>Action</th><th>Actor</th><th>Target</th><th>Occurred</th></tr></thead><tbody id="audit-rows"></tbody></table></div></section>
      </section>

      <section class="view" data-panel="runbooks">
        <section class="surface"><div class="section-heading"><div><h2>Operator runbooks</h2><p>Verified checks, escalation, evidence preservation, recovery, and rollback for each incident family.</p></div></div><div id="runbook-list" class="runbook-grid"></div></section>
      </section>
    </main>
  </div>

  <dialog id="merchant-dialog" class="detail-dialog"><div class="dialog-heading"><div><p class="eyebrow">Merchant account</p><h2 id="merchant-dialog-title">Merchant detail</h2></div><button id="close-merchant" class="quiet-button" type="button">Close</button></div><div id="merchant-detail"></div></dialog>
  <dialog id="incident-dialog" class="detail-dialog"><div class="dialog-heading"><div><p class="eyebrow">Authoritative incident</p><h2 id="incident-dialog-title">Incident detail</h2></div><button id="close-incident" class="quiet-button" type="button">Close</button></div><div id="incident-detail"></div></dialog>
  <dialog id="suppress-dialog"><form id="suppress-form" method="dialog"><h2>Suppress incident</h2><p>Health evaluation continues. Only operator notification state is suppressed.</p><label>Reason<textarea name="reason" maxlength="500" required></textarea></label><label>Duration<select name="hours"><option value="1">1 hour</option><option value="4">4 hours</option><option value="12">12 hours</option><option value="24">24 hours</option></select></label><div class="dialog-actions"><button id="cancel-suppress" class="secondary-button" type="button">Cancel</button><button type="submit">Suppress</button></div></form></dialog>
  <script src="/internal/operator/assets/command-center.js" defer></script>
</body>
</html>`;

export const operatorCommandCenterCss = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #102033; background: #f3f6f7; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #f3f6f7; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
.app-shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; display: flex; flex-direction: column; height: 100vh; padding: 22px 15px 16px; background: #0d1b32; color: #fff; }
.brand { display: grid; gap: 2px; padding: 4px 11px 24px; border-bottom: 1px solid rgba(255,255,255,.1); }
.brand strong { font-size: 21px; }
.brand span { color: #9fb4ca; font-size: 12px; }
.mobile-menu { display: none; min-height: 36px; border: 1px solid #8da3b9; border-radius: 5px; padding: 7px 11px; background: transparent; color: #fff; font-weight: 750; }
nav { display: grid; gap: 4px; padding-top: 18px; }
.nav-label { margin: 18px 11px 6px; color: #6f88a3; font-size: 10px; font-weight: 800; text-transform: uppercase; }
.nav-item { display: flex; align-items: center; justify-content: space-between; min-height: 42px; border: 0; border-radius: 6px; padding: 9px 11px; background: transparent; color: #c5d3e1; text-align: left; }
.nav-item:hover, .nav-item:focus-visible { background: rgba(255,255,255,.07); color: #fff; outline: 0; }
.nav-item.active { background: #fff; color: #102033; font-weight: 750; }
.nav-item b { min-width: 24px; border-radius: 12px; padding: 2px 7px; background: rgba(255,255,255,.11); font-size: 11px; text-align: center; }
.nav-item.active b { background: #e6f6f1; color: #08745d; }
.nav-item i { width: 8px; height: 8px; border-radius: 50%; background: #d64b3c; }
.nav-item i:empty:not(.visible) { display: none; }
.sidebar-footer { display: grid; gap: 12px; margin-top: auto; padding: 16px 10px 0; border-top: 1px solid rgba(255,255,255,.1); }
.identity { display: grid; gap: 2px; min-width: 0; }
.identity strong, .identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.identity strong { font-size: 13px; }
.identity span { color: #91a6bb; font-size: 11px; }
.quiet-button { min-height: 36px; border: 1px solid currentColor; border-radius: 5px; padding: 7px 11px; background: transparent; color: inherit; font-weight: 700; }
.workspace { width: 100%; min-width: 0; padding: 32px clamp(20px, 3vw, 48px) 60px; }
.topbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin: 0 auto 8px; max-width: 1500px; }
.eyebrow { margin: 0 0 7px; color: #088067; font-size: 11px; font-weight: 850; text-transform: uppercase; }
h1, h2, h3, p { letter-spacing: 0; }
h1 { margin: 0; font-size: 30px; }
h2 { margin: 0; font-size: 18px; }
h3 { margin: 0; font-size: 14px; }
.topbar > div > p:last-child { margin: 7px 0 0; color: #617386; font-size: 14px; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }
.freshness { display: inline-flex; align-items: center; min-height: 34px; border-radius: 5px; padding: 7px 10px; background: #e8eef1; color: #43596a; font-size: 12px; font-weight: 750; }
.freshness.current { background: #daf5e9; color: #087443; }
.freshness.delayed { background: #fff0c7; color: #765700; }
.freshness.stale { background: #ffe3df; color: #9d2f25; }
.secondary-button, .text-button, form button { min-height: 38px; border: 1px solid #9fb2ba; border-radius: 5px; padding: 8px 13px; background: #fff; color: #17384b; font-weight: 750; }
form button { border-color: #007c68; background: #007c68; color: #fff; }
.text-button { min-height: 32px; border: 0; padding: 4px; color: #08745d; }
.status { min-height: 20px; max-width: 1500px; margin: 0 auto 10px; color: #b42318; font-size: 13px; }
.view { display: none; width: 100%; min-width: 0; max-width: 1500px; margin: 0 auto; }
.view.active { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.view > *, .summary-grid > *, .split-grid > * { min-width: 0; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.summary-item { min-height: 116px; border: 1px solid #d9e3e6; border-top: 3px solid #0b7c68; border-radius: 6px; padding: 17px; background: #fff; }
.summary-item.attention { border-top-color: #d64b3c; }
.summary-item.warning { border-top-color: #d19a2a; }
.summary-item span { color: #607284; font-size: 11px; font-weight: 850; text-transform: uppercase; }
.summary-item strong { display: block; margin-top: 10px; font-size: 28px; }
.summary-item small { display: block; margin-top: 7px; color: #607284; font-size: 12px; }
.split-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr); gap: 16px; }
.surface { min-width: 0; border: 1px solid #d9e3e6; border-radius: 7px; background: #fff; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 20px 22px 15px; border-bottom: 1px solid #e8edef; }
.section-heading p { margin: 5px 0 0; color: #607284; font-size: 12px; }
.count { color: #607284; font-size: 12px; white-space: nowrap; }
.stack-list, .system-list { padding: 6px 22px 13px; }
.stack-row, .system-row { display: grid; gap: 4px; padding: 13px 0; border-bottom: 1px solid #edf1f2; }
.stack-row:last-child, .system-row:last-child { border-bottom: 0; }
.stack-row { grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; column-gap: 10px; }
.stack-row p, .system-row p { margin: 2px 0 0; color: #607284; font-size: 12px; }
.system-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.context-band { display: flex; justify-content: space-between; gap: 24px; border-left: 4px solid #0b7c68; padding: 14px 18px; background: #e9f5f2; color: #254458; font-size: 13px; }
.context-band span { color: #52697b; }
.table-wrap { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 10px 12px; border-bottom: 1px solid #cfdadd; color: #607284; text-align: left; font-size: 10px; text-transform: uppercase; white-space: nowrap; }
td { padding: 12px; border-bottom: 1px solid #edf1f2; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #fafcfc; }
.primary-text { display: block; color: #102033; font-weight: 750; }
.secondary-text { display: block; margin-top: 4px; color: #607284; font-size: 11px; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; min-height: 23px; border-radius: 4px; padding: 3px 7px; background: #e8eef1; color: #43596a; font-size: 10px; font-weight: 850; text-transform: uppercase; white-space: nowrap; }
.badge.healthy, .badge.resolved, .badge.succeeded, .badge.allowed { background: #daf5e9; color: #087443; }
.badge.degraded, .badge.warning, .badge.acknowledged, .badge.retrying, .badge.intent { background: #fff0c7; color: #765700; }
.badge.unhealthy, .badge.urgent, .badge.open, .badge.failed, .badge.denied { background: #ffe3df; color: #a93226; }
.badge.critical { background: #a92f26; color: #fff; }
.badge.unknown, .badge.info, .badge.suppressed, .badge.not_applicable { background: #e8eef1; color: #43596a; }
.component-list { display: flex; flex-wrap: wrap; gap: 5px; min-width: 260px; }
.row-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 145px; }
.row-actions button { min-height: 30px; border: 1px solid #9fb2ba; border-radius: 4px; padding: 5px 8px; background: #fff; color: #17384b; font-size: 11px; font-weight: 750; }
.toolbar-surface { padding: 16px 18px; }
.filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); align-items: end; gap: 12px; }
.filter-grid .search-field { grid-column: span 2; }
label { display: grid; gap: 6px; color: #405568; font-size: 11px; font-weight: 750; }
input, select, textarea { width: 100%; border: 1px solid #aebdc5; border-radius: 5px; padding: 9px 10px; background: #fff; color: #102033; }
input:focus, select:focus, textarea:focus { outline: 3px solid rgba(0,151,122,.16); border-color: #007c68; }
.toggle { display: flex; align-items: center; gap: 8px; }
.toggle input { width: 17px; height: 17px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 15px; border-top: 1px solid #edf1f2; }
.empty { padding: 28px 12px; color: #607284; text-align: center; }
.check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; padding: 8px 22px 18px; }
.check-item { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 10px; padding: 15px 0; border-bottom: 1px solid #edf1f2; }
.check-item p { margin: 5px 0 0; color: #607284; font-size: 12px; }
.check-meta { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 7px; color: #758493; font-size: 10px; }
.runbook-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; padding: 8px 22px 20px; }
.runbook { padding: 17px 0; border-bottom: 1px solid #edf1f2; scroll-margin-top: 20px; }
.runbook.selected { border-radius: 5px; background: #eef9f6; box-shadow: 0 0 0 8px #eef9f6; }
.runbook p { margin: 6px 0; color: #607284; font-size: 12px; }
.runbook ul { margin: 8px 0 0; padding-left: 18px; color: #405568; font-size: 11px; }
.runbook h4 { margin: 13px 0 4px; color: #17384b; font-size: 10px; text-transform: uppercase; }
dialog { width: min(94vw, 560px); max-height: 88vh; overflow: auto; border: 1px solid #c7d4d8; border-radius: 7px; padding: 0; color: #102033; box-shadow: 0 24px 70px rgba(16,32,51,.28); }
dialog::backdrop { background: rgba(7,24,42,.5); }
dialog form, .detail-dialog { padding: 24px; }
dialog form { display: grid; gap: 15px; }
dialog form p { margin: -6px 0 0; color: #607284; font-size: 12px; }
.dialog-heading { position: sticky; top: 0; display: flex; align-items: start; justify-content: space-between; gap: 16px; padding: 20px 22px; border-bottom: 1px solid #e5ebed; background: #fff; }
.dialog-heading .quiet-button { color: #405568; }
#merchant-detail, #incident-detail { padding: 5px 22px 24px; }
.detail-section { padding: 17px 0; border-bottom: 1px solid #edf1f2; }
.detail-section:last-child { border-bottom: 0; }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.detail-grid div { min-width: 0; }
.detail-grid span { display: block; color: #718293; font-size: 10px; text-transform: uppercase; }
.detail-grid strong { display: block; margin-top: 4px; overflow-wrap: anywhere; font-size: 12px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 9px; }
textarea { min-height: 90px; resize: vertical; }
[hidden] { display: none !important; }
@media (max-width: 1050px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .split-grid { grid-template-columns: 1fr; } .filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .search-field { grid-column: 1 / -1; } }
@media (max-width: 760px) { .app-shell { grid-template-columns: 1fr; } .sidebar { position: static; height: auto; padding-bottom: 12px; } .brand { grid-template-columns: minmax(0, 1fr) auto; padding-bottom: 16px; } .brand span { grid-column: 1; } .mobile-menu { display: block; grid-column: 2; grid-row: 1 / 3; align-self: center; } nav, .sidebar-footer { display: none; } .sidebar.menu-open nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .sidebar.menu-open .sidebar-footer { display: flex; justify-content: space-between; } .nav-label { grid-column: 1 / -1; } .workspace { padding: 22px 14px 40px; } .topbar { align-items: flex-start; } .topbar-actions { align-items: flex-end; flex-direction: column; } .check-grid, .runbook-grid { grid-template-columns: 1fr; } .context-band { flex-direction: column; gap: 5px; } }
@media (max-width: 500px) { .summary-grid, .filter-grid, .detail-grid { grid-template-columns: 1fr; } .search-field { grid-column: auto; } .topbar { flex-direction: column; } .topbar-actions { width: 100%; align-items: stretch; } }
`;

export const operatorCommandCenterJs = `'use strict';
(function () {
  const status = document.getElementById('status');
  const titles = {
    overview: ['Platform overview', 'Current service health and merchant attention across ScaleSafe.'],
    merchants: ['Merchants', 'Search and inspect every ScaleSafe installation from one tenant-safe view.'],
    incidents: ['Incidents', 'Operational issues, state changes, and accountable follow-up.'],
    money: ['Payments', 'Payment, refund, billing, and processor reconciliation health.'],
    fulfillment: ['Workflows & evidence', 'Delivery automation, external evidence, and defense processing health.'],
    recovery: ['Recovery & deploys', 'Independent backup, restore, release, network, and dead-man proof.'],
    resellers: ['Resellers', 'Organizations and the accounts assigned to them.'],
    audit: ['Audit', 'Attributed access and administrative activity.'],
    runbooks: ['Runbooks', 'The first verified checks for each incident family.']
  };
  const stateWeight = { critical: 6, unhealthy: 5, urgent: 5, unknown: 4, degraded: 3, warning: 3, healthy: 1, resolved: 0, not_applicable: 0 };
  let session = null;
  let health = { checks: [], incidents: [], merchants: [], summary: {}, generatedAt: null };
  let incidentCursor = null;
  let incidents = [];
  let merchantOffset = 0;
  let merchantTotal = 0;
  const merchantLimit = 50;
  let suppressIncidentId = '';
  const loaded = new Set();

  function show(message, ok) {
    status.textContent = message || '';
    status.style.color = ok ? '#087443' : '#b42318';
  }

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function badge(value) {
    const normalized = String(value || 'unknown').toLowerCase();
    return element('span', 'badge ' + normalized, normalized.replaceAll('_', ' '));
  }

  function formatTime(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded';
  }

  function relativeTime(value) {
    if (!value) return 'not recorded';
    const age = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(age)) return 'not recorded';
    const minutes = Math.max(0, Math.floor(age / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function empty(target, message, className) {
    target.replaceChildren(element('div', className || 'empty', message));
  }

  function emptyRow(target, columns, message) {
    const row = element('tr');
    const cell = element('td', 'empty', message);
    cell.colSpan = columns;
    row.appendChild(cell);
    target.appendChild(row);
  }

  async function get(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(payload.message || 'Request failed');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': cookie('__Host-scalesafe_ops_csrf') },
      body: JSON.stringify(body || {})
    });
    const payload = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.message || 'Request failed');
    return payload;
  }

  function cookie(name) {
    const prefix = name + '=';
    const item = document.cookie.split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf(prefix) === 0; });
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }

  function checkGroup(check) {
    const key = String(check.check_key || '');
    if (/money|refund|processor|payment|billing|stripe|nmi|whop/.test(key)) return 'money';
    if (/trigger|workflow|pulse|external_evidence|evidence|defense|provisioning|zoom|ghl|anthropic/.test(key)) return 'fulfillment';
    if (/recovery|backup|restore|deployment|ci|guardian|network|dns|tls/.test(key)) return 'recovery';
    return 'platform';
  }

  function worstState(items, field) {
    if (!items.length) return 'unknown';
    return items.reduce(function (worst, item) {
      const next = String(item[field] || 'unknown').toLowerCase();
      return (stateWeight[next] || 0) > (stateWeight[worst] || 0) ? next : worst;
    }, 'healthy');
  }

  function freshness(value) {
    if (!value) return { className: 'unknown', text: 'Freshness unknown' };
    const minutes = (Date.now() - new Date(value).getTime()) / 60000;
    if (!Number.isFinite(minutes)) return { className: 'unknown', text: 'Freshness unknown' };
    if (minutes <= 15) return { className: 'current', text: 'Current ' + relativeTime(value) };
    if (minutes <= 60) return { className: 'delayed', text: 'Delayed ' + relativeTime(value) };
    return { className: 'stale', text: 'Stale ' + relativeTime(value) };
  }

  function setFreshness(targetId, items) {
    const newest = items.map(function (item) { return item.last_observed_at; }).filter(Boolean).sort().reverse()[0];
    const result = freshness(newest);
    const target = document.getElementById(targetId);
    if (target) target.textContent = result.text;
  }

  function explainCheck(item) {
    if (item.state === 'unknown') return 'No trustworthy current result is available. Last known state is not treated as healthy.';
    if (/exhaust/i.test(String(item.failure_class || ''))) return 'Automatic retry budget is exhausted and human review is required.';
    if (/provider.*unknown|unknown.*provider/i.test(String(item.failure_class || ''))) return 'The request exists, but the provider outcome is not yet proven.';
    return item.summary || 'No additional detail reported.';
  }

  function renderIdentity(data) {
    const target = document.getElementById('identity');
    target.replaceChildren(
      element('strong', '', String(data.role || 'operator').replaceAll('_', ' ')),
      element('span', '', 'MFA verified session')
    );
  }

  function summaryCard(label, value, note, tone) {
    const card = element('div', 'summary-item ' + (tone || ''));
    card.append(element('span', '', label), element('strong', '', value), element('small', '', note));
    return card;
  }

  function renderSummary() {
    const summary = health.summary || {};
    const active = Number(summary.active_incident_count || 0);
    const critical = Number(summary.active_critical_count || 0);
    const merchantAttention = Number(summary.merchant_attention_count || 0);
    const merchantCount = Number(summary.merchant_count || 0);
    const rollupCount = Number(summary.merchant_rollup_count || 0);
    const unhealthy = Number(summary.health_unhealthy_count || 0);
    const unknown = Number(summary.health_unknown_count || 0);
    const checks = Number(summary.health_checks_total || 0);
    const target = document.getElementById('summary');
    target.replaceChildren(
      summaryCard('Platform state', summary.platform_state || 'unknown', unhealthy + ' unhealthy, ' + unknown + ' unknown', unhealthy || unknown ? 'attention' : ''),
      summaryCard('Active incidents', active, critical + ' critical', critical ? 'attention' : ''),
      summaryCard('Merchants needing attention', merchantAttention, rollupCount + ' of ' + merchantCount + ' observed', merchantAttention ? 'warning' : ''),
      summaryCard('Health checks', checks, 'Updated ' + relativeTime(health.generatedAt), '')
    );
    document.getElementById('incident-nav-count').textContent = String(active);
    document.getElementById('merchant-nav-count').textContent = String(merchantCount);
    document.getElementById('overview-dot').classList.toggle('visible', active > 0 || merchantAttention > 0);
  }

  function renderOverviewIncidents() {
    const target = document.getElementById('overview-incidents');
    target.replaceChildren();
    const items = health.incidents.slice().sort(function (a, b) {
      return (stateWeight[b.severity] || 0) - (stateWeight[a.severity] || 0) || String(b.last_seen_at).localeCompare(String(a.last_seen_at));
    }).slice(0, 6);
    if (!items.length) { empty(target, 'No active incidents.'); return; }
    items.forEach(function (item) {
      const row = element('div', 'stack-row');
      const detail = element('div');
      detail.append(element('h3', '', item.title), element('p', '', item.summary));
      row.append(badge(item.severity), detail, element('span', 'count', relativeTime(item.last_seen_at)));
      target.appendChild(row);
    });
  }

  function renderSystemGroups() {
    const definitions = [
      ['Platform', 'platform'],
      ['Payments', 'money'],
      ['Workflows & evidence', 'fulfillment'],
      ['Recovery & deploys', 'recovery']
    ];
    const target = document.getElementById('system-groups');
    target.replaceChildren();
    definitions.forEach(function (entry) {
      const items = health.checks.filter(function (item) { return checkGroup(item) === entry[1]; });
      const row = element('div', 'system-row');
      const detail = element('div');
      const problemCount = items.filter(function (item) { return !['healthy', 'not_applicable'].includes(item.state); }).length;
      detail.append(element('h3', '', entry[0]), element('p', '', problemCount + ' of ' + items.length + ' checks need attention'));
      row.append(detail, badge(worstState(items, 'state')));
      target.appendChild(row);
      const dot = document.getElementById(entry[1] + '-dot');
      if (dot) dot.classList.toggle('visible', problemCount > 0);
    });
  }

  function componentBadges(item) {
    const wrapper = element('div', 'component-list');
    [['Money', item.processor_state], ['Workflow', item.workflow_state], ['Evidence', item.evidence_state], ['Defense', item.defense_state]].forEach(function (entry) {
      const node = badge(entry[1]);
      node.textContent = entry[0] + ': ' + String(entry[1] || 'unknown').replaceAll('_', ' ');
      wrapper.appendChild(node);
    });
    return wrapper;
  }

  function renderOverviewMerchants() {
    const target = document.getElementById('overview-merchants');
    target.replaceChildren();
    const items = health.merchants.filter(function (item) { return Number(item.needs_attention_count) > 0; }).slice(0, 8);
    if (!items.length) { emptyRow(target, 5, 'No merchants currently require attention.'); return; }
    items.forEach(function (item) {
      const row = element('tr');
      const merchant = element('td');
      merchant.append(element('span', 'primary-text', item.merchant_name || item.location_id), element('span', 'secondary-text', item.location_id));
      const state = element('td'); state.appendChild(badge(item.overall_state));
      row.append(merchant, state, element('td', '', item.needs_attention_count || 0), componentBadges(item), element('td', '', relativeTime(item.last_reconciled_at)));
      target.appendChild(row);
    });
  }

  function renderChecks(group, targetId, freshnessId) {
    const items = health.checks.filter(function (item) { return checkGroup(item) === group; }).sort(function (a, b) {
      return (stateWeight[b.state] || 0) - (stateWeight[a.state] || 0) || String(a.check_key).localeCompare(String(b.check_key));
    });
    const target = document.getElementById(targetId);
    target.replaceChildren();
    if (!items.length) { empty(target, 'No current checks are available for this system.'); }
    items.forEach(function (item) {
      const row = element('div', 'check-item');
      const detail = element('div');
      detail.append(element('h3', '', item.check_key), element('p', '', explainCheck(item)));
      const meta = element('div', 'check-meta');
      meta.append(element('span', '', item.scope_type + ': ' + item.scope_id), element('span', '', 'Observed ' + relativeTime(item.last_observed_at)));
      if (item.failure_class) meta.appendChild(element('span', '', 'Code: ' + item.failure_class));
      detail.appendChild(meta);
      row.append(badge(item.state), detail);
      target.appendChild(row);
    });
    setFreshness(freshnessId, items);
  }

  async function loadHealth() {
    const data = await get('/internal/operator/api/health?limit=200');
    health = {
      checks: data.checks || [],
      incidents: data.incidents || [],
      merchants: data.merchants || [],
      summary: data.summary || {},
      generatedAt: data.generatedAt
    };
    renderSummary();
    renderOverviewIncidents();
    renderOverviewMerchants();
    renderSystemGroups();
    renderChecks('money', 'money-checks', 'money-freshness');
    renderChecks('fulfillment', 'fulfillment-checks', 'fulfillment-freshness');
    renderChecks('recovery', 'recovery-checks', 'recovery-freshness');
    const current = freshness(data.generatedAt);
    const target = document.getElementById('freshness');
    target.className = 'freshness ' + current.className;
    target.textContent = current.text;
    show('');
  }

  function queryString(values) {
    const params = new URLSearchParams();
    Object.keys(values).forEach(function (key) {
      const value = values[key];
      if (value !== null && value !== undefined && value !== '') params.set(key, value);
    });
    return params.toString();
  }

  async function loadMerchants(reset) {
    if (reset) merchantOffset = 0;
    const form = new FormData(document.getElementById('merchant-filters'));
    const component = String(form.get('component') || '');
    const componentState = String(form.get('componentState') || '');
    if (Boolean(component) !== Boolean(componentState)) {
      show('Choose both a component and its state.');
      return;
    }
    const query = queryString({
      limit: merchantLimit,
      offset: merchantOffset,
      query: String(form.get('query') || '').trim(),
      state: form.get('state'),
      installation: form.get('installation'),
      processor: form.get('processor'),
      plan: form.get('plan'),
      reseller: form.get('reseller'),
      incidentSeverity: form.get('incidentSeverity'),
      component: component,
      componentState: componentState
    });
    const data = await get('/internal/operator/api/merchants?' + query);
    merchantTotal = Number(data.total || 0);
    const target = document.getElementById('merchant-rows');
    target.replaceChildren();
    if (!data.items.length) emptyRow(target, 7, 'No merchants match these filters.');
    data.items.forEach(function (item) {
      const row = element('tr');
      const merchant = element('td');
      merchant.append(element('span', 'primary-text', item.merchant_name), element('span', 'secondary-text', item.location_id));
      const install = element('td'); install.appendChild(badge(item.installation_state));
      const plan = element('td'); plan.append(element('span', 'primary-text', item.marketplace_plan_key), element('span', 'secondary-text', item.marketplace_billing_status));
      const processors = element('td', '', (item.processor_types || []).join(', ') || 'None');
      const overall = element('td'); overall.appendChild(badge(item.overall_state));
      const action = element('td');
      const open = element('button', '', 'View'); open.type = 'button';
      open.addEventListener('click', function () { openMerchant(item.location_id); });
      const actionWrap = element('div', 'row-actions'); actionWrap.appendChild(open); action.appendChild(actionWrap);
      row.append(merchant, install, plan, processors, overall, element('td', '', item.needs_attention_count || 0), action);
      target.appendChild(row);
    });
    document.getElementById('merchant-result-count').textContent = merchantTotal + ' accounts';
    document.getElementById('merchant-nav-count').textContent = String(merchantTotal);
    document.getElementById('merchant-page').textContent = merchantTotal ? (merchantOffset + 1) + '-' + Math.min(merchantOffset + merchantLimit, merchantTotal) + ' of ' + merchantTotal : '0 accounts';
    document.getElementById('merchant-prev').disabled = merchantOffset === 0;
    document.getElementById('merchant-next').disabled = merchantOffset + merchantLimit >= merchantTotal;
  }

  function detailPair(label, value) {
    const group = element('div'); group.append(element('span', '', label), element('strong', '', value === null || value === undefined || value === '' ? 'Not recorded' : value)); return group;
  }

  function detailSection(title, pairs) {
    const section = element('section', 'detail-section');
    section.appendChild(element('h3', '', title));
    const grid = element('div', 'detail-grid');
    pairs.forEach(function (pair) { grid.appendChild(detailPair(pair[0], pair[1])); });
    section.appendChild(grid); return section;
  }

  async function openMerchant(locationId) {
    const dialog = document.getElementById('merchant-dialog');
    const target = document.getElementById('merchant-detail');
    empty(target, 'Loading merchant detail.');
    dialog.showModal();
    try {
      const data = await get('/internal/operator/api/merchants/' + encodeURIComponent(locationId));
      const merchant = data.merchant || data;
      document.getElementById('merchant-dialog-title').textContent = merchant.business_name || merchant.businessName || locationId;
      target.replaceChildren();
      target.appendChild(detailSection('Account', [
        ['Location', merchant.location_id || merchant.locationId],
        ['Status', merchant.status],
        ['Installation', merchant.snapshot_status || 'Not available'],
        ['Installed', formatTime(merchant.installed_at || merchant.installedAt)],
        ['Plan', merchant.marketplace_plan_key || merchant.marketplacePlan],
        ['Billing', merchant.marketplace_billing_status || merchant.marketplaceBillingStatus]
      ]));
      if (data.health) target.appendChild(detailSection('Health', [
        ['Overall', data.health.overall_state],
        ['Needs attention', data.health.needs_attention_count],
        ['Payments', data.health.processor_state],
        ['Workflows', data.health.workflow_state],
        ['Evidence', data.health.evidence_state],
        ['Defense', data.health.defense_state]
      ]));
      if (data.processors) target.appendChild(detailSection('Processors', data.processors.length ? data.processors.map(function (item) {
        return [String(item.type).toUpperCase(), item.status + (item.mode ? ' (' + item.mode + ')' : '') + ', verified ' + relativeTime(item.last_verified_at)];
      }) : [['Connections', 'None']]));
      if (data.connectors) target.appendChild(detailSection('Evidence connections', data.connectors.length ? data.connectors.map(function (item) {
        return [item.provider_key || item.connection_type || 'Custom connector', item.setup_status + ' / ' + item.health_status + ', success ' + relativeTime(item.last_success_at)];
      }) : [['Connections', 'None']]));
      if (data.incidents) target.appendChild(detailSection('Recent incidents', data.incidents.length ? data.incidents.map(function (item) {
        return [item.severity + ' ' + item.status, item.check_key + ', ' + relativeTime(item.last_seen_at)];
      }) : [['Incidents', 'None']]));
    } catch (error) { empty(target, error.message); }
  }

  async function openIncident(incidentId, updateLocation) {
    const dialog = document.getElementById('incident-dialog');
    const target = document.getElementById('incident-detail');
    empty(target, 'Loading incident detail.');
    dialog.showModal();
    if (updateLocation !== false) history.replaceState(null, '', '#incidents/' + encodeURIComponent(incidentId));
    try {
      const data = await get('/internal/operator/api/incidents/' + encodeURIComponent(incidentId));
      const item = data.incident;
      document.getElementById('incident-dialog-title').textContent = item.title;
      target.replaceChildren();
      target.appendChild(detailSection('Incident', [
        ['Incident ID', item.id],
        ['Check', item.check_key],
        ['Failure class', item.failure_class],
        ['Severity', item.severity],
        ['Status', item.status],
        ['Occurrences', item.occurrence_count]
      ]));
      target.appendChild(detailSection('Scope and timing', [
        ['Scope', item.scope_type + ': ' + item.scope_id],
        ['Location', item.location_id],
        ['First seen', formatTime(item.first_seen_at)],
        ['Last seen', formatTime(item.last_seen_at)],
        ['Acknowledged', formatTime(item.acknowledged_at)],
        ['Resolved', formatTime(item.resolved_at)]
      ]));
      const links = element('div', 'dialog-actions');
      if (item.location_id) {
        const merchant = element('button', 'secondary-button', 'Open merchant');
        merchant.type = 'button'; merchant.addEventListener('click', function () { dialog.close(); openMerchant(item.location_id); }); links.appendChild(merchant);
      }
      const runbook = element('button', '', 'Open ' + item.runbook_key);
      runbook.type = 'button'; runbook.addEventListener('click', function () { dialog.close(); navigate('runbooks', item.runbook_key); }); links.appendChild(runbook);
      target.appendChild(links);
    } catch (error) { empty(target, error.message); }
  }

  function canManageIncidents() {
    return session && (session.role === 'platform_owner' || session.role === 'platform_ops');
  }

  function renderIncidents() {
    const target = document.getElementById('incident-rows'); target.replaceChildren();
    document.getElementById('incident-count').textContent = incidents.length + ' shown';
    if (!incidents.length) { emptyRow(target, 7, 'No incidents in this view.'); return; }
    incidents.forEach(function (item) {
      const row = element('tr');
      const severity = element('td'); severity.appendChild(badge(item.severity));
      const detail = element('td'); detail.append(element('span', 'primary-text', item.title), element('span', 'secondary-text', item.summary));
      const scope = element('td'); scope.append(element('span', 'primary-text', item.scope_type), element('span', 'secondary-text', item.location_id || item.scope_id));
      const state = element('td'); state.appendChild(badge(item.status));
      const runbook = element('td');
      const jump = element('button', 'text-button', item.runbook_key || 'Open runbooks'); jump.type = 'button'; jump.addEventListener('click', function () { navigate('runbooks', item.runbook_key); }); runbook.appendChild(jump);
      const actions = element('td'); const wrap = element('div', 'row-actions');
      const inspect = element('button', 'secondary-button', 'Details'); inspect.type = 'button'; inspect.addEventListener('click', function () { openIncident(item.id); }); wrap.appendChild(inspect);
      if (canManageIncidents() && item.status === 'open') {
        const ack = element('button', '', 'Acknowledge'); ack.type = 'button'; ack.addEventListener('click', async function () { ack.disabled = true; try { await post('/internal/operator/api/incidents/' + encodeURIComponent(item.id) + '/acknowledge', { summary: 'Acknowledged from the Command Center.' }); await loadIncidents(true); await loadHealth(); } catch (error) { show(error.message); } finally { ack.disabled = false; } }); wrap.appendChild(ack);
      }
      if (canManageIncidents() && item.suppressible && item.severity !== 'critical' && item.status !== 'suppressed' && item.status !== 'resolved') {
        const suppress = element('button', '', 'Suppress'); suppress.type = 'button'; suppress.addEventListener('click', function () { suppressIncidentId = item.id; document.getElementById('suppress-dialog').showModal(); }); wrap.appendChild(suppress);
      }
      if (!wrap.childNodes.length) wrap.appendChild(element('span', 'secondary-text', 'Read only'));
      actions.appendChild(wrap);
      row.append(severity, detail, scope, state, element('td', '', formatTime(item.last_seen_at)), runbook, actions); target.appendChild(row);
    });
  }

  async function loadIncidents(reset) {
    if (reset) { incidents = []; incidentCursor = null; }
    const includeResolved = document.getElementById('include-resolved').checked;
    let url = '/internal/operator/api/incidents?limit=100&includeResolved=' + String(includeResolved);
    if (incidentCursor) url += '&cursor=' + encodeURIComponent(incidentCursor);
    const data = await get(url);
    const seen = new Set(incidents.map(function (item) { return item.id; }));
    incidents = incidents.concat((data.incidents || []).filter(function (item) { return !seen.has(item.id); }));
    incidentCursor = data.nextCursor || null;
    document.getElementById('more-incidents').hidden = !incidentCursor;
    renderIncidents();
  }

  async function loadResellers() {
    const target = document.getElementById('reseller-rows'); target.replaceChildren();
    try {
      const data = await get('/internal/operator/api/resellers?limit=200');
      document.getElementById('reseller-count').textContent = data.total + ' organizations';
      if (!data.items.length) { emptyRow(target, 5, 'No reseller organizations have been created.'); return; }
      data.items.forEach(function (item) {
        const row = element('tr'); const state = element('td'); state.appendChild(badge(item.status));
        row.append(element('td', 'primary-text', item.name), state, element('td', '', item.active_staff_count), element('td', '', item.active_merchant_count), element('td', '', formatTime(item.created_at))); target.appendChild(row);
      });
    } catch (error) { emptyRow(target, 5, error.status === 404 ? 'This role does not have reseller visibility.' : error.message); }
  }

  async function loadResellerFilter() {
    const select = document.getElementById('merchant-reseller');
    try {
      const data = await get('/internal/operator/api/resellers?limit=200');
      (data.items || []).forEach(function (item) {
        const option = element('option', '', item.name);
        option.value = item.id;
        select.appendChild(option);
      });
    } catch (error) {
      if (error.status !== 404) show(error.message);
    }
  }

  async function loadAudit() {
    const target = document.getElementById('audit-rows'); target.replaceChildren();
    try {
      const data = await get('/internal/operator/api/audit?limit=200');
      document.getElementById('audit-count').textContent = (data.events || []).length + ' recent events';
      if (!data.events.length) { emptyRow(target, 5, 'No operator audit events are available.'); return; }
      data.events.forEach(function (item) {
        const row = element('tr'); const result = element('td'); result.appendChild(badge(item.result));
        row.append(result, element('td', 'primary-text', item.action), element('td', '', item.actor_role || item.actor_operator_user_id || 'System'), element('td', '', [item.target_type, item.target_location_id || item.target_id].filter(Boolean).join(': ') || 'Platform'), element('td', '', formatTime(item.occurred_at))); target.appendChild(row);
      });
    } catch (error) { emptyRow(target, 5, error.status === 404 ? 'This role does not have audit visibility.' : error.message); }
  }

  async function loadRunbooks() {
    const target = document.getElementById('runbook-list');
    try {
      const data = await get('/internal/operator/api/runbooks'); target.replaceChildren();
      data.runbooks.forEach(function (item) {
        const card = element('article', 'runbook'); card.dataset.runbookKey = item.key;
        card.append(element('h3', '', item.key + ': ' + item.title), element('p', '', item.trigger), element('p', '', item.summary), element('span', 'badge info', item.owner));
        card.appendChild(element('h4', '', 'Procedure'));
        const steps = element('ul'); item.procedure.forEach(function (step) { steps.appendChild(element('li', '', step.action + ' Expected: ' + step.expected)); }); card.appendChild(steps);
        card.appendChild(element('h4', '', 'Escalation')); card.appendChild(element('p', '', item.escalation));
        card.appendChild(element('h4', '', 'Evidence to preserve'));
        const evidence = element('ul'); item.evidence.forEach(function (entry) { evidence.appendChild(element('li', '', entry)); }); card.appendChild(evidence);
        card.appendChild(element('h4', '', 'Recovery')); card.appendChild(element('p', '', item.recovery));
        card.appendChild(element('h4', '', 'Rollback')); card.appendChild(element('p', '', item.rollback));
        target.appendChild(card);
      });
    } catch (error) { empty(target, error.message); }
  }

  function focusRunbook(key) {
    document.querySelectorAll('.runbook').forEach(function (item) { item.classList.remove('selected'); });
    if (!key) return;
    const target = Array.from(document.querySelectorAll('.runbook')).find(function (item) { return item.dataset.runbookKey === key; });
    if (target) { target.classList.add('selected'); target.scrollIntoView({ block: 'start' }); }
  }

  async function loadView(view) {
    if (view === 'merchants') await loadMerchants(!loaded.has(view));
    if (view === 'incidents') await loadIncidents(!loaded.has(view));
    if (view === 'resellers' && !loaded.has(view)) await loadResellers();
    if (view === 'audit' && !loaded.has(view)) await loadAudit();
    if (view === 'runbooks' && !loaded.has(view)) await loadRunbooks();
    loaded.add(view);
  }

  function navigate(view, detailId) {
    if (!titles[view]) view = 'overview';
    document.querySelectorAll('.view').forEach(function (node) { node.classList.toggle('active', node.dataset.panel === view); });
    document.querySelectorAll('.nav-item').forEach(function (node) { node.classList.toggle('active', node.dataset.view === view); });
    document.getElementById('view-title').textContent = titles[view][0];
    document.getElementById('view-subtitle').textContent = titles[view][1];
    const nextHash = '#' + view + (detailId ? '/' + encodeURIComponent(detailId) : '');
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
    document.querySelector('.sidebar').classList.remove('menu-open');
    document.getElementById('mobile-menu').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0);
    loadView(view).then(function () {
      if (view === 'runbooks') focusRunbook(detailId);
      if (view === 'incidents' && detailId) openIncident(detailId, false);
    }).catch(function (error) { show(error.message); });
  }

  document.getElementById('mobile-menu').addEventListener('click', function (event) { const open = document.querySelector('.sidebar').classList.toggle('menu-open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-view]').forEach(function (button) { button.addEventListener('click', function () { navigate(button.dataset.view); }); });
  document.querySelectorAll('[data-jump]').forEach(function (button) { button.addEventListener('click', function () { navigate(button.dataset.jump); }); });
  document.getElementById('refresh').addEventListener('click', async function (event) { const button = event.currentTarget; button.disabled = true; show('Refreshing current health...', true); try { await loadHealth(); const view = location.hash.slice(1).split('/')[0]; if (view === 'merchants') await loadMerchants(true); if (view === 'incidents') await loadIncidents(true); if (view === 'audit') await loadAudit(); } catch (error) { show(error.message); } finally { button.disabled = false; } });
  document.getElementById('merchant-filters').addEventListener('submit', function (event) { event.preventDefault(); loadMerchants(true).catch(function (error) { show(error.message); }); });
  document.getElementById('merchant-prev').addEventListener('click', function () { merchantOffset = Math.max(0, merchantOffset - merchantLimit); loadMerchants(false).catch(function (error) { show(error.message); }); });
  document.getElementById('merchant-next').addEventListener('click', function () { merchantOffset += merchantLimit; loadMerchants(false).catch(function (error) { show(error.message); }); });
  document.getElementById('include-resolved').addEventListener('change', function () { loadIncidents(true).catch(function (error) { show(error.message); }); });
  document.getElementById('more-incidents').addEventListener('click', function () { loadIncidents(false).catch(function (error) { show(error.message); }); });
  document.getElementById('close-merchant').addEventListener('click', function () { document.getElementById('merchant-dialog').close(); });
  document.getElementById('close-incident').addEventListener('click', function () { document.getElementById('incident-dialog').close(); history.replaceState(null, '', '#incidents'); });
  document.getElementById('cancel-suppress').addEventListener('click', function () { document.getElementById('suppress-dialog').close(); });
  document.getElementById('suppress-form').addEventListener('submit', async function (event) { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const hours = Math.max(1, Math.min(24, Number(values.get('hours')) || 1)); const button = form.querySelector('button[type="submit"]'); button.disabled = true; try { await post('/internal/operator/api/incidents/' + encodeURIComponent(suppressIncidentId) + '/suppress', { reason: values.get('reason'), until: new Date(Date.now() + hours * 3600000).toISOString() }); form.reset(); document.getElementById('suppress-dialog').close(); await loadIncidents(true); await loadHealth(); } catch (error) { show(error.message); } finally { button.disabled = false; } });
  document.getElementById('logout').addEventListener('click', async function () { try { await post('/internal/operator/auth/logout', {}); location.replace('/internal/operator/login'); } catch (error) { show(error.message); } });

  Promise.all([get('/internal/operator/api/session'), get('/internal/operator/api/health?limit=200')]).then(function (results) {
    session = results[0]; renderIdentity(session);
    const data = results[1]; health = { checks: data.checks || [], incidents: data.incidents || [], merchants: data.merchants || [], summary: data.summary || {}, generatedAt: data.generatedAt };
    renderSummary(); renderOverviewIncidents(); renderOverviewMerchants(); renderSystemGroups();
    renderChecks('money', 'money-checks', 'money-freshness'); renderChecks('fulfillment', 'fulfillment-checks', 'fulfillment-freshness'); renderChecks('recovery', 'recovery-checks', 'recovery-freshness');
    const current = freshness(data.generatedAt); const fresh = document.getElementById('freshness'); fresh.className = 'freshness ' + current.className; fresh.textContent = current.text;
    loadResellerFilter();
    const route = (location.hash.slice(1) || 'overview').split('/');
    loaded.add('overview'); navigate(route[0], route[1] ? decodeURIComponent(route.slice(1).join('/')) : '');
  }).catch(function (error) { if (error.status === 401) { location.replace('/internal/operator/login'); return; } show(error.message); });
})();`;
