import { Router, Request, Response } from 'express';
import { getPaymentUpdateConfig, updatePaymentMethod, cancelSubscriptionPublic, getMilestoneConfig, submitMilestoneSignoff } from '../controllers/payment-update.controller';

const router = Router();

// API endpoints (public — called by the widgets)
router.get('/api/payment-update/config', getPaymentUpdateConfig);
router.post('/api/payment-update/update-method', updatePaymentMethod);
router.post('/api/payment-update/cancel-subscription', cancelSubscriptionPublic);
router.get('/api/milestone-signoff/config', getMilestoneConfig);
router.post('/api/milestone-signoff/submit', submitMilestoneSignoff);

// Widget page (loaded in GHL funnel iframe or standalone)
const widgetCsp = "frame-ancestors *; frame-src https://secure.nmi.com https://js.stripe.com; script-src 'self' 'unsafe-inline' https://secure.nmi.com https://js.stripe.com";

router.get('/payment-update', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Security-Policy', widgetCsp);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(paymentUpdateHtml());
});

function paymentUpdateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Update Payment Method</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #1f2937; padding: 24px 16px; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
  .card-form { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .field-label { font-size: 12px; font-weight: 500; color: #6b7280; margin-bottom: 6px; display: block; }
  .field-row { margin-bottom: 14px; }
  .field-row:last-child { margin-bottom: 0; }
  .inline-field { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; background: #fff; min-height: 42px; }
  #card-element { padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; min-height: 42px; }
  .half { display: flex; gap: 12px; }
  .half > div { flex: 1; }
  .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-primary:hover { background: #2563eb; }
  .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .status { text-align: center; padding: 16px; border-radius: 8px; margin-top: 16px; font-size: 14px; }
  .status-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .status-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .loading { text-align: center; padding: 40px 0; color: #6b7280; }
  .contact-info { font-size: 13px; color: #374151; margin-bottom: 16px; padding: 10px 12px; background: #f3f4f6; border-radius: 6px; }
  .hidden { display: none !important; }
</style>
</head>
<body>

<h1 id="title">Update Payment Method</h1>
<p class="subtitle" id="merchant-name"></p>

<div id="loading" class="loading">Loading payment form...</div>

<div id="no-processor" class="status status-error hidden">
  Payment processing is not configured for this account. Please contact your provider.
</div>

<div id="contact-info" class="contact-info hidden"></div>

<!-- NMI Collect.js form -->
<div id="nmi-form" class="hidden">
  <div class="card-form">
    <div class="field-row">
      <label class="field-label">Card Number</label>
      <div id="cc-number" class="inline-field"></div>
    </div>
    <div class="half">
      <div class="field-row">
        <label class="field-label">Expiration</label>
        <div id="cc-exp" class="inline-field"></div>
      </div>
      <div class="field-row">
        <label class="field-label">CVV</label>
        <div id="cc-cvv" class="inline-field"></div>
      </div>
    </div>
  </div>
  <button class="btn btn-primary" id="nmi-submit" onclick="submitNmi()">Update Payment Method</button>
</div>

<!-- Stripe Elements form -->
<div id="stripe-form" class="hidden">
  <div class="card-form">
    <div class="field-row">
      <label class="field-label">Card Details</label>
      <div id="card-element"></div>
    </div>
  </div>
  <button class="btn btn-primary" id="stripe-submit" onclick="submitStripe()">Update Payment Method</button>
</div>

<div id="success-msg" class="status status-success hidden"></div>
<div id="error-msg" class="status status-error hidden"></div>

<script>
var API_BASE = window.location.origin;
var params = new URLSearchParams(window.location.search);
var actionToken = params.get('actionToken') || params.get('token') || '';
var contactId = params.get('contactId') || '';
var locationId = params.get('locationId') || '';

var state = {
  config: null,
  nmiToken: '',
  stripe: null,
  cardElement: null,
  submitting: false,
  actionToken: actionToken,
};

function el(id) { return document.getElementById(id); }

function showError(msg) {
  el('error-msg').textContent = msg;
  el('error-msg').classList.remove('hidden');
}

// Load config on page load
(async function init() {
  if (!actionToken && (!contactId || !locationId)) {
    el('loading').classList.add('hidden');
    showError('Invalid payment update link.');
    return;
  }

  try {
    var configUrl = actionToken
      ? API_BASE + '/api/payment-update/config?actionToken=' + encodeURIComponent(actionToken)
      : API_BASE + '/api/payment-update/config?contactId=' + encodeURIComponent(contactId) + '&locationId=' + encodeURIComponent(locationId);
    var res = await fetch(configUrl);
    var data = await res.json();
    state.config = data;

    el('loading').classList.add('hidden');

    if (data.merchantName) {
      el('merchant-name').textContent = data.merchantName;
    }

    if (data.contactName || data.contactEmail) {
      el('contact-info').textContent = (data.contactName || '') + (data.contactEmail ? ' (' + data.contactEmail + ')' : '');
      el('contact-info').classList.remove('hidden');
    }

    if (data.processorType === 'none') {
      el('no-processor').classList.remove('hidden');
      return;
    }

    if (data.processorType === 'nmi') {
      el('nmi-form').classList.remove('hidden');
      initNmi(data.nmiTokenizationKey);
    } else if (data.processorType === 'stripe') {
      el('stripe-form').classList.remove('hidden');
      initStripe(data.stripePublishableKey, data.stripeAccountId);
    }
  } catch (err) {
    el('loading').classList.add('hidden');
    showError('Failed to load payment form. Please try again.');
  }
})();

// ─── NMI Collect.js ──────────────────────────────────

function initNmi(tokenKey) {
  var script = document.createElement('script');
  script.src = 'https://secure.nmi.com/token/Collect.js';
  script.onload = function() {
    // Delay to ensure DOM elements are painted before Collect.js mounts iframes
    setTimeout(function() {
      if (typeof CollectJS !== 'undefined') {
        CollectJS.configure({
          tokenizationKey: tokenKey,
          variant: 'inline',
          fields: {
            ccnumber: { selector: '#cc-number', placeholder: 'Card Number' },
            ccexp: { selector: '#cc-exp', placeholder: 'MM/YY' },
            cvv: { selector: '#cc-cvv', placeholder: 'CVV' },
          },
          customCss: {
            'border': 'none',
            'height': '100%',
            'width': '100%',
            'font-size': '16px',
            'color': '#32325d',
            'outline': 'none',
          },
          invalidCss: { 'color': '#ef4444' },
          focusCss: { 'outline': 'none' },
          callback: function(response) {
            state.nmiToken = response.token;
            doSubmit(response.token, 'nmi');
          }
        });
      }
    }, 150);
  };
  document.head.appendChild(script);
}

function submitNmi() {
  if (state.submitting) return;
  el('error-msg').classList.add('hidden');

  if (typeof CollectJS !== 'undefined') {
    state.submitting = true;
    el('nmi-submit').disabled = true;
    el('nmi-submit').textContent = 'Processing...';
    CollectJS.startPaymentRequest();
  } else {
    showError('Card form not loaded. Please refresh and try again.');
  }
}

// ─── Stripe Elements ─────────────────────────────────

function initStripe(pubKey, acctId) {
  var script = document.createElement('script');
  script.src = 'https://js.stripe.com/v3/';
  script.onload = function() {
    var opts = acctId ? { stripeAccount: acctId } : {};
    state.stripe = Stripe(pubKey, opts);
    var elements = state.stripe.elements();
    state.cardElement = elements.create('card', {
      style: { base: { fontSize: '16px', color: '#32325d', '::placeholder': { color: '#9ca3af' } } }
    });
    state.cardElement.mount('#card-element');
  };
  document.head.appendChild(script);
}

async function submitStripe() {
  if (state.submitting || !state.stripe || !state.cardElement) return;
  el('error-msg').classList.add('hidden');
  state.submitting = true;
  el('stripe-submit').disabled = true;
  el('stripe-submit').textContent = 'Processing...';

  try {
    var result = await state.stripe.createPaymentMethod({ type: 'card', card: state.cardElement });
    if (result.error) {
      throw new Error(result.error.message);
    }
    doSubmit(result.paymentMethod.id, 'stripe');
  } catch (err) {
    state.submitting = false;
    el('stripe-submit').disabled = false;
    el('stripe-submit').textContent = 'Update Payment Method';
    showError(err.message || 'Card validation failed.');
  }
}

// ─── Submit to backend ───────────────────────────────

async function doSubmit(token, processorType) {
  try {
    var res = await fetch(API_BASE + '/api/payment-update/update-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionToken: state.actionToken,
        contactId: contactId,
        locationId: locationId,
        token: token,
        processorType: processorType,
        contactEmail: state.config?.contactEmail || '',
        contactName: state.config?.contactName || '',
      })
    });

    var data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Update failed');
    }

    // Success
    el('nmi-form').classList.add('hidden');
    el('stripe-form').classList.add('hidden');
    el('success-msg').textContent = 'Payment method updated successfully! Card ending in ' + data.last4 + '.';
    el('success-msg').classList.remove('hidden');

    // Notify parent (GHL iframe)
    window.parent.postMessage({ type: 'ssPaymentMethodUpdated', last4: data.last4, brand: data.brand }, '*');
  } catch (err) {
    showError(err.message || 'Failed to update payment method. Please try again.');
  }

  state.submitting = false;
  var nmiBtn = el('nmi-submit');
  var stripeBtn = el('stripe-submit');
  if (nmiBtn) { nmiBtn.disabled = false; nmiBtn.textContent = 'Update Payment Method'; }
  if (stripeBtn) { stripeBtn.disabled = false; stripeBtn.textContent = 'Update Payment Method'; }
}
</script>
</body>
</html>`;
}

// Subscription cancellation page (client-facing)
router.get('/subscription-cancel', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(subscriptionCancelHtml());
});

function subscriptionCancelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cancel Subscription</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #1f2937; padding: 24px 16px; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
  .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .field-label { font-size: 12px; font-weight: 500; color: #6b7280; margin-bottom: 6px; display: block; }
  .field-row { margin-bottom: 14px; }
  textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; resize: vertical; min-height: 80px; font-family: inherit; }
  textarea:focus { border-color: #3b82f6; outline: none; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn-danger { background: #ef4444; color: #fff; }
  .btn-danger:hover { background: #dc2626; }
  .btn-danger:disabled { background: #fca5a5; cursor: not-allowed; }
  .status { text-align: center; padding: 16px; border-radius: 8px; margin-top: 16px; font-size: 14px; }
  .status-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .status-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .loading { text-align: center; padding: 40px 0; color: #6b7280; }
  .contact-info { font-size: 13px; color: #374151; margin-bottom: 16px; padding: 10px 12px; background: #f3f4f6; border-radius: 6px; }
  .warning { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #991b1b; }
  .hidden { display: none !important; }
</style>
</head>
<body>

<h1>Cancel Subscription</h1>
<p class="subtitle" id="merchant-name"></p>

<div id="loading" class="loading">Loading...</div>
<div id="contact-info" class="contact-info hidden"></div>

<div id="cancel-form" class="hidden">
  <div class="warning">
    Cancelling your subscription will stop all future billing. This action cannot be undone. If you have questions, contact your provider before proceeding.
  </div>

  <div class="field-row">
    <label class="field-label">Why are you cancelling? (required)</label>
    <textarea id="reason" placeholder="Please let us know why you'd like to cancel..."></textarea>
  </div>

  <button class="btn btn-danger" id="cancel-btn" onclick="submitCancel()" disabled>
    Cancel My Subscription
  </button>
</div>

<div id="success-msg" class="status status-success hidden">
  Your subscription has been cancelled. You will not be charged again. Thank you.
</div>
<div id="error-msg" class="status status-error hidden"></div>

<script>
var API_BASE = window.location.origin;
var params = new URLSearchParams(window.location.search);
var actionToken = params.get('actionToken') || params.get('token') || '';
var contactId = params.get('contactId') || '';
var locationId = params.get('locationId') || '';

(async function init() {
  if (!actionToken && (!contactId || !locationId)) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-msg').textContent = 'Invalid link. Please use the cancellation link provided by your provider.';
    document.getElementById('error-msg').classList.remove('hidden');
    return;
  }

  try {
    var configUrl = actionToken
      ? API_BASE + '/api/payment-update/config?actionToken=' + encodeURIComponent(actionToken)
      : API_BASE + '/api/payment-update/config?contactId=' + encodeURIComponent(contactId) + '&locationId=' + encodeURIComponent(locationId);
    var res = await fetch(configUrl);
    var data = await res.json();

    document.getElementById('loading').classList.add('hidden');

    if (data.merchantName) document.getElementById('merchant-name').textContent = data.merchantName;
    if (data.contactName || data.contactEmail) {
      document.getElementById('contact-info').textContent = (data.contactName || '') + (data.contactEmail ? ' (' + data.contactEmail + ')' : '');
      document.getElementById('contact-info').classList.remove('hidden');
    }

    document.getElementById('cancel-form').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-msg').textContent = 'Failed to load. Please try again.';
    document.getElementById('error-msg').classList.remove('hidden');
  }
})();

// Enable button when reason is entered
document.getElementById('reason').addEventListener('input', function() {
  document.getElementById('cancel-btn').disabled = !this.value.trim();
});

async function submitCancel() {
  var reason = document.getElementById('reason').value.trim();
  if (!reason) return;

  document.getElementById('cancel-btn').disabled = true;
  document.getElementById('cancel-btn').textContent = 'Cancelling...';
  document.getElementById('error-msg').classList.add('hidden');

  try {
    var res = await fetch(API_BASE + '/api/payment-update/cancel-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionToken: actionToken, contactId: contactId, locationId: locationId, reason: reason })
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Cancellation failed');

    document.getElementById('cancel-form').classList.add('hidden');
    document.getElementById('success-msg').classList.remove('hidden');
    window.parent.postMessage({ type: 'ssSubscriptionCancelled' }, '*');
  } catch (err) {
    document.getElementById('error-msg').textContent = err.message || 'Cancellation failed. Please try again.';
    document.getElementById('error-msg').classList.remove('hidden');
    document.getElementById('cancel-btn').disabled = false;
    document.getElementById('cancel-btn').textContent = 'Cancel My Subscription';
  }
}
</script>
</body>
</html>`;
}

// Milestone sign-off page (client-facing)
router.get('/milestone-signoff', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(milestoneSignoffHtml());
});

function milestoneSignoffHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Milestone Sign-Off</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #1f2937; padding: 24px 16px; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
  .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
  .field-label { font-size: 12px; font-weight: 500; color: #6b7280; margin-bottom: 6px; display: block; }
  .field-row { margin-bottom: 14px; }
  input[type="text"] { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; }
  input[type="text"]:focus { border-color: #3b82f6; outline: none; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .status { text-align: center; padding: 16px; border-radius: 8px; margin-top: 16px; font-size: 14px; }
  .status-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .status-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .loading { text-align: center; padding: 40px 0; color: #6b7280; }
  .checkbox-label { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; cursor: pointer; margin-bottom: 12px; }
  .checkbox-label input { width: 18px; height: 18px; margin-top: 2px; accent-color: #3b82f6; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<h1 id="title">Milestone Sign-Off</h1>
<p class="subtitle" id="merchant-name"></p>
<div id="loading" class="loading">Loading...</div>
<div id="form-section" class="hidden">
  <div class="card">
    <div class="card-title" id="milestone-title"></div>
    <div id="delivers" class="field-row" style="font-size:13px;color:#374151"></div>
    <div id="client-does" class="field-row" style="font-size:13px;color:#374151"></div>
  </div>
  <div class="field-row">
    <label class="checkbox-label">
      <input type="checkbox" id="confirm-cb" />
      I confirm this milestone was delivered as described above
    </label>
  </div>
  <div class="field-row">
    <label class="field-label">Your Full Legal Name (Electronic Signature)</label>
    <input type="text" id="signature" placeholder="Type your full legal name" />
  </div>
  <button class="btn btn-primary" id="submit-btn" onclick="submitSignoff()" disabled>Sign Off</button>
</div>
<div id="success-msg" class="status status-success hidden">Milestone signed off. Thank you!</div>
<div id="error-msg" class="status status-error hidden"></div>
<script>
var API_BASE = window.location.origin;
var params = new URLSearchParams(window.location.search);
var actionToken = params.get('actionToken') || params.get('token') || '';
var contactId = params.get('contactId') || '';
var locationId = params.get('locationId') || '';
var milestoneNumber = params.get('milestoneNumber') || '';
function setLabeledText(id, label, value) {
  if (!value) return;
  var node = document.getElementById(id);
  node.textContent = '';
  var strong = document.createElement('strong');
  strong.textContent = label;
  node.appendChild(strong);
  node.appendChild(document.createTextNode(' ' + value));
}
(async function() {
  if ((!actionToken && (!contactId || !locationId)) || (!actionToken && !milestoneNumber)) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-msg').textContent = 'Invalid link.';
    document.getElementById('error-msg').classList.remove('hidden');
    return;
  }
  try {
    var configUrl = actionToken
      ? API_BASE + '/api/milestone-signoff/config?actionToken=' + encodeURIComponent(actionToken)
      : API_BASE + '/api/milestone-signoff/config?contactId=' + encodeURIComponent(contactId) + '&locationId=' + encodeURIComponent(locationId) + '&milestoneNumber=' + milestoneNumber;
    var res = await fetch(configUrl);
    var data = await res.json();
    document.getElementById('loading').classList.add('hidden');
    if (data.error) { document.getElementById('error-msg').textContent = data.error; document.getElementById('error-msg').classList.remove('hidden'); return; }
    milestoneNumber = data.milestoneNumber || milestoneNumber;
    document.getElementById('merchant-name').textContent = data.merchantName || '';
    document.getElementById('milestone-title').textContent = 'Milestone ' + milestoneNumber + ': ' + data.milestoneName;
    setLabeledText('delivers', 'Deliverables:', data.delivers);
    setLabeledText('client-does', 'Your Responsibility:', data.clientDoes);
    document.getElementById('form-section').classList.remove('hidden');
  } catch (e) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-msg').textContent = 'Failed to load. Please try again.';
    document.getElementById('error-msg').classList.remove('hidden');
  }
})();
function updateBtn() {
  document.getElementById('submit-btn').disabled = !(document.getElementById('confirm-cb').checked && document.getElementById('signature').value.trim());
}
document.getElementById('confirm-cb').addEventListener('change', updateBtn);
document.getElementById('signature').addEventListener('input', updateBtn);
async function submitSignoff() {
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('submit-btn').textContent = 'Submitting...';
  document.getElementById('error-msg').classList.add('hidden');
  try {
    var res = await fetch(API_BASE + '/api/milestone-signoff/submit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ actionToken: actionToken, contactId: contactId, locationId: locationId, milestoneNumber: parseInt(milestoneNumber), signature: document.getElementById('signature').value.trim() })
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    document.getElementById('form-section').classList.add('hidden');
    document.getElementById('success-msg').classList.remove('hidden');
  } catch (e) {
    document.getElementById('error-msg').textContent = e.message || 'Sign-off failed.';
    document.getElementById('error-msg').classList.remove('hidden');
    document.getElementById('submit-btn').disabled = false;
    document.getElementById('submit-btn').textContent = 'Sign Off';
  }
}
</script>
</body>
</html>`;
}

export default router;
