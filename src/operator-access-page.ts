export function operatorAccessHtml(product: 'enrollments' | 'evidence'): string {
  const name = product === 'enrollments' ? 'Enrollments' : 'Evidence';
  return `<section class="surface access-surface" aria-label="${name} plans and access">
    <div class="section-heading"><div><h2>Merchant accounts · Plans &amp; access</h2><p>ScaleSafe ${name} only. Approval is tied to the exact installed GHL sub-account.</p></div></div>
    <p id="${product}-access-summary" class="access-summary" role="status">Loading installation access.</p>
    <form id="${product}-access-filters" class="access-filters">
      <label>Search ${name} merchants<input name="query" type="search" maxlength="100" placeholder="${product === 'enrollments' ? 'HighLevel name, business name or location ID' : 'GHL location ID'}"></label>
      <label>Access status<select name="status"><option value="all">All accounts</option><option value="pending">Approval needed</option><option value="active">Access active</option><option value="disconnected">Not installed / inactive</option></select></label>
      <button type="submit">Apply</button>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Merchant</th><th>Plan</th><th>Billing</th><th>Access</th><th>Approval recorded</th><th>Action</th></tr></thead><tbody id="${product}-access-rows"></tbody></table></div>
    <div class="pager"><button id="${product}-access-prev" class="secondary-button" type="button" disabled>Previous</button><span id="${product}-access-page"></span><button id="${product}-access-next" class="secondary-button" type="button" disabled>Next</button></div>
  </section>`;
}
export const operatorAccessDialog = `<dialog id="access-dialog"><div class="dialog-heading"><div><p id="access-product" class="eyebrow"></p><h2 id="access-title">Merchant access</h2></div><button id="access-close" class="quiet-button" type="button">Close</button></div><div id="access-detail" class="access-detail"></div></dialog>`;
export const operatorAccessCss = `
.access-surface { border-top: 3px solid #007c68; }
.access-summary { margin: 14px 18px 16px; color: #17384b; font-size: 14px; }
.access-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin: 0 18px 18px; }
.access-filters label { display: grid; gap: 6px; font-size: 12px; min-width: 180px; flex: 1; }
.access-detail { padding: 0 22px 22px; }
.access-detail form { padding: 18px 0 0; }
.access-detail form label { display: grid; gap: 7px; font-size: 13px; }
.access-detail .access-confirm { display: flex; align-items: flex-start; gap: 9px; }
.access-confirm input { width: auto; min-height: 20px; }
.access-notice { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.location-identity { display: grid; gap: 4px; min-width: 190px; max-width: 400px; overflow-wrap: anywhere; white-space: normal; }
#access-title, #merchant-dialog-title { font-size: 20px; overflow-wrap: anywhere; }
.detail-grid strong { overflow-wrap: anywhere; }
.health-details > summary { cursor: pointer; padding: 16px; font-weight: 700; }
.health-details[open] { display: grid; gap: 16px; }
@media(max-width:500px) { .access-filters { display: grid; } }
`;

// Runs inside the Command Center closure, sharing its safe DOM and CSRF helpers.
export const operatorAccessJs = `
  const accessStates = { enrollments: { offset: 0, request: 0 }, evidence: { offset: 0, request: 0 } };
  let accessBusy = false;
  let accessDialogRequest = 0;
  function productName(product) { return product === 'evidence' ? 'ScaleSafe Evidence' : 'ScaleSafe Enrollments'; }
  function billingLabel(value) { return ({ not_applicable: 'No subscription charge', complete: 'Payment confirmed', pending: 'Payment pending', failed: 'Payment failed', unknown: 'Not verified' })[value] || 'Not verified'; }
  function locationTitle(item) { return item.identity && item.identity.displayName || 'HighLevel name unavailable'; }
  function appendLocationIdentity(target, item) {
    const identity = item.identity || {};
    const wrapper = element('div', 'location-identity');
    wrapper.append(element('span', 'primary-text', locationTitle(item)), element('span', 'secondary-text', 'Location ID: ' + (item.locationId || item.location_id)));
    wrapper.appendChild(element('span', 'secondary-text', identity.status === 'verified' ? 'Verified ' + formatTime(identity.verifiedAt) : identity.status === 'stale' ? 'Stale name; last verified ' + formatTime(identity.verifiedAt) : 'Name not currently verified'));
    const business = item.businessName || item.business_name;
    if (business) wrapper.appendChild(element('span', 'secondary-text', 'Business: ' + business));
    target.appendChild(wrapper);
  }
  function identityDetail(item) {
    const identity = item.identity || {};
    return detailSection('HighLevel sub-account identity', [
      ['Location ID', item.locationId || item.location_id], ['HighLevel name', locationTitle(item)],
      ['Name status', identity.status || 'unavailable'], ['Source', identity.source === 'ghl_location_api' ? 'HighLevel location API' : 'Not verified'],
      ['Last verified', identity.verifiedAt ? formatTime(identity.verifiedAt) : 'Never'],
      ['Last checked', identity.checkedAt ? formatTime(identity.checkedAt) : 'Never'],
      ['Authorization', identity.authorization === 'authorized' ? 'Credentials bound to this location; setup health is separate' : 'Incomplete'],
      ['Lookup result', identity.reason ? identity.reason.replaceAll('_', ' ') : 'Verified'],
      ['Merchant business name', item.businessName || item.business_name]
    ]);
  }
  async function loadAccess(product, reset) {
    const state = accessStates[product];
    if (reset) state.offset = 0;
    const requestId = ++state.request;
    const form = new FormData(document.getElementById(product + '-access-filters'));
    const rows = document.getElementById(product + '-access-rows');
    const summary = document.getElementById(product + '-access-summary');
    const previous = document.getElementById(product + '-access-prev');
    const next = document.getElementById(product + '-access-next');
    rows.replaceChildren(); emptyRow(rows, 6, 'Loading current access...');
    summary.textContent = 'Checking current installation access...';
    previous.disabled = true; next.disabled = true;
    document.getElementById(product + '-access-page').textContent = '';
    try {
      const data = await get('/internal/operator/api/access/' + product + '?' + queryString({ query: form.get('query'), status: form.get('status'), limit: 50, offset: state.offset }));
      if (requestId !== state.request) return;
      state.generatedAt = data.generatedAt;
      if (product === 'enrollments' && activeView === 'merchants') renderActiveFreshness();
      summary.textContent = data.pending + ' awaiting approval across ' + data.installed + ' active installations. Checked ' + formatTime(data.generatedAt) + '.';
      if (!data.approvalAvailable) summary.textContent += ' Approval connection is not configured for this release.';
      rows.replaceChildren();
      data.items.forEach(function (item) {
        const row = element('tr');
        const identity = element('td');
        if (product === 'enrollments') appendLocationIdentity(identity, item);
        else identity.append(element('span', 'primary-text', item.businessName || item.locationId), element('span', 'secondary-text', item.businessName ? item.locationId : 'Business name not recorded in ' + productName(product)));
        const access = element('td'); access.appendChild(element('span', 'badge ' + (item.needsApproval ? 'warning' : item.accessAllowed ? 'healthy' : 'unknown'), item.accessLabel));
        const action = element('td');
        const open = element('button', 'secondary-button', item.needsApproval && session.capabilities.merchantAccessApprove && data.approvalAvailable ? 'Review & approve' : 'View access');
        open.type = 'button'; open.addEventListener('click', function () { openAccess(product, item.locationId); }); action.appendChild(open);
        row.append(identity, element('td', '', item.planLabel), element('td', '', billingLabel(item.billingStatus)), access, element('td', '', item.approvedAt ? formatTime(item.approvedAt) : 'Not recorded'), action);
        rows.appendChild(row);
      });
      if (!data.items.length) emptyRow(rows, 6, data.total ? 'No accounts on this page. Use Previous.' : 'No accounts match this filter.');
      document.getElementById(product + '-access-page').textContent = data.total ? (state.offset + 1) + '-' + Math.min(state.offset + 50, data.total) + ' of ' + data.total + ' matching accounts' : '0 matching accounts';
      previous.disabled = state.offset === 0; next.disabled = state.offset + 50 >= data.total;
    } catch (error) {
      if (requestId !== state.request) return;
      state.generatedAt = null;
      if (product === 'enrollments' && activeView === 'merchants') renderActiveFreshness();
      rows.replaceChildren(); emptyRow(rows, 6, 'Current access could not be loaded. Refresh to retry.');
      summary.textContent = error.status === 404 ? 'Access management is unavailable for this role or release.' : error.message;
    }
  }
  function renderAccessDetail(product, item, available, message) {
    const target = document.getElementById('access-detail'); target.replaceChildren();
    document.getElementById('access-product').textContent = productName(product);
    document.getElementById('access-title').textContent = product === 'enrollments' ? locationTitle(item) : item.businessName || item.locationId;
    if (product === 'enrollments') target.appendChild(identityDetail(item));
    target.appendChild(detailSection('Plan & access', [
      ['Product', productName(product)], ['Exact GHL sub-account', item.locationId], ['Plan', item.planLabel], ['Access', item.accessLabel],
      ['Billing', item.billingStatus === 'unknown' ? 'Not verified; not proof of payment' : billingLabel(item.billingStatus)],
      ['Approval recorded', item.approvedAt ? formatTime(item.approvedAt) : 'Not recorded'], ['Approved by', item.approvedBy], ['Approval note', item.note]
    ]));
    const notice = element('p', 'access-notice', message || (item.accessAllowed ? 'Access is already active. No approval is needed.' : !item.installed ? 'This account is inactive. Approval cannot install or reconnect the app.' : !item.needsApproval ? 'This plan or billing issue cannot be resolved by granting free access.' : 'Review the exact product and sub-account before granting access.'));
    notice.setAttribute('role', 'status'); target.appendChild(notice);
    if (product === 'enrollments' && item.identity && item.identity.authorization === 'incomplete') notice.textContent += ' HighLevel authorization is incomplete. Approval does not reconnect or finish setup.';
    if (product === 'enrollments' && session.capabilities.merchantAccessApprove) {
      const refresh = element('button', 'secondary-button', 'Refresh HighLevel name'); refresh.type = 'button';
      refresh.addEventListener('click', async function () {
        if (accessBusy) return;
        accessBusy = true; refresh.disabled = true; document.getElementById('access-close').disabled = true;
        notice.textContent = 'Checking this exact HighLevel sub-account...';
        try {
          const result = await post('/internal/operator/api/access/enrollments/' + encodeURIComponent(item.locationId) + '/refresh-identity', {});
          renderAccessDetail(product, result.merchant, result.approvalAvailable, result.auditComplete ? 'Identity check finished.' : 'Identity check finished; completion audit needs review. Reference: ' + result.correlationId);
          await loadAccess(product, false);
        } catch (error) { notice.textContent = error.message; refresh.disabled = false; }
        finally { accessBusy = false; document.getElementById('access-close').disabled = false; }
      });
      target.appendChild(refresh);
    }
    if (!item.needsApproval) return;
    if (!session.capabilities.merchantAccessApprove) { target.appendChild(element('p', 'access-notice', 'Only the platform owner can approve merchant access.')); return; }
    if (!available) { target.appendChild(element('p', 'access-notice', 'The secure approval connection must be configured before this account can be approved here.')); return; }
    const form = element('form');
    const effect = item.approvalKind === 'wholepay' ? 'WholePay approval enables access under the existing WholePay plan. Verify its active NMI merchant account first.' : product === 'evidence' ? 'Approval enables this installation and its Evidence capture workers. It does not approve ScaleSafe Enrollments.' : 'Approval grants no-cost Test Access to this installation only. It does not change the plan, bill the merchant, or approve ScaleSafe Evidence.';
    form.appendChild(element('p', 'access-notice', effect));
    const reasonLabel = element('label', '', 'Reason for approval (no passwords or payment credentials)');
    const reason = element('textarea'); reason.name = 'note'; reason.required = true; reason.minLength = 3; reason.maxLength = 500; reasonLabel.appendChild(reason); form.appendChild(reasonLabel);
    let reference = null;
    if (item.approvalKind === 'wholepay') {
      const label = element('label', '', 'WholePay merchant reference (not an API key)');
      reference = element('input'); reference.name = 'merchantReference'; reference.required = true; reference.maxLength = 100; label.appendChild(reference); form.appendChild(label);
    }
    const confirm = element('label', 'access-confirm'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.required = true;
    confirm.append(checkbox, element('span', '', (item.approvalKind === 'wholepay' ? 'I verified the active WholePay-provisioned NMI account and approve ' : 'I approve ') + productName(product) + ' access for ' + (product === 'enrollments' ? locationTitle(item) : item.businessName || item.locationId) + ' (' + item.locationId + ').')); form.appendChild(confirm);
    const submit = element('button', '', 'Approve this sub-account'); submit.type = 'submit'; form.appendChild(submit);
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); if (accessBusy || !form.reportValidity()) return;
      accessBusy = true; submit.disabled = true; document.getElementById('access-close').disabled = true;
      notice.textContent = 'Saving approval for this exact sub-account...';
      try {
        const result = await post('/internal/operator/api/access/' + product + '/' + encodeURIComponent(item.locationId) + '/approve', { version: item.version, note: reason.value.trim(), wholepayVerified: item.approvalKind === 'wholepay' && checkbox.checked, merchantReference: reference ? reference.value.trim() : '' });
        renderAccessDetail(product, result.merchant, available, result.auditComplete ? 'Approval saved. Merchant access is active.' : 'Access is active. Approval intent was recorded, but the completion audit needs review. Reference: ' + result.correlationId);
        await loadAccess(product, false);
        if (product === 'evidence') await loadEvidence();
      } catch (error) {
        notice.textContent = error.message + ' Reload this account to confirm its current state before another attempt.';
        const reload = element('button', 'secondary-button', 'Reload account'); reload.type = 'button';
        reload.addEventListener('click', function () { openAccess(product, item.locationId); }); target.appendChild(reload);
      } finally { accessBusy = false; document.getElementById('access-close').disabled = false; }
    });
    target.appendChild(form);
  }
  async function openAccess(product, locationId) {
    if (accessBusy) return;
    const requestId = ++accessDialogRequest;
    const dialog = document.getElementById('access-dialog');
    document.getElementById('access-product').textContent = productName(product);
    document.getElementById('access-title').textContent = locationId;
    const target = document.getElementById('access-detail'); empty(target, 'Loading current merchant access...');
    if (!dialog.open) dialog.showModal();
    try {
      const result = await get('/internal/operator/api/access/' + product + '/' + encodeURIComponent(locationId));
      if (requestId === accessDialogRequest) renderAccessDetail(product, result.merchant, result.approvalAvailable);
    } catch (error) { if (requestId === accessDialogRequest) empty(target, error.message); }
  }
  ['enrollments', 'evidence'].forEach(function (product) {
    document.getElementById(product + '-access-filters').addEventListener('submit', function (event) { event.preventDefault(); loadAccess(product, true); });
    document.getElementById(product + '-access-prev').addEventListener('click', function () { accessStates[product].offset = Math.max(0, accessStates[product].offset - 50); loadAccess(product, false); });
    document.getElementById(product + '-access-next').addEventListener('click', function () { accessStates[product].offset += 50; loadAccess(product, false); });
  });
  document.getElementById('access-close').addEventListener('click', function () { if (!accessBusy) { accessDialogRequest++; document.getElementById('access-dialog').close(); } });
  document.getElementById('access-dialog').addEventListener('cancel', function (event) { if (accessBusy) event.preventDefault(); else accessDialogRequest++; });
`;
