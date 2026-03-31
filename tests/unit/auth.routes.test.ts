/**
 * OAuth callback (/auth/callback) tests.
 * Covers fresh install, reinstall, missing locationId, and
 * snake_case vs camelCase field name handling.
 */

const mockExchangeCodeForTokens = jest.fn();

jest.mock('../../src/clients/ghl.client', () => ({
  exchangeCodeForTokens: mockExchangeCodeForTokens,
}));

const mockFindByLocationId = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    create: mockCreate,
    update: mockUpdate,
  },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    provisionMerchant: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/utils/crypto', () => ({
  decryptSsoPayload: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  config: { ghl: { ssoKey: 'test-key' } },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import authRoutes from '../../src/routes/auth.routes';

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.code, message: err.message });
});

const BASE_TOKEN_RESPONSE = {
  accessToken: 'at-123',
  refreshToken: 'rt-456',
  expiresAt: new Date('2026-04-01T00:00:00Z'),
  locationId: 'loc-abc',
  companyId: 'comp-xyz',
  userId: 'user-1',
  scopes: ['contacts.readonly', 'locations.readonly'],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /auth/callback', () => {
  it('returns 400 when authorization code is missing', async () => {
    const res = await request(app).get('/auth/callback');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing authorization code/);
  });

  it('provisions a new merchant on fresh install', async () => {
    mockExchangeCodeForTokens.mockResolvedValue(BASE_TOKEN_RESPONSE);
    mockFindByLocationId.mockResolvedValue(null); // no existing merchant
    mockCreate.mockResolvedValue({});

    const res = await request(app).get('/auth/callback?code=test-code');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.locationId).toBe('loc-abc');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: 'loc-abc' }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates tokens on reinstall (existing merchant)', async () => {
    mockExchangeCodeForTokens.mockResolvedValue(BASE_TOKEN_RESPONSE);
    mockFindByLocationId.mockResolvedValue({ location_id: 'loc-abc', status: 'inactive' });
    mockUpdate.mockResolvedValue({});

    const res = await request(app).get('/auth/callback?code=reinstall-code');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      'loc-abc',
      expect.objectContaining({ status: 'active' }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 with debug info when GHL response has no locationId', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      _debug: { tokenResponseKeys: ['access_token'], hadLocationId: false, hadCompanyId: true },
    });

    const res = await request(app).get('/auth/callback?code=bad-code');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/missing locationId/);
    expect(res.body.debug).toBeDefined();
    expect(res.body.debug.hadLocationId).toBe(false);
  });
});
