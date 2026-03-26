/**
 * ssoAuth.ts — SSO Authentication Middleware
 *
 * When a merchant opens a ScaleSafe page inside GHL (as an embedded iframe),
 * GHL sends an encrypted SSO key containing the user's session info
 * (userId, locationId, companyId, etc.).
 *
 * This middleware decrypts that key and attaches the tenant context to the request.
 * Routes that require merchant authentication use this middleware.
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { decryptSSOData } from '../utils/crypto';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

/** Decrypts the SSO key from the request and attaches tenant context. */
export function ssoAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const ssoKey = req.headers['x-sso-key'] as string || req.body?.key;

    if (!ssoKey) {
      throw new AuthenticationError('Missing SSO key');
    }

    const ssoData = decryptSSOData(ssoKey, config.ghl.ssoKey);

    // Attach tenant context to the request for downstream use
    (req as any).tenantContext = {
      locationId: ssoData.locationId as string,
      companyId: ssoData.companyId as string,
      userId: ssoData.userId as string,
      email: ssoData.email as string,
      role: ssoData.role as string,
    };

    logger.debug({ locationId: ssoData.locationId }, 'SSO authenticated');
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      next(error);
    } else {
      logger.error({ error }, 'SSO decryption failed');
      next(new AuthenticationError('Invalid SSO key'));
    }
  }
}
