function page(title: string, mode: 'login' | 'invite' | 'home'): string {
  const home = mode === 'home';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | ScaleSafe</title>
  <link rel="stylesheet" href="/internal/operator/assets/auth.css">
</head>
<body data-mode="${mode}">
  <main class="${home ? 'command-shell' : 'auth-shell'}">
    <header class="brand-bar">
      <div><strong>ScaleSafe</strong><span>Command Center</span></div>
      ${home ? '<button id="logout" class="secondary compact" type="button">Sign out</button>' : ''}
    </header>
    ${home ? `
    <section class="command-panel">
      <div class="command-heading">
        <div>
          <p class="eyebrow">Platform operations</p>
          <h1>System health</h1>
          <p id="status" class="status" aria-live="polite"></p>
        </div>
        <button id="refresh-health" class="secondary" type="button">Refresh</button>
      </div>

      <dl id="identity" class="identity"><dt>Status</dt><dd>Loading</dd></dl>

      <section id="health-disabled" class="notice" hidden>
        Health monitoring is not enabled in this environment.
      </section>

      <div id="health-workspace" hidden>
        <section id="health-summary" class="summary-grid" aria-label="Health summary"></section>

        <section class="data-section">
          <div class="section-heading">
            <div><h2>Active incidents</h2><p>Failures requiring operator awareness or action.</p></div>
            <span id="incident-count" class="count"></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Severity</th><th>Incident</th><th>Scope</th><th>Status</th><th>Last seen</th><th>Action</th></tr></thead>
              <tbody id="incident-rows"></tbody>
            </table>
          </div>
          <div class="pager"><button id="more-incidents" class="secondary compact" type="button" hidden>Load more</button></div>
        </section>

        <section class="data-section">
          <div class="section-heading">
            <div><h2>Merchant health</h2><p>Current rollups across installation, money, workflows, evidence, defense, and billing.</p></div>
            <span id="merchant-count" class="count"></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Merchant</th><th>Overall</th><th>Attention</th><th>Components</th><th>Reconciled</th></tr></thead>
              <tbody id="merchant-rows"></tbody>
            </table>
          </div>
          <div class="pager"><button id="more-merchants" class="secondary compact" type="button" hidden>Load more</button></div>
        </section>

        <section class="data-section">
          <div class="section-heading">
            <div><h2>Platform checks</h2><p>Workers, scheduled jobs, queues, database, application, and provider dependencies.</p></div>
            <span id="check-count" class="count"></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>State</th><th>Check</th><th>Scope</th><th>Summary</th><th>Observed</th></tr></thead>
              <tbody id="check-rows"></tbody>
            </table>
          </div>
          <div class="pager"><button id="more-checks" class="secondary compact" type="button" hidden>Load more</button></div>
        </section>
      </div>
    </section>

    <dialog id="suppress-dialog">
      <form id="suppress-form" method="dialog">
        <h2>Suppress incident</h2>
        <p>Health evaluation continues. Only operator notification state is suppressed.</p>
        <label>Reason<textarea name="reason" maxlength="500" required></textarea></label>
        <label>Duration
          <select name="hours">
            <option value="1">1 hour</option>
            <option value="4">4 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
          </select>
        </label>
        <div class="dialog-actions">
          <button id="cancel-suppress" class="secondary" type="button">Cancel</button>
          <button type="submit">Suppress</button>
        </div>
      </form>
    </dialog>` : `
    <section class="panel">
      <h1>${title}</h1>
      <p id="status" class="status" aria-live="polite"></p>
      ${mode === 'login' ? `
      <form id="login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Continue</button>
      </form>
      <section id="enroll" hidden>
        <p>Scan this code with your authenticator app, then enter the six-digit code.</p>
        <img id="qr" alt="Authenticator QR code">
        <label>Manual key<input id="secret" type="password" readonly></label>
      </section>
      <form id="mfa-form" hidden>
        <label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label>
        <button type="submit">Sign in</button>
      </form>` : ''}
      ${mode === 'invite' ? `
      <form id="invite-form">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Name<input name="displayName" autocomplete="name" required></label>
        <label>Create password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
        <button type="submit">Accept invitation</button>
      </form>` : ''}
    </section>`}
  </main>
  <script src="/internal/operator/assets/auth.js" defer></script>
</body>
</html>`;
}

export const operatorLoginHtml = (): string => page('Operator sign in', 'login');
export const operatorInviteHtml = (): string => page('Accept invitation', 'invite');
export const operatorHomeHtml = (): string => page('System health', 'home');

export const operatorAuthCss = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #102033; background: #f4f7f8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
.auth-shell { width: min(92vw, 440px); margin: 10vh auto; }
.command-shell { width: min(96vw, 1480px); margin: 28px auto 60px; }
.brand-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 18px; }
.brand-bar > div { display: flex; align-items: baseline; gap: 10px; }
.brand-bar strong { font-size: 23px; color: #073f3a; }
.brand-bar span { color: #526579; }
.panel { background: #fff; border: 1px solid #dce5e8; border-radius: 8px; padding: 28px; box-shadow: 0 14px 34px rgba(16,32,51,.08); }
.command-panel { background: #fff; border: 1px solid #dce5e8; border-radius: 8px; overflow: hidden; box-shadow: 0 14px 34px rgba(16,32,51,.07); }
.command-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 26px 28px 18px; border-bottom: 1px solid #e6ecee; }
h1 { margin: 0 0 16px; font-size: 25px; letter-spacing: 0; }
.command-heading h1 { margin: 0; font-size: 28px; }
h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
.eyebrow { margin: 0 0 6px; color: #087d69; font-size: 12px; font-weight: 800; text-transform: uppercase; }
form, #enroll { display: grid; gap: 16px; }
label { display: grid; gap: 7px; color: #34475a; font-size: 14px; font-weight: 600; }
input, textarea, select { width: 100%; border: 1px solid #aebdc5; border-radius: 6px; padding: 11px 12px; background: #fff; color: #102033; font: inherit; }
textarea { min-height: 92px; resize: vertical; }
input:focus, textarea:focus, select:focus { outline: 3px solid rgba(0,151,122,.18); border-color: #007c68; }
button { min-height: 42px; border: 0; border-radius: 6px; padding: 10px 15px; background: #007c68; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
button.secondary { border: 1px solid #9fb2ba; background: #fff; color: #18384b; }
button.compact { min-height: 36px; padding: 7px 12px; }
button:disabled { opacity: .6; cursor: wait; }
.status { min-height: 20px; margin: 6px 0 0; color: #b42318; font-size: 14px; }
.panel .status { margin: -10px 0 16px; }
#qr { width: 220px; height: 220px; margin: 0 auto; }
.identity { display: flex; gap: 18px; margin: 0; padding: 12px 28px; border-bottom: 1px solid #e6ecee; background: #f8fafb; font-size: 13px; }
.identity div { display: flex; gap: 6px; }
.identity dt { color: #637486; }
.identity dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 20px 28px; border-bottom: 1px solid #e6ecee; }
.summary-item { min-height: 104px; border: 1px solid #dce5e8; border-radius: 6px; padding: 17px; }
.summary-item strong { display: block; margin-top: 9px; font-size: 27px; }
.summary-item span { color: #607284; font-size: 12px; font-weight: 800; text-transform: uppercase; }
.summary-item small { display: block; margin-top: 7px; color: #607284; }
.notice { margin: 22px 28px; border-left: 4px solid #d4a72c; padding: 14px 16px; background: #fff9e8; }
.data-section { padding: 24px 28px; border-bottom: 1px solid #e6ecee; }
.data-section:last-child { border-bottom: 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.section-heading p { margin: 5px 0 0; color: #607284; font-size: 13px; }
.count { color: #607284; font-size: 13px; white-space: nowrap; }
.table-wrap { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { padding: 9px 10px; border-bottom: 1px solid #cfdadd; color: #607284; text-align: left; font-size: 11px; text-transform: uppercase; }
td { padding: 12px 10px; border-bottom: 1px solid #edf1f2; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.primary-text { display: block; font-weight: 750; }
.secondary-text { display: block; margin-top: 4px; color: #607284; font-size: 12px; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 3px 8px; background: #e8eef1; color: #314859; font-size: 11px; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
.badge.healthy, .badge.resolved { background: #dcf8ea; color: #087443; }
.badge.degraded, .badge.warning, .badge.acknowledged { background: #fff0c7; color: #805d00; }
.badge.unhealthy, .badge.urgent, .badge.open { background: #ffe3df; color: #a93226; }
.badge.critical { background: #b42318; color: #fff; }
.badge.unknown, .badge.info, .badge.suppressed { background: #e8eef1; color: #43596a; }
.component-list { display: flex; flex-wrap: wrap; gap: 5px; min-width: 280px; }
.row-actions { display: flex; gap: 7px; min-width: 150px; }
.row-actions button { min-height: 32px; padding: 5px 9px; font-size: 12px; }
.pager { display: flex; justify-content: center; padding: 12px 0 2px; }
.empty { padding: 24px 10px; color: #607284; text-align: center; }
dialog { width: min(92vw, 480px); border: 1px solid #cad6da; border-radius: 8px; padding: 24px; box-shadow: 0 22px 60px rgba(16,32,51,.25); }
dialog::backdrop { background: rgba(7,31,43,.42); }
dialog h2 { margin-bottom: 8px; }
dialog p { margin: 0 0 16px; color: #607284; font-size: 13px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 9px; }
[hidden] { display: none !important; }
@media (max-width: 880px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .command-heading, .identity, .summary-grid, .data-section { padding-left: 18px; padding-right: 18px; }
  .identity { flex-wrap: wrap; }
}
@media (max-width: 540px) {
  .command-shell { width: 100%; margin: 0; }
  .brand-bar { padding: 14px 16px; margin: 0; }
  .command-panel { border-left: 0; border-right: 0; border-radius: 0; }
  .summary-grid { grid-template-columns: 1fr; }
  .command-heading { align-items: flex-start; }
}
`;

export const operatorAuthJs = `'use strict';
(function () {
  const mode = document.body.dataset.mode;
  const status = document.getElementById('status');
  let session = null;
  let suppressIncidentId = '';
  let healthState = { checks: [], incidents: [], merchants: [] };
  let healthCursors = { checks: null, incidents: null, merchants: null };

  function show(message, ok) {
    status.textContent = message || '';
    status.style.color = ok ? '#067647' : '#b42318';
  }

  async function call(path, body, csrf) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrf;
    const response = await fetch(path, {
      method: 'POST',
      headers: headers,
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    });
    const payload = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.message || 'Request failed');
    return payload;
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

  function cookie(name) {
    const prefix = name + '=';
    const item = document.cookie.split(';').map(function (part) {
      return part.trim();
    }).find(function (part) {
      return part.indexOf(prefix) === 0;
    });
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function badge(value) {
    return element('span', 'badge ' + String(value || 'unknown').toLowerCase(), value || 'unknown');
  }

  function formatTime(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not recorded';
  }

  function emptyRow(target, columns, message) {
    const row = element('tr');
    const cell = element('td', 'empty', message);
    cell.colSpan = columns;
    row.appendChild(cell);
    target.appendChild(row);
  }

  function renderIdentity(data) {
    const identity = document.getElementById('identity');
    identity.replaceChildren();
    [
      ['Role', data.role],
      ['Organization', data.organizationId],
      ['Assurance', data.authAssurance]
    ].forEach(function (entry) {
      const group = element('div');
      group.append(element('dt', '', entry[0]), element('dd', '', entry[1]));
      identity.appendChild(group);
    });
  }

  function renderSummary(data) {
    const incidents = data.incidents || [];
    const merchants = data.merchants || [];
    const checks = data.checks || [];
    const items = [
      ['Active incidents', incidents.length, incidents.filter(function (item) { return item.severity === 'critical'; }).length + ' critical'],
      ['Merchant attention', merchants.filter(function (item) { return Number(item.needs_attention_count) > 0; }).length, merchants.length + ' rollups'],
      ['Unhealthy checks', checks.filter(function (item) { return item.state === 'unhealthy'; }).length, checks.filter(function (item) { return item.state === 'degraded'; }).length + ' degraded'],
      ['Contract', data.contractVersion || 'Unknown', 'Updated ' + formatTime(data.generatedAt)]
    ];
    const target = document.getElementById('health-summary');
    target.replaceChildren();
    items.forEach(function (item) {
      const card = element('div', 'summary-item');
      card.append(element('span', '', item[0]), element('strong', '', item[1]), element('small', '', item[2]));
      target.appendChild(card);
    });
  }

  function renderIncidents(items) {
    const target = document.getElementById('incident-rows');
    target.replaceChildren();
    document.getElementById('incident-count').textContent = items.length + ' active';
    if (!items.length) {
      emptyRow(target, 6, 'No active incidents.');
      return;
    }
    const canManage = session && (session.role === 'platform_owner' || session.role === 'platform_ops');
    items.forEach(function (item) {
      const row = element('tr');
      const severity = element('td');
      severity.appendChild(badge(item.severity));
      const incident = element('td');
      incident.append(element('span', 'primary-text', item.title), element('span', 'secondary-text', item.summary));
      const scope = element('td');
      scope.append(element('span', 'primary-text', item.scope_type), element('span', 'secondary-text', item.location_id || item.scope_id));
      const state = element('td');
      state.appendChild(badge(item.status));
      if (item.parent_incident_id) state.appendChild(element('span', 'secondary-text', 'Linked to provider incident'));
      const seen = element('td', '', formatTime(item.last_seen_at));
      const actions = element('td');
      const actionWrap = element('div', 'row-actions');
      if (canManage && item.status === 'open') {
        const acknowledge = element('button', '', 'Acknowledge');
        acknowledge.type = 'button';
        acknowledge.addEventListener('click', async function () {
          acknowledge.disabled = true;
          try {
            await call(
              '/internal/operator/api/incidents/' + encodeURIComponent(item.id) + '/acknowledge',
              { summary: 'Acknowledged from the Command Center.' },
              cookie('__Host-scalesafe_ops_csrf')
            );
            await loadHealth();
          } catch (error) {
            show(error.message);
            acknowledge.disabled = false;
          }
        });
        actionWrap.appendChild(acknowledge);
      }
      if (canManage && item.suppressible && item.severity !== 'critical' && item.status !== 'suppressed') {
        const suppress = element('button', 'secondary', 'Suppress');
        suppress.type = 'button';
        suppress.addEventListener('click', function () {
          suppressIncidentId = item.id;
          document.getElementById('suppress-dialog').showModal();
        });
        actionWrap.appendChild(suppress);
      }
      if (!actionWrap.childNodes.length) actionWrap.appendChild(element('span', 'secondary-text', 'Read only'));
      actions.appendChild(actionWrap);
      row.append(severity, incident, scope, state, seen, actions);
      target.appendChild(row);
    });
  }

  function renderMerchants(items) {
    const target = document.getElementById('merchant-rows');
    target.replaceChildren();
    document.getElementById('merchant-count').textContent = items.length + ' shown';
    if (!items.length) {
      emptyRow(target, 5, 'No merchant health rollups are available yet.');
      return;
    }
    items.forEach(function (item) {
      const row = element('tr');
      const merchant = element('td');
      merchant.append(
        element('span', 'primary-text', item.merchant_name || item.location_id),
        element('span', 'secondary-text', item.location_id)
      );
      const overall = element('td');
      overall.appendChild(badge(item.overall_state));
      const attention = element('td', '', String(item.needs_attention_count || 0));
      const components = element('td');
      const componentList = element('div', 'component-list');
      [
        ['Install', item.installation_state],
        ['Money', item.processor_state],
        ['Workflow', item.workflow_state],
        ['Evidence', item.evidence_state],
        ['Defense', item.defense_state],
        ['Billing', item.billing_state]
      ].forEach(function (component) {
        const value = badge(component[1]);
        value.textContent = component[0] + ': ' + component[1];
        componentList.appendChild(value);
      });
      components.appendChild(componentList);
      row.append(merchant, overall, attention, components, element('td', '', formatTime(item.last_reconciled_at)));
      target.appendChild(row);
    });
  }

  function renderChecks(items) {
    const target = document.getElementById('check-rows');
    target.replaceChildren();
    document.getElementById('check-count').textContent = items.length + ' checks';
    if (!items.length) {
      emptyRow(target, 5, 'No health checks have been evaluated yet.');
      return;
    }
    items.forEach(function (item) {
      const row = element('tr');
      const state = element('td');
      state.appendChild(badge(item.state));
      const check = element('td');
      check.append(element('span', 'primary-text', item.check_key), element('span', 'secondary-text', item.failure_class || 'No failure class'));
      row.append(
        state,
        check,
        element('td', '', item.scope_type + ': ' + item.scope_id),
        element('td', '', item.summary),
        element('td', '', formatTime(item.last_observed_at))
      );
      target.appendChild(row);
    });
  }

  function appendUnique(existing, incoming, key) {
    const seen = new Set(existing.map(function (item) { return String(item[key]); }));
    return existing.concat(incoming.filter(function (item) {
      const value = String(item[key]);
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    }));
  }

  function updatePagerButtons() {
    document.getElementById('more-incidents').hidden = !healthCursors.incidents;
    document.getElementById('more-merchants').hidden = !healthCursors.merchants;
    document.getElementById('more-checks').hidden = !healthCursors.checks;
  }

  async function loadHealth(reset, section) {
    if (reset === undefined) reset = true;
    const refresh = document.getElementById('refresh-health');
    refresh.disabled = true;
    show('Loading current health...', true);
    try {
      let url = '/internal/operator/api/health?limit=200';
      if (!reset && section && healthCursors[section]) {
        url += '&' + encodeURIComponent(section + 'Cursor') + '='
          + encodeURIComponent(healthCursors[section]);
      }
      const data = await get(url);
      if (reset) {
        healthState = {
          checks: data.checks || [],
          incidents: data.incidents || [],
          merchants: data.merchants || []
        };
        healthCursors = {
          checks: data.pagination && data.pagination.checksCursor,
          incidents: data.pagination && data.pagination.incidentsCursor,
          merchants: data.pagination && data.pagination.merchantsCursor
        };
      } else if (section === 'checks') {
        healthState.checks = appendUnique(healthState.checks, data.checks || [], 'id');
        healthCursors.checks = data.pagination && data.pagination.checksCursor;
      } else if (section === 'incidents') {
        healthState.incidents = appendUnique(healthState.incidents, data.incidents || [], 'id');
        healthCursors.incidents = data.pagination && data.pagination.incidentsCursor;
      } else if (section === 'merchants') {
        healthState.merchants = appendUnique(
          healthState.merchants,
          data.merchants || [],
          'location_id'
        );
        healthCursors.merchants = data.pagination && data.pagination.merchantsCursor;
      }
      document.getElementById('health-disabled').hidden = true;
      document.getElementById('health-workspace').hidden = false;
      renderSummary({
        incidents: healthState.incidents,
        merchants: healthState.merchants,
        checks: healthState.checks,
        contractVersion: data.contractVersion,
        generatedAt: data.generatedAt
      });
      renderIncidents(healthState.incidents);
      renderMerchants(healthState.merchants);
      renderChecks(healthState.checks);
      updatePagerButtons();
      show('Current as of ' + formatTime(data.generatedAt), true);
    } catch (error) {
      if (error.status === 404) {
        document.getElementById('health-workspace').hidden = true;
        document.getElementById('health-disabled').hidden = false;
        show('');
      } else {
        show(error.message);
      }
    } finally {
      refresh.disabled = false;
    }
  }

  if (mode === 'login') {
    const login = document.getElementById('login-form');
    const mfa = document.getElementById('mfa-form');
    const enroll = document.getElementById('enroll');
    login.addEventListener('submit', async function (event) {
      event.preventDefault();
      show('');
      const button = login.querySelector('button');
      button.disabled = true;
      try {
        const form = new FormData(login);
        const result = await call('/internal/operator/auth/start', {
          email: form.get('email'),
          password: form.get('password')
        });
        login.hidden = true;
        if (result.next === 'mfa_enroll') {
          const setup = await call('/internal/operator/auth/mfa/enroll', {});
          document.getElementById('qr').src = 'data:image/svg+xml;utf-8,' + encodeURIComponent(setup.qrCode);
          document.getElementById('secret').value = setup.secret;
          enroll.hidden = false;
        }
        mfa.hidden = false;
      } catch (error) {
        show(error.message);
        button.disabled = false;
      }
    });
    mfa.addEventListener('submit', async function (event) {
      event.preventDefault();
      show('');
      const button = mfa.querySelector('button');
      button.disabled = true;
      try {
        const form = new FormData(mfa);
        await call('/internal/operator/auth/mfa/verify', { code: form.get('code') });
        location.replace('/internal/operator/home');
      } catch (error) {
        show(error.message);
        button.disabled = false;
      }
    });
  }

  if (mode === 'invite') {
    const form = document.getElementById('invite-form');
    const invitationToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
    if (!invitationToken) show('This invitation link is incomplete.');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      show('');
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const values = new FormData(form);
        await call('/internal/operator/auth/invitations/accept', {
          invitationToken: invitationToken,
          email: values.get('email'),
          displayName: values.get('displayName'),
          password: values.get('password')
        });
        history.replaceState(null, '', location.pathname);
        form.hidden = true;
        show('Invitation accepted. You can now sign in.', true);
      } catch (error) {
        show(error.message);
        button.disabled = false;
      }
    });
  }

  if (mode === 'home') {
    get('/internal/operator/api/session').then(function (data) {
      session = data;
      renderIdentity(data);
      return loadHealth(true);
    }).catch(function (error) {
      if (error.status === 401) {
        location.replace('/internal/operator/login');
        return;
      }
      show(error.message);
    });

    document.getElementById('refresh-health').addEventListener('click', function () {
      return loadHealth(true);
    });
    document.getElementById('more-incidents').addEventListener('click', function () {
      return loadHealth(false, 'incidents');
    });
    document.getElementById('more-merchants').addEventListener('click', function () {
      return loadHealth(false, 'merchants');
    });
    document.getElementById('more-checks').addEventListener('click', function () {
      return loadHealth(false, 'checks');
    });
    document.getElementById('logout').addEventListener('click', async function () {
      try {
        await call('/internal/operator/auth/logout', {}, cookie('__Host-scalesafe_ops_csrf'));
        location.replace('/internal/operator/login');
      } catch (error) {
        show(error.message);
      }
    });

    const dialog = document.getElementById('suppress-dialog');
    document.getElementById('cancel-suppress').addEventListener('click', function () {
      dialog.close();
    });
    document.getElementById('suppress-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const hours = Math.max(1, Math.min(24, Number(form.get('hours')) || 1));
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await call(
          '/internal/operator/api/incidents/' + encodeURIComponent(suppressIncidentId) + '/suppress',
          { reason: form.get('reason'), until: until.toISOString() },
          cookie('__Host-scalesafe_ops_csrf')
        );
        event.currentTarget.reset();
        dialog.close();
        await loadHealth(true);
      } catch (error) {
        show(error.message);
      } finally {
        submit.disabled = false;
      }
    });
  }
})();`;
