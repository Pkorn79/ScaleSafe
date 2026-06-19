/**
 * FanBasis API client (Phase F1 shell) — mocked axios. Verifies base-URL/env switching,
 * the x-api-key header, the testConnection success/failure shape, and that the later-phase
 * surface methods are explicit shells (no unverified behavior ships in F1).
 */

const mockAxiosInstance = { get: jest.fn() };
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => mockAxiosInstance) },
}));

import { makeFanbasisClient } from '../../src/clients/fanbasis.client';

const axios = require('axios').default;

beforeEach(() => jest.clearAllMocks());

describe('FanbasisClient', () => {
  it('defaults to the sandbox base URL and sends the x-api-key header', () => {
    makeFanbasisClient({ apiKey: 'k_test' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://qa.dev-fan-basis.com/public-api',
      headers: expect.objectContaining({ 'x-api-key': 'k_test' }),
    }));
  });

  it('uses the production base URL when environment=production', () => {
    makeFanbasisClient({ apiKey: 'k', environment: 'production' });
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://www.fanbasis.com/public-api',
    }));
  });

  it('testConnection returns ok on a 2xx response', async () => {
    mockAxiosInstance.get.mockResolvedValue({ status: 200 });
    const client = makeFanbasisClient({ apiKey: 'k' });
    expect(await client.testConnection()).toEqual({ ok: true, status: 200 });
  });

  it('testConnection returns not-ok with status + message on failure', async () => {
    mockAxiosInstance.get.mockRejectedValue({ response: { status: 401, data: { message: 'bad key' } } });
    const client = makeFanbasisClient({ apiKey: 'k' });
    const r = await client.testConnection();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.message).toBe('bad key');
  });

  it('later-phase surface methods are explicit shells that throw', async () => {
    const client = makeFanbasisClient({ apiKey: 'k' });
    await expect(client.createCheckoutSession({})).rejects.toThrow(/Phase F2/);
    await expect(client.createEmbeddedSession({})).rejects.toThrow(/Phase F2/);
    await expect(client.refundTransaction({})).rejects.toThrow(/Phase F3/);
  });
});
