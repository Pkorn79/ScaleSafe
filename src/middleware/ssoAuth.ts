import { Request, Response, NextFunction } from 'express';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { extractGhlSsoContext } from '../utils/ghl-sso-context';

const AGENCY_CONTEXT_MESSAGE =
  'ScaleSafe must be opened from the sub-account you want to manage. '
  + 'In GoHighLevel, switch into that sub-account and open ScaleSafe from there.';

/**
 * GHL SSO middleware.
 *
 * SECURITY: a merchant session is bound to exactly one GHL sub-account — the
 * one in the encrypted SSO payload. An agency-context payload (no locationId)
 * FAILS CLOSED: the x-location-id header can never select a location the
 * payload itself doesn't carry. Cross-merchant access lives only in the
 * ScaleSafe HQ admin console behind admin auth.
 *
 * Authentication paths:
 * 1. x-sso-payload header — encrypted SSO token from the GHL postMessage handshake.
 *    The Vue frontend obtains this via window.postMessage and sends it on every request.
 *    Backend decrypts it each time to extract tenant context.
 */
export async function ssoAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Path 1: Encrypted SSO payload (most secure)
  const ssoPayload = req.headers['x-sso-payload'] as string | undefined;
  if (ssoPayload) {
    try {
      const userData = decryptSsoPayload(ssoPayload, config.ghl.ssoKey);
      const ssoContext = extractGhlSsoContext(userData);
      if (!ssoContext.locationId) {
        return next(new AuthenticationError(AGENCY_CONTEXT_MESSAGE));
      }
      req.tenantContext = {
        locationId: ssoContext.locationId,
        companyId: ssoContext.companyId,
        userId: ssoContext.userId,
        email: ssoContext.email,
        role: ssoContext.role,
      };
      return next();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return next(err);
      }
      logger.warn({ err }, 'SSO payload decryption failed');
      return next(new AuthenticationError('Invalid SSO payload'));
    }
  }

  // Path 2: locationId from validated SSO session
  const locationId = req.headers['x-location-id'] as string | undefined;
  // Development/test shortcut only. Production must use encrypted GHL SSO payloads.
  const allowDevLocationAuth = config.nodeEnv !== 'production' && process.env.ALLOW_DEV_LOCATION_AUTH === 'true';
  if (locationId && allowDevLocationAuth) {
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
      const ssoContext = extractGhlSsoContext(userData);
      if (!ssoContext.locationId) {
        return next(new AuthenticationError(AGENCY_CONTEXT_MESSAGE));
      }
      req.tenantContext = {
        locationId: ssoContext.locationId,
        companyId: ssoContext.companyId,
        userId: ssoContext.userId,
        email: ssoContext.email,
        role: ssoContext.role,
      };
      return next();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return next(err);
      }
      logger.warn({ err }, 'SSO query param decryption failed');
      return next(new AuthenticationError('Invalid SSO key'));
    }
  }

  return next(new AuthenticationError('Missing SSO authentication'));
}
