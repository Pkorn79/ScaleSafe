(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search || '');
  var paidEnrollmentToken = params.get('paidEnrollmentToken') || '';
  var offerId = params.get('offerId') || '';
  var evidenceContextToken = params.get('evidenceContextToken') || '';
  try {
    if (!evidenceContextToken && offerId) evidenceContextToken = sessionStorage.getItem('ss_evidence_context_token_' + offerId) || '';
    if (evidenceContextToken && offerId) sessionStorage.setItem('ss_evidence_context_token_' + offerId, evidenceContextToken);
  } catch (e) { /* silent */ }

  if (!paidEnrollmentToken && !evidenceContextToken && !offerId) return;

  var passthroughKeys = [
    'offerId',
    'paidEnrollmentToken',
    'evidenceContextToken',
    'paidEnrollment',
    'firstName',
    'lastName',
    'email',
    'phone',
    'paymentType',
  ];

  function appendContextToUrl(rawUrl) {
    if (!rawUrl || rawUrl.indexOf('/widgets/') === -1) return rawUrl;
    if (
      rawUrl.indexOf('/widgets/device-capture') === -1
      && rawUrl.indexOf('/widgets/offer-review') === -1
      && rawUrl.indexOf('/widgets/consent-capture') === -1
    ) {
      return rawUrl;
    }

    try {
      var url = new URL(rawUrl, window.location.href);
      passthroughKeys.forEach(function (key) {
        var value = key === 'evidenceContextToken' ? evidenceContextToken : params.get(key);
        if (value && !url.searchParams.get(key)) url.searchParams.set(key, value);
      });
      return url.toString();
    } catch (e) {
      return rawUrl;
    }
  }

  function patchFrames() {
    var frames = document.querySelectorAll('iframe');
    frames.forEach(function (frame) {
      var currentSrc = frame.getAttribute('src') || '';
      var nextSrc = appendContextToUrl(currentSrc);
      if (nextSrc && nextSrc !== currentSrc) frame.setAttribute('src', nextSrc);
    });
  }

  function fillKnownIdentityFields() {
    var fieldPairs = [
      { keys: ['firstName', 'first_name'], value: params.get('firstName') || '' },
      { keys: ['lastName', 'last_name'], value: params.get('lastName') || '' },
      { keys: ['email'], value: params.get('email') || '' },
      { keys: ['phone'], value: params.get('phone') || '' },
    ];

    fieldPairs.forEach(function (pair) {
      if (!pair.value) return;
      pair.keys.forEach(function (key) {
        var selector = [
          'input[name="' + key + '"]',
          'input[id="' + key + '"]',
          'input[placeholder*="' + key + '" i]',
        ].join(',');
        document.querySelectorAll(selector).forEach(function (input) {
          if (!input.value) {
            input.value = pair.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      });
    });
  }

  function run() {
    patchFrames();
    fillKnownIdentityFields();
    if (params.has('evidenceContextToken')) {
      try {
        params.delete('evidenceContextToken');
        var cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (e) { /* silent */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  var observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('message', function (event) {
    if (!event || !event.data || event.data.type !== 'ssPaidEnrollmentContext') return;
    run();
  });
})();
