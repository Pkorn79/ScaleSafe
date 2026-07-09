import { Request, Response, NextFunction } from 'express';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { extractGhlSsoContext } from '../utils/ghl-sso-context';
import { merchantRepository } from '../repositories/merchant.repository';

/**
 * GHL SSO middleware.
 *
 * Authentication paths:
 * 1. x-sso-payload header — encrypted SSO token from the GHL postMessage handshake.
 *    The Vue frontend obtains this via window.postMessage and sends it on every request.
 *    Backend decrypts it each time to extract tenant context.
 *
 * 2. x-location-id header — after the frontend has called POST /auth/sso and received
 *    the decrypted context, it can send the locationId directly for subsequent calls.
 *    Less secure but sufficient when the initial SSO was validated.
 */
async function resolveAgencySelectedLocation(
  companyId: string,
  selectedLocationId: string | undefined,
): Promise<string> {
  const locationId = String(selectedLocationId || '').trim();
  if (!companyId || !locationId) return '';

  const merchant = await merchantRepository.findByLocationId(locationId);
  if (!merchant || merchant.company_id !== companyId) {
    throw new AuthenticationError('Selected ScaleSafe location is not available for this agency.');
  }
  return merchant.location_id;
}

export async function ssoAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Path 1: Encrypted SSO payload (most secure)
  const ssoPayload = req.headers['x-sso-payload'] as string | undefined;
  if (ssoPayload) {
    try {
      const userData = decryptSsoPayload(ssoPayload, config.ghl.ssoKey);
      const ssoContext = extractGhlSsoContext(userData);
      const selectedLocationId = req.headers['x-location-id'] as string | undefined;
      const locationId = ssoContext.locationId
        || await resolveAgencySelectedLocation(ssoContext.companyId, selectedLocationId);
      req.tenantContext = {
        locationId,
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
      const selectedLocationId = req.headers['x-location-id'] as string | undefined;
      const locationId = ssoContext.locationId
        || await resolveAgencySelectedLocation(ssoContext.companyId, selectedLocationId);
      req.tenantContext = {
        locationId,
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
