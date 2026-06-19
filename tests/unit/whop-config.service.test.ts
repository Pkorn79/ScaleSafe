process.env.PROCESSOR_ENCRYPTION_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

import { ValidationError } from '../../src/utils/errors';

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const mockGetByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: { getByLocationId: (...a: any[]) => mockGetByLocationId(...a) },
}));

import { whopConfigService } from '../../src/services/whop-config.service';
import { decrypt } from '../../src/utils/field-encryption';

function query(result: { data: any; error?: any } = { data: null }) {
  const c: any = { captured: {} };
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.single = jest.fn(() => Promise.resolve(result));
  c.upsert = jest.fn((p: any) => { c.captured.upsert = p; return c; });
  c.delete = jest.fn(() => c);
  return c;
}

const sampleRow = {
  id: 'whop-1',
  merchant_id: 'merch-1',
  location_id: 'loc-1',
  company_id: 'biz_123',
  api_key_encrypted: 'x',
  webhook_secret_encrypted: null,
  environment: 'production',
  status: 'connected',
  last_verified_at: null,
  last_error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByLocationId.mockResolvedValue({ id: 'merch-1', location_id: 'loc-1' });
});

describe('whopConfigService.upsert', () => {
  it('encrypts the API key and stores the Whop config scoped to the merchant location', async () => {
    const getChain = query({ data: null });
    const upsertChain = query({ data: sampleRow });
    mockFrom.mockReturnValueOnce(getChain).mockReturnValueOnce(upsertChain);

    const pub = await whopConfigService.upsert('loc-1', {
      companyId: 'biz_123',
      apiKey: 'whop_secret_key',
      environment: 'production',
    });

    const payload = (upsertChain as any).captured.upsert;
    expect(payload.merchant_id).toBe('merch-1');
    expect(payload.location_id).toBe('loc-1');
    expect(payload.company_id).toBe('biz_123');
    expect(payload.api_key_encrypted).not.toBe('whop_secret_key');
    expect(decrypt(payload.api_key_encrypted)).toBe('whop_secret_key');
    expect(pub.connected).toBe(true);
    expect(pub.webhookUrl).toMatch(/\/webhooks\/whop$/);
  });

  it('shows a clear migration message when Whop tables are missing', async () => {
    mockFrom.mockReturnValueOnce(query({
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.whop_configs' in the schema cache",
      },
    }));

    await expect(whopConfigService.upsert('loc-1', {
      companyId: 'biz_123',
      apiKey: 'whop_secret_key',
      environment: 'production',
    })).rejects.toMatchObject({
      constructor: ValidationError,
      message: 'Whop checkout is not ready in the database. Apply migration 071_whop_checkout_channel.sql, then try again.',
    });
  });
});
