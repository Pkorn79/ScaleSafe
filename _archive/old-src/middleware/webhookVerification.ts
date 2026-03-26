/**
 * webhookVerification.ts — Webhook Signature Verification Middleware
 *
 * Verifies that incoming accept.blue webhooks are authentic by checking
 * the HMAC-SHA256 signature in the X-Signature header against the raw
 * request body using the merchant's webhook secret.
 *
 * The challenge: we need the merchant's webhook secret BEFORE we can verify,
 * but we don't know which merchant the webhook is for until we parse the body.
 * Solution: we parse the body first (it's already in req.body from express.json),
 * extract enough info to identify the merchant, fetch their secret, then verify
 * against req.rawBody (preserved by express.json's verify callback in app.ts).
 *
 * If verification fails, the request is rejected with 401.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAcceptBlueSignature } from '../utils/crypto';
import { WebhookVerificationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { findByLocationId } from '../repositories/merchant.repository';

/**
 * Verifies accept.blue webhook signatures.
 * Expects the merchant's location_id to be resolvable from the webhook payload
 * (via custom_fields or the ab_customer_map lookup done by the controller).
 *
 * For now, this middleware is applied AFTER the controller resolves the locationId
 * and attaches it to req.tenantContext. The controller calls verifyWebhookSignature()
 * directly rather than using this as route-level middleware, because the locationId
 * resolution requires parsing the payload first.
 */
export async function verifyAcceptBlueWebhook(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers['x-signature'] as string;
    if (!signature) {
      throw new WebhookVerificationError('Missing X-Signature header');
    }

    const rawBody = (req as any).rawBody as Buffer;
    if (!rawBody) {
      throw new WebhookVerificationError('Raw body not available for verification');
    }

    // The locationId must be set on the request before this middleware runs
    const locationId = (req as any).tenantContext?.locationId;
    if (!locationId) {
      throw new WebhookVerificationError('Cannot verify webhook — merchant not identified');
    }

    const merchant = await findByLocationId(locationId);
    if (!merchant?.ab_webhook_secret) {
      throw new WebhookVerificationError('Merchant webhook secret not configured');
    }

    const isValid = verifyAcceptBlueSignature(rawBody, signature, merchant.ab_webhook_secret);
    if (!isValid) {
      logger.warn({ locationId }, 'accept.blue webhook signature mismatch');
      throw new WebhookVerificationError();
    }

    logger.debug({ locationId }, 'accept.blue webhook signature verified');
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Standalone verification function for use in controllers.
 * Returns true/false instead of throwing, so the controller can handle
 * the error in context.
 */
export async function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  locationId: string
): Promise<boolean> {
  const merchant = await findByLocationId(locationId);
  if (!merchant?.ab_webhook_secret) {
    logger.warn({ locationId }, 'Cannot verify — no webhook secret configured');
    return false;
  }
  return verifyAcceptBlueSignature(rawBody, signature, merchant.ab_webhook_secret);
}
