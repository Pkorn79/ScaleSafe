function page(title: string, mode: 'login' | 'invite' | 'home'): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | ScaleSafe</title>
  <link rel="stylesheet" href="/internal/operator/assets/auth.css">
</head>
<body data-mode="${mode}">
  <main class="shell">
    <header><strong>ScaleSafe</strong><span>Command Center</span></header>
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
      ${mode === 'home' ? `
      <dl id="identity"><dt>Status</dt><dd>Loading</dd></dl>
      <button id="logout" type="button">Sign out</button>` : ''}
    </section>
  </main>
  <script src="/internal/operator/assets/auth.js" defer></script>
</body>
</html>`;
}

export const operatorLoginHtml = (): string => page('Operator sign in', 'login');
export const operatorInviteHtml = (): string => page('Accept invitation', 'invite');
export const operatorHomeHtml = (): string => page('Operator access', 'home');

export const operatorAuthCss = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #102033; background: #f4f7f8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
.shell { width: min(92vw, 440px); }
header { display: flex; align-items: baseline; gap: 10px; margin: 0 0 18px; }
header strong { font-size: 23px; color: #073f3a; }
header span { color: #526579; }
.panel { background: #fff; border: 1px solid #dce5e8; border-radius: 8px; padding: 28px; box-shadow: 0 14px 34px rgba(16,32,51,.08); }
h1 { margin: 0 0 22px; font-size: 25px; letter-spacing: 0; }
form, #enroll { display: grid; gap: 16px; }
label { display: grid; gap: 7px; color: #34475a; font-size: 14px; font-weight: 600; }
input { width: 100%; border: 1px solid #aebdc5; border-radius: 6px; padding: 11px 12px; font: inherit; }
input:focus { outline: 3px solid rgba(0,151,122,.18); border-color: #007c68; }
button { min-height: 42px; border: 0; border-radius: 6px; padding: 10px 15px; background: #007c68; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
button:disabled { opacity: .6; cursor: wait; }
.status { min-height: 20px; margin: -10px 0 16px; color: #b42318; font-size: 14px; }
#qr { width: 220px; height: 220px; margin: 0 auto; }
dl { display: grid; grid-template-columns: 110px 1fr; gap: 10px; margin: 0 0 24px; }
dt { color: #637486; }
dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; }
[hidden] { display: none !important; }
`;

export const operatorAuthJs = `'use strict';
(function () {
  const mode = document.body.dataset.mode;
  const status = document.getElementById('status');
  function show(message, ok) { status.textContent = message || ''; status.style.color = ok ? '#067647' : '#b42318'; }
  async function call(path, body, csrf) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrf;
    const response = await fetch(path, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body || {}) });
    const payload = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.message || 'Request failed');
    return payload;
  }
  function cookie(name) {
    const prefix = name + '=';
    const item = document.cookie.split(';').map(function (part) { return part.trim(); }).find(function (part) { return part.indexOf(prefix) === 0; });
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }
  function renderIdentity(data) {
    const identity = document.getElementById('identity');
    identity.replaceChildren();
    [
      ['Role', data.role],
      ['Organization', data.organizationId],
      ['Assurance', data.authAssurance]
    ].forEach(function (entry) {
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = String(entry[0] || '');
      value.textContent = String(entry[1] || '');
      identity.append(term, value);
    });
  }
  if (mode === 'login') {
    const login = document.getElementById('login-form');
    const mfa = document.getElementById('mfa-form');
    const enroll = document.getElementById('enroll');
    login.addEventListener('submit', async function (event) {
      event.preventDefault(); show('');
      const button = login.querySelector('button'); button.disabled = true;
      try {
        const form = new FormData(login);
        const result = await call('/internal/operator/auth/start', { email: form.get('email'), password: form.get('password') });
        login.hidden = true;
        if (result.next === 'mfa_enroll') {
          const setup = await call('/internal/operator/auth/mfa/enroll', {});
          document.getElementById('qr').src = 'data:image/svg+xml;utf-8,' + encodeURIComponent(setup.qrCode);
          document.getElementById('secret').value = setup.secret;
          enroll.hidden = false;
        }
        mfa.hidden = false;
      } catch (error) { show(error.message); button.disabled = false; }
    });
    mfa.addEventListener('submit', async function (event) {
      event.preventDefault(); show('');
      const button = mfa.querySelector('button'); button.disabled = true;
      try {
        const form = new FormData(mfa);
        await call('/internal/operator/auth/mfa/verify', { code: form.get('code') });
        location.replace('/internal/operator/home');
      } catch (error) { show(error.message); button.disabled = false; }
    });
  }
  if (mode === 'invite') {
    const form = document.getElementById('invite-form');
    const invitationToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
    if (!invitationToken) show('This invitation link is incomplete.');
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); show('');
      const button = form.querySelector('button'); button.disabled = true;
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
      } catch (error) { show(error.message); button.disabled = false; }
    });
  }
  if (mode === 'home') {
    fetch('/internal/operator/api/session', { credentials: 'same-origin' }).then(async function (response) {
      if (response.status === 401) { location.replace('/internal/operator/login'); return null; }
      if (!response.ok) throw new Error('Could not load operator session');
      return response.json();
    }).then(function (data) {
      if (!data) return;
      renderIdentity(data);
    }).catch(function (error) { show(error.message); });
    document.getElementById('logout').addEventListener('click', async function () {
      try {
        await call('/internal/operator/auth/logout', {}, cookie('__Host-scalesafe_ops_csrf'));
        location.replace('/internal/operator/login');
      } catch (error) { show(error.message); }
    });
  }
})();`;
