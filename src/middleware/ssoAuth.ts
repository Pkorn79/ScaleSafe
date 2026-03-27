import { Request, Response, NextFunction } from 'express';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * GHL SSO middleware.
 * Decrypts the SSO key from the request to extract tenant context.
 * Used on routes that render inside the GHL iframe.
 */
export function ssoAuth(req: Request, _res: Response, next: NextFunction): void {
  // GHL sends the SSO token as "sso_key" (snake_case) in the Custom Page URL
  const ssoKey = (
    req.query.sso_key || req.query.ssoKey || req.headers['x-sso-key']
  ) as string | undefined;

  if (!ssoKey) {
    logger.debug({ query: Object.keys(req.query), headers: Object.keys(req.headers) }, 'SSO key not found in request');
    return next(new AuthenticationError('Missing SSO key'));
  }

  try {
    const payload = decryptSsoPayload(ssoKey, config.ghl.ssoKey);
    req.tenantContext = {
      locationId: payload.locationId || payload.location_id,
      companyId: payload.companyId || payload.company_id,
      userId: payload.userId || payload.user_id,
      email: payload.email,
      role: payload.role || 'user',
    };
    next();
  } catch (err) {
    logger.warn({ err }, 'SSO decryption failed');
    next(new AuthenticationError('Invalid SSO key'));
  }
}
