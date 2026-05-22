const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { merchantRepository } from '../../src/repositories/merchant.repository';
import { decrypt } from '../../src/utils/field-encryption';

describe('merchantRepository token storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROCESSOR_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('encrypts GHL tokens when creating a merchant', async () => {
    let inserted: any;
    const chain = {
      insert: jest.fn((data: any) => {
        inserted = data;
        return {
          select: () => ({
            single: () => ({ data: { id: 'merchant_1', ...data }, error: null }),
          }),
        };
      }),
    };
    mockFrom.mockReturnValue(chain);

    await merchantRepository.create({
      location_id: 'loc_1',
      ghl_access_token: 'access_plain',
      ghl_refresh_token: 'refresh_plain',
      ghl_token_expires_at: new Date().toISOString(),
    });

    expect(inserted.ghl_access_token).toBeNull();
    expect(inserted.ghl_refresh_token).toBeNull();
    expect(decrypt(inserted.ghl_access_token_encrypted)).toBe('access_plain');
    expect(decrypt(inserted.ghl_refresh_token_encrypted)).toBe('refresh_plain');
  });

  it('encrypts GHL tokens when refreshing tokens', async () => {
    let updatePayload: any;
    const eq = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      update: jest.fn((data: any) => {
        updatePayload = data;
        return { eq };
      }),
    });

    await merchantRepository.updateTokens(
      'loc_1',
      'access_refreshed',
      'refresh_refreshed',
      new Date('2026-05-21T12:00:00Z'),
    );

    expect(updatePayload.ghl_access_token).toBeNull();
    expect(updatePayload.ghl_refresh_token).toBeNull();
    expect(decrypt(updatePayload.ghl_access_token_encrypted)).toBe('access_refreshed');
    expect(decrypt(updatePayload.ghl_refresh_token_encrypted)).toBe('refresh_refreshed');
    expect(eq).toHaveBeenCalledWith('location_id', 'loc_1');
  });

  it('falls back to plaintext token insert when encrypted token columns are not migrated yet', async () => {
    const firstSingle = jest.fn().mockReturnValue({
      data: null,
      error: {
        code: '42703',
        message: 'column merchants.ghl_access_token_encrypted does not exist',
      },
    });
    const secondSingle = jest.fn().mockReturnValue({
      data: { id: 'merchant_1', location_id: 'loc_1' },
      error: null,
    });
    const firstInsert = jest.fn(() => ({ select: () => ({ single: firstSingle }) }));
    const secondInsert = jest.fn(() => ({ select: () => ({ single: secondSingle }) }));
    mockFrom
      .mockReturnValueOnce({ insert: firstInsert })
      .mockReturnValueOnce({ insert: secondInsert });

    await merchantRepository.create({
      location_id: 'loc_1',
      ghl_access_token: 'access_plain',
      ghl_refresh_token: 'refresh_plain',
      ghl_token_expires_at: new Date().toISOString(),
    });

    expect(firstInsert).toHaveBeenCalledWith(expect.objectContaining({
      ghl_access_token: null,
      ghl_refresh_token: null,
      ghl_access_token_encrypted: expect.any(String),
      ghl_refresh_token_encrypted: expect.any(String),
    }));
    expect(secondInsert).toHaveBeenCalledWith(expect.objectContaining({
      ghl_access_token: 'access_plain',
      ghl_refresh_token: 'refresh_plain',
    }));
  });

  it('falls back to plaintext token refresh when encrypted token columns are not migrated yet', async () => {
    const firstEq = jest.fn().mockResolvedValue({
      error: {
        code: '42703',
        message: 'column merchants.ghl_refresh_token_encrypted does not exist',
      },
    });
    const secondEq = jest.fn().mockResolvedValue({ error: null });
    const firstUpdate = jest.fn(() => ({ eq: firstEq }));
    const secondUpdate = jest.fn(() => ({ eq: secondEq }));
    mockFrom
      .mockReturnValueOnce({ update: firstUpdate })
      .mockReturnValueOnce({ update: secondUpdate });

    await merchantRepository.updateTokens(
      'loc_1',
      'access_refreshed',
      'refresh_refreshed',
      new Date('2026-05-21T12:00:00Z'),
    );

    expect(firstUpdate).toHaveBeenCalledWith(expect.objectContaining({
      ghl_access_token: null,
      ghl_refresh_token: null,
      ghl_access_token_encrypted: expect.any(String),
      ghl_refresh_token_encrypted: expect.any(String),
    }));
    expect(secondUpdate).toHaveBeenCalledWith(expect.objectContaining({
      ghl_access_token: 'access_refreshed',
      ghl_refresh_token: 'refresh_refreshed',
      ghl_token_expires_at: '2026-05-21T12:00:00.000Z',
    }));
  });
});
