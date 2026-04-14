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
    const { locationId, companyId, accessToken, refreshToken, expiresAt, scopes, _debug } = tokenResponse;

    if (!locationId) {
      logger.error({ debug: _debug, companyId }, 'GHL token response missing locationId');
      // Return debug info directly in response so we can diagnose without logs
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'GHL token response missing locationId — cannot provision merchant',
        companyId: companyId || 'none',
        debug: _debug,
      });
      return;
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
 *
 * GHL may send locationId under different field names depending on whether the user
 * is accessing from a sub-account or agency level. When only companyId is present,
 * we look up the merchant by company_id instead.
 */
router.post('/sso', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payload } = req.body;
    if (!payload) throw new ValidationError('Missing SSO payload');

    const userData = decryptSsoPayload(payload, config.ghl.ssoKey);

    // Log the full SSO payload keys and location-related fields for debugging
    logger.info({
      ssoPayloadKeys: Object.keys(userData),
      activeLocation: userData.activeLocation,
      locationId: userData.locationId,
      location_id: userData.location_id,
      companyId: userData.companyId,
      company_id: userData.company_id,
      userId: userData.userId,
      role: userData.role,
      type: userData.type,
      userType: userData.userType,
    }, 'SSO payload received');

    // Try all known field names for location ID
    const locationId = userData.activeLocation || userData.locationId || userData.location_id || '';
    const companyId = userData.companyId || userData.company_id || '';

    // Find merchant — try locationId first, fall back to companyId lookup
    let merchant = locationId ? await merchantRepository.findByLocationId(locationId) : null;

    if (!merchant && companyId) {
      logger.info({ companyId }, 'No merchant found by locationId, trying companyId lookup');
      const companyMerchants = await merchantRepository.findAllByCompanyId(companyId);
      if (companyMerchants.length === 1) {
        merchant = companyMerchants[0];
        logger.info({ companyId, locationId: merchant.location_id }, 'Single merchant found for company');
      } else if (companyMerchants.length > 1) {
        logger.error({ companyId, count: companyMerchants.length, locations: companyMerchants.map(m => m.location_id) },
          'SSO: multiple locations for company — cannot resolve without explicit locationId');
        throw new AuthenticationError(
          'Multiple locations found for this company. Please access ScaleSafe from a specific location.'
        );
      }
    }

    if (!merchant) {
      logger.error({ locationId, companyId, ssoKeys: Object.keys(userData) }, 'SSO: no merchant found');
      throw new AuthenticationError(
        `Merchant not found — locationId=${locationId || 'none'}, companyId=${companyId || 'none'}`
      );
    }

    const resolvedLocationId = merchant.location_id;

    // Auto-provision if snapshot never completed
    logger.info({ locationId: resolvedLocationId, snapshotStatus: merchant.snapshot_status }, 'Merchant snapshot status check');
    if (merchant.snapshot_status !== 'installed') {
      logger.info({ locationId: resolvedLocationId, snapshotStatus: merchant.snapshot_status }, 'Snapshot not installed — triggering provisioning');
      if (merchant.snapshot_status === 'failed') {
        await merchantRepository.updateSnapshotStatus(resolvedLocationId, 'pending');
      }
      merchantService.provisionMerchant(resolvedLocationId).catch((err) => {
        logger.error({ err, locationId: resolvedLocationId }, 'Background provisioning from SSO failed');
      });
    }

    logger.info({ locationId: resolvedLocationId, userId: userData.userId, email: userData.email }, 'SSO session established');

    res.json({
      locationId: resolvedLocationId,
      companyId,
      userId: userData.userId || userData.user_id || '',
      email: userData.email || '',
      role: userData.role || 'user',
      userName: userData.userName || userData.name || '',
      snapshotStatus: merchant.snapshot_status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
