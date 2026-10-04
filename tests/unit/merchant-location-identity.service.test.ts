const mockGet = jest.fn();
const mockApi = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();
jest.mock('../../src/clients/ghl.client', () => ({ ghlApi: (...args: any[]) => mockApi(...args) }));
jest.mock('../../src/repositories/merchant.repository', () => ({ merchantRepository: {
  getByLocationId: (...args: any[]) => mockRead(...args),
  writeLocationIdentity: (...args: any[]) => mockWrite(...args),
} }));
jest.mock('../../src/utils/logger', () => ({ logger: { warn: jest.fn() } }));
import { identityAuthorizationBound, merchantLocationIdentityService as service } from '../../src/services/merchant-location-identity.service';
import { projectLocationIdentity, LOCATION_IDENTITY_TTL_MS } from '../../src/utils/merchant-location-identity';
import { logger } from '../../src/utils/logger';

let rows: Record<string, any>;
const clone = (value: any) => JSON.parse(JSON.stringify(value));
function merchant(locationId: string) {
  return { location_id: locationId, company_id: 'agency-a', status: 'active', business_name: 'Shared editable business',
    support_email: 'merchant@example.test', snapshot_status: 'failed', marketplace_plan_key: 'wholepay',
    wholepay_approved_at: '2026-01-01', updated_at: 'v0', ghl_access_token_encrypted: 'synthetic-encrypted',
    ghl_refresh_token_encrypted: 'synthetic-refresh', ghl_scopes: 'contacts.readonly locations.readonly',
    ghl_identity_authorized: true, config: { ghl_token_scope: 'location', ghl_token_location_id: locationId,
      ghl_token_company_id: 'agency-a', ghl_oauth_connected_at: 'generation-1' } };
}
beforeEach(() => {
  jest.clearAllMocks();
  rows = { a: merchant('a'), b: merchant('b') };
  mockRead.mockImplementation(async id => clone(rows[id]));
  mockWrite.mockImplementation(async (row, patch) => {
    if (row.updated_at !== rows[row.location_id].updated_at) return false;
    rows[row.location_id] = { ...rows[row.location_id], ...patch, updated_at: row.updated_at + 'x' };
    return true;
  });
  mockApi.mockResolvedValue({ get: mockGet });
  mockGet.mockImplementation(async path => ({ data: { location: {
    id: path.split('/').pop(), companyId: 'agency-a', name: 'HighLevel ' + path.split('/').pop(),
    business: { name: 'Not the subaccount name' }, email: 'not-merchant-settings@example.test',
  } } }));
});

test('exact tenant lookup gives duplicate businesses different identities before provisioning; settings and approvals never change', async () => {
  for (const id of ['b', 'a']) await service.refresh(id);
  expect(mockApi.mock.calls).toEqual([['b'], ['a']]);
  expect(mockGet.mock.calls).toEqual([['/locations/b'], ['/locations/a']]);
  for (const id of ['a', 'b']) {
    expect(rows[id]).toMatchObject({ business_name: 'Shared editable business', support_email: 'merchant@example.test',
      snapshot_status: 'failed', wholepay_approved_at: '2026-01-01', ghl_location_name: 'HighLevel ' + id,
      ghl_location_name_source: 'ghl_location_api', ghl_location_name_error: null });
    expect(projectLocationIdentity(rows[id]).status).toBe('verified');
  }
  for (const [, patch] of mockWrite.mock.calls) expect(Object.keys(patch).every(key => key.startsWith('ghl_location_name'))).toBe(true);
});

test('rename refresh changes only verified identity; normal repeated requests use the freshness window', async () => {
  await service.refresh('a');
  await service.refresh('a');
  expect(mockGet).toHaveBeenCalledTimes(1);
  mockGet.mockResolvedValue({ data: { location: { id: 'a', name: 'Renamed subaccount' } } });
  await service.refresh('a', true);
  expect(rows.a.ghl_location_name).toBe('Renamed subaccount');
  expect(rows.a.business_name).toBe('Shared editable business');
});

test.each([
  { ghl_access_token_encrypted: null }, { ghl_refresh_token_encrypted: null }, { status: 'uninstalled' },
  { ghl_scopes: 'contacts.readonly' }, { config: {} },
  { config: { ghl_token_scope: 'location', ghl_token_location_id: 'b' } },
  { config: { ghl_token_scope: 'company', ghl_token_company_id: 'other-agency' } },
  { config: { ghl_token_scope: 'location', ghl_token_location_id: 'a', ghl_token_company_id: 'other-agency' } },
])('missing or mismatched authorization never requests a location: %j', async patch => {
  Object.assign(rows.a, patch);
  expect(identityAuthorizationBound(rows.a)).toBe(false);
  await service.refresh('a', true);
  expect(mockApi).not.toHaveBeenCalled();
  expect(projectLocationIdentity(rows.a)).toMatchObject({ status: 'unavailable', authorization: 'incomplete',
    displayName: 'HighLevel name unavailable \u2014 authorization incomplete' });
});

test('bound company credential goes through the existing location-token client, never an agency-name endpoint', async () => {
  rows.a.config = { ghl_token_scope: 'company', ghl_token_company_id: 'agency-a' };
  await service.refresh('a');
  expect(mockApi).toHaveBeenCalledWith('a');
  expect(mockGet).toHaveBeenCalledWith('/locations/a');
  expect(rows.a.ghl_location_name).toBe('HighLevel a');
});

test.each([
  [{ location: { id: 'b', name: 'Wrong tenant' } }, 'identity_mismatch'],
  [{ location: { id: 'a', companyId: 'other-agency', name: 'Wrong company' } }, 'identity_mismatch'],
  [{ name: 'Agency', id: 'agency-a' }, 'identity_mismatch'],
  [{ location: { id: 'a', business: { name: 'Business is not identity' } } }, 'invalid_response'],
  [{ location: { id: 'a', name: ' ' } }, 'invalid_response'],
])('invalid provider response cannot overwrite prior verified proof: %j', async (data, reason) => {
  await service.refresh('a');
  const previous = rows.a.ghl_location_name_verified_at;
  mockGet.mockResolvedValue({ data });
  await service.refresh('a', true);
  expect(rows.a).toMatchObject({ ghl_location_name: 'HighLevel a', ghl_location_name_verified_at: previous,
    ghl_location_name_error: reason });
  expect(projectLocationIdentity(rows.a).status).toBe('stale');
});

test('provider failures preserve proof and store only safe error classes', async () => {
  await service.refresh('a');
  mockGet.mockRejectedValue({ response: { status: 503 }, message: 'SECRET-DO-NOT-STORE', config: { headers: { Authorization: 'SECRET' } } });
  await service.refresh('a', true);
  expect(projectLocationIdentity(rows.a)).toMatchObject({ name: 'HighLevel a', status: 'stale', reason: 'provider_unavailable' });
  expect(JSON.stringify(mockWrite.mock.calls)).not.toContain('SECRET');
  expect(logger.warn).not.toHaveBeenCalled();
  mockApi.mockRejectedValue({ ghlStatus: 401, message: 'SECRET' });
  await service.refresh('a', true);
  expect(projectLocationIdentity(rows.a)).toMatchObject({ status: 'unavailable', authorization: 'incomplete' });
});

test('outage without any prior verification never substitutes the business name', async () => {
  mockGet.mockRejectedValue(new Error('timeout'));
  await service.refresh('a');
  expect(projectLocationIdentity(rows.a)).toMatchObject({ name: null, displayName: 'HighLevel name unavailable', status: 'unavailable' });
});

test.each(['authorization', 'uninstall', 'credentials_removed', 'newer_lookup'])('discard an in-flight response after %s changes', async change => {
  mockGet.mockImplementation(async () => {
    if (change === 'authorization') rows.a.config.ghl_oauth_connected_at = 'generation-2';
    if (change === 'uninstall') rows.a.status = 'uninstalled';
    if (change === 'credentials_removed') rows.a.ghl_access_token_encrypted = null;
    if (change === 'newer_lookup') rows.a.ghl_location_name_refresh_id = 'different-lookup';
    return { data: { location: { id: 'a', name: 'Outdated response' } } };
  });
  await service.refresh('a');
  expect(rows.a.ghl_location_name).toBeUndefined();
});

test('singleflight is per location; failed compare-and-set never contacts the provider', async () => {
  const first = service.refresh('a');
  const second = service.refresh('a');
  expect(first).toBe(second);
  await first;
  expect(mockGet).toHaveBeenCalledTimes(1);
  mockWrite.mockResolvedValue(false);
  await service.refresh('b');
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('reauthorization during a lookup queues a forced verification with the new authorization', async () => {
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  mockGet.mockImplementationOnce(async () => {
    started();
    await new Promise<void>(resolve => { release = resolve; });
    return { data: { location: { id: 'a', name: 'Old authorization response' } } };
  });
  const first = service.refresh('a');
  await waiting;
  rows.a.config.ghl_oauth_connected_at = 'generation-2';
  const second = service.refresh('a', true);
  release();
  await first; await second;
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(rows.a.ghl_location_name).toBe('HighLevel a');
  expect(projectLocationIdentity(rows.a).status).toBe('verified');
});

test('projection expires proof, rejects legacy/future names, and shows missing auth even when a previous name exists', () => {
  const now = Date.now();
  const proof = { ghl_location_name: 'Verified subaccount', ghl_location_name_source: 'ghl_location_api',
    ghl_location_name_verified_at: new Date(now - LOCATION_IDENTITY_TTL_MS).toISOString(), ghl_identity_authorized: true };
  expect(projectLocationIdentity(proof, now).status).toBe('stale');
  expect(projectLocationIdentity({ ...proof, ghl_location_name_source: 'business_name' }, now).name).toBeNull();
  expect(projectLocationIdentity({ ...proof, ghl_location_name_verified_at: new Date(now + 1000).toISOString() }, now).name).toBeNull();
  expect(projectLocationIdentity({ ...proof, ghl_identity_authorized: false }, now).displayName).toContain('authorization incomplete');
});
