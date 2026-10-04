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
afterEach(() => jest.useRealTimers());

describe('merchant install persistence', () => {
  it('writes identity only with an exact-location, unchanged-row compare-and-set', async () => {
    const chain: any = {};
    for (const method of ['update', 'eq', 'select']) chain[method] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(async () => ({ data: { location_id: 'loc-1' }, error: null }));
    mockFrom.mockReturnValue(chain);
    const patch = { ghl_location_name: 'Verified subaccount', ghl_location_name_source: 'ghl_location_api',
      ghl_location_name_verified_at: new Date().toISOString() };
    expect(await merchantRepository.writeLocationIdentity(merchant(), patch)).toBe(true);
    expect(chain.update).toHaveBeenCalledWith(patch);
    expect(chain.eq.mock.calls).toEqual([['location_id', 'loc-1'], ['updated_at', '2026-07-12T10:00:00.000Z']]);
    expect(chain.select).toHaveBeenCalledWith('location_id');
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await merchantRepository.writeLocationIdentity(merchant(), patch)).toBe(false);
  });
  const oauth = {
    location_id: 'loc-1', company_id: 'company-1',
    ghl_access_token: 'new-access', ghl_refresh_token: 'new-refresh',
    config: { ghl_token_scope: 'location', ghl_token_location_id: 'loc-1' },
  };

  it('waits for a signed reinstall without spending conflict retries or writing revoked credentials', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const revoked = merchant({ status: 'uninstalled', config: { ghl_last_uninstalled_at: '2026-10-03T12:00:00Z' } });
    const active = merchant({ config: { ...revoked.config, ghl_lifecycle_event_type: 'INSTALL' } });
    const read = jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(revoked);
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(active);
    const pending = merchantRepository.upsertOAuthInstall(oauth, new Date().toISOString(), Date.now() + 10000);
    await jest.advanceTimersByTimeAsync(2000);
    expect(read.mock.calls.length).toBeGreaterThan(5);
    expect(write).not.toHaveBeenCalled();
    read.mockResolvedValue(active);
    await jest.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe(active);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('expires the wait without activating an uninstalled account', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-04T12:00:00Z'));
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({
      status: 'uninstalled', config: { ghl_last_uninstalled_at: '2026-10-03T12:00:00Z' },
    }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    const pending = merchantRepository.upsertOAuthInstall(oauth, new Date().toISOString(), Date.now() + 500);
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    await jest.advanceTimersByTimeAsync(500);
    await assertion;
    expect(write).not.toHaveBeenCalled();
  });

  it('a later revocation still wins while waiting, even if a new INSTALL follows', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const read = jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({
      status: 'uninstalled', config: { ghl_last_uninstalled_at: '2026-10-03T12:00:00Z' },
    }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    const pending = merchantRepository.upsertOAuthInstall(oauth, new Date().toISOString(), Date.now() + 10000);
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 401 });
    await jest.advanceTimersByTimeAsync(250);
    read.mockResolvedValue(merchant({ config: { ghl_last_uninstalled_at: new Date().toISOString() } }));
    await jest.advanceTimersByTimeAsync(250);
    await assertion;
    expect(write).not.toHaveBeenCalled();
  });

  it('reloads and merges newer config after a competing write', async () => {
    const first = merchant({ config: { original: true } });
    const newer = merchant({ config: { original: true, concurrent: true } });
    jest.spyOn(merchantRepository, 'findByLocationId')
      .mockResolvedValueOnce(first).mockResolvedValueOnce(newer);
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged')
      .mockResolvedValueOnce(null).mockResolvedValueOnce(merchant());
    await merchantRepository.upsertOAuthInstall(oauth);
    expect(write).toHaveBeenLastCalledWith(newer, expect.objectContaining({
      config: { original: true, concurrent: true, ...oauth.config },
    }));
  });

  it('reloads an INSTALL stub that wins the initial insert', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId')
      .mockResolvedValueOnce(null).mockResolvedValueOnce(merchant());
    jest.spyOn(merchantRepository, 'create').mockRejectedValue({ code: '23505' });
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(merchant());
    await merchantRepository.upsertOAuthInstall(oauth);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not revive a revocation received during token exchange, even after another INSTALL', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({
      config: { ghl_last_uninstalled_at: '2026-10-03T12:00:01Z', ghl_uninstalled_at: null },
    }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    await expect(merchantRepository.upsertOAuthInstall(oauth, '2026-10-03T12:00:00Z'))
      .rejects.toThrow(/changed during authorization/);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a callback for a different agency', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({ company_id: 'other' }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    await expect(merchantRepository.upsertOAuthInstall(oauth)).rejects.toThrow(/agency/);
    expect(write).not.toHaveBeenCalled();
  });

  it('never reactivates a suspended account through OAuth', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({ status: 'suspended' }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    await expect(merchantRepository.upsertOAuthInstall(oauth)).rejects.toThrow(/not enabled/);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves a merchant name supplied by a newer writer', async () => {
    const current = merchant({ business_name: 'Current merchant name' });
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(current);
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(current);
    await merchantRepository.upsertOAuthInstall({ ...oauth, business_name: 'Stale callback name' });
    expect(write).toHaveBeenCalledWith(current, expect.objectContaining({ business_name: 'Current merchant name' }));
  });

  it.each(['', null])('preserves an intentionally empty business name (%s) after a competing install', async (businessName) => {
    const current = merchant({ business_name: businessName });
    jest.spyOn(merchantRepository, 'findByLocationId')
      .mockResolvedValueOnce(null).mockResolvedValueOnce(current);
    jest.spyOn(merchantRepository, 'create').mockRejectedValue({ code: '23505' });
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(current);
    await merchantRepository.upsertOAuthInstall({ ...oauth, business_name: 'Unverified install-list label' });
    expect(write).toHaveBeenCalledWith(current, expect.objectContaining({ business_name: businessName }));
  });

  it('does not let a callback arriving after an uninstall reactivate the row', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({
      status: 'uninstalled', config: { ghl_uninstalled_at: '2026-10-03T10:00:00Z' },
    }));
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    await expect(merchantRepository.upsertOAuthInstall(oauth, '2026-10-03T12:00:00Z'))
      .rejects.toThrow(/confirmation of a new installation/);
    expect(write).not.toHaveBeenCalled();
  });

  it('bounds retries instead of applying an unguarded final write', async () => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant());
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(null);
    await expect(merchantRepository.upsertOAuthInstall(oauth)).rejects.toThrow(/changed during authorization/);
    expect(write).toHaveBeenCalledTimes(5);
  });

  it('adoption cannot overwrite a callback that wins the concurrent write', async () => {
    const stub = merchant({ ghl_access_token_encrypted: null, ghl_refresh_token_encrypted: null });
    const direct = merchant({ config: { ghl_token_scope: 'location', ghl_token_location_id: 'loc-1' } });
    jest.spyOn(merchantRepository, 'findByLocationId')
      .mockResolvedValueOnce(stub).mockResolvedValueOnce(direct);
    jest.spyOn(merchantRepository, 'findAllByCompanyId').mockResolvedValue([merchant({ location_id: 'source' })]);
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(null);
    expect(await merchantRepository.adoptCompanyAuthorization('loc-1', 'company-1')).toBe(direct);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each(['uninstalled', 'missing', 'wrong-company'])('adoption cannot activate a %s target', async (state) => {
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(
      state === 'missing' ? null : merchant({
        status: state === 'uninstalled' ? state : 'active',
        company_id: state === 'wrong-company' ? 'other' : 'company-1',
      }),
    );
    const write = jest.spyOn(merchantRepository, 'updateIfUnchanged');
    expect(await merchantRepository.adoptCompanyAuthorization('loc-1', 'company-1')).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('guards encrypted writes by location, status and row version', async () => {
    const chain: any = {};
    chain.update = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(async () => ({ data: merchant(), error: null }));
    mockFrom.mockReturnValue(chain);

    await merchantRepository.updateIfUnchanged(merchant(), {
      location_id: 'loc-1',
      company_id: 'company-1',
      ghl_access_token: 'access',
      ghl_refresh_token: 'refresh',
      config: { ghl_token_scope: 'company' },
    });

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-1',
      ghl_access_token: null,
      ghl_access_token_encrypted: 'encrypted:access',
      ghl_refresh_token_encrypted: 'encrypted:refresh',
    }));
    expect(chain.eq.mock.calls).toEqual([
      ['location_id', 'loc-1'], ['status', 'active'],
      ['updated_at', '2026-07-12T10:00:00.000Z'],
    ]);
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
    const target = merchant({ location_id: 'loc-future', ghl_access_token_encrypted: null, ghl_refresh_token_encrypted: null });
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(target);
    jest.spyOn(merchantRepository, 'findAllByCompanyId').mockResolvedValue([source]);
    const upsert = jest.spyOn(merchantRepository, 'updateIfUnchanged').mockResolvedValue(
      merchant({ location_id: 'loc-future' }),
    );

    await merchantRepository.adoptCompanyAuthorization('loc-future', 'company-1');

    expect(upsert).toHaveBeenCalledWith(target, expect.objectContaining({
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
    jest.spyOn(merchantRepository, 'findByLocationId').mockResolvedValue(merchant({
      location_id: 'loc-future', ghl_access_token_encrypted: null, ghl_refresh_token_encrypted: null,
    }));
    jest.spyOn(merchantRepository, 'findAllByCompanyId').mockResolvedValue([source]);
    const upsert = jest.spyOn(merchantRepository, 'upsertOAuthInstall');

    const result = await merchantRepository.adoptCompanyAuthorization('loc-future', 'company-1');

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(merchantHasOAuthCredentials(source)).toBe(true);
  });
});
