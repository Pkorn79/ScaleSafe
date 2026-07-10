import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens, InstalledLocation } from '../clients/ghl.client';
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

function oauthDebugResponse(debug: Record<string, unknown> | undefined) {
  if (config.isProd || !debug) return undefined;
  return debug;
}

function validateOAuthCode(code: string): void {
  if (!GHL_CODE_PATTERN.test(code)) {
    throw new ValidationError('Invalid authorization code');
  }
}

function installTargets(locationId: string, installedLocations: InstalledLocation[] = []): InstalledLocation[] {
  if (locationId) return [{ locationId }];

  const seen = new Set<string>();
  const targets: InstalledLocation[] = [];
  for (const location of installedLocations) {
    const id = String(location.locationId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    targets.push({ locationId: id, ...(location.name ? { name: location.name } : {}) });
  }
  return targets;
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
    const { locationId, companyId, accessToken, refreshToken, expiresAt, scopes, installedLocations, _debug } = tokenResponse;
    const targets = installTargets(locationId, installedLocations);

    if (targets.length === 0) {
      logger.error({
        debug: config.isDev ? _debug : undefined,
        hasCompany: !!companyId,
      }, 'GHL OAuth callback did not resolve any installed sub-accounts');
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'GHL did not return any installed sub-accounts for this ScaleSafe app install. Confirm the Marketplace app ID and retry the install.',
        debug: oauthDebugResponse(_debug),
      });
      return;
    }

    if (!locationId || targets.length > 1) {
      const provisionTargets: string[] = [];
      const installedTargets: string[] = [];
      const failedTargets: Array<{ locationId: string; error: string }> = [];

      // Each target is isolated: one location's DB failure must never abort the
      // install for the others (a single bad row previously turned the entire
      // callback into INTERNAL_ERROR after some merchants were already created).
      for (const target of targets) {
        const targetLocationId = target.locationId;
        try {
          const existing = await merchantRepository.findByLocationId(targetLocationId);

          if (existing) {
            await merchantRepository.update(targetLocationId, {
              company_id: companyId || existing.company_id,
              ghl_access_token: accessToken,
              ghl_refresh_token: refreshToken,
              ghl_token_expires_at: expiresAt.toISOString(),
              ghl_scopes: scopes.join(' '),
              business_name: existing.business_name || target.name || undefined,
              status: 'active',
            } as any);
            logger.info({ locationId: targetLocationId }, 'Existing merchant re-authenticated');
            if (existing.snapshot_status !== 'installed') {
              provisionTargets.push(targetLocationId);
            }
          } else {
            await merchantRepository.create({
              location_id: targetLocationId,
              company_id: companyId,
              ghl_access_token: accessToken,
              ghl_refresh_token: refreshToken,
              ghl_token_expires_at: expiresAt.toISOString(),
              ghl_scopes: scopes.join(' '),
              business_name: target.name,
            });
            logger.info({ locationId: targetLocationId }, 'New merchant provisioned');
            provisionTargets.push(targetLocationId);
          }
          installedTargets.push(targetLocationId);
        } catch (targetErr: any) {
          failedTargets.push({ locationId: targetLocationId, error: targetErr?.message || String(targetErr) });
          logger.error(
            { err: targetErr?.message || String(targetErr), code: targetErr?.code, locationId: targetLocationId, step: 'merchant_upsert' },
            'Install failed for sub-account during OAuth callback',
          );
        }
      }

      if (installedTargets.length === 0) {
        // Every target failed — surface the first real error to the handler.
        throw new Error(`ScaleSafe install failed for all sub-accounts: ${failedTargets[0]?.error || 'unknown error'}`);
      }

      for (const targetLocationId of provisionTargets) {
        merchantService.provisionMerchant(targetLocationId).catch((err) => {
          logger.error({ err, locationId: targetLocationId }, 'Background provisioning failed');
        });
      }

      res.json({
        success: true,
        message: failedTargets.length
          ? 'ScaleSafe installed for some sub-accounts; others failed — see failed list'
          : 'ScaleSafe installed successfully for connected sub-accounts',
        locationId: installedTargets[0],
        locations: installedTargets,
        ...(failedTargets.length ? { failed: failedTargets.map((f) => f.locationId) } : {}),
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
 * SECURITY: a merchant session is scoped to exactly one GHL sub-account. An
 * agency-context launch (payload without a locationId) FAILS CLOSED — no
 * sub-account chooser, no single-merchant auto-pick. Cross-merchant selection
 * exists only in the ScaleSafe HQ admin console behind admin auth, never
 * behind GHL merchant SSO.
 */
router.post('/sso', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payload } = req.body;
    if (!payload) throw new ValidationError('Missing SSO payload');

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

    if (!locationId) {
      logger.warn({ hasCompanyId: !!companyId }, 'SSO: agency-context launch without a sub-account — failing closed');
      res.status(403).json({
        error: 'AGENCY_CONTEXT',
        message: 'ScaleSafe must be opened from the sub-account you want to manage. '
          + 'In GoHighLevel, switch into that sub-account and open ScaleSafe from there.',
      });
      return;
    }

    const merchant = await merchantRepository.findByLocationId(locationId);

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
