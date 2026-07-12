import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { GHLApiError } from '../utils/errors';
import { getSupabase } from './supabase.client';
import { encrypt, decrypt } from '../utils/field-encryption';

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const CUSTOM_FIELD_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const INSTALLED_LOCATIONS_PATHS = ['/oauth/installed-locations', '/oauth/installedLocations'];
const INSTALLED_LOCATIONS_RETRY_DELAYS_MS = process.env.NODE_ENV === 'test'
  ? [0, 1]
  : [0, 750, 1500, 3000, 5000];

const customFieldIdCache = new Map<string, {
  expiresAt: number;
  map: Map<string, string>;
}>();

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export type GhlTokenScope = 'location' | 'company';

function readEncryptedToken(encrypted?: string | null, plaintext?: string | null): string {
  if (encrypted) return decrypt(encrypted);
  return plaintext || '';
}

function readConfigToken(config: Record<string, unknown>, encryptedKey: string, legacyKey: string): string {
  const encrypted = config[encryptedKey];
  if (typeof encrypted === 'string' && encrypted) return decrypt(encrypted);
  const legacy = config[legacyKey];
  return typeof legacy === 'string' ? legacy : '';
}

function isMissingEncryptedTokenColumn(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42703' && (
    message.includes('ghl_access_token_encrypted')
    || message.includes('ghl_refresh_token_encrypted')
  );
}

function parseScopeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(' ').map((scope) => scope.trim()).filter(Boolean);
  return [];
}

function marketplaceAppId(): string {
  if (config.ghl.appId) return config.ghl.appId;

  const clientIdPrefix = String(config.ghl.clientId || '').split('-')[0];
  return /^[a-f0-9]{24}$/i.test(clientIdPrefix) ? clientIdPrefix : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistCredentialRotation<T>(
  write: () => PromiseLike<{ data: T; error: any }>,
  valid: (data: T) => boolean,
  description: string,
): Promise<T> {
  const delays = [0, 100, 250, 500, 1000];
  let lastError: any = null;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      const result = await write();
      if (!result.error && valid(result.data)) return result.data;
      lastError = result.error || new Error(`${description} did not update a row`);
    } catch (err) {
      lastError = err;
    }
    logger.warn({ err: lastError?.message || String(lastError), description }, 'GHL credential persistence will retry');
  }
  throw new GHLApiError(`${description} failed after retry: ${lastError?.message || String(lastError)}`);
}

function jwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function inferLegacyTokenScope(accessToken: string, cfg: Record<string, unknown>): GhlTokenScope {
  if (
    cfg.location_access_token
    || cfg.location_access_token_encrypted
    || cfg.location_refresh_token
    || cfg.location_refresh_token_encrypted
  ) return 'company';

  const claims = jwtPayload(accessToken);
  const claimScope = String(claims?.userType || claims?.user_type || claims?.type || '').toLowerCase();
  if (claimScope === 'company') return 'company';
  if (claimScope === 'location' || claims?.locationId || claims?.location_id) return 'location';

  // company_id is present on both HighLevel token types. Defaulting legacy
  // rows to company would break every ordinary sub-account install.
  return 'location';
}

export interface TokenResponse extends TokenPair {
  locationId: string;
  companyId: string;
  userId: string;
  scopes: string[];
  tokenScope: GhlTokenScope;
  approvedLocations: InstalledLocation[];
  installedLocations?: InstalledLocation[];
  _debug?: Record<string, unknown>;
}

export interface InstalledLocation {
  locationId: string;
  name?: string;
}

function normalizeContactFieldKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('contact.') ? trimmed : `contact.${trimmed}`;
}

function fieldNameToContactFieldKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key ? normalizeContactFieldKey(key) : '';
}

export function clearGhlCustomFieldIdCache(locationId?: string): void {
  if (locationId) {
    customFieldIdCache.delete(locationId);
    return;
  }
  customFieldIdCache.clear();
}

async function getContactCustomFieldIdMap(
  api: AxiosInstance,
  locationId: string,
): Promise<Map<string, string>> {
  const cached = customFieldIdCache.get(locationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.map;
  }

  const res = await api.get(`/locations/${locationId}/customFields`);
  const fields = res.data?.customFields || res.data?.fields || (Array.isArray(res.data) ? res.data : []);
  const map = new Map<string, string>();

  for (const field of fields) {
    const id = field?.id;
    if (!id) continue;

    const rawKey = field?.fieldKey || field?.key;
    if (rawKey) {
      const contactKey = normalizeContactFieldKey(String(rawKey));
      const bareKey = contactKey.replace(/^contact\./, '');
      map.set(contactKey, id);
      map.set(bareKey, id);
    }

    if (field?.name) {
      const nameKey = fieldNameToContactFieldKey(String(field.name));
      if (nameKey) {
        const bareNameKey = nameKey.replace(/^contact\./, '');
        map.set(nameKey, id);
        map.set(bareNameKey, id);
      }
    }
  }

  customFieldIdCache.set(locationId, {
    expiresAt: Date.now() + CUSTOM_FIELD_ID_CACHE_TTL_MS,
    map,
  });
  return map;
}

/**
 * Exchange an OAuth authorization code for access + refresh tokens.
 * Called once during merchant install.
 *
 * GHL agency-level apps return a Company-scoped token.
 * We store it, then exchange it for a Location-scoped token in ghlApi().
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'authorization_code',
    code,
    user_type: 'Location',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const data = res.data;

  if (config.isDev) {
    logger.debug({
      tokenResponseKeys: Object.keys(data),
      hasLocation: !!(data.locationId || data.location_id),
      hasCompany: !!(data.companyId || data.company_id),
      hasUser: !!(data.userId || data.user_id),
      userType: data.userType,
      scopeCount: parseScopeList(data.scope || data.scopes).length,
    }, 'GHL token exchange response');
  }

  // GHL uses camelCase (locationId) but has historically been inconsistent
  let locationId = data.locationId || data.location_id || '';
  const companyId = data.companyId || data.company_id || '';
  const userId = data.userId || data.user_id || '';
  const accessToken = data.access_token || data.accessToken || '';
  const refreshToken = data.refresh_token || data.refreshToken || '';
  const expiresIn = Number(data.expires_in || data.expiresIn || 86400);
  const scopes = parseScopeList(data.scope || data.scopes);
  const userType = String(data.userType || data.user_type || '').trim().toLowerCase();
  const tokenScope: GhlTokenScope = locationId || userType === 'location' ? 'location' : 'company';
  const approvedLocations = normalizeInstalledLocationsResponse(
    data.approvedLocations || data.approved_locations || [],
  );

  if (!accessToken || !refreshToken) {
    throw new GHLApiError('OAuth token response did not include durable access and refresh credentials');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GHLApiError('OAuth token response contained an invalid expiration');
  }
  if (tokenScope === 'location' && !locationId) {
    throw new GHLApiError('Location-scoped OAuth token response did not include a locationId');
  }
  if (tokenScope === 'company' && !companyId) {
    throw new GHLApiError('Company-scoped OAuth token response did not include a companyId');
  }

  // Collect debug info to surface in error responses
  const debug: Record<string, unknown> = {
    tokenResponseKeys: Object.keys(data),
    hadLocationId: !!(data.locationId || data.location_id),
    hadCompanyId: !!companyId,
    tokenScope,
    approvedLocationCount: approvedLocations.length,
  };

  let installedLocations: InstalledLocation[] = [];

  // Bulk-capable agency installs can return companyId but no locationId.
  // Resolve only through the app-installed locations endpoint; do not use a
  // generic sub-account search because that can attach the install to the
  // wrong location in multi-location agencies.
  if (!locationId && companyId && accessToken) {
    // Modern company-token responses identify the exact locations approved in
    // this authorization. Prefer that list so installing one new sub-account
    // never causes ScaleSafe to reconcile every older installation in the
    // agency. The installed-locations lookup remains a legacy fallback.
    if (approvedLocations.length > 0) {
      installedLocations = approvedLocations;
      debug.locationResolutionSource = 'approvedLocations';
    } else {
      const resolved = await resolveInstalledLocationsFromCompany(accessToken, companyId);
      installedLocations = resolved.installedLocations;
      debug.installedLocationsResponse = resolved.debug;
      debug.locationResolutionSource = 'installedLocations';
    }
    if (installedLocations.length === 1) {
      locationId = installedLocations[0].locationId;
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    locationId,
    companyId,
    userId,
    scopes,
    tokenScope,
    approvedLocations,
    installedLocations,
    _debug: debug,
  };
}

/**
 * When GHL returns a company-level token without locationId, use the company
 * token to fetch sub-accounts where this Marketplace app is installed.
 */
async function resolveInstalledLocationsFromCompany(
  accessToken: string,
  companyId: string,
): Promise<{ installedLocations: InstalledLocation[]; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { called: true };

  try {
    logger.info('No locationId in token response - resolving via installed locations');

    const params: Record<string, string> = { companyId };
    const appId = marketplaceAppId();
    if (appId) {
      params.appId = appId;
      debug.hasAppId = true;
    } else {
      debug.missingAppId = true;
      logger.warn('GHL Marketplace appId is unavailable for installed-locations lookup');
      return { installedLocations: [], debug };
    }

    const resolved = await fetchInstalledLocations(accessToken, params);
    Object.assign(debug, resolved.debug);

    const locations = resolved.installedLocations;
    logger.info({
      locationCount: locations.length,
      path: resolved.debug.path,
      attempts: resolved.debug.attempts,
    }, 'Installed locations response');

    if (locations.length === 0) {
      logger.error('No installed locations found for company');
      return { installedLocations: [], debug };
    }

    if (locations.length === 1) {
      debug.resolvedLocationId = locations[0].locationId;
    } else {
      debug.multipleInstalledLocations = true;
    }

    logger.info('Resolved installed locations');
    return { installedLocations: locations, debug };
  } catch (err: any) {
    debug.error = err.message;
    debug.errorStatus = err.response?.status;
    debug.errorBodyKeys = err.response?.data ? Object.keys(err.response.data) : [];
    logger.error({
      err: err.message,
      status: err.response?.status,
      responseKeys: err.response?.data ? Object.keys(err.response.data) : [],
    }, 'Failed to resolve installed locations');
    return { installedLocations: [], debug };
  }
}

async function fetchInstalledLocations(
  accessToken: string,
  params: Record<string, string>,
): Promise<{ installedLocations: InstalledLocation[]; debug: Record<string, unknown> }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Version: '2021-07-28',
    Accept: 'application/json',
  };
  const requestParams = {
    ...params,
    isInstalled: 'true',
    limit: '100',
  };

  const debug: Record<string, unknown> = {
    attempts: 0,
    pathsTried: [],
    hasCompanyId: !!params.companyId,
    hasAppId: !!params.appId,
  };
  let lastError: any;
  let lastEmptyResponse: Record<string, unknown> | null = null;

  for (const delayMs of INSTALLED_LOCATIONS_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);

    for (const path of INSTALLED_LOCATIONS_PATHS) {
      debug.attempts = Number(debug.attempts || 0) + 1;
      (debug.pathsTried as string[]).push(path);

      try {
        const res = await axios.get(`${config.ghl.apiDomain}${path}`, {
          headers,
          params: requestParams,
        });

        const locations = normalizeInstalledLocationsResponse(res.data);
        const responseDebug = {
          httpStatus: res.status,
          responseKeys: Object.keys(res.data || {}),
          locationCount: locations.length,
          path,
        };

        if (locations.length > 0) {
          return {
            installedLocations: locations,
            debug: {
              ...debug,
              ...responseDebug,
              ...(config.isDev ? {
                rawLocations: locations.map((l) => ({ id: l.locationId, name: l.name || '' })),
              } : {}),
            },
          };
        }

        lastEmptyResponse = responseDebug;
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        if (status === 404 || status === 405) {
          continue;
        }

        if (status === 400 || status === 401 || status === 422) {
          return {
            installedLocations: [],
            debug: {
              ...debug,
              error: err.message,
              errorStatus: status,
              errorBodyKeys: err.response?.data ? Object.keys(err.response.data) : [],
            },
          };
        }
      }
    }
  }

  if (lastEmptyResponse) {
    return {
      installedLocations: [],
      debug: {
        ...debug,
        ...lastEmptyResponse,
      },
    };
  }

  return {
    installedLocations: [],
    debug: {
      ...debug,
      error: lastError?.message || 'Installed locations lookup failed',
      errorStatus: lastError?.response?.status,
      errorBodyKeys: lastError?.response?.data ? Object.keys(lastError.response.data) : [],
    },
  };
}

function normalizeInstalledLocationsResponse(data: any): InstalledLocation[] {
  const raw =
    arrayOrNull(data?.locations)
    || arrayOrNull(data?.installedLocations)
    || arrayOrNull(data?.installed_locations)
    || arrayOrNull(data?.data?.locations)
    || arrayOrNull(data?.data?.installedLocations)
    || arrayOrNull(data?.data?.installed_locations)
    || arrayOrNull(data?.data)
    || arrayOrNull(data)
    || [];

  const seen = new Set<string>();
  const result: InstalledLocation[] = [];

  for (const item of raw) {
    const locationId = String(typeof item === 'string'
      ? item
      : item?.locationId
        || item?.location_id
        || item?.id
        || item?._id
        || item?.location?.locationId
        || item?.location?.location_id
        || item?.location?.id
        || item?.location?._id
        || '').trim();

    if (!locationId || seen.has(locationId)) continue;
    seen.add(locationId);

    const name = String(
      item?.name
      || item?.locationName
      || item?.location_name
      || item?.businessName
      || item?.business_name
      || item?.location?.name
      || '',
    ).trim();

    result.push({ locationId, ...(name ? { name } : {}) });
  }

  return result;
}

function arrayOrNull(value: unknown): any[] | null {
  return Array.isArray(value) ? value : null;
}

function tokenPairFromResponse(data: any, currentRefreshToken = ''): TokenPair {
  const accessToken = String(data?.access_token || data?.accessToken || '').trim();
  const refreshToken = String(data?.refresh_token || data?.refreshToken || currentRefreshToken || '').trim();
  const expiresIn = Number(data?.expires_in || data?.expiresIn || 86400);
  if (!accessToken || !refreshToken) {
    throw new GHLApiError('Token refresh response did not include durable credentials');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GHLApiError('Token refresh response contained an invalid expiration');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

function assertReturnedTokenBinding(
  data: any,
  expectedScope: GhlTokenScope,
  expectedLocationId = '',
  expectedCompanyId = '',
): void {
  const returnedScope = String(data?.userType || data?.user_type || '').trim().toLowerCase();
  const returnedLocationId = String(data?.locationId || data?.location_id || '').trim();
  const returnedCompanyId = String(data?.companyId || data?.company_id || '').trim();

  if (returnedScope !== expectedScope) {
    throw new GHLApiError(
      `Expected a ${expectedScope}-scoped token but GHL returned ${returnedScope || 'no token scope'}`,
    );
  }
  if (expectedLocationId && returnedLocationId !== expectedLocationId) {
    throw new GHLApiError('GHL returned a token for a different sub-account');
  }
  if (expectedScope === 'company' && expectedCompanyId && returnedCompanyId !== expectedCompanyId) {
    throw new GHLApiError('GHL returned a token for a different agency');
  }
  if (expectedScope === 'location' && expectedCompanyId
    && returnedCompanyId && returnedCompanyId !== expectedCompanyId) {
    throw new GHLApiError('GHL returned a token for a different agency');
  }
}

async function recoverConcurrentCompanyRefresh(
  locationId: string,
  companyId: string,
  staleRefreshToken: string,
): Promise<TokenPair | null> {
  let result = await getSupabase()
    .from('merchants')
    .select('ghl_access_token, ghl_refresh_token, ghl_access_token_encrypted, ghl_refresh_token_encrypted, ghl_token_expires_at, company_id, config, status')
    .eq('location_id', locationId)
    .eq('status', 'active')
    .single();

  if (isMissingEncryptedTokenColumn(result.error)) {
    result = await getSupabase()
      .from('merchants')
      .select('ghl_access_token, ghl_refresh_token, ghl_token_expires_at, company_id, config, status')
      .eq('location_id', locationId)
      .eq('status', 'active')
      .single();
  }
  if (result.error || !result.data) return null;

  const merchant: any = result.data;
  const cfg = (merchant.config || {}) as Record<string, unknown>;
  const configuredScope = String(cfg.ghl_token_scope || '').toLowerCase();
  const boundCompanyId = String(cfg.ghl_token_company_id || '').trim();
  if (configuredScope === 'location') return null;
  if (companyId && merchant.company_id && merchant.company_id !== companyId) return null;
  if (companyId && boundCompanyId && boundCompanyId !== companyId) return null;

  const accessToken = readEncryptedToken(
    merchant.ghl_access_token_encrypted,
    merchant.ghl_access_token,
  );
  const refreshToken = readEncryptedToken(
    merchant.ghl_refresh_token_encrypted,
    merchant.ghl_refresh_token,
  );
  const expiresAt = merchant.ghl_token_expires_at
    ? new Date(merchant.ghl_token_expires_at)
    : null;
  if (!accessToken || !refreshToken || refreshToken === staleRefreshToken
    || !expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }

  logger.info({ locationId, companyId }, 'Using company credentials rotated by another instance');
  return { accessToken, refreshToken, expiresAt };
}

/**
 * Refresh an expired Company-level access token.
 * Updates the company tokens in the merchants table.
 */
async function refreshCompanyToken(
  locationId: string,
  currentRefreshToken: string,
  companyId = '',
): Promise<TokenPair> {
  if (!currentRefreshToken) throw new GHLApiError('Missing GHL company refresh token');
  logger.info('Refreshing GHL company access token');
  let res;
  try {
    res = await axios.post(TOKEN_URL, new URLSearchParams({
      client_id: config.ghl.clientId,
      client_secret: config.ghl.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    // Company refresh tokens rotate. Two Railway instances can notice expiry
    // together; the loser reloads the winner's persisted credentials instead
    // of failing every sibling sub-account that shared the old refresh token.
    const recovered = await recoverConcurrentCompanyRefresh(locationId, companyId, currentRefreshToken);
    if (recovered) return recovered;
    throw err;
  }

  logger.info({
    locationId,
    userType: res.data.userType,
    locationIdReturned: res.data.locationId,
    companyIdReturned: res.data.companyId,
  }, 'GHL company token refresh response');

  assertReturnedTokenBinding(res.data, 'company', '', companyId);
  const tokens = tokenPairFromResponse(res.data, currentRefreshToken);

  // A company refresh token is shared by every approved sub-account row. GHL
  // rotates refresh tokens, so persisting only the row that noticed expiry
  // strands every sibling location with the now-invalid prior token.
  await persistCredentialRotation(
    async () => {
      let updateQuery: any = getSupabase()
        .from('merchants')
        .update({
          ghl_access_token: null,
          ghl_refresh_token: null,
          ghl_access_token_encrypted: encrypt(tokens.accessToken),
          ghl_refresh_token_encrypted: encrypt(tokens.refreshToken),
          ghl_token_expires_at: tokens.expiresAt.toISOString(),
        });
      updateQuery = companyId
        ? updateQuery
          .eq('company_id', companyId)
          .eq('status', 'active')
          // A company can contain both bulk-installed company authorizations and
          // directly installed location authorizations. Never overwrite the latter.
          .or('config->>ghl_token_scope.eq.company,config->>ghl_token_scope.is.null')
        : updateQuery.eq('location_id', locationId).eq('status', 'active');
      return updateQuery.select('location_id');
    },
    (rows) => Array.isArray(rows) && rows.length > 0,
    'Persisting refreshed GHL company credentials',
  );

  return tokens;
}

async function refreshPrimaryLocationToken(
  locationId: string,
  currentRefreshToken: string,
): Promise<TokenPair> {
  if (!currentRefreshToken) throw new GHLApiError('Missing GHL location refresh token');
  logger.info({ locationId }, 'Refreshing primary GHL location access token');
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  assertReturnedTokenBinding(res.data, 'location', locationId);
  const tokens = tokenPairFromResponse(res.data, currentRefreshToken);
  await persistCredentialRotation(
    () => getSupabase()
      .from('merchants')
      .update({
        ghl_access_token: null,
        ghl_refresh_token: null,
        ghl_access_token_encrypted: encrypt(tokens.accessToken),
        ghl_refresh_token_encrypted: encrypt(tokens.refreshToken),
        ghl_token_expires_at: tokens.expiresAt.toISOString(),
      })
      .eq('location_id', locationId)
      .eq('status', 'active')
      .select('location_id')
      .maybeSingle(),
    (row) => Boolean(row),
    'Persisting refreshed GHL location credentials',
  );
  return tokens;
}

async function refreshLocationToken(
  locationId: string,
  currentRefreshToken: string,
  existingConfig: Record<string, unknown>,
): Promise<TokenPair> {
  if (!currentRefreshToken) throw new GHLApiError('Missing GHL location refresh token');
  logger.info({ locationId }, 'Refreshing GHL location access token');
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  assertReturnedTokenBinding(res.data, 'location', locationId);
  const tokens = tokenPairFromResponse(res.data, currentRefreshToken);

  await persistCredentialRotation(
    () => getSupabase()
      .from('merchants')
      .update({
        config: {
          ...existingConfig,
          location_access_token: null,
          location_refresh_token: null,
          location_access_token_encrypted: encrypt(tokens.accessToken),
          location_refresh_token_encrypted: encrypt(tokens.refreshToken),
          location_token_expires_at: tokens.expiresAt.toISOString(),
        },
      })
      .eq('location_id', locationId)
      .eq('status', 'active')
      .select('location_id')
      .maybeSingle(),
    (row) => Boolean(row),
    'Persisting refreshed GHL child-location credentials',
  );

  return tokens;
}

/**
 * Exchange a Company-scoped access token for a Location-scoped access token.
 * This is required for Agency-level installs to access location-level endpoints
 * (custom fields, custom values, contacts, etc.).
 *
 * POST /oauth/location-token
 * Body: { companyId, locationId }
 * Auth: Bearer <company_access_token>
 */
async function getLocationToken(
  companyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<TokenPair> {
  logger.info('Exchanging company token for location token');

  const requestConfig = {
    headers: {
      Authorization: `Bearer ${companyAccessToken}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  };

  let res;
  try {
    res = await axios.post(
      `${config.ghl.apiDomain}/oauth/location-token`,
      { companyId, locationId },
      requestConfig,
    );
  } catch (err: any) {
    const status = err.response?.status;
    if (status !== 404 && status !== 405) throw err;

    logger.warn({ status }, 'GHL location-token endpoint unavailable; retrying legacy locationToken endpoint');
    res = await axios.post(
      `${config.ghl.apiDomain}/oauth/locationToken`,
      { companyId, locationId },
      requestConfig,
    );
  }

  const data = res.data;
  logger.info({
    locationId,
    companyId,
    userType: data.userType,
    responseKeys: Object.keys(data),
  }, 'Location token obtained');

  assertReturnedTokenBinding(data, 'location', locationId, companyId);
  const tokens = tokenPairFromResponse(data);

  // Store location token in config JSONB
  const currentMerchant = await persistCredentialRotation(
    () => getSupabase()
      .from('merchants')
      .select('config')
      .eq('location_id', locationId)
      .single(),
    (row) => Boolean(row),
    'Loading merchant for new GHL child-location credentials',
  );

  const existingConfig = (((currentMerchant as any).config || {}) as Record<string, unknown>);
  await persistCredentialRotation(
    () => getSupabase()
      .from('merchants')
      .update({
        config: {
          ...existingConfig,
          location_access_token: null,
          location_refresh_token: null,
          location_access_token_encrypted: encrypt(tokens.accessToken),
          location_refresh_token_encrypted: encrypt(tokens.refreshToken),
          location_token_expires_at: tokens.expiresAt.toISOString(),
        },
      })
      .eq('location_id', locationId)
      .eq('status', 'active')
      .select('location_id')
      .maybeSingle(),
    (row) => Boolean(row),
    'Persisting new GHL child-location credentials',
  );

  return tokens;
}

/**
 * Create an Axios instance scoped to a merchant's GHL location.
 *
 * For Agency-level installs (Company-scoped tokens), this:
 * 1. Reads the stored Company token
 * 2. Checks for a cached Location token in config
 * 3. If no Location token or expired, exchanges Company token for Location token
 * 4. Uses the Location token for all API calls
 * 5. On 401, refreshes Company token, gets new Location token, retries
 */
export async function ghlApi(locationId: string): Promise<AxiosInstance> {
  const supabase = getSupabase();

  const merchantResult = await supabase
    .from('merchants')
    .select('ghl_access_token, ghl_refresh_token, ghl_access_token_encrypted, ghl_refresh_token_encrypted, ghl_token_expires_at, company_id, config, status')
    .eq('location_id', locationId)
    .single();
  let merchant: any = merchantResult.data;
  let error: any = merchantResult.error;

  if (isMissingEncryptedTokenColumn(error)) {
    logger.warn(
      { locationId },
      'Encrypted GHL token columns missing; using legacy plaintext token columns until migration 068 is applied',
    );
    const legacyResult = await supabase
      .from('merchants')
      .select('ghl_access_token, ghl_refresh_token, ghl_token_expires_at, company_id, config, status')
      .eq('location_id', locationId)
      .single();
    merchant = legacyResult.data;
    error = legacyResult.error;
  }

  if (error || !merchant) {
    throw new GHLApiError(`Merchant not found: ${locationId}`);
  }
  if (merchant.status !== 'active') {
    throw new GHLApiError(`ScaleSafe is not actively installed for merchant: ${locationId}`);
  }

  const companyId = (merchant as any).company_id || '';
  const cfg = (merchant.config || {}) as Record<string, unknown>;
  const storedAccessToken = readEncryptedToken(
    (merchant as any).ghl_access_token_encrypted,
    (merchant as any).ghl_access_token,
  );
  const storedRefreshToken = readEncryptedToken(
    (merchant as any).ghl_refresh_token_encrypted,
    (merchant as any).ghl_refresh_token,
  );
  const configuredScope = String(cfg.ghl_token_scope || '').toLowerCase();
  const tokenScope: GhlTokenScope = configuredScope === 'location'
    ? 'location'
    : configuredScope === 'company'
      ? 'company'
      : inferLegacyTokenScope(storedAccessToken, cfg);
  if (!configuredScope) {
    logger.warn({ locationId, inferredTokenScope: tokenScope }, 'Using inferred scope for legacy GHL OAuth credentials');
  }
  const boundLocationId = String(cfg.ghl_token_location_id || '').trim();
  const boundCompanyId = String(cfg.ghl_token_company_id || '').trim();
  if (tokenScope === 'location' && boundLocationId && boundLocationId !== locationId) {
    throw new GHLApiError('Stored GHL token is bound to a different sub-account');
  }
  if (tokenScope === 'company' && boundCompanyId && companyId && boundCompanyId !== companyId) {
    throw new GHLApiError('Stored GHL token is bound to a different agency');
  }
  let primaryRefreshToken = storedRefreshToken;

  let accessToken = '';
  let cachedLocationRefreshToken = '';
  let companyAccessToken = tokenScope === 'company' ? storedAccessToken : '';

  if (tokenScope === 'company') {
    if (!companyId) throw new GHLApiError(`Missing GHL company binding for merchant: ${locationId}`);
    const locationTokenExpiry = cfg.location_token_expires_at
      ? new Date(cfg.location_token_expires_at as string)
      : null;
    const locationTokenValid = locationTokenExpiry
      && Number.isFinite(locationTokenExpiry.getTime())
      && locationTokenExpiry > new Date();
    const cachedLocationAccessToken = readConfigToken(cfg, 'location_access_token_encrypted', 'location_access_token');
    cachedLocationRefreshToken = readConfigToken(cfg, 'location_refresh_token_encrypted', 'location_refresh_token');

    if (locationTokenValid && cachedLocationAccessToken) {
      accessToken = cachedLocationAccessToken;
    } else if (cachedLocationRefreshToken) {
      try {
        const refreshedLocation = await refreshLocationToken(locationId, cachedLocationRefreshToken, cfg);
        accessToken = refreshedLocation.accessToken;
        cachedLocationRefreshToken = refreshedLocation.refreshToken;
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err), status: err?.response?.status, locationId },
          'GHL location token refresh failed; exchanging the company token again',
        );
      }
    }

    if (!accessToken) {
      const companyExpiry = merchant.ghl_token_expires_at
        ? new Date(merchant.ghl_token_expires_at)
        : null;
      if (companyExpiry && Number.isFinite(companyExpiry.getTime()) && companyExpiry <= new Date()) {
        try {
          const refreshed = await refreshCompanyToken(locationId, storedRefreshToken, companyId);
          companyAccessToken = refreshed.accessToken;
          primaryRefreshToken = refreshed.refreshToken;
        } catch (err: any) {
          logger.error({ err: err.message, locationId, companyId }, 'Failed to refresh company token');
          throw new GHLApiError(`Company token refresh failed: ${err.message}`);
        }
      }
      if (!companyAccessToken) throw new GHLApiError(`Missing GHL company access token for merchant: ${locationId}`);

      try {
        const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
        accessToken = locationTokens.accessToken;
        cachedLocationRefreshToken = locationTokens.refreshToken;
      } catch (err: any) {
        // A company token is never used directly for a location API call. That
        // fallback made a failed location binding look healthy and could query
        // an agency-wide surface with ambiguous tenant semantics.
        logger.error({ err: err.message, locationId, companyId }, 'Failed to obtain tenant-bound GHL location token');
        throw new GHLApiError(`Location token exchange failed: ${err.message}`);
      }
    }
  } else {
    accessToken = storedAccessToken;
    const primaryExpiry = merchant.ghl_token_expires_at
      ? new Date(merchant.ghl_token_expires_at)
      : null;
    if (primaryExpiry && Number.isFinite(primaryExpiry.getTime()) && primaryExpiry <= new Date()) {
      const refreshed = await refreshPrimaryLocationToken(locationId, primaryRefreshToken);
      accessToken = refreshed.accessToken;
      primaryRefreshToken = refreshed.refreshToken;
    }
  }

  if (!accessToken) {
    throw new GHLApiError(`Missing GHL access token for merchant: ${locationId}`);
  }

  const instance = axios.create({
    baseURL: config.ghl.apiDomain,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
    timeout: 30000,
  });

  // Intercept request: auto-transform customField (singular object) to customFields (plural array).
  // GHL V2 accepts custom-field IDs reliably; key-based updates can 200 without populating values.
  instance.interceptors.request.use(async (reqConfig) => {
    if (reqConfig.data && typeof reqConfig.data === 'object' && reqConfig.data.customField && !reqConfig.data.customFields) {
      const cf = reqConfig.data.customField;
      let fieldIdMap: Map<string, string> | null = null;
      try {
        fieldIdMap = await getContactCustomFieldIdMap(instance, locationId);
      } catch (err: any) {
        logger.warn(
          { locationId, err: err?.message || String(err) },
          'Failed to load GHL custom field id map; falling back to key-based contact field update',
        );
      }

      reqConfig.data.customFields = Object.entries(cf).map(([key, value]) => {
        const normalizedKey = normalizeContactFieldKey(key);
        const bareKey = normalizedKey.replace(/^contact\./, '');
        const id = fieldIdMap?.get(normalizedKey) || fieldIdMap?.get(bareKey);
        return id
          ? { id, field_value: value }
          : { key: normalizedKey, field_value: value };
      });
      delete reqConfig.data.customField;
    }
    return reqConfig;
  });

  // Intercept rejected tokens: refresh and retry once.
  instance.interceptors.response.use(
    (response) => response,
    async (err) => {
      const original = err.config as AxiosRequestConfig & { _retried?: boolean };
      if ((err.response?.status === 401 || err.response?.status === 403) && !original._retried) {
        original._retried = true;
        logger.info('GHL token rejected, refreshing');

        try {
          if (tokenScope === 'company' && cachedLocationRefreshToken) {
            try {
              const locationTokens = await refreshLocationToken(locationId, cachedLocationRefreshToken, cfg);
              accessToken = locationTokens.accessToken;
              cachedLocationRefreshToken = locationTokens.refreshToken;
            } catch (locationRefreshError: any) {
              logger.warn(
                { err: locationRefreshError.message, locationId },
                'Rejected cached location refresh; minting a new location token from company authorization',
              );
              cachedLocationRefreshToken = '';
              try {
                const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
                accessToken = locationTokens.accessToken;
                cachedLocationRefreshToken = locationTokens.refreshToken;
              } catch {
                const refreshed = await refreshCompanyToken(locationId, primaryRefreshToken, companyId);
                primaryRefreshToken = refreshed.refreshToken;
                companyAccessToken = refreshed.accessToken;
                const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
                accessToken = locationTokens.accessToken;
                cachedLocationRefreshToken = locationTokens.refreshToken;
              }
            }
          } else if (tokenScope === 'company') {
            const refreshed = await refreshCompanyToken(locationId, primaryRefreshToken, companyId);
            primaryRefreshToken = refreshed.refreshToken;
            companyAccessToken = refreshed.accessToken;
            const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
            accessToken = locationTokens.accessToken;
            cachedLocationRefreshToken = locationTokens.refreshToken;
          } else {
            const refreshed = await refreshPrimaryLocationToken(locationId, primaryRefreshToken);
            accessToken = refreshed.accessToken;
            primaryRefreshToken = refreshed.refreshToken;
          }

          original.headers = { ...original.headers, Authorization: `Bearer ${accessToken}` };
          return instance.request(original);
        } catch (refreshErr: any) {
          logger.error({ err: refreshErr.message }, 'Token refresh+exchange failed');
          throw new GHLApiError(`Token refresh failed: ${refreshErr.message}`);
        }
      }
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      throw new GHLApiError(msg, status);
    },
  );

  return instance;
}

// Keep the old export name for backward compatibility
export const refreshAccessToken = refreshCompanyToken;
