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

interface TokenResponse extends TokenPair {
  locationId: string;
  companyId: string;
  userId: string;
  scopes: string[];
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

  // Collect debug info to surface in error responses
  const debug: Record<string, unknown> = {
    tokenResponseKeys: Object.keys(data),
    hadLocationId: !!(data.locationId || data.location_id),
    hadCompanyId: !!companyId,
  };

  let installedLocations: InstalledLocation[] = [];

  // Bulk-capable agency installs can return companyId but no locationId.
  // Resolve only through the app-installed locations endpoint; do not use a
  // generic sub-account search because that can attach the install to the
  // wrong location in multi-location agencies.
  if (!locationId && companyId && accessToken) {
    const resolved = await resolveInstalledLocationsFromCompany(accessToken, companyId);
    installedLocations = resolved.installedLocations;
    if (installedLocations.length === 1) {
      locationId = installedLocations[0].locationId;
    }
    debug.installedLocationsResponse = resolved.debug;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    locationId,
    companyId,
    userId,
    scopes,
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
    const locationId = String(
      item?.locationId
      || item?.location_id
      || item?.id
      || item?._id
      || item?.location?.locationId
      || item?.location?.location_id
      || item?.location?.id
      || item?.location?._id
      || '',
    ).trim();

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

/**
 * Refresh an expired Company-level access token.
 * Updates the company tokens in the merchants table.
 */
async function refreshCompanyToken(locationId: string, currentRefreshToken: string): Promise<TokenPair> {
  logger.info('Refreshing GHL company access token');
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  logger.info({
    locationId,
    userType: res.data.userType,
    locationIdReturned: res.data.locationId,
    companyIdReturned: res.data.companyId,
  }, 'GHL company token refresh response');

  const tokens: TokenPair = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
  };

  // Persist new company tokens
  const { error } = await getSupabase()
    .from('merchants')
    .update({
      ghl_access_token: null,
      ghl_refresh_token: null,
      ghl_access_token_encrypted: encrypt(tokens.accessToken),
      ghl_refresh_token_encrypted: encrypt(tokens.refreshToken),
      ghl_token_expires_at: tokens.expiresAt.toISOString(),
    })
    .eq('location_id', locationId);

  if (error) {
    logger.error({ error }, 'Failed to persist refreshed company tokens');
  }

  return tokens;
}

async function refreshLocationToken(
  locationId: string,
  currentRefreshToken: string,
  existingConfig: Record<string, unknown>,
): Promise<TokenPair> {
  logger.info({ locationId }, 'Refreshing GHL location access token');
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokens: TokenPair = {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token || currentRefreshToken,
    expiresAt: new Date(Date.now() + (res.data.expires_in || 86400) * 1000),
  };

  const { error } = await getSupabase()
    .from('merchants')
    .update({
      config: {
        ...existingConfig,
        location_access_token: null,
        location_refresh_token: null,
        location_access_token_encrypted: encrypt(tokens.accessToken),
        location_refresh_token_encrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        location_token_expires_at: tokens.expiresAt.toISOString(),
      },
    })
    .eq('location_id', locationId);

  if (error) {
    logger.error({ error }, 'Failed to persist refreshed location token');
  }

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

  const tokens: TokenPair = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000),
  };

  // Store location token in config JSONB
  try {
    const { data: current } = await getSupabase()
      .from('merchants')
      .select('config')
      .eq('location_id', locationId)
      .single();

    const existingConfig = ((current?.config || {}) as Record<string, unknown>);
    await getSupabase()
      .from('merchants')
      .update({
        config: {
          ...existingConfig,
          location_access_token: null,
          location_refresh_token: null,
          location_access_token_encrypted: encrypt(tokens.accessToken),
          location_refresh_token_encrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
          location_token_expires_at: tokens.expiresAt.toISOString(),
        },
      })
      .eq('location_id', locationId);
  } catch (err) {
    logger.error({ err }, 'Failed to persist location token');
  }

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
    .select('ghl_access_token, ghl_refresh_token, ghl_access_token_encrypted, ghl_refresh_token_encrypted, ghl_token_expires_at, company_id, config')
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
      .select('ghl_access_token, ghl_refresh_token, ghl_token_expires_at, company_id, config')
      .eq('location_id', locationId)
      .single();
    merchant = legacyResult.data;
    error = legacyResult.error;
  }

  if (error || !merchant) {
    throw new GHLApiError(`Merchant not found: ${locationId}`);
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

  // Determine if we need a location token exchange
  let accessToken = '';
  const locationTokenExpiry = cfg.location_token_expires_at
    ? new Date(cfg.location_token_expires_at as string)
    : null;
  const locationTokenValid = locationTokenExpiry && locationTokenExpiry > new Date();

  const cachedLocationAccessToken = readConfigToken(cfg, 'location_access_token_encrypted', 'location_access_token');
  const cachedLocationRefreshToken = readConfigToken(cfg, 'location_refresh_token_encrypted', 'location_refresh_token');
  if (locationTokenValid && cachedLocationAccessToken) {
    // Use cached location token
    accessToken = cachedLocationAccessToken;
  } else if (cachedLocationRefreshToken) {
    try {
      const refreshedLocation = await refreshLocationToken(locationId, cachedLocationRefreshToken, cfg);
      accessToken = refreshedLocation.accessToken;
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), status: err?.response?.status, locationId },
        'GHL location token refresh failed; trying company token path',
      );
    }
  }

  if (!accessToken && companyId) {
    // Need to get a location token from company token
    let companyAccessToken = storedAccessToken;

    // Check if company token is expired and refresh if needed
    const companyExpiry = merchant.ghl_token_expires_at
      ? new Date(merchant.ghl_token_expires_at)
      : null;
    if (companyExpiry && companyExpiry <= new Date()) {
      try {
        const refreshed = await refreshCompanyToken(locationId, storedRefreshToken);
        companyAccessToken = refreshed.accessToken;
      } catch (err: any) {
        logger.error({ err: err.message }, 'Failed to refresh company token');
        throw new GHLApiError(`Company token refresh failed: ${err.message}`);
      }
    }

    // Exchange company token for location token
    try {
      const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
      accessToken = locationTokens.accessToken;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to get location token');
      // Fall back to company token: some endpoints may work.
      accessToken = companyAccessToken;
    }
  } else if (!accessToken) {
    // No companyId: use the stored token directly for Location-level installs.
    accessToken = storedAccessToken;
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
          if (cachedLocationRefreshToken) {
            const locationTokens = await refreshLocationToken(locationId, cachedLocationRefreshToken, cfg);
            accessToken = locationTokens.accessToken;
          } else {
            const refreshed = await refreshCompanyToken(locationId, storedRefreshToken);

            if (companyId) {
              const locationTokens = await getLocationToken(refreshed.accessToken, companyId, locationId);
              accessToken = locationTokens.accessToken;
            } else {
              accessToken = refreshed.accessToken;
            }
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
