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
router.get('/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.query.locationId as string;
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
 * GET /auth/stripe/callback
 * Handles the redirect from Stripe after merchant authorizes.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string; // locationId
    const error = req.query.error as string;

    if (error) {
      logger.warn({ error, state }, 'Stripe OAuth denied by merchant');
      res.redirect('/?stripe_error=denied');
      return;
    }

    if (!code || !state) {
      throw new ValidationError('Missing code or state in Stripe callback');
    }

    // Exchange code for stripe_user_id
    const result = await stripeConnectService.handleCallback(code, state);

    // Look up merchant by locationId
    const merchant = await merchantRepository.findByLocationId(state);
    if (!merchant) {
      logger.error({ locationId: state }, 'Stripe callback: merchant not found');
      res.redirect('/?stripe_error=merchant_not_found');
      return;
    }

    // Register webhooks on the connected account
    let webhookEndpointId: string | undefined;
    try {
      webhookEndpointId = await stripeConnectService.registerWebhooks(
        result.stripeUserId,
        state,
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to register Stripe webhooks — continuing');
    }

    // Save connection
    await stripeConnectService.saveConnection(
      merchant.id,
      state,
      result.stripeUserId,
      webhookEndpointId,
    );

    logger.info(
      { locationId: state, stripeUserId: result.stripeUserId },
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

    res.redirect('/?stripe_connected=true');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/stripe/disconnect
 * Disconnects merchant's Stripe account. SSO required.
 */
router.post('/disconnect', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = req.body.locationId || (req as any).locationId;
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
    const locationId = (req as any).locationId;
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
    const locationId = (req as any).locationId || req.body.locationId;
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
