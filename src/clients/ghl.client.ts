import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { GHLApiError } from '../utils/errors';
import { getSupabase } from './supabase.client';

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
const CUSTOM_FIELD_ID_CACHE_TTL_MS = 5 * 60 * 1000;

const customFieldIdCache = new Map<string, {
  expiresAt: number;
  map: Map<string, string>;
}>();

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface TokenResponse extends TokenPair {
  locationId: string;
  companyId: string;
  userId: string;
  scopes: string[];
  _debug?: Record<string, unknown>;
}

function normalizeContactFieldKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('contact.') ? trimmed : `contact.${trimmed}`;
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
    const rawKey = field?.fieldKey || field?.key;
    if (!id || !rawKey) continue;

    const contactKey = normalizeContactFieldKey(String(rawKey));
    const bareKey = contactKey.replace(/^contact\./, '');
    map.set(contactKey, id);
    map.set(bareKey, id);
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
      scopeCount: data.scope ? String(data.scope).split(' ').length : 0,
    }, 'GHL token exchange response');
  }

  // GHL uses camelCase (locationId) but has historically been inconsistent
  let locationId = data.locationId || data.location_id || '';
  const companyId = data.companyId || data.company_id || '';
  const userId = data.userId || data.user_id || '';
  const accessToken = data.access_token;

  // Collect debug info to surface in error responses
  const debug: Record<string, unknown> = {
    tokenResponseKeys: Object.keys(data),
    hadLocationId: !!(data.locationId || data.location_id),
    hadCompanyId: !!companyId,
  };

  // Agency-level installs return companyId but no locationId.
  // Resolve locationId by querying installed locations.
  if (!locationId && companyId && accessToken) {
    const resolved = await resolveLocationFromCompany(accessToken, companyId);
    locationId = resolved.locationId;
    debug.installedLocationsResponse = resolved.debug;
  }

  return {
    accessToken,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    locationId,
    companyId,
    userId,
    scopes: data.scope ? data.scope.split(' ') : [],
    _debug: debug,
  };
}

/**
 * When GHL returns a company-level token without locationId, use the company
 * token to search for locations under the company via GET /locations/search.
 * Returns both the resolved locationId and full debug info for diagnostics.
 */
async function resolveLocationFromCompany(
  accessToken: string,
  companyId: string,
): Promise<{ locationId: string; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { called: true };

  try {
    logger.info('No locationId in token response - resolving via locations/search');

    const res = await axios.get(`${config.ghl.apiDomain}/locations/search`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
      params: { companyId },
    });

    debug.httpStatus = res.status;
    debug.responseKeys = Object.keys(res.data || {});

    const locations = res.data.locations || [];
    debug.locationCount = locations.length;
    if (config.isDev) {
      debug.rawLocations = locations.map((l: any) => ({ id: l.id || l._id, name: l.name }));
    }

    logger.info({ locationCount: locations.length }, 'Locations search response');

    if (locations.length === 0) {
      logger.error('No locations found for company');
      return { locationId: '', debug };
    }

    // Use the first location — for single sub-account installs this is the target
    const loc = locations[0];
    const resolvedId = loc.id || loc._id || loc.locationId || '';
    debug.resolvedLocationId = resolvedId;
    debug.firstLocationKeys = Object.keys(loc);
    logger.info('Resolved locationId from locations/search');
    return { locationId: resolvedId, debug };
  } catch (err: any) {
    debug.error = err.message;
    debug.errorStatus = err.response?.status;
    debug.errorBodyKeys = err.response?.data ? Object.keys(err.response.data) : [];
    logger.error({
      err: err.message,
      status: err.response?.status,
      responseKeys: err.response?.data ? Object.keys(err.response.data) : [],
    }, 'Failed to resolve locationId from locations/search');
    return { locationId: '', debug };
  }
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
      ghl_access_token: tokens.accessToken,
      ghl_refresh_token: tokens.refreshToken,
      ghl_token_expires_at: tokens.expiresAt.toISOString(),
    })
    .eq('location_id', locationId);

  if (error) {
    logger.error({ error }, 'Failed to persist refreshed company tokens');
  }

  return tokens;
}

/**
 * Exchange a Company-scoped access token for a Location-scoped access token.
 * This is required for Agency-level installs to access location-level endpoints
 * (custom fields, custom values, contacts, etc.).
 *
 * POST /oauth/locationToken
 * Body: { companyId, locationId }
 * Auth: Bearer <company_access_token>
 */
async function getLocationToken(
  companyAccessToken: string,
  companyId: string,
  locationId: string,
): Promise<TokenPair> {
  logger.info('Exchanging company token for location token');

  const res = await axios.post(
    `${config.ghl.apiDomain}/oauth/locationToken`,
    { companyId, locationId },
    {
      headers: {
        Authorization: `Bearer ${companyAccessToken}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    },
  );

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
          location_access_token: tokens.accessToken,
          location_refresh_token: tokens.refreshToken,
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

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('ghl_access_token, ghl_refresh_token, ghl_token_expires_at, company_id, config')
    .eq('location_id', locationId)
    .single();

  if (error || !merchant) {
    throw new GHLApiError(`Merchant not found: ${locationId}`);
  }

  const companyId = (merchant as any).company_id || '';
  const cfg = (merchant.config || {}) as Record<string, unknown>;

  // Determine if we need a location token exchange
  let accessToken: string;
  const locationTokenExpiry = cfg.location_token_expires_at
    ? new Date(cfg.location_token_expires_at as string)
    : null;
  const locationTokenValid = locationTokenExpiry && locationTokenExpiry > new Date();

  if (locationTokenValid && cfg.location_access_token) {
    // Use cached location token
    accessToken = cfg.location_access_token as string;
  } else if (companyId) {
    // Need to get a location token from company token
    let companyAccessToken = merchant.ghl_access_token;

    // Check if company token is expired and refresh if needed
    const companyExpiry = merchant.ghl_token_expires_at
      ? new Date(merchant.ghl_token_expires_at)
      : null;
    if (companyExpiry && companyExpiry <= new Date()) {
      try {
        const refreshed = await refreshCompanyToken(locationId, merchant.ghl_refresh_token);
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
      // Fall back to company token — some endpoints may work
      accessToken = companyAccessToken;
    }
  } else {
    // No companyId — use the stored token directly (Location-level install)
    accessToken = merchant.ghl_access_token;
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

  // Intercept 401 → refresh company token → get new location token → retry once
  instance.interceptors.response.use(
    (response) => response,
    async (err) => {
      const original = err.config as AxiosRequestConfig & { _retried?: boolean };
      if ((err.response?.status === 401 || err.response?.status === 403) && !original._retried) {
        original._retried = true;
        logger.info('GHL token rejected, refreshing');

        try {
          // Refresh company token
          const refreshed = await refreshCompanyToken(locationId, merchant.ghl_refresh_token);

          if (companyId) {
            // Get fresh location token
            const locationTokens = await getLocationToken(refreshed.accessToken, companyId, locationId);
            accessToken = locationTokens.accessToken;
          } else {
            accessToken = refreshed.accessToken;
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
