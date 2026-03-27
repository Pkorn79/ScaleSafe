import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError, AuthenticationError } from '../utils/errors';

const router = Router();

/**
 * GET /auth/callback
 * GHL OAuth callback — exchanges authorization code for tokens and provisions the merchant.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    if (!code) throw new ValidationError('Missing authorization code');

    logger.info('OAuth callback received, exchanging code for tokens');

    const tokenResponse = await exchangeCodeForTokens(code);
    const { locationId, companyId, accessToken, refreshToken, expiresAt, scopes } = tokenResponse;

    if (!locationId) {
      throw new ValidationError('GHL token response missing locationId — cannot provision merchant');
    }

    // Check if merchant already exists (re-install scenario)
    const existing = await merchantRepository.findByLocationId(locationId);

    if (existing) {
      // Re-install: update tokens, reactivate if uninstalled
      await merchantRepository.update(locationId, {
        ghl_access_token: accessToken,
        ghl_refresh_token: refreshToken,
        ghl_token_expires_at: expiresAt.toISOString(),
        ghl_scopes: scopes.join(' '),
        status: 'active',
      } as any);
      logger.info({ locationId }, 'Existing merchant re-authenticated');
    } else {
      // New install: create merchant record
      await merchantRepository.create({
        location_id: locationId,
        company_id: companyId,
        ghl_access_token: accessToken,
        ghl_refresh_token: refreshToken,
        ghl_token_expires_at: expiresAt.toISOString(),
        ghl_scopes: scopes.join(' '),
      });
      logger.info({ locationId, companyId }, 'New merchant provisioned');
    }

    // Run provisioning async — don't block the OAuth response
    // GHL expects a fast callback response; provisioning runs in background
    merchantService.provisionMerchant(locationId).catch((err) => {
      logger.error({ err, locationId }, 'Background provisioning failed');
    });

    res.json({ success: true, message: 'ScaleSafe installed successfully', locationId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/sso
 * Decrypts the GHL SSO payload sent by the frontend via postMessage handshake.
 * Returns decrypted user/location context for the Vue app to use in subsequent API calls.
 */
router.post('/sso', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payload } = req.body;
    if (!payload) throw new ValidationError('Missing SSO payload');

    const userData = decryptSsoPayload(payload, config.ghl.ssoKey);
    const locationId = userData.activeLocation || userData.locationId || '';
    const companyId = userData.companyId || '';

    if (!locationId) {
      throw new AuthenticationError('SSO payload missing location context');
    }

    // Verify merchant exists
    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      throw new AuthenticationError(`Merchant not found for location ${locationId}`);
    }

    // Auto-provision if snapshot never ran (e.g., merchant installed before provisioning code existed)
    if (merchant.snapshot_status === 'pending') {
      logger.info({ locationId }, 'Snapshot pending — triggering provisioning on SSO login');
      merchantService.provisionMerchant(locationId).catch((err) => {
        logger.error({ err, locationId }, 'Background provisioning from SSO failed');
      });
    }

    logger.info({ locationId, userId: userData.userId, email: userData.email }, 'SSO session established');

    res.json({
      locationId,
      companyId,
      userId: userData.userId || '',
      email: userData.email || '',
      role: userData.role || 'user',
      userName: userData.userName || '',
      snapshotStatus: merchant.snapshot_status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
