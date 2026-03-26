/**
 * tenantContext.ts — Tenant Context Middleware
 *
 * Extracts the merchant's locationId from various sources and attaches it
 * to the request as req.tenantContext. Downstream handlers use this to
 * scope all operations to the correct merchant.
 *
 * Sources of locationId (checked in order):
 * 1. SSO-decrypted context (already set by ssoAuth middleware)
 * 2. Query parameter ?locationId=xxx
 * 3. Request body field location_id (for webhooks)
 * 4. Request body field locationId (alternate casing)
 *
 * Also loads the full merchant config from Supabase and caches it on the request
 * so services don't need to re-fetch it.
 */

import { Request, Response, NextFunction } from 'express';
import { findByLocationId } from '../repositories/merchant.repository';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Extracts locationId from the request and loads merchant config.
 * Used on API routes that need merchant context but aren't using SSO
 * (e.g., webhook routes where locationId comes from the payload).
 */
export async function tenantContext(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // If SSO already set the context, just load the merchant config
    let locationId = (req as any).tenantContext?.locationId;

    // Try to extract from various sources
    if (!locationId) {
      locationId =
        (req.query.locationId as string) ||
        req.body?.location_id ||
        req.body?.locationId;
    }

    if (!locationId) {
      throw new AuthenticationError('Cannot determine merchant — missing locationId');
    }

    // Load merchant config from Supabase
    const merchant = await findByLocationId(locationId);
    if (!merchant) {
      throw new AuthenticationError(`No merchant found for location: ${locationId}`);
    }

    if (merchant.status !== 'active') {
      throw new AuthenticationError(`Merchant is ${merchant.status}: ${locationId}`);
    }

    // Attach full context to request
    (req as any).tenantContext = {
      ...(req as any).tenantContext,
      locationId,
      merchant,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Lightweight version that only extracts locationId without loading merchant config.
 * Used for webhook routes where we need the locationId for idempotency checking
 * but don't necessarily need the full merchant record yet.
 */
export function extractLocationId(req: Request): string | null {
  return (
    (req as any).tenantContext?.locationId ||
    (req.query.locationId as string) ||
    req.body?.location_id ||
    req.body?.locationId ||
    null
  );
}
