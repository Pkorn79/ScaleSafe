import axios from 'axios';
import { Request } from 'express';
import { config } from '../config';
import { OfferRecord } from '../repositories/offer.repository';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

export type BotProtectionPolicy = 'default' | 'off' | 'required';

export interface TurnstileRequirement {
  required: boolean;
  siteKey: string;
  reason?: string;
}

function clientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

function normalizePolicy(value: unknown): BotProtectionPolicy {
  return value === 'off' || value === 'required' ? value : 'default';
}

export const turnstileService = {
  requirementForOffer(offer?: OfferRecord | null): TurnstileRequirement {
    const turnstileConfig = (config as any).turnstile || {};
    const policy = normalizePolicy((offer as any)?.bot_protection_policy);
    const required = policy === 'required' || (policy === 'default' && turnstileConfig.enabledDefault === true);
    return {
      required,
      siteKey: turnstileConfig.siteKey || '',
      reason: required && !turnstileConfig.siteKey ? 'missing_site_key' : undefined,
    };
  },

  async verifyForOffer(req: Request, offer?: OfferRecord | null): Promise<void> {
    const requirement = this.requirementForOffer(offer);
    if (!requirement.required) return;

    const turnstileConfig = (config as any).turnstile || {};
    if (!turnstileConfig.secretKey) {
      logger.error({ offerId: offer?.id }, 'Turnstile required but TURNSTILE_SECRET_KEY is missing');
      throw new ValidationError('Security check is not configured. Please contact support.');
    }

    const token = String(req.body?.turnstileToken || req.body?.cfTurnstileResponse || '').trim();
    if (!token) {
      throw new ValidationError('Please complete the security check before continuing.');
    }

    const idempotencyKey = `${offer?.location_id || 'unknown'}:${offer?.id || 'no-offer'}:${token.slice(0, 32)}`;
    const body = new URLSearchParams();
    body.set('secret', turnstileConfig.secretKey);
    body.set('response', token);
    const ip = clientIp(req);
    if (ip) body.set('remoteip', ip);
    body.set('idempotency_key', idempotencyKey);

    try {
      const { data } = await axios.post(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 },
      );
      if (!data?.success) {
        logger.warn({
          offerId: offer?.id,
          locationId: offer?.location_id,
          errorCodes: data?.['error-codes'] || [],
        }, 'Turnstile verification rejected checkout attempt');
        throw new ValidationError('Security check expired. Please try again.');
      }
    } catch (err: any) {
      if (err instanceof ValidationError) throw err;
      logger.warn({
        offerId: offer?.id,
        locationId: offer?.location_id,
        err: err?.message || String(err),
      }, 'Turnstile verification failed');
      throw new ValidationError('Security check expired. Please try again.');
    }
  },
};
