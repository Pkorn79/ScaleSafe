import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { createWhopCheckoutSession, getCheckoutConfig, getCheckoutConfigByOffer, getCheckoutConfigByProduct, getCheckoutQuote, processPayment, saveCard } from '../controllers/checkout.controller';

const router = Router();

// API endpoints for checkout processing
router.get('/api/checkout/config', getCheckoutConfig);
router.get('/api/checkout/config-by-offer/:offerId', getCheckoutConfigByOffer);
router.get('/api/checkout/config-by-product/:ghlProductId', getCheckoutConfigByProduct);
router.get('/api/checkout/quote', getCheckoutQuote);
router.post('/api/checkout/process-payment', processPayment);
router.post('/api/checkout/whop/session', createWhopCheckoutSession);
router.post('/api/checkout/save-card', saveCard);

function createScriptNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

function checkoutCsp(nonce: string): string {
  return `frame-ancestors *; frame-src https://secure.nmi.com https://js.stripe.com https://*.whop.com https://whop.com; script-src 'self' 'nonce-${nonce}' https://secure.nmi.com https://js.stripe.com https://*.whop.com https://whop.com`;
}

// Serve the checkout page (loaded by GHL in an iframe)
router.get('/checkout', (_req: Request, res: Response) => {
  const nonce = createScriptNonce();
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Security-Policy', checkoutCsp(nonce));
  res.send(checkoutHtml(nonce));
});

// Quick checkout page (compact single-page checkout for lower-ticket items)
router.get('/quick-checkout', (_req: Request, res: Response) => {
  const nonce = createScriptNonce();
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Security-Policy', checkoutCsp(nonce));
  res.send(quickCheckoutHtml(nonce));
});

// Payment thank-you page (standalone redirect after quick-checkout)
router.get('/payment-thank-you', async (req: Request, res: Response) => {
  const amount = req.query.amount as string || '0.00';
  const name = req.query.name as string || 'Customer';
  const offerId = req.query.offerId as string || '';

  let merchantName = '';
  if (offerId) {
    try {
      const { getSupabase } = require('../clients/supabase.client');
      const { data: offer } = await getSupabase().from('offers_mirror').select('location_id').eq('id', offerId).single();
      if (offer) {
        const { data: merchant } = await getSupabase().from('merchants').select('business_name').eq('location_id', offer.location_id).single();
        merchantName = merchant?.business_name || '';
      }
    } catch {}
  }

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Confirmed</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:420px;text-align:center;padding:40px 32px;background:#f0fdf4;border:1px solid #a7f3d0;border-radius:12px}
.check{font-size:48px;margin-bottom:16px}h1{font-size:22px;font-weight:600;margin-bottom:8px}
.amount{font-size:28px;font-weight:700;color:#10b981;margin:12px 0}.name{font-size:14px;color:#6b7280;margin-bottom:4px}
.merchant{font-size:14px;color:#374151;margin-top:16px;padding-top:16px;border-top:1px solid #d1fae5}</style></head>
<body><div class="card"><div class="check">&#10003;</div><h1>Payment Confirmed</h1>
<div class="name">Thank you, ${name.replace(/</g, '&lt;')}!</div>
<div class="amount">$${amount}</div>
<div class="name">Your payment has been processed successfully.</div>
${merchantName ? `<div class="merchant">${merchantName.replace(/</g, '&lt;')}</div>` : ''}
</div></body></html>`);
});

function checkoutHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Checkout — ScaleSafe</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#1a1a2e;padding:16px}
.container{max-width:440px;margin:0 auto}
.merchant-name{font-size:14px;color:#6b7280;text-align:center;margin-bottom:16px}
.product-card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center}
.product-name{font-size:16px;font-weight:600;margin-bottom:4px}
.product-amount{font-size:28px;font-weight:700;color:#3b82f6}
.toggle-group{display:flex;gap:8px;margin-bottom:16px}
.toggle-btn{flex:1;padding:12px;border:2px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;text-align:center;transition:all .15s}
.toggle-btn.active{border-color:#3b82f6;background:#eff6ff}
.toggle-btn .label{font-size:13px;color:#6b7280;margin-bottom:2px}
.toggle-btn .amount{font-size:16px;font-weight:600;color:#1a1a2e}
.card-form{margin-bottom:16px}
.card-form label{display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px}
.field-wrapper{border:1px solid #d1d5db;border-radius:8px;padding:12px;margin-bottom:10px;min-height:44px;background:#fff;transition:border-color .15s}
.field-wrapper:focus-within{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.field-row{display:flex;gap:10px}
.field-row .field-wrapper{flex:1}
#card-element{min-height:20px}
.save-card-row{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:#374151}
.save-card-row input{width:18px;height:18px}
.pay-btn{display:block;width:100%;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:background .15s}
.pay-btn:hover{background:#2563eb}
.pay-btn:disabled{background:#93c5fd;cursor:not-allowed}
.error-msg{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:14px;display:none}
.spinner{display:none;text-align:center;padding:20px}
.spinner::after{content:'';display:inline-block;width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.footer{text-align:center;margin-top:16px;font-size:12px;color:#9ca3af}
.hidden{display:none!important}
.setup-title{font-size:18px;font-weight:600;text-align:center;margin-bottom:16px}
</style>
</head>
<body>
<div class="container">
  <div class="merchant-name" id="merchant-name"></div>

  <div id="product-section" class="hidden">
    <div class="product-card">
      <div class="product-name" id="product-name"></div>
      <div class="product-amount" id="product-amount"></div>
    </div>
    <div class="toggle-group hidden" id="toggle-group">
      <div class="toggle-btn active" id="toggle-pif">
        <div class="label">Pay in Full</div>
        <div class="amount" id="pif-amount"></div>
      </div>
      <div class="toggle-btn" id="toggle-installments">
        <div class="label">Installments</div>
        <div class="amount" id="installments-amount"></div>
      </div>
    </div>
  </div>

  <div id="setup-section" class="hidden">
    <div class="setup-title">Save a Card</div>
  </div>

  <div id="error-msg" class="error-msg"></div>

  <div class="card-form" id="card-form">
    <label>Card Number</label>
    <div class="field-wrapper" id="cc-number-wrapper">
      <div id="cc-number"></div>
      <div id="card-element"></div>
    </div>
    <div class="field-row" id="exp-cvv-row">
      <div class="field-wrapper"><div id="cc-exp"></div></div>
      <div class="field-wrapper"><div id="cc-cvv"></div></div>
    </div>
  </div>

  <label class="save-card-row" id="save-card-row">
    <input type="checkbox" id="save-card-checkbox">
    Save card for future use
  </label>

  <button class="pay-btn" id="pay-btn">Pay</button>
  <div class="spinner" id="spinner"></div>

  <div class="footer">Secured by ScaleSafe</div>
</div>

<script nonce="${nonce}">
(function() {
  // ─── State ──────────────────────────────────────────────
  var state = {
    mode: null, // 'payment' or 'setup'
    publishableKey: '',
    processorType: '',
    amount: 0,
    currency: 'usd',
    contactId: '',
    contactName: '',
    contactEmail: '',
    orderId: '',
    transactionId: '',
    subscriptionId: '',
    locationId: '',
    productDetails: null,
    pifPrice: null,
    installmentPrice: null,
    selectedPricing: 'pif',
    nmiTokenizationKey: '',
    stripeAccountId: '',
    stripePublishableKey: '',
    stripe: null,
    cardElement: null,
    nmiToken: null,
    processing: false,
  };

  var API_BASE = '';

  function ssParentOrigins() {
    var origins = ['https://app.gohighlevel.com', 'https://app.leadconnectorhq.com'];
    try {
      if (document.referrer) origins.unshift(new URL(document.referrer).origin);
    } catch(e) {}
    return origins.filter(function(origin, index) { return origin && origins.indexOf(origin) === index; });
  }

  function ssPostToParent(message) {
    if (window.parent === window) return;
    ssParentOrigins().forEach(function(origin) {
      try { window.parent.postMessage(message, origin); } catch(e) {}
    });
  }

  function ssIsTrustedParentMessage(event) {
    return ssParentOrigins().indexOf(event.origin) !== -1;
  }

  // ─── PostMessage: send ready signal ─────────────────────
  ssPostToParent({
    type: 'custom_provider_ready',
    loaded: true,
    addCardOnFileSupported: true
  });

  // ─── PostMessage: listen for GHL events ─────────────────
  window.addEventListener('message', function(event) {
    if (!ssIsTrustedParentMessage(event)) return;
    var d = event.data;
    if (!d || !d.type) return;
    if (d.type === 'payment_initiate_props') initPayment(d);
    else if (d.type === 'setup_initiate_props') initSetup(d);
  });

  // ─── Initialize payment flow ────────────────────────────
  function initPayment(data) {
    state.mode = 'payment';
    state.publishableKey = data.publishableKey || '';
    state.amount = data.amount || 0;
    state.currency = (data.currency || 'USD').toLowerCase();
    state.contactId = data.contact?.id || '';
    state.contactName = data.contact?.name || '';
    state.contactEmail = data.contact?.email || '';
    state.orderId = data.orderId || '';
    state.transactionId = data.transactionId || '';
    state.subscriptionId = data.subscriptionId || '';
    state.locationId = data.locationId || '';
    state.productDetails = data.productDetails || null;

    // Parse pricing options
    parsePricing(data.productDetails);

    // Show product section
    el('product-section').classList.remove('hidden');
    el('setup-section').classList.add('hidden');

    if (state.productDetails && state.productDetails[0]) {
      el('product-name').textContent = state.productDetails[0].name || 'Payment';
    }
    updateDisplayAmount();

    // Load processor config
    loadConfig();
  }

  // ─── Initialize card-on-file flow ───────────────────────
  function initSetup(data) {
    state.mode = 'setup';
    state.publishableKey = data.publishableKey || '';
    state.currency = (data.currency || 'USD').toLowerCase();
    state.contactId = data.contact?.id || '';
    state.contactName = data.contact?.name || '';
    state.contactEmail = data.contact?.email || '';
    state.locationId = data.locationId || '';

    el('product-section').classList.add('hidden');
    el('setup-section').classList.remove('hidden');
    el('save-card-row').classList.add('hidden');
    el('pay-btn').textContent = 'Save Card';

    loadConfig();
  }

  // ─── Parse PIF vs installments ──────────────────────────
  function parsePricing(productDetails) {
    if (!productDetails || !productDetails[0] || !productDetails[0].prices) return;
    var prices = productDetails[0].prices;

    prices.forEach(function(p) {
      if (p.type === 'onetime' || p.type === 'one_time') {
        state.pifPrice = p;
      } else if (p.type === 'recurring') {
        state.installmentPrice = p;
      }
    });

    if (state.pifPrice && state.installmentPrice) {
      el('toggle-group').classList.remove('hidden');
      el('pif-amount').textContent = formatCents(state.pifPrice.amount);
      var ip = state.installmentPrice;
      var cycles = ip.totalCycles || '?';
      el('installments-amount').textContent = cycles + 'x ' + formatCents(ip.amount);
    }
  }

  function selectPricing(type) {
    state.selectedPricing = type;
    el('toggle-pif').classList.toggle('active', type === 'pif');
    el('toggle-installments').classList.toggle('active', type === 'installments');
    updateDisplayAmount();
  }

  function updateDisplayAmount() {
    var amt = state.amount;
    if (state.selectedPricing === 'pif' && state.pifPrice) {
      amt = state.pifPrice.amount;
    } else if (state.selectedPricing === 'installments' && state.installmentPrice) {
      amt = state.installmentPrice.amount;
    }
    state.amount = amt;
    el('product-amount').textContent = formatCents(amt);
    el('pay-btn').textContent = 'Pay ' + formatCents(amt);
  }

  // ─── Load merchant/processor config ─────────────────────
  function loadConfig() {
    // GHL Custom Payment Provider iframe: offerId comes from productDetails (postMessage),
    // not URL params (the iframe URL has no query params).
    var ghlProductId = state.productDetails && state.productDetails[0] ? (state.productDetails[0]._id || state.productDetails[0].id || '') : '';
    var configUrl = ghlProductId
      ? API_BASE + '/api/checkout/config-by-product/' + encodeURIComponent(ghlProductId)
      : API_BASE + '/api/checkout/config?publishableKey=' + encodeURIComponent(state.publishableKey);
    console.log('[ScaleSafe] loadConfig: ghlProductId=' + ghlProductId + ' configUrl=' + configUrl);
    fetch(configUrl)
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        state.processorType = cfg.processorType;
        el('merchant-name').textContent = cfg.merchantName || '';

        if (cfg.processorType === 'nmi') {
          if (!cfg.nmiTokenizationKey) {
            showError('NMI is not fully configured. The tokenization key is missing. Please check Settings > Payments.');
            return;
          }
          state.nmiTokenizationKey = cfg.nmiTokenizationKey;
          el('pay-btn').disabled = true;
          el('pay-btn').textContent = 'Enter card details...';
          initNmi(cfg.nmiTokenizationKey);
        } else if (cfg.processorType === 'stripe') {
          state.stripeAccountId = cfg.stripeAccountId;
          state.stripePublishableKey = cfg.stripePublishableKey;
          initStripe(cfg.stripePublishableKey, cfg.stripeAccountId);
        }
      })
      .catch(function(err) {
        showError('Failed to load payment configuration');
      });
  }

  // ─── NMI Collect.js ─────────────────────────────────────
  function initNmi(tokenKey) {
    el('card-element').classList.add('hidden');
    el('exp-cvv-row').classList.remove('hidden');

    var script = document.createElement('script');
    script.src = 'https://secure.nmi.com/token/Collect.js';
    script.setAttribute('data-tokenization-key', tokenKey);
    script.onload = function() {
      if (typeof CollectJS !== 'undefined') {
        CollectJS.configure({
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
            'color': '#1f2937',
            'outline': 'none',
            'background-color': '#ffffff',
          },
          invalidCss: { 'color': '#ef4444' },
          placeholderCss: { 'color': '#9ca3af' },
          focusCss: { 'outline': 'none' },
          fieldsAvailableCallback: function() {
            console.log('[ScaleSafe] Collect.js fields rendered');
            el('pay-btn').disabled = false;
            if (state.amount) el('pay-btn').textContent = 'Pay ' + formatCents(state.amount);
            else el('pay-btn').textContent = 'Pay';
          },
          timeoutCallback: function() {
            showError('Card input timed out. Please refresh and try again.');
            el('pay-btn').disabled = false;
            el('pay-btn').textContent = 'Pay';
          },
          callback: function(response) {
            state.nmiToken = response.token;
            doSubmit(response.token);
          }
        });
      }
    };
    document.head.appendChild(script);
  }

  // ─── Stripe Elements ────────────────────────────────────
  function initStripe(pubKey, acctId) {
    el('cc-number').classList.add('hidden');
    el('exp-cvv-row').classList.add('hidden');
    el('card-element').classList.remove('hidden');

    var script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = function() {
      state.stripe = Stripe(pubKey, { stripeAccount: acctId });
      var elements = state.stripe.elements();
      state.cardElement = elements.create('card', {
        style: {
          base: { fontSize: '16px', color: '#32325d', '::placeholder': { color: '#aab7c4' } }
        }
      });
      state.cardElement.mount('#card-element');
    };
    document.head.appendChild(script);
  }

  // ─── Submit payment ─────────────────────────────────────
  function submitPayment() {
    if (state.processing) return;
    hideError();

    if (state.processorType === 'nmi') {
      // Trigger Collect.js tokenization — callback calls doSubmit
      if (typeof CollectJS !== 'undefined') {
        el('pay-btn').disabled = true;
        el('pay-btn').textContent = 'Processing...';
        CollectJS.startPaymentRequest();
      } else {
        showError('Payment system not loaded. Please refresh the page.');
      }
      return; // NMI callback handles doSubmit
    } else if (state.processorType === 'stripe') {
      state.processing = true;
      setLoading(true);
      state.stripe.createPaymentMethod({
        type: 'card',
        card: state.cardElement,
        billing_details: { name: state.contactName, email: state.contactEmail }
      }).then(function(result) {
        if (result.error) {
          state.processing = false;
          setLoading(false);
          showError(result.error.message);
          return;
        }
        doSubmit(result.paymentMethod.id);
      });
    }
  }

  // ─── Do the actual submission ───────────────────────────
  function doSubmit(token) {
    state.processing = true;
    setLoading(true);

    var evidence = captureEvidence();

    if (state.mode === 'setup') {
      // Card-on-file flow
      fetch(API_BASE + '/api/checkout/save-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishableKey: state.publishableKey,
          paymentToken: token,
          contactId: state.contactId,
          contactEmail: state.contactEmail,
          contactName: state.contactName,
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.processing = false;
        setLoading(false);
        if (data.success) {
          ssPostToParent({
            type: 'custom_element_success_response',
            chargeId: data.paymentMethodId
          });
        } else {
          showError(data.error || 'Failed to save card');
        }
      })
      .catch(function() {
        state.processing = false;
        setLoading(false);
        showError('Network error. Please try again.');
      });
      return;
    }

    // Payment flow
    var urlParams = new URLSearchParams(window.location.search);
    fetch(API_BASE + '/api/checkout/process-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publishableKey: state.publishableKey,
        paymentToken: token,
        amount: state.amount,
        currency: state.currency,
        contactId: state.contactId,
        contactName: state.contactName,
        contactEmail: state.contactEmail,
        orderId: state.orderId,
        transactionId: state.transactionId,
        subscriptionId: state.subscriptionId,
        offerId: urlParams.get('offer_id') || '',
        ghlProductId: state.productDetails && state.productDetails[0] ? (state.productDetails[0]._id || state.productDetails[0].id || '') : '',
        consentToken: urlParams.get('consent_token') || '',
        saveCard: el('save-card-checkbox') ? el('save-card-checkbox').checked : false,
        ipAddress: '',
        deviceFingerprint: evidence.deviceFingerprint,
        browserInfo: evidence.browserInfo,
        productDetails: state.productDetails,
        requestThreeDSecure: false,
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      state.processing = false;
      setLoading(false);
      if (data.success) {
        ssPostToParent({
          type: 'custom_element_success_response',
          chargeId: data.chargeId,
          subscriptionId: data.subscriptionId || '',
          billingIssue: data.billingIssue || null
        });
      } else if (data.threeDSecureUrl) {
        window.location.href = data.threeDSecureUrl;
      } else {
        showError(data.error || 'Payment failed. Please try a different card.');
      }
    })
    .catch(function() {
      state.processing = false;
      setLoading(false);
      showError('Network error. Please try again.');
    });
  }

  // ─── Evidence capture ───────────────────────────────────
  function captureEvidence() {
    return {
      deviceFingerprint: navigator.userAgent + '|' + screen.width + 'x' + screen.height + '|' + navigator.language,
      browserInfo: JSON.stringify({
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screenResolution: screen.width + 'x' + screen.height,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cookiesEnabled: navigator.cookieEnabled,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // ─── Helpers ────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function formatCents(cents) { return '$' + (cents / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); }
  function showError(msg) { var e = el('error-msg'); e.textContent = msg; e.style.display = 'block'; }
  function hideError() { el('error-msg').style.display = 'none'; }
  function setLoading(on) {
    el('pay-btn').disabled = on;
    el('pay-btn').classList.toggle('hidden', on);
    el('spinner').style.display = on ? 'block' : 'none';
  }

  el('toggle-pif').addEventListener('click', function() { selectPricing('pif'); });
  el('toggle-installments').addEventListener('click', function() { selectPricing('installments'); });
  el('pay-btn').addEventListener('click', submitPayment);
})();
</script>
</body>
</html>`;
}

function quickCheckoutHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quick Checkout — ScaleSafe</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#1a1a2e;padding:16px}
.container{max-width:480px;margin:0 auto}
.merchant-name{font-size:14px;color:#6b7280;text-align:center;margin-bottom:16px}
.offer-card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px}
.offer-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.offer-name{font-size:18px;font-weight:600}
.offer-price{font-size:24px;font-weight:700;color:#3b82f6}
.offer-desc{font-size:14px;color:#6b7280;line-height:1.5;margin-bottom:8px}
.offer-refund{font-size:13px;color:#6b7280;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-top:8px}
.dual-pricing-box{background:#f8fafc;border:1px solid #dbeafe;border-radius:8px;padding:12px;margin:10px 0 12px}
.dual-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#475569;margin:3px 0}
.dual-row strong{font-size:14px;color:#111827}
.dual-note{font-size:12px;color:#64748b;line-height:1.35;margin-top:6px}
.method-toggle{display:none;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:12px}
.method-toggle.active{display:flex}
.method-option{flex:1;border:0;background:#f9fafb;color:#374151;padding:10px;font-size:14px;font-weight:600;cursor:pointer}
.method-option.active{background:#2563eb;color:#fff}
.method-option:disabled{color:#9ca3af;cursor:not-allowed;background:#f3f4f6}
.divider{height:1px;background:#e5e7eb;margin:20px 0}
.section-title{font-size:14px;font-weight:600;color:#374151;margin-bottom:12px}
.field-wrapper{border:1px solid #d1d5db;border-radius:8px;padding:12px;margin-bottom:10px;min-height:44px;background:#fff;transition:border-color .15s}
.field-wrapper:focus-within{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.field-row{display:flex;gap:10px}
.field-row .field-wrapper{flex:1}
#card-element{min-height:20px}
.whop-panel{display:none;background:#f8fafc;border:1px solid #dbeafe;border-radius:8px;padding:14px;margin-bottom:12px}
.whop-panel.active{display:block}
.whop-note{font-size:13px;color:#475569;line-height:1.5;margin-bottom:10px}
.consent-row{display:flex;align-items:flex-start;gap:10px;margin:16px 0;font-size:14px;color:#374151;line-height:1.5}
.consent-row input{width:20px;height:20px;margin-top:2px;flex-shrink:0;accent-color:#3b82f6}
.pay-btn{display:block;width:100%;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:background .15s}
.pay-btn:hover{background:#2563eb}
.pay-btn:disabled{background:#93c5fd;cursor:not-allowed}
.error-msg{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:12px;margin-bottom:12px;font-size:14px;display:none}
.success-msg{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:8px;padding:16px;text-align:center;font-size:16px;font-weight:500;display:none}
.spinner{display:none;text-align:center;padding:20px}
.spinner::after{content:'';display:inline-block;width:28px;height:28px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.footer{text-align:center;margin-top:16px;font-size:12px;color:#9ca3af}
.hidden{display:none!important}
.loading{text-align:center;padding:40px;color:#6b7280}
</style>
</head>
<body>
<div class="container">
  <div class="merchant-name" id="merchant-name"></div>

  <div id="loading" class="loading">Loading...</div>

  <div id="offer-section" class="hidden">
    <div class="offer-card">
      <div class="offer-header">
        <div class="offer-name" id="offer-name"></div>
        <div class="offer-price" id="offer-price"></div>
      </div>
      <div class="offer-desc hidden" id="offer-desc"></div>
      <div class="offer-refund hidden" id="offer-refund"></div>
    </div>

    <!-- PIF / Installment toggle (shown when offer supports both) -->
    <div id="pricing-toggle" class="hidden" style="display:none;margin:12px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="display:flex">
        <button type="button" id="toggle-pif-btn" style="flex:1;padding:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;background:#3b82f6;color:#fff;transition:background 0.15s">
          Pay in Full <span id="toggle-pif-price"></span>
        </button>
        <button type="button" id="toggle-inst-btn" style="flex:1;padding:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;background:#f9fafb;color:#374151;transition:background 0.15s">
          Installments <span id="toggle-inst-price"></span>
        </button>
      </div>
    </div>
    <div id="installment-note" class="hidden" style="display:none;font-size:12px;color:#6b7280;text-align:center;margin-bottom:8px"></div>
    <div id="dual-pricing-box" class="dual-pricing-box hidden">
      <div class="dual-row"><span>Bank transfer price</span><strong id="dual-ach-price"></strong></div>
      <div class="dual-row"><span>Card price</span><strong id="dual-card-price"></strong></div>
      <div class="dual-note">Bank transfer is the lower price. Card payments use the card price shown here.</div>
    </div>

    <div class="divider"></div>

    <!-- Customer Information (hidden when ?consentToken= is present — full funnel already collected this on Page 1) -->
    <div id="customer-info-section">
      <div class="section-title">Your Information</div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Full Name *</label>
        <input type="text" id="cust-name" class="field-wrapper" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:16px" placeholder="Full name" required />
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px">
        <div style="flex:1">
          <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Email *</label>
          <input type="email" id="cust-email" class="field-wrapper" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:16px" placeholder="Email" required />
        </div>
        <div style="flex:1">
          <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Phone *</label>
          <input type="tel" id="cust-phone" class="field-wrapper" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:16px" placeholder="Phone" required />
        </div>
      </div>

      <div class="divider"></div>
    </div>

    <div class="section-title">Payment Information</div>
    <div id="payment-method-toggle" class="method-toggle">
      <button type="button" id="method-ach" class="method-option">Bank Transfer</button>
      <button type="button" id="method-card" class="method-option active">Card</button>
    </div>
    <div id="nmi-fields" class="hidden">
      <div id="nmi-card-fields">
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Card Number</label>
        <div class="field-wrapper"><div id="ccnumber"></div></div>
        <div class="field-row">
          <div>
            <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Exp Date</label>
            <div class="field-wrapper"><div id="ccexp"></div></div>
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">CVV</label>
            <div class="field-wrapper"><div id="cvv"></div></div>
          </div>
        </div>
      </div>
      <div id="nmi-ach-fields" class="hidden">
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Name on Bank Account</label>
        <div class="field-wrapper"><div id="checkname"></div></div>
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Routing Number</label>
        <div class="field-wrapper"><div id="checkaba"></div></div>
        <label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px">Account Number</label>
        <div class="field-wrapper"><div id="checkaccount"></div></div>
        <div class="field-row">
          <select id="ach-holder-type" class="field-wrapper" style="height:44px;padding:8px">
            <option value="personal">Personal account</option>
            <option value="business">Business account</option>
          </select>
          <select id="ach-account-type" class="field-wrapper" style="height:44px;padding:8px">
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </div>
        <div class="dual-note">ACH is submitted for bank processing. Receipt and access are completed after the processor confirms settlement.</div>
      </div>
    </div>
    <div id="stripe-fields" class="hidden">
      <div class="field-wrapper"><div id="card-element"></div></div>
    </div>
    <div id="whop-checkout" class="whop-panel">
      <div class="whop-note">Payment will be completed through Whop. Your enrollment details and consent are still recorded by ScaleSafe.</div>
      <div id="whop-embed-root"></div>
    </div>

    <!-- Terms checkbox (hidden when ?consentToken= is present — accepted on funnel Page 3) -->
    <div class="consent-row" id="consent-row">
      <input type="checkbox" id="consent-cb">
      <label for="consent-cb" id="consent-text">I agree to the terms and conditions and authorize this charge.</label>
    </div>

    <div class="error-msg" id="error-msg"></div>
    <div class="success-msg" id="success-msg">Payment successful!</div>
    <div class="spinner" id="spinner"></div>
    <button class="pay-btn" id="pay-btn" disabled>Pay</button>

    <div class="footer">Secure payment powered by ScaleSafe</div>
  </div>
</div>

<script nonce="${nonce}">
(function(){
  var API_BASE = window.location.origin;
  var params = new URLSearchParams(window.location.search);
  var offerId = params.get('offerId');
  var publishableKey = params.get('publishableKey') || '';

  var offerData = null;
  var processorType = '';
  var collectJs = null;
  var stripe = null;
  var stripeElements = null;
  var cardElement = null;
  var paymentToken = null;
  var consentToken = params.get('consentToken') || '';
  var paymentChoice = params.get('paymentChoice') || '';
  var enrollmentEmail = '';
  var selectedPaymentMethod = 'card';

  // CONSENT MODE = full enrollment funnel path. Customer info + T&C were already
  // collected on Page 1 / Page 3 of the funnel; we hide those fields here and
  // populate them from /api/enrollment/consent-lookup so the submit handler stays unchanged.
  var consentMode = !!consentToken;

  // Prefill mode: if URL has contactId + name + email, lock the customer fields (Quick Pay prefilled link)
  var prefillContactId = params.get('contactId') || '';
  var prefillName = params.get('contactName') || '';
  var prefillEmail = params.get('contactEmail') || '';
  var prefillPhone = params.get('contactPhone') || '';

  function el(id) { return document.getElementById(id); }

  // Apply prefill on load
  (function() {
    if (prefillName) { el('cust-name').value = prefillName; el('cust-name').readOnly = true; el('cust-name').style.background = '#f3f4f6'; }
    if (prefillEmail) { el('cust-email').value = prefillEmail; el('cust-email').readOnly = true; el('cust-email').style.background = '#f3f4f6'; enrollmentEmail = prefillEmail; }
    if (prefillPhone) { el('cust-phone').value = prefillPhone; el('cust-phone').readOnly = true; el('cust-phone').style.background = '#f3f4f6'; }
  })();

  // Consent-mode setup: hide the redundant sections immediately so the user never sees them flash.
  (function() {
    if (!consentMode) return;
    var infoSec = el('customer-info-section');
    if (infoSec) infoSec.style.display = 'none';
    var consentRow = el('consent-row');
    if (consentRow) consentRow.style.display = 'none';
    // Pre-check the consent box so updatePayBtn() ungates without user action.
    // The actual T&C acceptance was logged at funnel Page 3.
    var cb = el('consent-cb');
    if (cb) cb.checked = true;
  })();

  function ssCheckoutParentOrigins() {
    var origins = ['https://app.gohighlevel.com', 'https://app.leadconnectorhq.com'];
    try {
      if (document.referrer) origins.unshift(new URL(document.referrer).origin);
    } catch(e) {}
    return origins.filter(function(origin, index) { return origin && origins.indexOf(origin) === index; });
  }

  function ssCheckoutPostToParent(message) {
    if (window.parent === window) return;
    ssCheckoutParentOrigins().forEach(function(origin) {
      try { window.parent.postMessage(message, origin); } catch(e) {}
    });
  }

  function ssCheckoutIsTrustedParentMessage(event) {
    return ssCheckoutParentOrigins().indexOf(event.origin) !== -1;
  }

  // Listen for GHL postMessage (paymentsUrl protocol)
  window.addEventListener('message', function(e) {
    if (!ssCheckoutIsTrustedParentMessage(e)) return;
    try {
      var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (d.action === 'payment_initiate_props') {
        if (d.publishableKey) publishableKey = d.publishableKey;
        if (d.offerId) offerId = d.offerId;
        init();
      }
    } catch(ex) {}
  });

  if (offerId) init();

  async function init() {
    try {
      // Load offer details
      var res = await fetch(API_BASE + '/api/enrollment/offer/' + encodeURIComponent(offerId) + '/public');
      if (!res.ok) throw new Error('Offer not found');
      offerData = await res.json();

      // Load processor config
      var cfg = null;
      if (publishableKey) {
        var cfgRes = await fetch(API_BASE + '/api/checkout/config?publishableKey=' + encodeURIComponent(publishableKey));
        if (cfgRes.ok) cfg = await cfgRes.json();
      } else if (offerId) {
        var cfgRes2 = await fetch(API_BASE + '/api/checkout/config-by-offer/' + encodeURIComponent(offerId));
        if (cfgRes2.ok) cfg = await cfgRes2.json();
      }

      if (cfg) {
        if (cfg.publishableKey) publishableKey = cfg.publishableKey;
        processorType = cfg.processorType;
        el('merchant-name').textContent = cfg.merchantName || offerData.merchantName || '';

        if (processorType === 'nmi' && cfg.nmiTokenizationKey) {
          await loadNmi(cfg.nmiTokenizationKey);
        } else if (processorType === 'stripe' && cfg.stripePublishableKey) {
          await loadStripe(cfg.stripePublishableKey, cfg.stripeAccountId);
        } else if (processorType === 'whop') {
          el('whop-checkout').classList.add('active');
          el('pay-btn').textContent = 'Continue to Whop Checkout';
        } else if (processorType === 'nmi' && !cfg.nmiTokenizationKey) {
          console.error('[ScaleSafe] NMI tokenization key missing');
          el('error-msg').textContent = 'NMI is not fully configured. The tokenization key is missing. Please contact the provider to update their payment settings.';
          el('error-msg').style.display = 'block';
        } else {
          console.error('[ScaleSafe] No tokenization credentials available. processorType=' + processorType
            + ' stripePublishableKey=' + (cfg.stripePublishableKey ? 'set' : 'MISSING')
            + ' nmiTokenizationKey=' + (cfg.nmiTokenizationKey ? 'set' : 'MISSING'));
          el('error-msg').textContent = 'Payment processing is not fully configured. Please contact the provider.';
          el('error-msg').style.display = 'block';
        }
      } else {
        console.error('[ScaleSafe] No processor config returned for offerId=' + offerId);
        el('error-msg').textContent = 'Payment processing is not available for this offer.';
        el('error-msg').style.display = 'block';
      }

      // Look up enrollment data from consent token (full funnel path).
      // Populates the hidden cust-name/cust-email fields so the existing submit
      // body keeps working without re-prompting the user.
      if (consentToken) {
        try {
          var consentRes = await fetch(API_BASE + '/api/enrollment/consent-lookup/' + encodeURIComponent(consentToken));
          if (consentRes.ok) {
            var consentData = await consentRes.json();
            enrollmentEmail = consentData.email || '';
            var fullName = ((consentData.firstName || '') + ' ' + (consentData.lastName || '')).trim()
              || consentData.digitalSignature
              || '';
            if (el('cust-name') && fullName) el('cust-name').value = fullName;
            if (el('cust-email') && consentData.email) el('cust-email').value = consentData.email;
            if (consentData.contactId) prefillContactId = consentData.contactId;
          }
        } catch(e) { /* silent */ }
      }

      renderOffer();
    } catch(err) {
      el('loading').textContent = 'Unable to load checkout. Please try again.';
    }
  }

  function renderOffer() {
    el('loading').classList.add('hidden');
    el('offer-section').classList.remove('hidden');

    // Merchant logo
    if (offerData.merchantLogoUrl) {
      try {
        var logoUrl = new URL(offerData.merchantLogoUrl, window.location.origin);
        if (logoUrl.protocol === 'https:' || logoUrl.protocol === 'http:') {
          var logoDiv = document.createElement('div');
          logoDiv.style.cssText = 'text-align:center;margin-bottom:12px;';
          var logoImg = document.createElement('img');
          logoImg.src = logoUrl.href;
          logoImg.alt = '';
          logoImg.style.cssText = 'max-width:150px;height:auto;';
          logoDiv.appendChild(logoImg);
          el('offer-section').insertBefore(logoDiv, el('offer-section').firstChild);
        }
      } catch(e) { /* ignore invalid logo URLs */ }
    }

    el('offer-name').textContent = offerData.programName;
    el('merchant-name').textContent = el('merchant-name').textContent || offerData.merchantName || '';

    // Show pricing toggle if offer supports both PIF and installments
    var hasBothOptions = offerData.paymentType === 'installments' && offerData.pifDiscountEnabled && offerData.pifPrice && offerData.installmentAmount;
    if (hasBothOptions) {
      el('pricing-toggle').style.display = 'block';
      el('pricing-toggle').classList.remove('hidden');
      el('toggle-pif-price').textContent = formatCurrency(offerData.pifPrice);
      el('toggle-inst-price').textContent = formatCurrency(offerData.installmentAmount) + '/mo';
      if (!paymentChoice) paymentChoice = 'pif'; // Default to PIF when toggle shown
    } else if (offerData.paymentType === 'installments' && offerData.installmentAmount) {
      // Installment-only (no PIF discount) — force installments
      paymentChoice = 'installments';
    } else if (offerData.paymentType === 'subscription') {
      if (offerData.installmentAmount == null) {
        offerData.installmentAmount = offerData.price;
      }
      paymentChoice = 'subscription';
    }

    updatePricingDisplay();

    if (offerData.programDescription) {
      el('offer-desc').textContent = offerData.programDescription;
      el('offer-desc').classList.remove('hidden');
    }
    if (offerData.refundWindowText) {
      el('offer-refund').textContent = offerData.refundWindowText;
      el('offer-refund').classList.remove('hidden');
    }

    // Update consent label with T&C link (source order: per-offer tcUrl → default text)
    var consentLabel = el('consent-text');
    if (offerData.tcUrl) {
      try {
        var termsUrl = new URL(offerData.tcUrl, window.location.origin);
        if (termsUrl.protocol === 'https:' || termsUrl.protocol === 'http:') {
          consentLabel.textContent = 'I agree to the ';
          var link = document.createElement('a');
          link.href = termsUrl.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.style.cssText = 'color:#3b82f6;text-decoration:underline';
          link.textContent = 'Terms and Conditions';
          consentLabel.appendChild(link);
          consentLabel.appendChild(document.createTextNode(' and authorize this charge.'));
        } else {
          consentLabel.textContent = 'I agree to the Terms and Conditions and authorize this charge.';
        }
      } catch(e) {
        consentLabel.textContent = 'I agree to the Terms and Conditions and authorize this charge.';
      }
    } else if (offerData.quickCheckoutConsentText) {
      consentLabel.textContent = offerData.quickCheckoutConsentText;
    }
  }

  function baseDisplayPrice() {
    var displayPrice = offerData.price;
    if (paymentChoice === 'pif' && offerData.pifPrice != null) {
      displayPrice = offerData.pifPrice;
    } else if (paymentChoice === 'installments' && offerData.installmentAmount != null) {
      displayPrice = offerData.installmentAmount;
    } else if (paymentChoice === 'subscription' && offerData.installmentAmount != null) {
      displayPrice = offerData.installmentAmount;
    }
    return Number(displayPrice || 0);
  }

  function priceQuote() {
    var cardPrice = baseDisplayPrice();
    var dual = offerData.dualPricing || null;
    if (!dual || !offerData.dualPricingEnabled) {
      return { cardPrice: cardPrice, achPrice: cardPrice, selectedPrice: cardPrice, enabled: false };
    }
    var uplift = Number(dual.cardUpliftPercent || 0);
    var achPrice = uplift > 0 ? Math.round((cardPrice / (1 + uplift / 100)) * 100) / 100 : cardPrice;
    return {
      cardPrice: cardPrice,
      achPrice: achPrice,
      selectedPrice: selectedPaymentMethod === 'ach' ? achPrice : cardPrice,
      enabled: true
    };
  }

  function achSelectable() {
    return !!(offerData
      && offerData.dualPricingEnabled
      && offerData.achEnabled
      && processorType === 'nmi'
      && paymentChoice !== 'installments'
      && paymentChoice !== 'subscription');
  }

  function setPaymentMethod(method) {
    if (method === 'ach' && !achSelectable()) return;
    selectedPaymentMethod = method === 'ach' ? 'ach' : 'card';
    updatePaymentMethodUi();
    updatePricingDisplay();
  }

  function updatePaymentMethodUi() {
    var toggle = el('payment-method-toggle');
    if (toggle) {
      toggle.classList.toggle('active', achSelectable());
    }
    if (!achSelectable()) selectedPaymentMethod = 'card';
    var achButton = el('method-ach');
    var cardButton = el('method-card');
    if (achButton) achButton.classList.toggle('active', selectedPaymentMethod === 'ach');
    if (cardButton) cardButton.classList.toggle('active', selectedPaymentMethod === 'card');
    var cardFields = el('nmi-card-fields');
    var achFields = el('nmi-ach-fields');
    if (cardFields) cardFields.classList.toggle('hidden', selectedPaymentMethod === 'ach');
    if (achFields) achFields.classList.toggle('hidden', selectedPaymentMethod !== 'ach');
  }

  function updatePricingDisplay() {
    var note = '';
    var quote = priceQuote();
    var displayPrice = quote.selectedPrice;
    if (paymentChoice === 'installments' && offerData.installmentAmount != null) {
      note = offerData.installmentCount + ' ' + (offerData.installmentFrequency || 'monthly') + ' payments of ' + formatCurrency(displayPrice);
    } else if (paymentChoice === 'subscription' && offerData.installmentAmount != null) {
      note = formatCurrency(displayPrice) + ' / ' + (offerData.installmentFrequency || 'month') + ' (ongoing)';
    }
    el('offer-price').textContent = formatCurrency(displayPrice);
    if (quote.enabled) {
      el('dual-ach-price').textContent = formatCurrency(quote.achPrice);
      el('dual-card-price').textContent = formatCurrency(quote.cardPrice);
      el('dual-pricing-box').classList.remove('hidden');
    } else {
      el('dual-pricing-box').classList.add('hidden');
    }
    updatePaymentMethodUi();
    el('pay-btn').textContent = processorType === 'whop'
      ? 'Continue to Whop Checkout'
      : 'Pay ' + formatCurrency(displayPrice);
    if (note) {
      el('installment-note').textContent = note;
      el('installment-note').style.display = 'block';
      el('installment-note').classList.remove('hidden');
    } else {
      el('installment-note').style.display = 'none';
    }
    // Update toggle button styles
    if (el('toggle-pif-btn')) {
      el('toggle-pif-btn').style.background = paymentChoice === 'pif' ? '#3b82f6' : '#f9fafb';
      el('toggle-pif-btn').style.color = paymentChoice === 'pif' ? '#fff' : '#374151';
      el('toggle-inst-btn').style.background = paymentChoice === 'installments' ? '#3b82f6' : '#f9fafb';
      el('toggle-inst-btn').style.color = paymentChoice === 'installments' ? '#fff' : '#374151';
    }
    updatePayBtn();
  }

  function selectPaymentOption(choice) {
    paymentChoice = choice;
    updatePricingDisplay();
  }

  function formatCurrency(val) {
    if (val == null) return '';
    return '$' + Number(val).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  // Consent checkbox + pay button gate
  // For NMI: button enables when consent is checked (token is generated on submit via startPaymentRequest).
  // For Stripe: button enables when consent is checked (token is created inline via createPaymentMethod on submit).
  // Both processors handle tokenization at submit time — no pre-tokenization gate needed.
  el('consent-cb').addEventListener('change', updatePayBtn);
  el('toggle-pif-btn').addEventListener('click', function() { selectPaymentOption('pif'); });
  el('toggle-inst-btn').addEventListener('click', function() { selectPaymentOption('installments'); });
  el('method-ach').addEventListener('click', function() { setPaymentMethod('ach'); });
  el('method-card').addEventListener('click', function() { setPaymentMethod('card'); });
  function updatePayBtn() {
    var ready = el('consent-cb').checked && (paymentToken !== null || processorType === 'stripe' || processorType === 'nmi' || processorType === 'whop');
    el('pay-btn').disabled = !ready;
  }

  async function renderWhopCheckout(custName, custEmail) {
    var sessionRes = await fetch(API_BASE + '/api/checkout/whop/session', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        offerId: offerId,
        consentToken: consentToken,
        contactId: prefillContactId || '',
        contactName: custName,
        contactEmail: custEmail || enrollmentEmail,
        checkoutMode: consentToken ? 'full_enrollment' : 'quick_checkout'
      })
    });
    var session = await sessionRes.json();
    if (!session.success) throw new Error(session.error || 'Could not start Whop checkout');

    var root = el('whop-embed-root');
    root.textContent = '';
    var mount = document.createElement('div');
    mount.setAttribute('data-whop-checkout-session', session.sessionId);
    mount.setAttribute('data-whop-checkout-plan-id', session.planId || '');
    mount.setAttribute('data-whop-skip-redirect', 'true');
    root.appendChild(mount);

    var script = document.createElement('script');
    script.src = session.embedScriptUrl || 'https://js.whop.com/checkout.js';
    script.async = true;
    document.head.appendChild(script);

    if (session.checkoutUrl) {
      var link = document.createElement('a');
      link.href = session.checkoutUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open Whop checkout';
      link.style.cssText = 'display:block;text-align:center;margin-top:12px;color:#2563eb;font-weight:600';
      root.appendChild(link);
    }
    el('pay-btn').classList.add('hidden');
    el('success-msg').textContent = 'Whop checkout is ready below.';
    el('success-msg').style.display = 'block';
  }

  // NMI Collect.js
  function loadNmi(tokenKey) {
    return new Promise(function(resolve) {
      var s = document.createElement('script');
      s.src = 'https://secure.nmi.com/token/Collect.js';
      s.setAttribute('data-tokenization-key', tokenKey);
      s.setAttribute('data-variant', 'inline');
      s.onload = function() {
        el('nmi-fields').classList.remove('hidden');
        if (window.CollectJS) {
          window.CollectJS.configure({
            fields: {
              ccnumber: {selector:'#ccnumber',placeholder:'Card Number'},
              ccexp: {selector:'#ccexp',placeholder:'MM/YY'},
              cvv: {selector:'#cvv',placeholder:'CVV'},
              checkname: {selector:'#checkname',placeholder:'Name on account'},
              checkaba: {selector:'#checkaba',placeholder:'Routing number'},
              checkaccount: {selector:'#checkaccount',placeholder:'Account number'}
            },
            customCss: {
              'border': 'none',
              'height': '100%',
              'width': '100%',
              'font-size': '16px',
              'color': '#1f2937',
              'outline': 'none',
              'background-color': '#ffffff',
            },
            invalidCss: { 'color': '#ef4444' },
            placeholderCss: { 'color': '#9ca3af' },
            focusCss: { 'outline': 'none' },
            fieldsAvailableCallback: function() {
              console.log('[ScaleSafe] Collect.js fields rendered');
            },
            timeoutCallback: function() {
              el('error-msg').textContent = 'Card input timed out. Please refresh and try again.';
              el('error-msg').style.display = 'block';
            },
            callback: function(r) {
              paymentToken = r.token;
              updatePayBtn();
            }
          });
        }
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  // Stripe Elements
  function loadStripe(pubKey, accountId) {
    return new Promise(function(resolve) {
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = function() {
        el('stripe-fields').classList.remove('hidden');
        stripe = window.Stripe(pubKey, {stripeAccount: accountId});
        stripeElements = stripe.elements();
        cardElement = stripeElements.create('card', { hidePostalCode: true });
        cardElement.mount('#card-element');
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  // Payment submission
  el('pay-btn').addEventListener('click', async function() {
    if (!offerData) return;
    setLoading(true);
    el('error-msg').style.display = 'none';

    try {
      var token = paymentToken;
      // Use payment choice to determine charge amount
      var chargePrice = priceQuote().selectedPrice;
      // Validate customer fields. Phone is only required on Quick Pay (no consent token);
      // on the full funnel path the contact already exists in GHL with phone from Page 1.
      var custName = el('cust-name').value.trim();
      var custEmail = el('cust-email').value.trim();
      var custPhone = el('cust-phone').value.trim();
      if (consentMode) {
        if (!custName || !custEmail) {
          throw new Error('Missing enrollment data. Please refresh and try again.');
        }
      } else {
        if (!custName || !custEmail || !custPhone) {
          throw new Error('Please fill in your name, email, and phone number');
        }
      }
      if (!enrollmentEmail) enrollmentEmail = custEmail;

      if (processorType === 'whop') {
        await renderWhopCheckout(custName, custEmail);
        setLoading(false);
        return;
      }

      var amount = Math.round(chargePrice * 100);

      // For Stripe, create PaymentMethod first
      if (processorType === 'stripe' && cardElement) {
        var result = await stripe.createPaymentMethod({type:'card', card: cardElement});
        if (result.error) throw new Error(result.error.message);
        token = result.paymentMethod.id;
      }

      // NMI: trigger tokenization if not yet done
      if (processorType === 'nmi' && !token && window.CollectJS) {
        window.CollectJS.startPaymentRequest();
        await new Promise(function(r) { setTimeout(r, 2000); });
        token = paymentToken;
        if (!token) throw new Error('Card tokenization failed');
      }

      var res = await fetch(API_BASE + '/api/checkout/process-payment', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          publishableKey: publishableKey,
          paymentToken: token,
          amount: amount,
          currency: 'usd',
          offerId: offerId,
          consentToken: consentToken,
          contactId: prefillContactId || '',
          contactName: custName,
          contactEmail: custEmail || enrollmentEmail,
          contactPhone: custPhone,
          paymentChoice: paymentChoice || 'pif',
          paymentMethod: selectedPaymentMethod,
          achAccountHolderType: selectedPaymentMethod === 'ach' ? el('ach-holder-type').value : undefined,
          achAccountType: selectedPaymentMethod === 'ach' ? el('ach-account-type').value : undefined,
          achSecCode: selectedPaymentMethod === 'ach' ? 'WEB' : undefined,
          deviceFingerprint: navigator.userAgent,
          browserInfo: {screen: screen.width+'x'+screen.height, tz: Intl.DateTimeFormat().resolvedOptions().timeZone}
        })
      });

      var data = await res.json();
      if (!data.success) throw new Error(data.error || 'Payment failed');

      // Success
      el('pay-btn').classList.add('hidden');
      el('success-msg').textContent = data.billingIssue
        ? 'Payment received. Recurring billing setup needs merchant attention.'
        : data.paymentStatus === 'processing'
          ? 'Bank transfer submitted. Receipt and enrollment completion will happen after settlement.'
          : 'Payment Successful!';
      el('success-msg').style.display = 'block';

      // In GHL iframe: notify parent
      if (window !== window.parent) {
        try {
          ssCheckoutPostToParent(JSON.stringify({
            action: 'custom_element_success_response',
            chargeId: data.chargeId,
            transactionId: data.chargeId,
            subscriptionId: data.subscriptionId || '',
            billingIssue: data.billingIssue || null
          }));
        } catch(e){}
        setTimeout(function() {
          try { ssCheckoutPostToParent({ type: 'ssPaymentComplete' }); } catch(e) {}
        }, 1500);
      } else {
        // Standalone: redirect to thank-you page or returnUrl
        var returnUrl = params.get('returnUrl');
        if (returnUrl) {
          el('success-msg').textContent = 'Payment Successful — Redirecting...';
          setTimeout(function() { window.location.href = returnUrl; }, 2000);
        } else {
          // Redirect to ScaleSafe thank-you page
          var tyUrl = API_BASE + '/payment-thank-you?amount=' + encodeURIComponent((amount / 100).toFixed(2)) + '&name=' + encodeURIComponent(custName) + '&offerId=' + encodeURIComponent(offerId);
          el('success-msg').textContent = 'Payment Successful — Redirecting...';
          setTimeout(function() { window.location.href = tyUrl; }, 2000);
        }
      }
    } catch(err) {
      el('error-msg').textContent = err.message || 'Payment failed. Please try again.';
      el('error-msg').style.display = 'block';
    }
    setLoading(false);
  });

  function setLoading(on) {
    el('pay-btn').disabled = on;
    el('pay-btn').classList.toggle('hidden', on);
    el('spinner').style.display = on ? 'block' : 'none';
  }
})();
</script>
</body>
</html>`;
}

export default router;
