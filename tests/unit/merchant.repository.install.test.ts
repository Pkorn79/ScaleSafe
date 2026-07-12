const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockFrom(...args) }),
}));

jest.mock('../../src/utils/field-encryption', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
}));

import {
  merchantHasOAuthCredentials,
  merchantRepository,
} from '../../src/repositories/merchant.repository';

function merchant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'merchant-1',
    location_id: 'loc-1',
    company_id: 'company-1',
    status: 'active',
    snapshot_status: 'pending',
    snapshot_attempts: 1,
    updated_at: '2026-07-12T10:00:00.000Z',
    ghl_access_token: null,
    ghl_refresh_token: null,
    ghl_access_token_encrypted: 'encrypted:company-access',
    ghl_refresh_token_encrypted: 'encrypted:company-refresh',
    ghl_token_expires_at: '2026-07-13T10:00:00.000Z',
    ghl_scopes: 'contacts.readonly',
    config: { ghl_token_scope: 'company', ghl_token_company_id: 'company-1' },
    ...overrides,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('merchant install persistence', () => {
  it('atomically upserts OAuth credentials over a lifecycle webhook stub', async () => {
    const chain: any = {};
    chain.upsert = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.single = jest.fn(async () => ({ data: merchant(), error: null }));
    mockFrom.mockReturnValue(chain);

    await merchantRepository.upsertOAuthInstall({
      location_id: 'loc-1',
      company_id: 'company-1',
      ghl_access_token: 'access',
      ghl_refresh_token: 'refresh',
      config: { ghl_token_scope: 'company' },
    });

    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-1',
      status: 'active',
      ghl_access_token: null,
      ghl_access_token_encrypted: 'encrypted:access',
      ghl_refresh_token_encrypted: 'encrypted:refresh',
    }), { onConflict: 'location_id' });
  });

  it('claims provisioning with status, attempt, and updated-at compare-and-set guards', async () => {
    const current = merchant();
    const selectChain: any = {};
    selectChain.select = jest.fn(() => selectChain);
    selectChain.eq = jest.fn(() => selectChain);
    selectChain.single = jest.fn(async () => ({ data: current, error: null }));

    const updateChain: any = {};
    updateChain.update = jest.fn(() => updateChain);
    updateChain.eq = jest.fn(() => updateChain);
    updateChain.select = jest.fn(() => updateChain);
    updateChain.maybeSingle = jest.fn(async () => ({
      data: { ...current, snapshot_status: 'installing', snapshot_attempts: 2 },
      error: null,
    }));
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain);

    const claimed = await merchantRepository.claimProvisioning(
      'loc-1',
      new Date('2026-07-12T09:00:00.000Z'),
      5,
    );

    expect(claimed?.snapshot_status).toBe('installing');
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      snapshot_status: 'installing', snapshot_attempts: 2, snapshot_error: null,
    }));
    expect(updateChain.eq.mock.calls).toEqual(expect.arrayContaining([
      ['location_id', 'loc-1'],
      ['snapshot_status', 'pending'],
      ['snapshot_attempts', 1],
      ['updated_at', '2026-07-12T10:00:00.000Z'],
    ]));
  });

  it('does not reclaim a currently active provisioning lease', async () => {
    const current = merchant({ snapshot_status: 'installing', updated_at: '2026-07-12T10:00:00.000Z' });
    const selectChain: any = {};
    selectChain.select = jest.fn(() => selectChain);
    selectChain.eq = jest.fn(() => selectChain);
    selectChain.single = jest.fn(async () => ({ data: current, error: null }));
    mockFrom.mockReturnValueOnce(selectChain);

    const claimed = await merchantRepository.claimProvisioning(
      'loc-1',
      new Date('2026-07-12T09:55:00.000Z'),
      5,
    );

    expect(claimed).toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('copies only a company-scoped authorization to a future location', async () => {
    const source = merchant({ location_id: 'loc-source' });
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(null);
    jest.spyOn(merchantRepository, 'findAllByCompanyId').mockResolvedValue([source]);
    const upsert = jest.spyOn(merchantRepository, 'upsertOAuthInstall').mockResolvedValue(
      merchant({ location_id: 'loc-future' }),
    );

    await merchantRepository.adoptCompanyAuthorization('loc-future', 'company-1');

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-future',
      company_id: 'company-1',
      ghl_access_token: 'company-access',
      ghl_refresh_token: 'company-refresh',
      config: expect.objectContaining({ ghl_token_scope: 'company' }),
    }));
  });

  it('never copies a location-scoped token to another sub-account', async () => {
    const source = merchant({
      location_id: 'loc-source',
      config: { ghl_token_scope: 'location', ghl_token_location_id: 'loc-source' },
    });
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(null);
    jest.spyOn(merchantRepository, 'findAllByCompanyId').mockResolvedValue([source]);
    const upsert = jest.spyOn(merchantRepository, 'upsertOAuthInstall');

    const result = await merchantRepository.adoptCompanyAuthorization('loc-future', 'company-1');

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(merchantHasOAuthCredentials(source)).toBe(true);
  });
});
