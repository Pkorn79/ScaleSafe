import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { GHLApiError } from '../utils/errors';
import { getSupabase } from './supabase.client';

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

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

  // Log full response for debugging (redact tokens in production)
  logger.info({
    tokenResponseKeys: Object.keys(data),
    locationId: data.locationId,
    location_id: data.location_id,
    companyId: data.companyId,
    userId: data.userId,
    userType: data.userType,
    scope: data.scope,
  }, 'GHL token exchange response');

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
  const debug: Record<string, unknown> = { called: true, companyId };

  try {
    logger.info({ companyId }, 'No locationId in token response — resolving via locations/search');

    const res = await axios.get(`${config.ghl.apiDomain}/locations/search`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
      params: { companyId },
    });

    // Capture the FULL response for debugging
    debug.httpStatus = res.status;
    debug.responseKeys = Object.keys(res.data || {});
    debug.fullResponseBody = res.data;

    const locations = res.data.locations || [];
    debug.locationCount = locations.length;
    debug.rawLocations = locations.map((l: any) => ({ id: l.id || l._id, name: l.name }));

    logger.info({ companyId, locationCount: locations.length, locations: debug.rawLocations }, 'Locations search response');

    if (locations.length === 0) {
      logger.error({ companyId }, 'No locations found for company');
      return { locationId: '', debug };
    }

    // Use the first location — for single sub-account installs this is the target
    const loc = locations[0];
    const resolvedId = loc.id || loc._id || loc.locationId || '';
    debug.resolvedLocationId = resolvedId;
    debug.firstLocationKeys = Object.keys(loc);
    logger.info({ companyId, resolvedLocationId: resolvedId, locationName: loc.name }, 'Resolved locationId from locations/search');
    return { locationId: resolvedId, debug };
  } catch (err: any) {
    debug.error = err.message;
    debug.errorStatus = err.response?.status;
    debug.errorBody = err.response?.data;
    logger.error({ err: err.message, companyId, status: err.response?.status, body: err.response?.data }, 'Failed to resolve locationId from locations/search');
    return { locationId: '', debug };
  }
}

/**
 * Refresh an expired Company-level access token.
 * Updates the company tokens in the merchants table.
 */
async function refreshCompanyToken(locationId: string, currentRefreshToken: string): Promise<TokenPair> {
  logger.info({ locationId }, 'Refreshing GHL company access token');
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
    logger.error({ locationId, error }, 'Failed to persist refreshed company tokens');
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
  logger.info({ companyId, locationId }, 'Exchanging company token for location token');

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
    logger.error({ locationId, err }, 'Failed to persist location token');
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
        logger.error({ err: err.message, locationId }, 'Failed to refresh company token');
        throw new GHLApiError(`Company token refresh failed: ${err.message}`);
      }
    }

    // Exchange company token for location token
    try {
      const locationTokens = await getLocationToken(companyAccessToken, companyId, locationId);
      accessToken = locationTokens.accessToken;
    } catch (err: any) {
      logger.error({ err: err.message, locationId, companyId }, 'Failed to get location token');
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

  // Intercept 401 → refresh company token → get new location token → retry once
  instance.interceptors.response.use(
    (response) => response,
    async (err) => {
      const original = err.config as AxiosRequestConfig & { _retried?: boolean };
      if ((err.response?.status === 401 || err.response?.status === 403) && !original._retried) {
        original._retried = true;
        logger.info({ locationId }, 'GHL token rejected, refreshing');

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
          logger.error({ err: refreshErr.message, locationId }, 'Token refresh+exchange failed');
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
