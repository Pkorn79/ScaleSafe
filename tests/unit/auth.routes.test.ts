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
const mockUpsertOAuthInstall = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    findByCompanyId: mockFindByCompanyId,
    findAllByCompanyId: mockFindAllByCompanyId,
    create: mockCreate,
    update: mockUpdate,
    upsertOAuthInstall: mockUpsertOAuthInstall,
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
  tokenScope: 'location',
  approvedLocations: [],
};

const MERCHANT_RECORD = {
  location_id: 'loc-abc',
  company_id: 'comp-xyz',
  snapshot_status: 'installed',
  status: 'active',
  ghl_access_token_encrypted: 'encrypted-access',
  ghl_refresh_token_encrypted: 'encrypted-refresh',
  config: {
    ghl_token_scope: 'location',
    ghl_token_location_id: 'loc-abc',
    ghl_token_company_id: 'comp-xyz',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (testConfig as any).isProd = false;
  mockUpsertOAuthInstall.mockResolvedValue({ snapshot_status: 'pending' });
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

    const res = await request(app).get('/auth/callback?code=test-code');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.locationId).toBe('loc-abc');
    expect(mockUpsertOAuthInstall).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-abc',
      config: expect.objectContaining({
        ghl_token_scope: 'location',
        ghl_token_location_id: 'loc-abc',
      }),
    }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts valid signed state when GHL returns it', async () => {
    mockExchangeCodeForTokens.mockResolvedValue(BASE_TOKEN_RESPONSE);
    mockFindByLocationId.mockResolvedValue(null);

    const state = createGhlOAuthState();
    const res = await request(app).get(`/auth/callback?code=test-code&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsertOAuthInstall).toHaveBeenCalledWith(
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
    mockFindByLocationId.mockResolvedValue({
      location_id: 'loc-abc', status: 'uninstalled', config: {}, snapshot_status: 'installed',
    });
    mockUpsertOAuthInstall.mockResolvedValue({ snapshot_status: 'installed' });

    const res = await request(app).get('/auth/callback?code=reinstall-code');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsertOAuthInstall).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-abc',
      ghl_access_token: 'at-123',
    }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 with debug info when GHL returns no installed sub-account', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      tokenScope: 'company',
      _debug: { tokenResponseKeys: ['access_token'], hadLocationId: false, hadCompanyId: true },
    });

    const res = await request(app).get('/auth/callback?code=bad-code');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/did not return any installed sub-accounts/);
    expect(res.body.debug).toBeDefined();
    expect(res.body.debug.hadLocationId).toBe(false);
  });

  it('provisions all installed sub-accounts when GHL returns an agency token', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      tokenScope: 'company',
      installedLocations: [
        { locationId: 'loc-new', name: 'New Test Account' },
        { locationId: 'loc-existing', name: 'Existing Account' },
      ],
    });
    mockFindByLocationId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ location_id: 'loc-existing', company_id: 'comp-xyz', snapshot_status: 'installed', status: 'active' });
    mockUpsertOAuthInstall
      .mockResolvedValueOnce({ snapshot_status: 'pending' })
      .mockResolvedValueOnce({ snapshot_status: 'installed' });

    const res = await request(app).get('/auth/callback?code=agency-code');

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual(['loc-new', 'loc-existing']);
    expect(mockUpsertOAuthInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc-new',
        business_name: 'New Test Account',
        config: expect.objectContaining({ ghl_token_scope: 'company' }),
      }),
    );
    expect(mockUpsertOAuthInstall).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc-existing',
      business_name: 'Existing Account',
    }));
  });

  it('one failing sub-account does not abort the install for the others', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      tokenScope: 'company',
      installedLocations: [
        { locationId: 'loc-bad', name: 'Broken Account' },
        { locationId: 'loc-good', name: 'Good Account' },
      ],
    });
    mockFindByLocationId.mockResolvedValue(null);
    mockUpsertOAuthInstall
      .mockRejectedValueOnce(Object.assign(new Error('null value in column "ghl_access_token" violates not-null constraint'), { code: '23502' }))
      .mockResolvedValueOnce({ snapshot_status: 'pending' });

    const res = await request(app).get('/auth/callback?code=agency-code');

    expect(res.status).toBe(207);
    expect(res.body.success).toBe(false);
    expect(res.body.locations).toEqual(['loc-good']);
    expect(res.body.failed).toEqual(['loc-bad']);
    expect(mockUpsertOAuthInstall).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when every sub-account fails to install', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({
      ...BASE_TOKEN_RESPONSE,
      locationId: '',
      tokenScope: 'company',
      installedLocations: [{ locationId: 'loc-bad', name: 'Broken Account' }],
    });
    mockFindByLocationId.mockResolvedValue(null);
    mockUpsertOAuthInstall.mockRejectedValue(new Error('database exploded'));

    const res = await request(app).get('/auth/callback?code=agency-code');

    expect(res.status).toBe(500);
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
    mockFindByLocationId.mockResolvedValue({
      ...MERCHANT_RECORD,
      location_id: 'loc-snake',
      config: { ...MERCHANT_RECORD.config, ghl_token_location_id: 'loc-snake' },
    });

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-snake');
  });

  it('rejects initial SSO after the app has been uninstalled', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      locationId: 'loc-abc', companyId: 'comp-xyz', userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue({ ...MERCHANT_RECORD, status: 'uninstalled' });

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INSTALLATION_INVALID');
    expect(res.body.message).toMatch(/not actively installed/i);
  });

  it('rejects initial SSO when GHL company and installed merchant disagree', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      locationId: 'loc-abc', companyId: 'comp-other', userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/agency/i);
  });

  // SECURITY CONTRACT: agency-context launches (no locationId in the SSO
  // payload) fail closed. No sub-account chooser, no single-merchant
  // auto-pick, and a client-supplied selectedLocationId is never honored.

  it('fails closed (403 AGENCY_CONTEXT) when SSO has no locationId — even with a single installed location', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindAllByCompanyId.mockResolvedValue([MERCHANT_RECORD]);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('AGENCY_CONTEXT');
    expect(res.body.message).toMatch(/sub-account/i);
    expect(res.body.locations).toBeUndefined();
    expect(mockFindAllByCompanyId).not.toHaveBeenCalled();
  });

  it('fails closed for agencies with multiple installed locations — no chooser payload', async () => {
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

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('AGENCY_CONTEXT');
    expect(res.body.locations).toBeUndefined();
    expect(mockFindAllByCompanyId).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied selectedLocationId — agency context cannot select a sub-account', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp-xyz',
      userId: 'user-1',
      email: 'philip@test.com',
    });
    mockFindByLocationId.mockResolvedValue(MERCHANT_RECORD);

    const res = await request(app)
      .post('/auth/sso')
      .send({ payload: 'encrypted-data', selectedLocationId: 'loc-abc' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('AGENCY_CONTEXT');
    expect(mockFindByLocationId).not.toHaveBeenCalled();
  });

  it('returns 401 when no merchant exists for the sub-account in the payload', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      locationId: 'loc-not-installed',
      companyId: 'comp-xyz',
      userId: 'user-1',
    });
    mockFindByLocationId.mockResolvedValue(null);

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INSTALLATION_NOT_FOUND');
    expect(res.body.message).toMatch(/not installed/i);
  });

  it('returns a typed 503 when the merchant store is unavailable', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      locationId: 'loc-abc', companyId: 'comp-xyz', userId: 'user-1',
    });
    mockFindByLocationId.mockRejectedValue(new Error('fetch failed'));

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.message).toMatch(/temporarily unavailable/i);
  });

  it('returns a typed authentication error for an invalid encrypted payload', async () => {
    mockDecryptSsoPayload.mockImplementation(() => { throw new Error('bad cipher'); });

    const res = await request(app).post('/auth/sso').send({ payload: 'encrypted-data' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_SSO_PAYLOAD');
  });
});
