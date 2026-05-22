import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError, AuthenticationError } from '../utils/errors';

const router = Router();

function oauthDebugResponse(debug: Record<string, unknown> | undefined) {
  if (config.isProd || !debug) return undefined;
  return debug;
}

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
      logger.error({
        debug: config.isDev ? _debug : undefined,
        hasCompany: !!companyId,
      }, 'GHL token response missing locationId');
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'GHL token response missing locationId — cannot provision merchant',
        debug: oauthDebugResponse(_debug),
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
      logger.info('Existing merchant re-authenticated');
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
      logger.info('New merchant provisioned');
    }

    // Run provisioning async — don't block the OAuth response
    // GHL expects a fast callback response; provisioning runs in background
    merchantService.provisionMerchant(locationId).catch((err) => {
      logger.error({ err }, 'Background provisioning failed');
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

    if (config.isDev) {
      logger.debug({
        ssoPayloadKeys: Object.keys(userData),
        hasLocation: !!(userData.activeLocation || userData.locationId || userData.location_id),
        hasCompany: !!(userData.companyId || userData.company_id),
        role: userData.role,
        type: userData.type,
        userType: userData.userType,
      }, 'SSO payload received');
    }

    // Try all known field names for location ID
    const locationId = userData.activeLocation || userData.locationId || userData.location_id || '';
    const companyId = userData.companyId || userData.company_id || '';

    // Find merchant — try locationId first, fall back to companyId lookup
    let merchant = locationId ? await merchantRepository.findByLocationId(locationId) : null;

    if (!merchant && companyId) {
      logger.info('No merchant found by locationId, trying companyId lookup');
      const companyMerchants = await merchantRepository.findAllByCompanyId(companyId);
      if (companyMerchants.length === 1) {
        merchant = companyMerchants[0];
        logger.info('Single merchant found for company');
      } else if (companyMerchants.length > 1) {
        logger.error({ count: companyMerchants.length },
          'SSO: multiple locations for company — cannot resolve without explicit locationId');
        throw new AuthenticationError(
          'Multiple locations found for this company. Please access ScaleSafe from a specific location.'
        );
      }
    }

    if (!merchant) {
      logger.error({ hasLocationId: !!locationId, hasCompanyId: !!companyId }, 'SSO: no merchant found');
      throw new AuthenticationError(
        'Merchant not found for this ScaleSafe install.'
      );
    }

    const resolvedLocationId = merchant.location_id;

    // Auto-provision if snapshot never completed
    logger.info({ snapshotStatus: merchant.snapshot_status }, 'Merchant snapshot status check');
    if (merchant.snapshot_status !== 'installed') {
      logger.info({ snapshotStatus: merchant.snapshot_status }, 'Snapshot not installed - triggering provisioning');
      if (merchant.snapshot_status === 'failed') {
        await merchantRepository.updateSnapshotStatus(resolvedLocationId, 'pending');
      }
      merchantService.provisionMerchant(resolvedLocationId).catch((err) => {
        logger.error({ err }, 'Background provisioning from SSO failed');
      });
    }

    logger.info('SSO session established');

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
