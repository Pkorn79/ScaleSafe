/**
 * Auth routes tests — OAuth callback + SSO handshake.
 * Covers fresh install, reinstall, missing locationId,
 * and SSO with location vs company-level context.
 */

const mockExchangeCodeForTokens = jest.fn();

jest.mock('../../src/clients/ghl.client', () => ({
  exchangeCodeForTokens: mockExchangeCodeForTokens,
}));

const mockFindByLocationId = jest.fn();
const mockFindByCompanyId = jest.fn();
const mockFindAllByCompanyId = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateSnapshotStatus = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    findByCompanyId: mockFindByCompanyId,
    findAllByCompanyId: mockFindAllByCompanyId,
    create: mockCreate,
    update: mockUpdate,
    updateSnapshotStatus: mockUpdateSnapshotStatus,
  },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    provisionMerchant: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockDecryptSsoPayload = jest.fn();

jest.mock('../../src/utils/crypto', () => ({
  decryptSsoPayload: mockDecryptSsoPayload,
}));

jest.mock('../../src/config', () => ({
  config: {
    ghl: { clientId: 'test-ghl-client-id', ssoKey: 'test-key' },
    appUrl: 'https://dashboard.scalesafe.test',
    publicActionTokenSecret: 'test_public_action_secret_1234567890',
    processorEncryptionKey: 'test_processor_secret_1234567890',
    isProd: false,
    isDev: false,
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import authRoutes from '../../src/routes/auth.routes';
import { config as testConfig } from '../../src/config';
import { createGhlOAuthState } from '../../src/utils/ghl-oauth-state';

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

const MERCHANT_RECORD = {
  location_id: 'loc-abc',
  company_id: 'comp-xyz',
  snapshot_status: 'installed',
  status: 'active',
};

beforeEach(() => {
  jest.clearAllMocks();
  (testConfig as any).isProd = false;
});

describe('GET /auth/callback', () => {
  it('starts ScaleSafe-controlled installs with a signed OAuth state', async () => {
    const res = await request(app).get('/auth/install');

    expect(res.status).toBe(302);
    const redirect = new URL(res.headers.location);
    expect(redirect.origin + redirect.pathname).toBe('https://marketplace.gohighlevel.com/oauth/chooselocation');
    expect(redirect.searchParams.get('client_id')).toBe('test-ghl-client-id');
    expect(redirect.searchParams.get('redirect_uri')).toBe('https://dashboard.scalesafe.test/auth/callback');
    expect(redirect.searchParams.get('state')).toContain('.');
  });

  it('returns 400 when authorization code is missing', async () => {
    const res = await request(app).get('/auth/callback');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing authorization code/);
  });

  it('rejects malformed authorization codes before token exchange', async () => {
    const res = await request(app).get('/auth/callback?code=x');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid authorization code/);
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('rejects duplicate authorization code parameters before token exchange', async () => {
    const res = await request(app).get('/auth/callback?code=test-code&code=other-code');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing authorization code/);
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('provisions a new merchant on fresh install', async () => {
    mockExchangeCodeForTokens.mockResolvedValue(BASE_TOKEN_RESPONSE);
    mockFindByLocationId.mockResolvedValue(null);
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

  it('accepts valid signed state when GHL returns it', async () => {
    mockExchangeCodeForTokens.mockResolvedValue(BASE_TOKEN_RESPONSE);
    mockFindByLocationId.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    const state = createGhlOAuthState();
    const res = await request(app).get(`/auth/callback?code=test-code&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: 'loc-abc' }),
    );
  });

  it('rejects tampered signed state before token exchange', async () => {
    const state = `${createGhlOAuthState()}x`;
    const res = await request(app).get(`/auth/callback?code=test-code&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/state/i);
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
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

  it('provisions all installed sub-accounts when GHL returns an agency token', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      installedLocations: [
        { locationId: 'loc-new', name: 'New Test Account' },
        { locationId: 'loc-existing', name: 'Existing Account' },
      ],
    });
    mockFindByLocationId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ location_id: 'loc-existing', company_id: 'comp-xyz', snapshot_status: 'installed', status: 'active' });
    mockCreate.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});

    const res = await request(app).get('/auth/callback?code=agency-code');

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual(['loc-new', 'loc-existing']);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc-new',
        business_name: 'New Test Account',
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      'loc-existing',
      expect.objectContaining({
        status: 'active',
        business_name: 'Existing Account',
      }),
    );
  });

  it('does not expose OAuth debug info in production', async () => {
    (testConfig as any).isProd = true;
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      _debug: { tokenResponseKeys: ['access_token'], hadLocationId: false, hadCompanyId: true },
    });

    const res = await request(app).get('/auth/callback?code=bad-code');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.debug).toBeUndefined();
  });
});

describe('POST /auth/sso', () => {
  it('returns 400 when payload is missing', async () => {
    const res = await request(app).post('/auth/sso').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing SSO payload/);
  });

  it('establishes session when SSO has activeLocation', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      activeLocation: 'loc-abc',
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
      role: 'admin',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-abc');
    expect(res.body.email).toBe('philip@test.com');
    expect(mockFindByLocationId).toHaveBeenCalledWith('loc-abc');
  });

  it('establishes session when SSO has locationId (camelCase)', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      locationId: 'loc-abc',
      userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-abc');
  });

  it('establishes session when activeLocation is a nested GHL object', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      activeLocation: { id: 'loc-abc', name: 'WholePay App Test' },
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);
    mockFindAllByCompanyId.mockResolvedValue([
      MERCHANT_RECORD,
      { ...MERCHANT_RECORD, location_id: 'loc-other' },
    ]);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-abc');
    expect(mockFindByLocationId).toHaveBeenCalledWith('loc-abc');
    expect(mockFindAllByCompanyId).not.toHaveBeenCalled();
  });

  it('establishes session when SSO has location_id (snake_case)', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      location_id: 'loc-snake',
      userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue({ ...MERCHANT_RECORD, location_id: 'loc-snake' });

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-snake');
  });

  it('falls back to companyId lookup when no locationId in SSO', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindByLocationId.mockResolvedValue(null); // won't be called with empty string
    mockFindAllByCompanyId.mockResolvedValue([MERCHANT_RECORD]); // single location = safe

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-abc'); // resolved from merchant record
    expect(mockFindAllByCompanyId).toHaveBeenCalledWith('comp-xyz');
  });

  it('returns location choices when agency SSO has multiple installed locations', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindAllByCompanyId.mockResolvedValue([
      { ...MERCHANT_RECORD, location_id: 'loc-abc', business_name: 'Account A' },
      { ...MERCHANT_RECORD, location_id: 'loc-def', business_name: 'Account B' },
    ]);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MULTIPLE_LOCATIONS');
    expect(res.body.locations).toEqual([
      expect.objectContaining({ locationId: 'loc-abc', name: 'Account A' }),
      expect.objectContaining({ locationId: 'loc-def', name: 'Account B' }),
    ]);
  });

  it('uses selectedLocationId when agency SSO selects an installed location', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);

    const res = await request(app)
      .post('/auth/sso')
      .send({ payload: 'encrypted-data', selectedLocationId: 'loc-abc' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-abc');
    expect(mockFindByLocationId).toHaveBeenCalledWith('loc-abc');
    expect(mockFindAllByCompanyId).not.toHaveBeenCalled();
  });

  it('rejects selectedLocationId when it belongs to another agency', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue({ ...MERCHANT_RECORD, company_id: 'comp-other' });

    const res = await request(app)
      .post('/auth/sso')
      .send({ payload: 'encrypted-data', selectedLocationId: 'loc-abc' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not available/i);
  });

  it('returns 401 when no merchant found by locationId or companyId', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-unknown',
      userId: 'user-1',
    });
    mockFindAllByCompanyId.mockResolvedValue([]); // no merchants for company

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Merchant not found/);
  });
});
