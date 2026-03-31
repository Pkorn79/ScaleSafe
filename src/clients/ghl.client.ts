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
 * GHL agency-level apps return companyId but NOT locationId in the token response.
 * When locationId is missing, we call /oauth/installedLocations to resolve it.
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
 * Refresh an expired access token using the stored refresh token.
 * Updates tokens in the merchants table.
 */
export async function refreshAccessToken(locationId: string, currentRefreshToken: string): Promise<TokenPair> {
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
    refreshToken: res.data.refresh_token,
    expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
  };

  // Persist new tokens
  const { error } = await getSupabase()
    .from('merchants')
    .update({
      ghl_access_token: tokens.accessToken,
      ghl_refresh_token: tokens.refreshToken,
      ghl_token_expires_at: tokens.expiresAt.toISOString(),
    })
    .eq('location_id', locationId);

  if (error) {
    logger.error({ locationId, error }, 'Failed to persist refreshed tokens');
  }

  return tokens;
}

/**
 * Create an Axios instance scoped to a merchant's GHL location.
 * Automatically refreshes the token on 401 and retries the request once.
 */
export async function ghlApi(locationId: string): Promise<AxiosInstance> {
  const supabase = getSupabase();

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('ghl_access_token, ghl_refresh_token, ghl_token_expires_at')
    .eq('location_id', locationId)
    .single();

  if (error || !merchant) {
    throw new GHLApiError(`Merchant not found: ${locationId}`);
  }

  let accessToken = merchant.ghl_access_token;

  const instance = axios.create({
    baseURL: config.ghl.apiDomain,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
    timeout: 30000,
  });

  // Intercept 401 → refresh token → retry once
  instance.interceptors.response.use(
    (response) => response,
    async (err) => {
      const original = err.config as AxiosRequestConfig & { _retried?: boolean };
      if ((err.response?.status === 401 || err.response?.status === 403) && !original._retried) {
        original._retried = true;
        logger.info({ locationId }, 'GHL token expired, refreshing');
        const tokens = await refreshAccessToken(locationId, merchant.ghl_refresh_token);
        accessToken = tokens.accessToken;
        original.headers = { ...original.headers, Authorization: `Bearer ${tokens.accessToken}` };
        return instance.request(original);
      }
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      throw new GHLApiError(msg, status);
    },
  );

  return instance;
}
