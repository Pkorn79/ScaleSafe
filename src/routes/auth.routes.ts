import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError, AuthenticationError } from '../utils/errors';
import { createGhlOAuthState, verifyGhlOAuthState } from '../utils/ghl-oauth-state';
import { extractGhlSsoContext } from '../utils/ghl-sso-context';

const router = Router();
const GHL_CODE_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;

function locationOption(merchant: any) {
  const name = merchant.dba_name || merchant.business_name || merchant.location_id;
  return {
    locationId: merchant.location_id,
    name,
    status: merchant.status || '',
    snapshotStatus: merchant.snapshot_status || '',
  };
}

function selectedLocationId(req: Request): string {
  const body = req.body || {};
  const raw = body.selectedLocationId || body.locationId || body.location_id;
  return typeof raw === 'string' ? raw.trim() : '';
}

function oauthDebugResponse(debug: Record<string, unknown> | undefined) {
  if (config.isProd || !debug) return undefined;
  return debug;
}

function validateOAuthCode(code: string): void {
  if (!GHL_CODE_PATTERN.test(code)) {
    throw new ValidationError('Invalid authorization code');
  }
}

router.get('/install', (_req: Request, res: Response) => {
  const state = createGhlOAuthState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.ghl.clientId,
    redirect_uri: `${config.appUrl}/auth/callback`,
    state,
  });
  res.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`);
});

/**
 * GET /auth/callback
 * GHL OAuth callback — exchanges authorization code for tokens and provisions the merchant.
 */
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new ValidationError('Missing authorization code');
    validateOAuthCode(code);

    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (state) {
      verifyGhlOAuthState(state);
    } else if (config.isDev) {
      logger.debug('GHL OAuth callback did not include state; accepting documented Marketplace install callback');
    }

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
    const requestedLocationId = selectedLocationId(req);

    const userData = decryptSsoPayload(payload, config.ghl.ssoKey);
    const ssoContext = extractGhlSsoContext(userData);

    if (config.isDev) {
      logger.debug({
        ssoPayloadKeys: Object.keys(userData),
        hasLocation: !!ssoContext.locationId,
        hasCompany: !!ssoContext.companyId,
        role: userData.role,
        type: userData.type,
        userType: userData.userType,
      }, 'SSO payload received');
    }

    const { locationId, companyId } = ssoContext;

    // Find merchant — try locationId first, fall back to a validated agency selection.
    let merchant = locationId ? await merchantRepository.findByLocationId(locationId) : null;

    if (!merchant && companyId && requestedLocationId) {
      const selected = await merchantRepository.findByLocationId(requestedLocationId);
      if (!selected || selected.company_id !== companyId) {
        logger.warn(
          { companyId, requestedLocationId, found: !!selected },
          'SSO: selected location is not installed for this company',
        );
        throw new AuthenticationError('Selected ScaleSafe location is not available for this agency.');
      }
      merchant = selected;
      logger.info({ locationId: merchant.location_id }, 'SSO: agency user selected installed location');
    }

    if (!merchant && companyId) {
      logger.info('No merchant found by locationId, trying companyId lookup');
      const companyMerchants = await merchantRepository.findAllByCompanyId(companyId);
      if (companyMerchants.length === 1) {
        merchant = companyMerchants[0];
        logger.info('Single merchant found for company');
      } else if (companyMerchants.length > 1) {
        logger.info(
          { count: companyMerchants.length },
          'SSO: multiple locations for company — returning location choices',
        );
        res.status(409).json({
          error: 'MULTIPLE_LOCATIONS',
          message: 'Multiple ScaleSafe installs were found for this agency. Select the sub-account to open.',
          companyId,
          locations: companyMerchants
            .filter((m: any) => m?.location_id)
            .map(locationOption),
        });
        return;
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
      userId: ssoContext.userId,
      email: ssoContext.email,
      role: ssoContext.role,
      userName: ssoContext.userName,
      snapshotStatus: merchant.snapshot_status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
