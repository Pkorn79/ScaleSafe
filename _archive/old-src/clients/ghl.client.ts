/**
 * ghl.client.ts — GoHighLevel API Client
 *
 * Refactored from the GHL Marketplace App Template's ghl.ts.
 * Key changes from the template:
 * - Tokens stored in Supabase (merchants table) instead of in-memory
 * - SSO decryption moved to utils/crypto.ts
 * - Structured logging instead of console.log
 * - Proper error handling with custom error classes
 *
 * This client handles:
 * - OAuth token exchange (authorization code → access + refresh tokens)
 * - Token refresh on 401 responses
 * - Creating authenticated axios instances for GHL API calls
 * - Getting location tokens from company tokens
 */

import qs from 'qs';
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExternalServiceError, AuthenticationError } from '../utils/errors';

/** Token data returned by GHL OAuth endpoints. */
export interface GhlTokenData {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: 'Company' | 'Location';
  companyId?: string;
  locationId?: string;
}

/**
 * Callback interface for persisting tokens.
 * The merchant.repository provides the concrete implementation.
 */
export interface TokenStore {
  getTokens(resourceId: string): Promise<{ accessToken: string; refreshToken: string } | null>;
  saveTokens(resourceId: string, data: GhlTokenData): Promise<void>;
  updateTokens(resourceId: string, accessToken: string, refreshToken: string): Promise<void>;
}

/** GHL API client with OAuth token management. */
export class GhlClient {
  private tokenStore: TokenStore;

  constructor(tokenStore: TokenStore) {
    this.tokenStore = tokenStore;
  }

  /**
   * Handles the OAuth callback from GHL Marketplace.
   * Exchanges the authorization code for access + refresh tokens,
   * then persists them via the token store.
   */
  async handleAuthorization(code: string): Promise<GhlTokenData> {
    if (!code) {
      throw new AuthenticationError('Missing authorization code');
    }

    const tokenData = await this.exchangeCodeForTokens(code);
    await this.tokenStore.saveTokens(
      tokenData.locationId || tokenData.companyId || '',
      tokenData
    );

    logger.info(
      { locationId: tokenData.locationId, companyId: tokenData.companyId },
      'GHL OAuth tokens saved'
    );

    return tokenData;
  }

  /**
   * Creates an authenticated axios instance for making GHL API calls.
   * Automatically attaches the Bearer token and handles 401 refresh.
   */
  async getAuthenticatedClient(resourceId: string): Promise<AxiosInstance> {
    const tokens = await this.tokenStore.getTokens(resourceId);
    if (!tokens) {
      throw new AuthenticationError(`No GHL installation found for resource: ${resourceId}`);
    }

    const instance = axios.create({
      baseURL: config.ghl.apiDomain,
    });

    // Attach access token to every request
    instance.interceptors.request.use(
      async (requestConfig: InternalAxiosRequestConfig) => {
        const currentTokens = await this.tokenStore.getTokens(resourceId);
        if (currentTokens) {
          requestConfig.headers['Authorization'] = `Bearer ${currentTokens.accessToken}`;
        }
        return requestConfig;
      }
    );

    // On 401, refresh the token and retry once
    instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          await this.refreshAccessToken(resourceId);
          const newTokens = await this.tokenStore.getTokens(resourceId);
          if (newTokens) {
            originalRequest.headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
          }
          return axios(originalRequest);
        }
        return Promise.reject(error);
      }
    );

    return instance;
  }

  /**
   * Gets a location-level token from a company-level token.
   * Used when the app is installed at the agency level and needs
   * to make API calls for a specific sub-account.
   */
  async getLocationTokenFromCompanyToken(
    companyId: string,
    locationId: string
  ): Promise<void> {
    const client = await this.getAuthenticatedClient(companyId);
    const res = await client.post(
      '/oauth/locationToken',
      { companyId, locationId },
      { headers: { Version: '2021-07-28' } }
    );
    await this.tokenStore.saveTokens(locationId, res.data);
    logger.info({ companyId, locationId }, 'Location token obtained from company token');
  }

  /** Exchanges an authorization code for access + refresh tokens. */
  private async exchangeCodeForTokens(code: string): Promise<GhlTokenData> {
    try {
      const resp = await axios.post(
        `${config.ghl.apiDomain}/oauth/token`,
        qs.stringify({
          client_id: config.ghl.clientId,
          client_secret: config.ghl.clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
      );
      return resp.data;
    } catch (error: any) {
      logger.error({ error: error?.response?.data }, 'GHL token exchange failed');
      throw new ExternalServiceError('GHL', 'Token exchange failed');
    }
  }

  /** Refreshes an expired access token using the stored refresh token. */
  private async refreshAccessToken(resourceId: string): Promise<void> {
    const tokens = await this.tokenStore.getTokens(resourceId);
    if (!tokens) {
      throw new AuthenticationError(`Cannot refresh — no tokens for resource: ${resourceId}`);
    }

    try {
      const resp = await axios.post(
        `${config.ghl.apiDomain}/oauth/token`,
        qs.stringify({
          client_id: config.ghl.clientId,
          client_secret: config.ghl.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }),
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
      );

      await this.tokenStore.updateTokens(
        resourceId,
        resp.data.access_token,
        resp.data.refresh_token
      );

      logger.debug({ resourceId }, 'GHL access token refreshed');
    } catch (error: any) {
      logger.error({ error: error?.response?.data, resourceId }, 'GHL token refresh failed');
      throw new ExternalServiceError('GHL', 'Token refresh failed');
    }
  }
}
