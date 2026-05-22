import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { isMerchantWebhookSecretEnforced } from '../utils/webhook-enforcement';

function getHeaderSecret(req: Request): string {
  const direct = req.header('x-scalesafe-webhook-secret');
  if (direct) return direct.trim();

  const auth = req.header('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function shouldEnforce(): boolean {
  return isMerchantWebhookSecretEnforced();
}

function timingSafeSecretMatches(candidate: string | null | undefined, supplied: string): boolean {
  if (!candidate || !supplied) return false;
  const candidateDigest = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const suppliedDigest = crypto.createHash('sha256').update(supplied, 'utf8').digest();
  return crypto.timingSafeEqual(candidateDigest, suppliedDigest);
}

async function findMerchantForSecret(secret: string, bodyLocationId: string) {
  if (bodyLocationId) {
    const merchant = await merchantRepository.findByLocationId(bodyLocationId);
    return timingSafeSecretMatches(merchant?.webhook_secret, secret) ? merchant : null;
  }

  const merchants = await merchantRepository.listActive();
  return merchants.find((merchant) => timingSafeSecretMatches(merchant.webhook_secret, secret)) || null;
}

function observe(req: Request, reason: string, extra: Record<string, unknown> = {}) {
  logger.warn(
    {
      path: req.path,
      locationId: req.body?.locationId || req.body?.location_id || null,
      reason,
      enforce: shouldEnforce(),
      ...extra,
    },
    'GHL form webhook secret validation observation',
  );
}

export async function requireMerchantWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const enforce = shouldEnforce();
  const secret = getHeaderSecret(req);
  const bodyLocationId = String(req.body?.locationId || req.body?.location_id || '').trim();

  if (!secret) {
    observe(req, 'missing_secret');
    if (enforce) {
      res.status(401).json({ error: 'WEBHOOK_SECRET_REQUIRED' });
      return;
    }
    next();
    return;
  }

  try {
    const merchant = await findMerchantForSecret(secret, bodyLocationId);
    if (!merchant) {
      observe(req, 'invalid_secret');
      if (enforce) {
        res.status(401).json({ error: 'INVALID_WEBHOOK_SECRET' });
        return;
      }
      next();
      return;
    }

    if (bodyLocationId && merchant.location_id !== bodyLocationId) {
      observe(req, 'location_mismatch', {
        secretLocationId: merchant.location_id,
      });
      if (enforce) {
        res.status(403).json({ error: 'WEBHOOK_TENANT_MISMATCH' });
        return;
      }
      next();
      return;
    }

    (req as any).tenantContext = {
      ...(req as any).tenantContext,
      locationId: merchant.location_id,
      merchantId: merchant.id,
    };
    logger.info({ locationId: merchant.location_id, path: req.path }, 'GHL form webhook secret validated');
    next();
  } catch (err: any) {
    logger.error({ err: err.message, path: req.path }, 'GHL form webhook secret validation failed');
    if (enforce) {
      res.status(401).json({ error: 'WEBHOOK_SECRET_VALIDATION_FAILED' });
      return;
    }
    next();
  }
}
