/**
 * GHL client tests — token exchange field name handling.
 * Verifies that exchangeCodeForTokens handles both camelCase
 * and snake_case field names from GHL's token response,
 * and resolves locationId via installedLocations for agency-level installs.
 */

import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../src/config', () => ({
  config: {
    ghl: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      appId: 'app-123',
      apiDomain: 'https://services.leadconnectorhq.com',
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Must import after mocks are set up
import { exchangeCodeForTokens } from '../../src/clients/ghl.client';
import { config as testConfig } from '../../src/config';

beforeEach(() => {
  jest.clearAllMocks();
  (testConfig.ghl as any).clientId = 'test-client-id';
  (testConfig.ghl as any).appId = 'app-123';
});

describe('exchangeCodeForTokens', () => {
  it('parses camelCase locationId from GHL response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 86400,
        locationId: 'loc-camel',
        companyId: 'comp-1',
        userId: 'user-1',
        scope: 'contacts.readonly locations.readonly',
      },
    });

    const result = await exchangeCodeForTokens('code-123');
    expect(result.locationId).toBe('loc-camel');
    expect(result.companyId).toBe('comp-1');
    expect(result.scopes).toEqual(['contacts.readonly', 'locations.readonly']);
    // Should NOT call installedLocations when locationId is present
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('falls back to snake_case location_id from GHL response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-2',
        refresh_token: 'rt-2',
        expires_in: 86400,
        location_id: 'loc-snake',
        company_id: 'comp-snake',
        user_id: 'user-snake',
        scope: 'contacts.write',
      },
    });

    const result = await exchangeCodeForTokens('code-456');
    expect(result.locationId).toBe('loc-snake');
    expect(result.companyId).toBe('comp-snake');
    expect(result.userId).toBe('user-snake');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('parses v3-style camelCase token fields from GHL response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        accessToken: 'at-v3',
        refreshToken: 'rt-v3',
        expiresIn: 86400,
        locationId: 'loc-v3',
        companyId: 'comp-v3',
        userId: 'user-v3',
        scopes: ['contacts.readonly', 'locations.readonly'],
      },
    });

    const result = await exchangeCodeForTokens('code-v3');

    expect(result.accessToken).toBe('at-v3');
    expect(result.refreshToken).toBe('rt-v3');
    expect(result.locationId).toBe('loc-v3');
    expect(result.scopes).toEqual(['contacts.readonly', 'locations.readonly']);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('resolves locationId via installedLocations when token has companyId but no locationId', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-agency',
        refresh_token: 'rt-agency',
        expires_in: 86400,
        companyId: 'comp-agency',
        scope: 'contacts.readonly',
      },
    });

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: {
        locations: [
          { _id: 'loc-resolved', name: 'PMG Sub-Account' },
        ],
      },
    });

    const result = await exchangeCodeForTokens('code-agency');
    expect(result.locationId).toBe('loc-resolved');
    expect(result.companyId).toBe('comp-agency');
    expect(result._debug?.installedLocationsResponse).toBeDefined();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/oauth/installed-locations',
      expect.objectContaining({
        params: expect.objectContaining({ companyId: 'comp-agency', appId: 'app-123' }),
      }),
    );
  });

  it('derives Marketplace appId from GHL clientId when explicit appId env is missing', async () => {
    (testConfig.ghl as any).clientId = '665c6bb13d4e5364bdec0e2f-mawqjyjd';
    (testConfig.ghl as any).appId = '';

    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-agency',
        refresh_token: 'rt-agency',
        expires_in: 86400,
        companyId: 'comp-agency',
        scope: 'contacts.readonly',
      },
    });

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: {
        locations: [
          { locationId: 'loc-derived', name: 'Derived App ID Account' },
        ],
      },
    });

    const result = await exchangeCodeForTokens('code-derived-app-id');

    expect(result.locationId).toBe('loc-derived');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/oauth/installed-locations',
      expect.objectContaining({
        params: expect.objectContaining({ companyId: 'comp-agency', appId: '665c6bb13d4e5364bdec0e2f' }),
      }),
    );
  });

  it('falls back to legacy installedLocations endpoint when the current path is unavailable', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-agency',
        refresh_token: 'rt-agency',
        expires_in: 86400,
        companyId: 'comp-agency',
        scope: 'contacts.readonly',
      },
    });

    mockedAxios.get
      .mockRejectedValueOnce({ message: 'Not found', response: { status: 404, data: {} } })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          locations: [
            { _id: 'loc-legacy', name: 'Legacy Endpoint Account' },
          ],
        },
      });

    const result = await exchangeCodeForTokens('code-legacy-endpoint');

    expect(result.locationId).toBe('loc-legacy');
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://services.leadconnectorhq.com/oauth/installed-locations',
      expect.any(Object),
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://services.leadconnectorhq.com/oauth/installedLocations',
      expect.any(Object),
    );
  });

  it('retries installed location lookup when GHL initially returns an empty list', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-agency',
        refresh_token: 'rt-agency',
        expires_in: 86400,
        companyId: 'comp-agency',
        scope: 'contacts.readonly',
      },
    });

    mockedAxios.get
      .mockResolvedValueOnce({ status: 200, data: { locations: [] } })
      .mockResolvedValueOnce({ status: 200, data: { locations: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          locations: [
            { locationId: 'loc-after-delay', name: 'Delayed Install Account' },
          ],
        },
      });

    const result = await exchangeCodeForTokens('code-delayed-install');

    expect(result.locationId).toBe('loc-after-delay');
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('returns all installed locations without guessing when multiple sub-accounts are installed', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-agency',
        refresh_token: 'rt-agency',
        expires_in: 86400,
        companyId: 'comp-agency',
        scope: 'contacts.readonly',
      },
    });

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: {
        locations: [
          { locationId: 'loc-a', name: 'Account A' },
          { location_id: 'loc-b', location_name: 'Account B' },
        ],
      },
    });

    const result = await exchangeCodeForTokens('code-agency');

    expect(result.locationId).toBe('');
    expect(result.installedLocations).toEqual([
      { locationId: 'loc-a', name: 'Account A' },
      { locationId: 'loc-b', name: 'Account B' },
    ]);
    expect(result._debug?.installedLocationsResponse).toMatchObject({
      locationCount: 2,
      multipleInstalledLocations: true,
    });
  });

  it('returns empty locationId when installedLocations returns no locations', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-empty',
        refresh_token: 'rt-empty',
        expires_in: 86400,
        companyId: 'comp-empty',
        scope: '',
      },
    });

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { locations: [] },
    });

    const result = await exchangeCodeForTokens('code-empty');
    expect(result.locationId).toBe('');
    expect(result._debug?.installedLocationsResponse).toMatchObject({ locationCount: 0 });
  });

  it('returns empty locationId when installedLocations API call fails', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-fail',
        refresh_token: 'rt-fail',
        expires_in: 86400,
        companyId: 'comp-fail',
        scope: '',
      },
    });

    mockedAxios.get.mockRejectedValue(new Error('Network error'));

    const result = await exchangeCodeForTokens('code-fail');
    expect(result.locationId).toBe('');
    expect(result.companyId).toBe('comp-fail');
    expect(result._debug?.installedLocationsResponse).toMatchObject({ error: 'Network error' });
  });

  it('sends user_type=Location in the token request', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at-4',
        refresh_token: 'rt-4',
        expires_in: 86400,
        locationId: 'loc-test',
        scope: '',
      },
    });

    await exchangeCodeForTokens('code-user-type');

    const callBody = mockedAxios.post.mock.calls[0][1] as string;
    expect(callBody).toContain('user_type=Location');
  });
});
