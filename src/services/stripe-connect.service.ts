/* eslint-disable @typescript-eslint/no-var-requires */
import * as crypto from 'crypto';
const Stripe = require('stripe');
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { ProcessorError } from '../errors/processor.error';
import { logger } from '../utils/logger';
import { encrypt } from './processor-config.service';

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
  'payment_intent.processing',
  'payment_intent.payment_failed',
  // Charge events (for evidence vault)
  'charge.succeeded',
  'payment_intent.succeeded',
  'charge.refunded',
  // Subscription lifecycle
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.deleted',
  'customer.subscription.updated',
];

const STATE_MAX_AGE_MS = 60 * 60 * 1000;

function getStripe(): any {
  return new Stripe(config.stripe.secretKey);
}

function stripeStateSecret(): string {
  return config.processorEncryptionKey || config.ghl?.ssoKey || config.stripe.secretKey;
}

function signStatePayload(payload: string): string {
  return crypto.createHmac('sha256', stripeStateSecret()).update(payload).digest('base64url');
}

function generateSignedState(locationId: string): string {
  const payload = Buffer.from(JSON.stringify({
    locationId,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');
  return `${payload}.${signStatePayload(payload)}`;
}

function unsignedStripeStateAllowed(state: string): boolean {
  return process.env.ALLOW_UNSIGNED_STRIPE_STATE === 'true'
    && /^[A-Za-z0-9_-]+$/.test(state);
}

export const stripeConnectService = {
  /**
   * Generate the Stripe Connect authorization URL.
   * Merchant clicks this to start the OAuth flow.
   */
  generateAuthUrl(locationId: string, merchantEmail?: string): string {
    const state = generateSignedState(locationId);
    const params = new URLSearchParams({
      client_id: config.stripe.clientId,
      response_type: 'code',
      scope: 'read_write',
      redirect_uri: `${config.appUrl}/auth/stripe/callback`,
      state,
    });

    if (merchantEmail) {
      params.set('stripe_user[email]', merchantEmail);
    }

    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  },

  /**
   * Verify the callback state and return the intended location.
   */
  parseCallbackState(state: string): string {
    const parts = state.split('.');
    const [payload, signature] = parts;
    if (parts.length !== 2) {
      if (unsignedStripeStateAllowed(state)) return state;
      throw new ProcessorError('Invalid Stripe OAuth state', 'stripe', 'OAUTH_INVALID_STATE');
    }

    if (!payload || !signature) {
      if (unsignedStripeStateAllowed(state)) return state;
      throw new ProcessorError('Invalid Stripe OAuth state', 'stripe', 'OAUTH_INVALID_STATE');
    }

    const expected = signStatePayload(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new ProcessorError('Invalid Stripe OAuth state signature', 'stripe', 'OAUTH_INVALID_STATE');
    }

    let parsed: { locationId?: unknown; issuedAt?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new ProcessorError('Invalid Stripe OAuth state payload', 'stripe', 'OAUTH_INVALID_STATE');
    }

    if (typeof parsed.locationId !== 'string' || !parsed.locationId) {
      throw new ProcessorError('Stripe OAuth state missing location', 'stripe', 'OAUTH_INVALID_STATE');
    }

    if (typeof parsed.issuedAt !== 'number' || Date.now() - parsed.issuedAt > STATE_MAX_AGE_MS) {
      throw new ProcessorError('Expired Stripe OAuth state', 'stripe', 'OAUTH_EXPIRED_STATE');
    }

    return parsed.locationId;
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
  async registerWebhooks(stripeUserId: string, locationId: string): Promise<{
    endpointId: string;
    signingSecret?: string;
  }> {
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

    return {
      endpointId: endpoint.id,
      signingSecret: endpoint.secret || undefined,
    };
  },

  /**
   * Store the Stripe connection in processor_configs and update the merchant record.
   */
  async saveConnection(
    merchantId: string,
    locationId: string,
    stripeUserId: string,
    webhookEndpointId?: string,
    webhookSigningSecret?: string,
  ): Promise<void> {
    const supabase = getSupabase();

    // Check if a Stripe config already exists for this merchant
    const { data: existing } = await supabase
      .from('processor_configs')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('processor_type', 'stripe')
      .maybeSingle();

    if (existing) {
      const updates: Record<string, any> = {
        location_id: locationId,
        stripe_user_id: stripeUserId,
        stripe_webhook_endpoint_id: webhookEndpointId || null,
        is_active: true,
        is_default: true,
        label: 'Stripe Connect',
      };
      if (webhookSigningSecret) {
        updates.stripe_webhook_secret_encrypted = encrypt(webhookSigningSecret);
      }

      const { error: updateError } = await supabase
        .from('processor_configs')
        .update(updates)
        .eq('id', existing.id);

      if (updateError) {
        logger.error({ err: updateError }, 'Failed to update Stripe processor config');
        throw new ProcessorError(
          `Failed to update Stripe config: ${updateError.message}`,
          'stripe',
          updateError.code,
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from('processor_configs')
        .insert({
          merchant_id: merchantId,
          location_id: locationId,
          processor_type: 'stripe',
          label: 'Stripe Connect',
          stripe_user_id: stripeUserId,
          stripe_webhook_endpoint_id: webhookEndpointId || null,
          stripe_webhook_secret_encrypted: webhookSigningSecret ? encrypt(webhookSigningSecret) : null,
          is_active: true,
          is_default: true,
        });

      if (insertError) {
        logger.error({ err: insertError }, 'Failed to insert Stripe processor config');
        throw new ProcessorError(
          `Failed to save Stripe config: ${insertError.message}`,
          'stripe',
          insertError.code,
        );
      }
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
