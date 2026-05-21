import { Router, Request, Response, NextFunction } from 'express';
import { stripeConnectService } from '../services/stripe-connect.service';
import { stripeRiskAuditService } from '../services/stripe-risk-audit.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { ssoAuth } from '../middleware/ssoAuth';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const router = Router();

/**
 * GET /auth/stripe/connect
 * Generates the OAuth URL and redirects the merchant to Stripe.
 */
router.get('/connect', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.tenantContext?.locationId;
    const email = req.query.email as string | undefined;

    if (!locationId) {
      throw new ValidationError('Missing locationId');
    }

    const url = stripeConnectService.generateAuthUrl(locationId, email);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/stripe/connect-url
 * Authenticated SPA helper. Returns the Stripe OAuth URL so the browser can
 * open it in a popup while keeping SSO headers on this request.
 */
router.get('/connect-url', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.tenantContext?.locationId;
    const email = (req.query.email as string | undefined) || req.tenantContext?.email;

    if (!locationId) {
      throw new ValidationError('Missing locationId');
    }

    res.json({ url: stripeConnectService.generateAuthUrl(locationId, email) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/stripe/callback
 * Handles the redirect from Stripe after merchant authorizes.
 *
 * The merchant launches OAuth from a popup window opened by the SPA (which
 * stays inside the GHL iframe with SSO intact). This endpoint always renders
 * an HTML page that posts the result back to `window.opener` and self-closes,
 * so the iframe never has to be navigated.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      logger.warn({ error, state }, 'Stripe OAuth denied by merchant');
      sendPopupResult(res, false, 'denied');
      return;
    }

    if (!code || !state) {
      throw new ValidationError('Missing code or state in Stripe callback');
    }

    let locationId: string;
    try {
      locationId = stripeConnectService.parseCallbackState(state);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Stripe OAuth callback state rejected');
      sendPopupResult(res, false, 'invalid_state');
      return;
    }

    // Exchange code for stripe_user_id
    let result;
    try {
      result = await stripeConnectService.handleCallback(code, locationId);
    } catch (err: any) {
      logger.error({ err: err.message, code: err.code, locationId }, 'Stripe OAuth token exchange failed');
      sendPopupResult(res, false, 'Token exchange failed: ' + (err.message || 'unknown'));
      return;
    }

    // Look up merchant by locationId
    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      logger.error({ locationId }, 'Stripe callback: merchant not found');
      sendPopupResult(res, false, 'merchant_not_found');
      return;
    }

    // Register webhooks on the connected account
    let webhookEndpointId: string | undefined;
    try {
      webhookEndpointId = await stripeConnectService.registerWebhooks(
        result.stripeUserId,
        locationId,
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to register Stripe webhooks — continuing');
    }

    // Save connection
    try {
      await stripeConnectService.saveConnection(
        merchant.id,
        locationId,
        result.stripeUserId,
        webhookEndpointId,
      );
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to save Stripe connection');
      sendPopupResult(res, false, 'Save failed: ' + (err.message || 'unknown'));
      return;
    }

    logger.info(
      { locationId, stripeUserId: result.stripeUserId },
      'Stripe Connect fully provisioned',
    );

    // Fire risk audit asynchronously — don't block the callback
    setImmediate(async () => {
      try {
        await stripeRiskAuditService.runAudit(merchant.id);
      } catch (err: any) {
        logger.warn({ err: err.message, merchantId: merchant.id }, 'Background risk audit failed');
      }
    });

    sendPopupResult(res, true);
  } catch (err) {
    next(err);
  }
});

/**
 * Render the popup-result page. Posts a `stripe_connect_result` message to
 * `window.opener` (the SPA still running inside GHL) and self-closes. If
 * there is no opener (direct visit, etc.) the user sees a status line.
 */
function sendPopupResult(res: Response, success: boolean, error?: string): void {
  const payload = JSON.stringify({
    type: 'stripe_connect_result',
    success,
    error: error || null,
  }).replace(/</g, '\\u003c');

  const status = success
    ? 'Stripe connected. You can close this window.'
    : 'Stripe connection failed: ' + (error || 'unknown') + '. You can close this window.';
  const safeStatus = status.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Stripe Connect</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #334155; text-align: center; padding: 60px 24px; background: #f8fafc; }
  p { font-size: 14px; }
</style>
</head>
<body>
<p>${safeStatus}</p>
<script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(${payload}, window.location.origin);
    }
  } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
})();
</script>
</body>
</html>`);
}

/**
 * POST /api/stripe/disconnect
 * Disconnects merchant's Stripe account. SSO required.
 */
router.post('/disconnect', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.body.locationId || req.tenantContext?.locationId;
    if (!locationId) throw new ValidationError('Missing locationId');

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    if (!merchant.stripe_user_id) {
      res.status(400).json({ error: 'No Stripe account connected' });
      return;
    }

    // Get webhook endpoint ID from processor_configs
    const { getSupabase } = await import('../clients/supabase.client');
    const { data: configRow } = await getSupabase()
      .from('processor_configs')
      .select('stripe_webhook_endpoint_id')
      .eq('merchant_id', merchant.id)
      .eq('processor_type', 'stripe')
      .single();

    await stripeConnectService.disconnect(
      merchant.stripe_user_id,
      configRow?.stripe_webhook_endpoint_id,
    );

    // Update DB
    const supabase = getSupabase();
    await supabase
      .from('processor_configs')
      .update({ is_active: false })
      .eq('merchant_id', merchant.id)
      .eq('processor_type', 'stripe');

    await supabase
      .from('merchants')
      .update({ stripe_connected: false, stripe_user_id: null })
      .eq('id', merchant.id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stripe/risk-audit
 * Fetch the latest risk audit for the current merchant.
 */
router.get('/risk-audit', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.tenantContext?.locationId;
    if (!locationId) throw new ValidationError('Missing locationId');

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    const audit = await stripeRiskAuditService.getLatestAudit(merchant.id);
    res.json(audit || null);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/risk-audit
 * Trigger a new risk audit for the current merchant.
 */
router.post('/risk-audit', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.tenantContext?.locationId || req.body.locationId;
    if (!locationId) throw new ValidationError('Missing locationId');

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }

    const audit = await stripeRiskAuditService.runAudit(merchant.id);
    res.json(audit);
  } catch (err) {
    next(err);
  }
});

export default router;
