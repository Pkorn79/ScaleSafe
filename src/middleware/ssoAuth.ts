import { Request, Response, NextFunction } from 'express';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * GHL SSO middleware.
 *
 * Two authentication paths:
 * 1. x-sso-payload header — encrypted SSO token from the GHL postMessage handshake.
 *    The Vue frontend obtains this via window.postMessage and sends it on every request.
 *    Backend decrypts it each time to extract tenant context.
 *
 * 2. x-location-id header — after the frontend has called POST /auth/sso and received
 *    the decrypted context, it can send the locationId directly for subsequent calls.
 *    Less secure but sufficient when the initial SSO was validated.
 */
export function ssoAuth(req: Request, _res: Response, next: NextFunction): void {
  // Path 1: Encrypted SSO payload (most secure)
  const ssoPayload = req.headers['x-sso-payload'] as string | undefined;
  if (ssoPayload) {
    try {
      const userData = decryptSsoPayload(ssoPayload, config.ghl.ssoKey);
      req.tenantContext = {
        locationId: userData.activeLocation || userData.locationId || '',
        companyId: userData.companyId || '',
        userId: userData.userId || '',
        email: userData.email || '',
        role: userData.role || 'user',
      };
      return next();
    } catch (err) {
      logger.warn({ err }, 'SSO payload decryption failed');
      return next(new AuthenticationError('Invalid SSO payload'));
    }
  }

  // Path 2: locationId from validated SSO session
  const locationId = req.headers['x-location-id'] as string | undefined;
  if (locationId) {
    req.tenantContext = {
      locationId,
      companyId: (req.headers['x-company-id'] as string) || '',
      userId: (req.headers['x-user-id'] as string) || '',
      email: '',
      role: 'user',
    };
    return next();
  }

  // Path 3: Legacy query param support (for direct URL testing)
  const ssoKey = (req.query.sso_key || req.query.ssoKey) as string | undefined;
  if (ssoKey) {
    try {
      const userData = decryptSsoPayload(ssoKey, config.ghl.ssoKey);
      req.tenantContext = {
        locationId: userData.activeLocation || userData.locationId || '',
        companyId: userData.companyId || '',
        userId: userData.userId || '',
        email: userData.email || '',
        role: userData.role || 'user',
      };
      return next();
    } catch (err) {
      logger.warn({ err }, 'SSO query param decryption failed');
      return next(new AuthenticationError('Invalid SSO key'));
    }
  }

  return next(new AuthenticationError('Missing SSO authentication'));
}
