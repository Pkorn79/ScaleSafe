/** Real installation handlers, identity service and repositories; fictional provider/database boundaries only. */
import { InstallStore, barrier } from '../helpers/install-store';
const mockStore = new InstallStore();
const mockPost = jest.fn();
const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockProvision = jest.fn();
const mockSso = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (table: string) => mockStore.from(table) }),
}));
jest.mock('axios', () => ({ __esModule: true, default: {
  post: (...args: any[]) => mockPost(...args),
  get: () => { throw new Error('Unexpected unbound provider call'); },
  create: (...args: any[]) => mockCreate(...args),
} }));
jest.mock('../../src/utils/crypto', () => ({ decryptSsoPayload: (...args: any[]) => mockSso(...args) }));
jest.mock('../../src/services/merchant.service', () => ({
  merchantService: { provisionMerchant: (...args: any[]) => mockProvision(...args) },
}));
jest.mock('../../src/services/phase2Enrollment.service', () => ({ phase2EnrollmentService: {} }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: {} }));
jest.mock('../../src/services/ghl-activity.service', () => ({ ghlActivityService: {} }));
jest.mock('../../src/services/evidence-connection.service', () => ({ evidenceConnectionService: {} }));
jest.mock('../../src/services/evidence-connector.service', () => ({ evidenceConnectorService: {} }));
jest.mock('../../src/services/notification.service', () => ({ notificationService: {} }));
jest.mock('../../src/utils/logger', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));

import express from 'express';
import request from 'supertest';
import authRoutes from '../../src/routes/auth.routes';
import { webhookController } from '../../src/controllers/webhook.controller';
import { merchantRepository } from '../../src/repositories/merchant.repository';
import { merchantLocationIdentityService, identityAuthorizationBound } from '../../src/services/merchant-location-identity.service';
import { projectLocationIdentity } from '../../src/utils/merchant-location-identity';
import { config } from '../../src/config';

const company = 'fictional-agency';
const location = 'fictional-ali';
const sibling = 'fictional-matt';
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.post('/test/signed-lifecycle', webhookController.ghlAppLifecycle);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: err.code }));
let work: Promise<void>[] = [];
let providerScope: 'Location' | 'Company' = 'Location';
let providerTarget = location;
let callbackNumber = 0;
let identityError: unknown;
let names: Record<string, string> = {};

async function drain() {
  for (let index = 0; index < work.length; index++) await work[index];
  if (identityError) throw identityError;
}
function callback() {
  return request(app).get('/auth/callback?code=fictional-code-identity-' + (++callbackNumber));
}
async function seed(target = location, overrides: Record<string, any> = {}) {
  return merchantRepository.create({ location_id: target, company_id: company,
    ghl_access_token: '', ghl_refresh_token: '', business_name: 'Shared editable business', ...overrides });
}

beforeEach(() => {
  mockStore.reset();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  work = [];
  identityError = undefined;
  callbackNumber = 0;
  providerTarget = location;
  providerScope = 'Location';
  names = { [location]: 'Verified Ali', [sibling]: 'Verified Matt' };
  mockProvision.mockRejectedValue(new Error('Fictional provisioning failure'));
  mockGet.mockImplementation(async (url: string) => {
    const target = decodeURIComponent(url.replace('/locations/', ''));
    if (!names[target] || url !== '/locations/' + encodeURIComponent(target)) throw new Error('Unexpected location');
    return { data: { location: { id: target, companyId: company, name: names[target] } } };
  });
  mockCreate.mockImplementation(() => ({ get: (...args: any[]) => mockGet(...args),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }));
  const redeemed = new Set<string>();
  mockPost.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/oauth/location-token')) {
      expect(body).toEqual({ companyId: company, locationId: providerTarget });
      return { data: { access_token: 'fictional-child-' + providerTarget, refresh_token: 'fictional-child-refresh',
        userType: 'Location', locationId: providerTarget, companyId: company, expires_in: 86400 } };
    }
    const params = new URLSearchParams(body);
    const code = params.get('code');
    if (!url.endsWith('/oauth/token') || params.get('grant_type') !== 'authorization_code'
      || !code || redeemed.has(code)) throw new Error('Unexpected or reused authorization');
    redeemed.add(code);
    return { data: { access_token: 'fictional-access-' + providerTarget, refresh_token: 'fictional-refresh',
      userType: providerScope, companyId: company, expires_in: 86400, scope: 'locations.readonly oauth.write',
      ...(providerScope === 'Location' ? { locationId: providerTarget }
        : { approvedLocations: [{ locationId: providerTarget, name: 'Unverified install label' }] }),
    } };
  });
  // Keep the real background operation, but await it before assertions/fixture reset.
  jest.spyOn(merchantLocationIdentityService, 'schedule').mockImplementation((target, force) => {
    work.push(merchantLocationIdentityService.refresh(target, force).catch(error => { identityError = error; }));
  });
});
afterEach(async () => { await drain(); jest.restoreAllMocks(); });

it.each(['Location', 'Company'] as const)('verifies exact identity after %s authorization despite provisioning failure', async (scope) => {
  providerScope = scope;
  await seed(location, { business_name: '' });
  const before = mockStore.merchant(location);
  expect((await callback()).status).toBe(200);
  await drain();
  const saved = mockStore.merchant(location);
  expect(saved.ghl_location_name).toBe('Verified Ali');
  expect(saved.ghl_location_name_source).toBe('ghl_location_api');
  expect(saved.ghl_location_name_error).toBeNull();
  expect(saved.business_name).toBe('');
  expect(saved.marketplace_plan_key).toBe(before.marketplace_plan_key);
  expect(saved.marketplace_billing_status).toBe(before.marketplace_billing_status);
  expect(mockGet).toHaveBeenCalledWith('/locations/' + location);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({
    Authorization: 'Bearer fictional-' + (scope === 'Company' ? 'child-' : 'access-') + location,
  }) }));
  expect(mockPost.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
  expect(mockProvision).toHaveBeenCalled();
});

it.each([[location, sibling], [sibling, location]])('keeps duplicate businesses isolated in order %s then %s', async (first, second) => {
  for (const target of [first, second]) {
    await seed(target);
    providerTarget = target;
    expect((await callback()).status).toBe(200);
    await drain();
  }
  expect(mockStore.merchant(location).ghl_location_name).toBe('Verified Ali');
  expect(mockStore.merchant(sibling).ghl_location_name).toBe('Verified Matt');
  names[location] = 'Renamed Ali';
  await merchantLocationIdentityService.refresh(location, true);
  expect(mockStore.merchant(location).ghl_location_name).toBe('Renamed Ali');
  expect(mockStore.merchant(location).business_name).toBe('Shared editable business');
  expect(mockStore.merchant(sibling).ghl_location_name).toBe('Verified Matt');
});

it('retrieves identity for an already provisioned installation without repeating setup', async () => {
  await seed(location, { snapshot_status: 'installed' });
  expect((await callback()).status).toBe(200);
  await drain();
  expect(mockStore.merchant(location).ghl_location_name).toBe('Verified Ali');
  expect(mockProvision).not.toHaveBeenCalled();
});

it('preserves approved access but does not claim a tokenless installation is connected', async () => {
  await seed(location);
  await merchantRepository.update(location, { test_access_approved_at: '2026-01-01T00:00:00Z' });
  mockSso.mockReturnValue({ locationId: location, companyId: company });
  expect((await request(app).post('/auth/sso').send({ payload: 'fictional-sso' })).body.error).toBe('AUTHORIZATION_REQUIRED');
  await merchantLocationIdentityService.refresh(location, true);
  const saved = mockStore.merchant(location);
  expect(saved.test_access_approved_at).toBe('2026-01-01T00:00:00Z');
  expect(projectLocationIdentity({ ...saved, ghl_identity_authorized: identityAuthorizationBound(saved) }).displayName)
    .toBe('HighLevel name unavailable \u2014 authorization incomplete');
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockGet).not.toHaveBeenCalled();
});

it('discards a successful name response when a signed uninstall wins during lookup', async () => {
  await seed();
  const gate = barrier();
  mockGet.mockImplementation(async () => {
    await gate.wait();
    return { data: { location: { id: location, companyId: company, name: 'Late name' } } };
  });
  expect((await callback()).status).toBe(200);
  await gate.entered;
  const revoked = await request(app).post('/test/signed-lifecycle').send({
    type: 'UNINSTALL', appId: config.ghl.appId, locationId: location, companyId: company,
    webhookId: 'fictional-uninstall', timestamp: new Date().toISOString(),
  });
  gate.release();
  await drain();
  expect(revoked.status).toBe(200);
  const saved = mockStore.merchant(location);
  expect(saved.status).toBe('uninstalled');
  expect(saved.ghl_access_token_encrypted).toBeNull();
  expect(saved.ghl_location_name).toBeUndefined();
  expect(identityAuthorizationBound(saved)).toBe(false);
});

it('does not let a mismatched provider response overwrite prior verified proof', async () => {
  await seed();
  await callback();
  await drain();
  const before = mockStore.merchant(location);
  mockGet.mockResolvedValue({ data: { location: { id: sibling, companyId: company, name: 'Wrong merchant' } } });
  await merchantLocationIdentityService.refresh(location, true);
  const saved = mockStore.merchant(location);
  expect(saved.ghl_location_name).toBe(before.ghl_location_name);
  expect(saved.ghl_location_name_verified_at).toBe(before.ghl_location_name_verified_at);
  expect(saved.ghl_location_name_error).toBe('identity_mismatch');
});
