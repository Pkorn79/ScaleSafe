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
      apiDomain: 'https://services.leadconnectorhq.com',
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Must import after mocks are set up
import { exchangeCodeForTokens } from '../../src/clients/ghl.client';

beforeEach(() => {
  jest.clearAllMocks();
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
      'https://services.leadconnectorhq.com/oauth/installedLocations',
      expect.objectContaining({
        params: { companyId: 'comp-agency' },
      }),
    );
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
