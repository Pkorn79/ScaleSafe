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

/**
 * Exchange an OAuth authorization code for access + refresh tokens.
 * Called once during merchant install.
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenPair> {
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: 'authorization_code',
    code,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
  };
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
      if (err.response?.status === 401 && !original._retried) {
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
