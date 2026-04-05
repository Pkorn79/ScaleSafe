/* eslint-disable @typescript-eslint/no-var-requires */
const Stripe = require('stripe');
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { ProcessorError } from '../errors/processor.error';
import { logger } from '../utils/logger';

const WEBHOOK_EVENTS: string[] = [
  // Dispute lifecycle
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  // Early Fraud Warnings
  'radar.early_fraud_warning.created',
  // Payment failures
  'payment_intent.payment_failed',
  // Charge events (for evidence vault)
  'charge.succeeded',
  'charge.refunded',
];

function getStripe(): any {
  return new Stripe(config.stripe.secretKey, {
    apiVersion: '2025-03-31.basil',
  });
}

export const stripeConnectService = {
  /**
   * Generate the Stripe Connect authorization URL.
   * Merchant clicks this to start the OAuth flow.
   */
  generateAuthUrl(locationId: string, merchantEmail?: string): string {
    const params = new URLSearchParams({
      client_id: config.stripe.clientId,
      response_type: 'code',
      scope: 'read_write',
      redirect_uri: `${config.appUrl}/auth/stripe/callback`,
      state: locationId,
    });

    if (merchantEmail) {
      params.set('stripe_user[email]', merchantEmail);
    }

    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  },

  /**
   * Handle the OAuth callback. Exchange code for stripe_user_id.
   */
  async handleCallback(code: string, state: string): Promise<{
    stripeUserId: string;
    scope: string;
    livemode: boolean;
  }> {
    const stripe = getStripe();

    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    if (!response.stripe_user_id) {
      throw new ProcessorError(
        'Stripe OAuth response missing stripe_user_id',
        'stripe',
        'OAUTH_MISSING_ACCOUNT_ID',
      );
    }

    logger.info(
      { locationId: state, stripeUserId: response.stripe_user_id },
      'Stripe Connect OAuth completed',
    );

    return {
      stripeUserId: response.stripe_user_id,
      scope: response.scope || 'read_write',
      livemode: response.livemode ?? false,
    };
  },

  /**
   * Register webhooks on the connected merchant's Stripe account.
   */
  async registerWebhooks(stripeUserId: string, locationId: string): Promise<string> {
    const stripe = getStripe();

    const webhookUrl = `${config.appUrl}/webhooks/stripe/${locationId}`;

    const endpoint = await stripe.webhookEndpoints.create(
      {
        url: webhookUrl,
        enabled_events: WEBHOOK_EVENTS,
        description: `ScaleSafe webhooks for ${locationId}`,
      },
      { stripeAccount: stripeUserId },
    );

    logger.info(
      { locationId, endpointId: endpoint.id },
      'Stripe webhook endpoint registered',
    );

    return endpoint.id;
  },

  /**
   * Store the Stripe connection in processor_configs and update the merchant record.
   */
  async saveConnection(
    merchantId: string,
    locationId: string,
    stripeUserId: string,
    webhookEndpointId?: string,
  ): Promise<void> {
    const supabase = getSupabase();

    // Upsert processor_configs row
    const { error: configError } = await supabase
      .from('processor_configs')
      .upsert(
        {
          merchant_id: merchantId,
          location_id: locationId,
          processor_type: 'stripe',
          label: 'Stripe Connect',
          stripe_user_id: stripeUserId,
          stripe_webhook_endpoint_id: webhookEndpointId || null,
          is_active: true,
          is_default: true,
        },
        { onConflict: 'merchant_id,processor_type,nmi_processor_id' },
      );

    if (configError) {
      logger.error({ err: configError }, 'Failed to save Stripe processor config');
      throw new ProcessorError(
        `Failed to save Stripe config: ${configError.message}`,
        'stripe',
        configError.code,
      );
    }

    // Update merchant record
    const { error: merchantError } = await supabase
      .from('merchants')
      .update({
        stripe_connected: true,
        stripe_user_id: stripeUserId,
      })
      .eq('id', merchantId);

    if (merchantError) {
      logger.error({ err: merchantError }, 'Failed to update merchant Stripe status');
    }
  },

  /**
   * Disconnect a merchant's Stripe account.
   */
  async disconnect(stripeUserId: string, webhookEndpointId?: string): Promise<void> {
    const stripe = getStripe();

    // Remove webhook endpoint if we have one
    if (webhookEndpointId) {
      try {
        await stripe.webhookEndpoints.del(
          webhookEndpointId,
          { stripeAccount: stripeUserId },
        );
      } catch (err) {
        logger.warn({ stripeUserId, webhookEndpointId }, 'Failed to delete webhook endpoint');
      }
    }

    // Deauthorize the connected account
    try {
      await stripe.oauth.deauthorize({
        client_id: config.stripe.clientId,
        stripe_user_id: stripeUserId,
      });
    } catch (err) {
      logger.warn({ stripeUserId }, 'Failed to deauthorize Stripe account');
    }

    logger.info({ stripeUserId }, 'Stripe account disconnected');
  },

  /**
   * Verify a connected account is still valid and accessible.
   */
  async verifyConnection(stripeUserId: string): Promise<{ valid: boolean; accountName?: string }> {
    const stripe = getStripe();

    try {
      const account = await stripe.accounts.retrieve(stripeUserId);
      return {
        valid: true,
        accountName: account.business_profile?.name || account.id,
      };
    } catch (err) {
      return { valid: false };
    }
  },
};
