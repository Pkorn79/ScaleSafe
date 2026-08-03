import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens, InstalledLocation, TokenResponse } from '../clients/ghl.client';
import { merchantHasOAuthCredentials, merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { decryptSsoPayload } from '../utils/crypto';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError, AuthenticationError, ServiceUnavailableError } from '../utils/errors';
import { createGhlOAuthState, verifyGhlOAuthState } from '../utils/ghl-oauth-state';
import { assertActiveGhlMerchantBinding, extractGhlSsoContext } from '../utils/ghl-sso-context';
import {
  marketplaceEntitlementForMerchant,
  marketplacePlanKey,
} from '../services/marketplace-entitlement.service';

const router = Router();
const GHL_CODE_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;
const INSTALL_SETTLING_WINDOW_MS = 10 * 60 * 1000;

function isRecentLifecycleTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && Date.now() - timestamp >= 0
    && Date.now() - timestamp <= INSTALL_SETTLING_WINDOW_MS;
}

function installationIsSettling(merchant: Record<string, any>): boolean {
  const merchantConfig = (merchant.config || {}) as Record<string, unknown>;
  if (merchant.status === 'uninstalled') {
    return isRecentLifecycleTimestamp(merchantConfig.ghl_uninstalled_at);
  }
  return merchant.status === 'active'
    && !merchantHasOAuthCredentials(merchant as any)
    && isRecentLifecycleTimestamp(merchantConfig.ghl_install_event_at);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInstallCompletePage(params: {
  partial: boolean;
  installedTargets: string[];
  failedTargets: Array<{ locationId: string; error: string }>;
  provisioningStarted: boolean;
}): string {
  const statusLabel = params.partial ? 'Partially installed' : 'Installed';
  const title = params.partial ? 'ScaleSafe needs attention' : 'ScaleSafe is installed';
  const subtitle = params.partial
    ? 'ScaleSafe connected to at least one selected sub-account, but one or more sub-accounts need a retry.'
    : 'Your ScaleSafe account is connected. Provisioning is running in the background when setup is not already complete.';
  const accountLabel = params.installedTargets.length === 1 ? 'Connected sub-account' : 'Connected sub-accounts';
  const accountItems = params.installedTargets
    .map((locationId) => `<li><code>${escapeHtml(locationId)}</code></li>`)
    .join('');
  const failedItems = params.failedTargets
    .map((failure) => `<li><code>${escapeHtml(failure.locationId)}</code><span>${escapeHtml(failure.error)}</span></li>`)
    .join('');
  const provisioningCopy = params.provisioningStarted
    ? 'ScaleSafe is finishing the initial field and workflow setup. This usually takes a minute or two.'
    : 'This sub-account was already provisioned, so you can open ScaleSafe now.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; --bg: #f6f8fb; --panel: #ffffff; --ink: #102033; --muted: #5a6b80; --line: #d9e1ea; --accent: #136f63; --warn: #8a4b09; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(680px, 100%); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 32px; box-shadow: 0 18px 45px rgba(16, 32, 51, 0.08); }
    .badge { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 10px; border-radius: 999px; background: ${params.partial ? '#fff4df' : '#e8f6f3'}; color: ${params.partial ? 'var(--warn)' : 'var(--accent)'}; font-size: 13px; font-weight: 700; }
    h1 { margin: 18px 0 10px; font-size: 32px; line-height: 1.15; letter-spacing: 0; }
    p { margin: 0 0 18px; color: var(--muted); font-size: 16px; line-height: 1.6; }
    section { margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--line); }
    h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; }
    ol, ul { margin: 0; padding-left: 22px; color: var(--ink); line-height: 1.7; }
    li + li { margin-top: 6px; }
    code { padding: 2px 6px; border-radius: 6px; background: #eef3f8; color: #24384f; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; }
    .failed li { display: grid; gap: 4px; margin-bottom: 10px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
    a { color: var(--accent); font-weight: 700; text-decoration: none; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 16px; border-radius: 6px; background: var(--accent); color: #ffffff; }
    .secondary { background: #eef3f8; color: #24384f; }
  </style>
</head>
<body>
  <main>
    <span class="badge">${statusLabel}</span>
    <h1>${title}</h1>
    <p>${subtitle}</p>
    <p>${provisioningCopy}</p>
    <section>
      <h2>Next step</h2>
      <ol>
        <li>Return to GoHighLevel and switch into the sub-account where you installed ScaleSafe.</li>
        <li>Open ScaleSafe from the left navigation or from the installed apps area.</li>
        <li>If the first launch says installation is still finishing, wait a minute and reopen ScaleSafe.</li>
      </ol>
    </section>
    <section>
      <h2>${accountLabel}</h2>
      <ul>${accountItems}</ul>
    </section>
    ${params.partial ? `<section><h2>Needs retry</h2><ul class="failed">${failedItems}</ul></section>` : ''}
    <div class="actions">
      <a class="button" href="https://app.gohighlevel.com/">Open GoHighLevel</a>
      <a class="button secondary" href="${escapeHtml(config.appUrl)}">Open ScaleSafe</a>
    </div>
  </main>
</body>
</html>`;
}

async function persistOAuthTarget(
  target: InstalledLocation,
  token: TokenResponse,
  options: { includePlan: boolean } = { includePlan: true },
) {
  const existing = await merchantRepository.findByLocationId(target.locationId);
  const companyId = token.companyId || existing?.company_id || undefined;

  return merchantRepository.upsertOAuthInstall({
    location_id: target.locationId,
    company_id: companyId,
    ghl_access_token: token.accessToken,
    ghl_refresh_token: token.refreshToken,
    ghl_token_expires_at: token.expiresAt.toISOString(),
    ghl_scopes: token.scopes.join(' '),
    business_name: existing?.business_name || target.name || undefined,
    ...(options.includePlan && token.planId ? {
      marketplace_plan_id: token.planId,
      marketplace_plan_key: marketplacePlanKey(token.planId),
      marketplace_plan_updated_at: new Date().toISOString(),
    } : {}),
    config: {
      ...(existing?.config || {}),
      ghl_token_scope: token.tokenScope,
      ghl_token_company_id: companyId || null,
      ghl_token_location_id: token.tokenScope === 'location' ? target.locationId : null,
      ghl_oauth_connected_at: new Date().toISOString(),
      location_access_token: null,
      location_refresh_token: null,
      location_access_token_encrypted: null,
      location_refresh_token_encrypted: null,
      location_token_expires_at: null,
    },
  });
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
    const { locationId, companyId, approvedLocations, installedLocations, _debug } = tokenResponse;
    const targets = installTargets(locationId, installedLocations);
    const planTargetIds = new Set<string>([
      ...(locationId ? [locationId] : []),
      ...(approvedLocations || []).map((location) => String(location.locationId || '').trim()).filter(Boolean),
    ]);

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

    {
      const provisionTargets: string[] = [];
      const installedTargets: string[] = [];
      const failedTargets: Array<{ locationId: string; error: string }> = [];

      // Each target is isolated: one location's DB failure must never abort the
      // install for the others (a single bad row previously turned the entire
      // callback into INTERNAL_ERROR after some merchants were already created).
      for (const target of targets) {
        const targetLocationId = target.locationId;
        try {
          // A legacy company-token lookup returns every installed sub-account,
          // not necessarily the sub-account that just selected a plan. Only an
          // exact token location or GHL-approved location may receive callback
          // plan metadata; the per-location INSTALL webhook remains authoritative.
          const merchant = await persistOAuthTarget(target, tokenResponse, {
            includePlan: planTargetIds.has(targetLocationId),
          });
          if (merchant.snapshot_status !== 'installed') provisionTargets.push(targetLocationId);
          logger.info(
            { locationId: targetLocationId, tokenScope: tokenResponse.tokenScope },
            'Merchant OAuth install reconciled',
          );
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

      const partial = failedTargets.length > 0;
      res
        .status(partial ? 207 : 200)
        .type('html')
        .send(renderInstallCompletePage({
          partial,
          installedTargets,
          failedTargets,
          provisioningStarted: provisionTargets.length > 0,
        }));
      return;
    }

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

    let userData: Record<string, string>;
    try {
      userData = decryptSsoPayload(payload, config.ghl.ssoKey);
    } catch (decryptError: any) {
      logger.warn({ err: decryptError?.message || String(decryptError) }, 'SSO payload validation failed');
      res.status(401).json({
        error: 'INVALID_SSO_PAYLOAD',
        message: 'GoHighLevel returned account context that ScaleSafe could not validate. Reopen the app from the sub-account.',
      });
      return;
    }
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

    let merchant;
    try {
      merchant = await merchantRepository.findByLocationId(locationId);
    } catch (databaseError: any) {
      logger.error(
        { err: databaseError?.message || String(databaseError), hasLocationId: true },
        'SSO merchant lookup unavailable',
      );
      throw new ServiceUnavailableError('ScaleSafe account services are temporarily unavailable. Please retry in a moment.');
    }

    if (!merchant) {
      logger.error({ hasLocationId: !!locationId, hasCompanyId: !!companyId }, 'SSO: no merchant found');
      res.status(401).json({
        error: 'INSTALLATION_NOT_FOUND',
        message: 'ScaleSafe is not installed for this GoHighLevel sub-account.',
      });
      return;
    }
    if (installationIsSettling(merchant as any)) {
      logger.info({ hasLocationId: true }, 'SSO: GHL installation lifecycle is still settling');
      res.status(409).json({
        error: 'INSTALLATION_PENDING',
        message: 'GoHighLevel is still finishing this ScaleSafe installation. ScaleSafe will retry automatically.',
      });
      return;
    }
    try {
      assertActiveGhlMerchantBinding(merchant as any, ssoContext);
    } catch (bindingError: any) {
      if (!(bindingError instanceof AuthenticationError)) throw bindingError;
      res.status(401).json({
        error: 'INSTALLATION_INVALID',
        message: bindingError.message,
      });
      return;
    }

    if (!merchant.company_id && companyId) {
      await merchantRepository.update(locationId, { company_id: companyId } as any);
    }

    const resolvedLocationId = merchant.location_id;
    let responseSnapshotStatus = merchant.snapshot_status;

    // Auto-provision if snapshot never completed
    logger.info({ snapshotStatus: merchant.snapshot_status }, 'Merchant snapshot status check');
    if (merchant.snapshot_status !== 'installed') {
      logger.info({ snapshotStatus: merchant.snapshot_status }, 'Snapshot not installed - triggering provisioning');
      if (merchant.snapshot_status === 'failed') {
        await merchantRepository.updateSnapshotStatus(resolvedLocationId, 'pending');
        responseSnapshotStatus = 'pending';
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
      snapshotStatus: responseSnapshotStatus,
      entitlement: marketplaceEntitlementForMerchant(merchant),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
