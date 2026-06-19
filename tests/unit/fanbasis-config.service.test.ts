/**
 * FanBasis credential service (Phase F1). Real field-encryption runs; only supabase, the merchant
 * repository, and the FanBasis client are mocked — so we assert the ACTUAL encrypted insert payload.
 *
 * Invariants:
 *  - upsert encrypts the API key (never persists plaintext) and scopes by merchant_id + location_id.
 *  - upsert validates: API key required; environment must be production|sandbox.
 *  - testConnection marks verified/error from the client result and never leaks the key.
 */

// Must be set before field-encryption runs (read lazily per-call). 64 hex chars = 32 bytes.
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

const mockClientTest = jest.fn();
jest.mock('../../src/clients/fanbasis.client', () => ({
  makeFanbasisClient: jest.fn(() => ({ testConnection: mockClientTest })),
}));

import { fanbasisConfigService } from '../../src/services/fanbasis-config.service';
import { decrypt, encrypt } from '../../src/utils/field-encryption';

function query(result: { data: any; error?: any } = { data: null }) {
  const c: any = { captured: {} };
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.maybeSingle = jest.fn(() => Promise.resolve(result));
  c.single = jest.fn(() => Promise.resolve(result));
  c.upsert = jest.fn((p: any) => { c.captured.upsert = p; return c; });
  c.update = jest.fn((p: any) => { c.captured.update = p; return c; });
  c.delete = jest.fn(() => c);
  c.then = (resolve: any) => resolve(result);
  return c;
}

const sampleRow = {
  id: 'fb-1', merchant_id: 'merch-1', location_id: 'loc-1', creator_handle: 'me', creator_id: null,
  api_key_encrypted: 'x', webhook_secret_encrypted: null, environment: 'sandbox',
  status: 'connected', last_verified_at: null, last_error: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByLocationId.mockResolvedValue({ id: 'merch-1', location_id: 'loc-1' });
});

describe('fanbasisConfigService.upsert', () => {
  it('encrypts the API key before persisting (never plaintext) and scopes by merchant + location', async () => {
    const getChain = query({ data: null });            // no existing config
    const upsertChain = query({ data: sampleRow });
    mockFrom.mockReturnValueOnce(getChain).mockReturnValueOnce(upsertChain);

    const pub = await fanbasisConfigService.upsert('loc-1', {
      creatorHandle: 'me', apiKey: 'fb_secret_key', environment: 'sandbox',
    });

    const payload = (upsertChain as any).captured.upsert;
    expect(payload.merchant_id).toBe('merch-1');
    expect(payload.location_id).toBe('loc-1');
    expect(payload.api_key_encrypted).not.toBe('fb_secret_key');
    expect(decrypt(payload.api_key_encrypted)).toBe('fb_secret_key');
    expect(pub.connected).toBe(true);
    expect(pub.hasApiKey).toBe(true);
    expect(pub.webhookUrl).toMatch(/\/webhooks\/fanbasis$/);
  });

  it('throws ValidationError when no API key is provided and none exists', async () => {
    mockFrom.mockReturnValueOnce(query({ data: null }));
    await expect(fanbasisConfigService.upsert('loc-1', { creatorHandle: 'me' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid environment', async () => {
    await expect(fanbasisConfigService.upsert('loc-1', { apiKey: 'k', environment: 'live' as any }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('fanbasisConfigService.testConnection', () => {
  const row = { ...sampleRow, api_key_encrypted: encrypt('fb_secret_key') };

  it('marks verified and returns connected on success', async () => {
    const getChain = query({ data: row });
    const updateChain = query({ data: null });
    mockFrom.mockReturnValueOnce(getChain).mockReturnValueOnce(updateChain);
    mockClientTest.mockResolvedValue({ ok: true, status: 200 });

    const r = await fanbasisConfigService.testConnection('loc-1');
    expect(r.connected).toBe(true);
    expect((updateChain as any).captured.update.status).toBe('connected');
    expect((updateChain as any).captured.update.last_verified_at).toBeTruthy();
  });

  it('marks error and returns not-connected on failure', async () => {
    const getChain = query({ data: row });
    const updateChain = query({ data: null });
    mockFrom.mockReturnValueOnce(getChain).mockReturnValueOnce(updateChain);
    mockClientTest.mockResolvedValue({ ok: false, status: 401, message: 'bad key' });

    const r = await fanbasisConfigService.testConnection('loc-1');
    expect(r.connected).toBe(false);
    expect(r.message).toBe('bad key');
    expect((updateChain as any).captured.update.status).toBe('error');
    expect((updateChain as any).captured.update.last_error).toBe('bad key');
  });
});
