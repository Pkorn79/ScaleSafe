/**
 * Local replacement for the unavailable review-account login.
 * Real HTTP handlers, OAuth-response normalization, encrypted persistence,
 * lifecycle ordering, tenant binding, entitlements and approval services.
 * Simulated boundaries: GHL HTTP/SSO, PostgREST, downstream provisioning.
 * No production credentials, outbound provider calls, clients or charges.
 */
import { InstallStore, barrier } from '../helpers/install-store';
const mockStore = new InstallStore();
const mockTokenPost = jest.fn();
const mockSso = jest.fn();
const mockProvision = jest.fn().mockResolvedValue({ status: 'installed' });

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (table: string) => mockStore.from(table) }),
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: (...args: any[]) => mockTokenPost(...args),
    get: () => { throw new Error('Unexpected provider GET in isolated test'); },
    create: () => { throw new Error('Unexpected provider client in isolated test'); },
  },
}));
jest.mock('../../src/utils/crypto', () => ({
  decryptSsoPayload: (...args: any[]) => mockSso(...args),
}));
jest.mock('../../src/services/merchant.service', () => ({
  merchantService: { provisionMerchant: (...args: any[]) => mockProvision(...args) },
}));
// Identity is exercised with these real handlers in merchant-identity-install.integration.test.ts.
jest.mock('../../src/services/merchant-location-identity.service', () => ({
  merchantLocationIdentityService: { schedule: jest.fn() },
}));
jest.mock('../../src/services/phase2Enrollment.service', () => ({ phase2EnrollmentService: {} }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: {} }));
jest.mock('../../src/services/ghl-activity.service', () => ({ ghlActivityService: {} }));
jest.mock('../../src/services/evidence-connection.service', () => ({ evidenceConnectionService: {} }));
jest.mock('../../src/services/evidence-connector.service', () => ({ evidenceConnectorService: {} }));
jest.mock('../../src/services/notification.service', () => ({ notificationService: {} }));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import authRoutes from '../../src/routes/auth.routes';
import { webhookController } from '../../src/controllers/webhook.controller';
import { merchantRepository } from '../../src/repositories/merchant.repository';
import { marketplacePlanIds, setTestAccessApproval } from '../../src/services/marketplace-entitlement.service';
import { decrypt } from '../../src/utils/field-encryption';
import { config } from '../../src/config';

const location = 'fictional-first-agency-location';
const company = 'fictional-first-agency';
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
// Signature verification is a separate existing test boundary. These fixtures
// represent already-authenticated provider events, not unsigned public traffic.
app.post('/test/authenticated-lifecycle', webhookController.ghlAppLifecycle);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.code, message: err.message });
});
let eventNumber = 0;
let callbackNumber = 0;
const redeemedCodes = new Set<string>();
function lifecycle(type: string, overrides: Record<string, any> = {}) {
  return request(app).post('/test/authenticated-lifecycle').send({
    type, appId: config.ghl.appId, locationId: location, companyId: company,
    webhookId: 'fictional-webhook-' + (++eventNumber),
    timestamp: new Date(Date.now() + eventNumber).toISOString(), ...overrides,
  });
}
function callbackResponse(planId: string, scope: 'Location' | 'Company' = 'Location', target = location, agency = company) {
  mockTokenPost.mockImplementation(async (url: string, body: string) => {
    const params = new URLSearchParams(body);
    const code = params.get('code');
    if (url !== 'https://services.leadconnectorhq.com/oauth/token'
      || params.get('grant_type') !== 'authorization_code'
      || !code || redeemedCodes.has(code)) throw new Error('Invalid or reused fictional OAuth exchange');
    redeemedCodes.add(code);
    return { data: {
      access_token: 'fictional-access', refresh_token: 'fictional-refresh',
      expires_in: 86400, userType: scope, companyId: agency, userId: 'fictional-installer',
      ...(scope === 'Location' ? { locationId: target } : { approvedLocations: [{ locationId: target }] }),
      scope: 'locations.readonly oauth.readonly oauth.write', planId,
    } };
  });
}
function callback() {
  return request(app).get('/auth/callback?code=fictional-authorization-code-' + (++callbackNumber));
}
function sso(target = location, agency = company) {
  mockSso.mockReturnValue({ locationId: target, companyId: agency, userId: 'fictional-user' });
  return request(app).post('/auth/sso').send({ payload: 'fictional-encrypted-context' });
}
beforeEach(() => {
  mockStore.reset();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  eventNumber = 0;
  callbackNumber = 0;
  redeemedCodes.clear();
  mockTokenPost.mockImplementation(() => { throw new Error('Unexpected token request'); });
});

describe('fresh agency — no prior reusable credentials', () => {
  const cases = (['test', 'standard', 'wholepay'] as const).flatMap((plan) =>
    (['Location', 'Company'] as const).flatMap((scope) =>
      (['webhook-first', 'callback-first'] as const).map((order) => ({ plan, scope, order }))));
  it.each(cases)('$plan / $scope / $order connects the exact new location', async ({ plan, scope, order }) => {
    callbackResponse(marketplacePlanIds[plan], scope);
    expect(mockStore.rows('merchants')).toHaveLength(0);
    if (order === 'webhook-first') {
      expect((await lifecycle('INSTALL', { planId: marketplacePlanIds[plan] })).status).toBe(200);
      expect((await sso()).body.error).toBe('AUTHORIZATION_REQUIRED');
    }
    expect((await callback()).status).toBe(200);
    if (order === 'callback-first') {
      expect((await lifecycle('INSTALL', { planId: marketplacePlanIds[plan] })).status).toBe(200);
    }
    expect(mockStore.rows('merchants')).toHaveLength(1);
    const saved = mockStore.merchant(location);
    expect(saved.company_id).toBe(company);
    expect(saved.ghl_access_token).toBeNull();
    expect(decrypt(saved.ghl_access_token_encrypted)).toBe('fictional-access');
    expect(decrypt(saved.ghl_refresh_token_encrypted)).toBe('fictional-refresh');
    expect(saved.config.ghl_token_scope).toBe(scope.toLowerCase());
    expect(saved.config.ghl_oauth_adopted_at).toBeUndefined();
    const login = await sso();
    expect(login.status).toBe(200);
    expect(login.body.entitlement.planKey).toBe(plan);
    expect(login.body.entitlement.accessAllowed).toBe(plan === 'standard');
    expect(mockTokenPost).toHaveBeenCalledTimes(1);
  });

  it.each(['test', 'standard', 'wholepay'] as const)('%s cannot log in without an OAuth callback, regardless of billing/approval', async (plan) => {
    await lifecycle('INSTALL', { planId: marketplacePlanIds[plan] });
    if (plan === 'test') await setTestAccessApproval({ locationId: location, approved: true, approvedBy: 'fictional-owner' });
    else await lifecycle('APP_PAYMENT_STATUS', { newStatus: 'complete' });
    expect((await sso()).body.error).toBe('AUTHORIZATION_REQUIRED');
    expect(mockTokenPost).not.toHaveBeenCalled();
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockStore.merchant(location).ghl_access_token_encrypted).toBeUndefined();
  });

  it('free approval is separate from OAuth and bound to one exact location', async () => {
    callbackResponse(marketplacePlanIds.test);
    await lifecycle('INSTALL', { planId: marketplacePlanIds.test });
    await callback();
    expect((await sso()).body.entitlement.accessState).toBe('needs_test_access_approval');
    await setTestAccessApproval({ locationId: location, approved: true, approvedBy: 'fictional-owner' });
    expect((await sso()).body.entitlement.accessAllowed).toBe(true);
    expect((await sso('fictional-other-location')).status).toBe(401);
    expect((await sso(location, 'fictional-other-agency')).status).toBe(401);
  });
});

describe('lifecycle ordering and real repository writes', () => {
  it('stale INSTALL cannot erase OAuth credentials written while its update was waiting', async () => {
    await lifecycle('INSTALL');
    await lifecycle('UNINSTALL');
    const gate = barrier();
    mockStore.beforeMerchantWrite = gate.wait;
    const reinstall = lifecycle('INSTALL').then((result) => result);
    await gate.entered;
    // Model another replica completing the signed INSTALL, then a callback,
    // while the first replica still holds an obsolete uninstalled row.
    await lifecycle('INSTALL');
    callbackResponse(marketplacePlanIds.standard);
    expect((await callback()).status).toBe(200);
    gate.release();
    expect((await reinstall).status).toBe(200);
    expect((await sso()).status).toBe(200);
    expect(mockStore.merchant(location).config.ghl_oauth_connected_at).toBeTruthy();
  });

  it('old UNINSTALL cannot overwrite a newer signed INSTALL after a lost write race', async () => {
    await lifecycle('INSTALL');
    const gate = barrier();
    mockStore.beforeMerchantWrite = gate.wait;
    const uninstall = lifecycle('UNINSTALL').then((result) => result);
    await gate.entered;
    await lifecycle('INSTALL');
    callbackResponse(marketplacePlanIds.standard);
    expect((await callback()).status).toBe(200);
    gate.release();
    expect((await uninstall).body.ignored).toBe('older_event');
    expect((await sso()).status).toBe(200);
  });

  it('a genuine later UNINSTALL clears credentials and blocks login', async () => {
    callbackResponse(marketplacePlanIds.standard);
    await callback();
    await lifecycle('INSTALL');
    await lifecycle('UNINSTALL');
    const saved = mockStore.merchant(location);
    expect(saved.status).toBe('uninstalled');
    expect(saved.ghl_access_token_encrypted).toBeNull();
    expect(saved.ghl_refresh_token_encrypted).toBeNull();
    expect((await sso()).status).not.toBe(200);
    expect(mockStore.merchant(location).status).toBe('uninstalled');
  });

  it('waits for a delayed signed INSTALL and completes the same one-use callback', async () => {
    await lifecycle('INSTALL');
    await lifecycle('UNINSTALL');
    await new Promise((resolve) => setTimeout(resolve, 2));
    callbackResponse(marketplacePlanIds.standard);
    const originalRead = merchantRepository.findByLocationId.bind(merchantRepository);
    let reads = 0;
    let sawWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { sawWaiting = resolve; });
    jest.spyOn(merchantRepository, 'findByLocationId').mockImplementation(async (id) => {
      const row = await originalRead(id);
      if (row?.status === 'uninstalled' && ++reads === 2) sawWaiting();
      return row;
    });
    const pending = callback().then((res) => res);
    await waiting;
    expect(mockStore.merchant(location).status).toBe('uninstalled');
    expect(mockStore.merchant(location).ghl_access_token_encrypted).toBeNull();
    await lifecycle('INSTALL');
    expect((await pending).status).toBe(200);
    expect(mockTokenPost).toHaveBeenCalledTimes(1);
    expect((await sso()).status).toBe(200);
  });

  it('only same-company agency authorization may be adopted by another installation', async () => {
    callbackResponse(marketplacePlanIds.standard, 'Company');
    await callback();
    await lifecycle('INSTALL', { locationId: 'fictional-sibling' });
    expect(mockStore.merchant('fictional-sibling').config.ghl_oauth_adopted_at).toBeTruthy();
    await lifecycle('INSTALL', { locationId: 'fictional-outsider', companyId: 'fictional-other-agency' });
    expect(mockStore.merchant('fictional-outsider').ghl_access_token_encrypted).toBeUndefined();
    expect((await sso('fictional-outsider', 'fictional-other-agency')).body.error).toBe('AUTHORIZATION_REQUIRED');
  });

  it('does not borrow a location-scoped token for a sibling', async () => {
    callbackResponse(marketplacePlanIds.standard);
    await callback();
    await lifecycle('INSTALL', { locationId: 'fictional-sibling' });
    expect((await sso('fictional-sibling')).body.error).toBe('AUTHORIZATION_REQUIRED');
    expect((await merchantRepository.findByLocationId(location))!.status).toBe('active');
  });
});
