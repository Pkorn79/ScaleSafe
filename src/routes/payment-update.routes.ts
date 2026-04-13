import { Router, Request, Response } from 'express';
import { getPaymentUpdateConfig, updatePaymentMethod } from '../controllers/payment-update.controller';

const router = Router();

// API endpoints (public — called by the widget)
router.get('/api/payment-update/config', getPaymentUpdateConfig);
router.post('/api/payment-update/update-method', updatePaymentMethod);

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
console.log('RAW search:', window.location.search);
console.log('RAW href:', window.location.href);
var params = new URLSearchParams(window.location.search);
var contactId = params.get('contactId') || '';
var locationId = params.get('locationId') || '';
console.log('Parsed contactId:', contactId, 'locationId:', locationId);

var state = {
  config: null,
  nmiToken: '',
  stripe: null,
  cardElement: null,
  submitting: false,
};

function el(id) { return document.getElementById(id); }

function showError(msg) {
  el('error-msg').textContent = msg;
  el('error-msg').classList.remove('hidden');
}

// Load config on page load
(async function init() {
  if (!contactId || !locationId) {
    el('loading').classList.add('hidden');
    showError('Missing contactId or locationId in URL parameters.');
    return;
  }

  try {
    var res = await fetch(API_BASE + '/api/payment-update/config?contactId=' + encodeURIComponent(contactId) + '&locationId=' + encodeURIComponent(locationId));
    var data = await res.json();
    console.log('Payment update config:', JSON.stringify(data));
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

export default router;
