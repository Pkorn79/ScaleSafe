(function () {
  var script = document.currentScript;
  var apiBase = script && script.getAttribute('data-api-base');
  if (!apiBase && script && script.src) {
    try { apiBase = new URL(script.src).origin; } catch (_) {}
  }
  apiBase = (apiBase || 'https://scalesafe-production.up.railway.app').replace(/\/$/, '');

  var containerId = script && script.getAttribute('data-container');
  var root = (containerId && document.getElementById(containerId))
    || document.getElementById('scalesafe-milestone-signoff');
  if (!root) {
    root = document.createElement('div');
    root.id = 'scalesafe-milestone-signoff';
    document.body.appendChild(root);
  }

  var token = new URLSearchParams(window.location.search).get('actionToken')
    || new URLSearchParams(window.location.search).get('token')
    || '';

  var styles = document.createElement('style');
  styles.textContent = [
    '.ss-ms{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2937;max-width:560px;margin:0 auto}',
    '.ss-ms-card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:16px 0}',
    '.ss-ms-title{font-size:22px;font-weight:650;margin:0 0 4px}',
    '.ss-ms-sub{color:#6b7280;font-size:14px;margin:0 0 18px}',
    '.ss-ms-label{display:block;font-size:12px;font-weight:650;color:#6b7280;margin:12px 0 6px;text-transform:uppercase}',
    '.ss-ms-text{font-size:14px;line-height:1.5;color:#374151;white-space:pre-wrap}',
    '.ss-ms-input{width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:16px}',
    '.ss-ms-check{display:flex;gap:9px;align-items:flex-start;font-size:14px;margin:14px 0}',
    '.ss-ms-check input{width:18px;height:18px;margin-top:2px}',
    '.ss-ms-btn{width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:650;cursor:pointer}',
    '.ss-ms-btn:disabled{background:#93c5fd;cursor:not-allowed}',
    '.ss-ms-status{padding:14px;border-radius:8px;margin-top:14px;font-size:14px}',
    '.ss-ms-ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}',
    '.ss-ms-err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}',
  ].join('');
  document.head.appendChild(styles);

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function render(html) {
    root.innerHTML = '<div class="ss-ms">' + html + '</div>';
  }

  function showError(message) {
    render('<div class="ss-ms-status ss-ms-err">' + escapeHtml(message) + '</div>');
  }

  function updateSubmitState() {
    var checked = document.getElementById('ss-ms-confirm').checked;
    var signed = document.getElementById('ss-ms-signature').value.trim();
    document.getElementById('ss-ms-submit').disabled = !(checked && signed);
  }

  async function submitSignoff() {
    var btn = document.getElementById('ss-ms-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    var error = document.getElementById('ss-ms-error');
    error.style.display = 'none';
    try {
      var res = await fetch(apiBase + '/api/milestone-signoff/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionToken: token,
          signature: document.getElementById('ss-ms-signature').value.trim()
        })
      });
      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Sign-off failed');
      render('<div class="ss-ms-status ss-ms-ok">Milestone signed off. Thank you.</div>');
    } catch (err) {
      error.textContent = err.message || 'Sign-off failed.';
      error.style.display = 'block';
      btn.textContent = 'Submit Sign-Off';
      updateSubmitState();
    }
  }

  async function load() {
    if (!token) {
      showError('Invalid sign-off link.');
      return;
    }

    render('<div class="ss-ms-status">Loading...</div>');
    try {
      var res = await fetch(apiBase + '/api/milestone-signoff/config?actionToken=' + encodeURIComponent(token));
      var data = await res.json();
      if (data.error) throw new Error(data.error);

      render(
        '<h1 class="ss-ms-title">Milestone Sign-Off</h1>' +
        '<p class="ss-ms-sub">' + escapeHtml(data.merchantName || '') + '</p>' +
        '<div class="ss-ms-card">' +
        '<div class="ss-ms-label">Milestone</div>' +
        '<div class="ss-ms-text">Milestone ' + escapeHtml(data.milestoneNumber) + ': ' + escapeHtml(data.milestoneName) + '</div>' +
        (data.delivers ? '<div class="ss-ms-label">Work Delivered</div><div class="ss-ms-text">' + escapeHtml(data.delivers) + '</div>' : '') +
        (data.clientDoes ? '<div class="ss-ms-label">Client Responsibility</div><div class="ss-ms-text">' + escapeHtml(data.clientDoes) + '</div>' : '') +
        '</div>' +
        '<label class="ss-ms-check"><input type="checkbox" id="ss-ms-confirm"> <span>I acknowledge that the work described above for this milestone has been delivered to my satisfaction. I understand this sign-off is being recorded.</span></label>' +
        '<label class="ss-ms-label" for="ss-ms-signature">Your Signature</label>' +
        '<input class="ss-ms-input" id="ss-ms-signature" type="text" autocomplete="name">' +
        '<button class="ss-ms-btn" id="ss-ms-submit" disabled>Submit Sign-Off</button>' +
        '<div class="ss-ms-status ss-ms-err" id="ss-ms-error" style="display:none"></div>'
      );
      document.getElementById('ss-ms-confirm').addEventListener('change', updateSubmitState);
      document.getElementById('ss-ms-signature').addEventListener('input', updateSubmitState);
      document.getElementById('ss-ms-submit').addEventListener('click', submitSignoff);
    } catch (err) {
      showError(err.message || 'Failed to load milestone sign-off.');
    }
  }

  load();
})();
