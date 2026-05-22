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
});
