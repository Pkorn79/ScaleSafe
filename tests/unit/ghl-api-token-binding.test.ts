import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockFrom = jest.fn();
let responseRejected: ((error: any) => Promise<any>) | null = null;

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockFrom(...args) }),
}));

jest.mock('../../src/utils/field-encryption', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
}));

jest.mock('../../src/config', () => ({
  config: {
    ghl: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      appId: 'app-id',
      apiDomain: 'https://services.leadconnectorhq.com',
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { ghlApi } from '../../src/clients/ghl.client';

interface BuilderTrace {
  eq: Array<[string, unknown]>;
  or: string[];
  update?: Record<string, unknown>;
}

function installSupabaseMock(singleResults: any[], updateResults: any[] = []) {
  const traces: BuilderTrace[] = [];
  mockFrom.mockImplementation(() => {
    const trace: BuilderTrace = { eq: [], or: [] };
    traces.push(trace);
    const chain: any = {};
    chain.select = jest.fn(() => chain);
    chain.update = jest.fn((payload: Record<string, unknown>) => {
      trace.update = payload;
      return chain;
    });
    chain.eq = jest.fn((column: string, value: unknown) => {
      trace.eq.push([column, value]);
      return chain;
    });
    chain.or = jest.fn((filter: string) => {
      trace.or.push(filter);
      return chain;
    });
    chain.single = jest.fn(async () => singleResults.shift() || { data: null, error: null });
    chain.maybeSingle = jest.fn(async () => updateResults.shift() || { data: null, error: null });
    chain.then = (resolve: (value: any) => void, reject: (reason: any) => void) =>
      Promise.resolve(updateResults.shift() || { data: null, error: null }).then(resolve, reject);
    return chain;
  });
  return traces;
}

function installAxiosInstance() {
  const instance: any = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn((_fulfilled: any, rejected: any) => { responseRejected = rejected; }) },
    },
    request: jest.fn(),
  };
  mockedAxios.create.mockReturnValue(instance);
  return instance;
}

function baseMerchant(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    company_id: 'company-1',
    ghl_access_token: null,
    ghl_refresh_token: null,
    ghl_access_token_encrypted: 'encrypted:primary-access',
    ghl_refresh_token_encrypted: 'encrypted:primary-refresh',
    ghl_token_expires_at: '2099-01-01T00:00:00.000Z',
    config: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  responseRejected = null;
  installAxiosInstance();
});

describe('ghlApi token/location binding', () => {
  it('treats legacy unbound credentials as location-scoped even when companyId is present', async () => {
    installSupabaseMock([{
      data: baseMerchant({ config: {} }),
      error: null,
    }]);

    await ghlApi('loc-1');

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer primary-access' }),
    }));
  });

  it('uses a location-scoped primary token directly even when companyId is present', async () => {
    installSupabaseMock([{
      data: baseMerchant({
        config: {
          ghl_token_scope: 'location',
          ghl_token_location_id: 'loc-1',
          ghl_token_company_id: 'company-1',
        },
      }),
      error: null,
    }]);

    await ghlApi('loc-1');

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer primary-access' }),
    }));
  });

  it('exchanges a company token for the requested location and persists it', async () => {
    const traces = installSupabaseMock([
      {
        data: baseMerchant({
          config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' },
        }),
        error: null,
      },
      { data: { config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }, error: null },
    ], [{ data: { location_id: 'loc-1' }, error: null }]);
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'location-access',
        refresh_token: 'location-refresh',
        expires_in: 86400,
        userType: 'Location',
        locationId: 'loc-1',
        companyId: 'company-1',
      },
    });

    await ghlApi('loc-1');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/oauth/location-token',
      { companyId: 'company-1', locationId: 'loc-1' },
      expect.any(Object),
    );
    expect(traces.some((trace) =>
      trace.update?.config
      && (trace.update.config as any).location_access_token_encrypted === 'encrypted:location-access'))
      .toBe(true);
    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer location-access' }),
    }));
  });

  it('rejects a location-token response for a different sub-account', async () => {
    installSupabaseMock([{
      data: baseMerchant({ config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }),
      error: null,
    }]);
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'wrong-access',
        refresh_token: 'wrong-refresh',
        expires_in: 86400,
        userType: 'Location',
        locationId: 'loc-other',
        companyId: 'company-1',
      },
    });

    await expect(ghlApi('loc-1')).rejects.toThrow(/different sub-account/i);
    expect(mockedAxios.create).not.toHaveBeenCalled();
  });

  it('rejects a location-token response that omits its location binding', async () => {
    installSupabaseMock([{
      data: baseMerchant({ config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }),
      error: null,
    }]);
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'unbound-access',
        refresh_token: 'unbound-refresh',
        expires_in: 86400,
        userType: 'Location',
        companyId: 'company-1',
      },
    });

    await expect(ghlApi('loc-1')).rejects.toThrow(/different sub-account/i);
    expect(mockedAxios.create).not.toHaveBeenCalled();
  });

  it('does not continue with an unpersisted location token', async () => {
    installSupabaseMock([
      {
        data: baseMerchant({ config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }),
        error: null,
      },
      { data: { config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }, error: null },
    ], [{ data: null, error: new Error('database unavailable') }]);
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'location-access',
        refresh_token: 'location-refresh',
        expires_in: 86400,
        userType: 'Location',
        locationId: 'loc-1',
        companyId: 'company-1',
      },
    });

    await expect(ghlApi('loc-1')).rejects.toThrow(/child-location credentials failed after retry/i);
    expect(mockedAxios.create).not.toHaveBeenCalled();
  });

  it('refuses to use retained credentials after uninstall', async () => {
    installSupabaseMock([{
      data: baseMerchant({
        status: 'uninstalled',
        config: { ghl_token_scope: 'location', ghl_token_location_id: 'loc-1' },
      }),
      error: null,
    }]);

    await expect(ghlApi('loc-1')).rejects.toThrow(/not actively installed/i);
    expect(mockedAxios.create).not.toHaveBeenCalled();
  });

  it('persists a rotated company refresh token to every active sibling location', async () => {
    const traces = installSupabaseMock([
      {
        data: baseMerchant({
          ghl_token_expires_at: '2020-01-01T00:00:00.000Z',
          config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' },
        }),
        error: null,
      },
      { data: { config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }, error: null },
    ], [
      { data: [{ location_id: 'loc-1' }, { location_id: 'loc-2' }], error: null },
      { data: { location_id: 'loc-1' }, error: null },
    ]);
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          access_token: 'rotated-company-access',
          refresh_token: 'rotated-company-refresh',
          expires_in: 86400,
          userType: 'Company',
          companyId: 'company-1',
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: 'location-access',
          refresh_token: 'location-refresh',
          expires_in: 86400,
          userType: 'Location',
          locationId: 'loc-1',
          companyId: 'company-1',
        },
      });

    await ghlApi('loc-1');

    const companyUpdate = traces.find((trace) =>
      trace.update?.ghl_refresh_token_encrypted === 'encrypted:rotated-company-refresh');
    expect(companyUpdate?.eq).toEqual(expect.arrayContaining([
      ['company_id', 'company-1'],
      ['status', 'active'],
    ]));
    expect(companyUpdate?.or).toContain(
      'config->>ghl_token_scope.eq.company,config->>ghl_token_scope.is.null',
    );
  });

  it('recovers when another instance already rotated the shared company refresh token', async () => {
    installSupabaseMock([
      {
        data: baseMerchant({
          ghl_token_expires_at: '2020-01-01T00:00:00.000Z',
          config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' },
        }),
        error: null,
      },
      {
        data: baseMerchant({
          ghl_access_token_encrypted: 'encrypted:new-company-access',
          ghl_refresh_token_encrypted: 'encrypted:new-company-refresh',
          ghl_token_expires_at: '2099-01-01T00:00:00.000Z',
          config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' },
        }),
        error: null,
      },
      { data: { config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } }, error: null },
    ], [{ data: { location_id: 'loc-1' }, error: null }]);
    mockedAxios.post
      .mockRejectedValueOnce(Object.assign(new Error('refresh token already used'), {
        response: { status: 400 },
      }))
      .mockResolvedValueOnce({
        data: {
          access_token: 'location-access',
          refresh_token: 'location-refresh',
          expires_in: 86400,
          userType: 'Location',
          locationId: 'loc-1',
          companyId: 'company-1',
        },
      });

    await ghlApi('loc-1');

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://services.leadconnectorhq.com/oauth/location-token',
      { companyId: 'company-1', locationId: 'loc-1' },
      expect.any(Object),
    );
    expect(mockedAxios.create).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer location-access' }),
    }));
  });

  it('falls back to company authorization when a cached location refresh is rejected', async () => {
    const instance = installAxiosInstance();
    installSupabaseMock([
      {
        data: baseMerchant({
          config: {
            ghl_token_scope: 'company',
            ghl_token_company_id: 'company-1',
            location_access_token_encrypted: 'encrypted:stale-location-access',
            location_refresh_token_encrypted: 'encrypted:stale-location-refresh',
            location_token_expires_at: '2099-01-01T00:00:00.000Z',
          },
        }),
        error: null,
      },
      {
        data: { config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' } },
        error: null,
      },
    ], [{ data: { location_id: 'loc-1' }, error: null }]);
    mockedAxios.post
      .mockRejectedValueOnce(Object.assign(new Error('stale child refresh'), { response: { status: 400 } }))
      .mockResolvedValueOnce({
        data: {
          access_token: 'fresh-location-access',
          refresh_token: 'fresh-location-refresh',
          expires_in: 86400,
          userType: 'Location',
          locationId: 'loc-1',
          companyId: 'company-1',
        },
      });
    instance.request.mockResolvedValue({ data: { ok: true } });

    await ghlApi('loc-1');
    await responseRejected!({ response: { status: 401 }, config: { headers: {} } });

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://services.leadconnectorhq.com/oauth/location-token',
      { companyId: 'company-1', locationId: 'loc-1' },
      expect.any(Object),
    );
    expect(instance.request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-location-access' }),
    }));
  });
});
