import { config } from '../../src/config';
import { accessPage, operatorMerchantAccessService as service, projectEnrollmentAccess, ACCESS_COLUMNS } from '../../src/services/operator-merchant-access.service';
const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => ({ from: mockFrom }) }));
const pending = () => ({ location_id: 'fixture-tenant-a', business_name: 'Fictional Alpha', status: 'active' as const,
  installed_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', marketplace_plan_key: 'test' as const, marketplace_billing_status: 'unknown' as const });
const filters = { query: '', status: 'all' as const, limit: 50, offset: 0 };
const actor = { operatorContext: { operatorUserId: 'owner-fixture' } } as any;
const input = () => ({ version: projectEnrollmentAccess(pending()).version, note: 'Invited beta account', wholepayVerified: false, merchantReference: '' });
function builder(result: object) {
  const b: any = {};
  for (const method of ['select','order','limit','gt','eq','is','update']) b[method] = jest.fn(() => b);
  b.maybeSingle = jest.fn(async () => result); b.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
  return b;
}
beforeEach(() => { jest.restoreAllMocks(); mockFrom.mockReset(); config.supabase.url = 'https://zddyagfotdtfbcdursqu.supabase.co'; });
test('shows actual entitlement and installation state without claiming unknown billing is paid', () => {
  expect(projectEnrollmentAccess(pending())).toMatchObject({ needsApproval: true, planLabel: 'Free / Test Access', billingStatus: 'unknown', accessAllowed: false });
  expect(projectEnrollmentAccess({ ...pending(), status: 'uninstalled' } as any)).toMatchObject({ installed: false, needsApproval: false });
  expect(projectEnrollmentAccess({ ...pending(), marketplace_plan_key: 'standard' })).toMatchObject({ planLabel: 'Standard (paid plan)', billingStatus: 'unknown', needsApproval: false });
  expect(projectEnrollmentAccess({ ...pending(), marketplace_plan_key: 'standard', marketplace_billing_status: 'failed' })).toMatchObject({ accessAllowed: false, accessLabel: 'Billing needs attention' });
  expect(projectEnrollmentAccess({ ...pending(), marketplace_plan_key: 'wholepay' })).toMatchObject({ needsApproval: true, approvalKind: 'wholepay' });
});
test('pending totals cover the portfolio, not just the displayed page or search', () => {
  const rows = [projectEnrollmentAccess(pending()), projectEnrollmentAccess({ ...pending(), location_id: 'tenant-b', business_name: 'Bravo' })];
  expect(accessPage('enrollments', rows, { ...filters, query: 'bravo', limit: 1 }, true)).toMatchObject({ total: 1, pending: 2, items: [{ locationId: 'tenant-b' }] });
  expect(accessPage('enrollments', rows, { ...filters, status: 'active' }, true)).toMatchObject({ total: 0, pending: 2 });
});

test('search distinguishes duplicate businesses by verified subaccount name or exact ID without altering approvals', () => {
  const rows = ['Ali', 'Matt'].map(name => projectEnrollmentAccess({ ...pending(),
    location_id: 'location-' + name, business_name: 'Kingdom Alignment', ghl_location_name: 'Kingdom Alignment - ' + name,
    ghl_location_name_source: 'ghl_location_api', ghl_location_name_verified_at: new Date().toISOString(), ghl_identity_authorized: true }));
  expect(accessPage('enrollments', rows, { ...filters, query: 'kingdom alignment' }, true).total).toBe(2);
  expect(accessPage('enrollments', rows, { ...filters, query: '- Matt' }, true).items.map(item => item.locationId)).toEqual(['location-Matt']);
  expect(accessPage('enrollments', rows, { ...filters, query: 'location-Ali' }, true).items.map(item => item.locationId)).toEqual(['location-Ali']);
  expect(rows.every(item => item.needsApproval && !item.accessAllowed)).toBe(true);
});

test('approval remains valid with missing auth, but identity and access labels never claim a connected install', () => {
  const item = projectEnrollmentAccess({ ...pending(), test_access_approved_at: '2026-09-02T00:00:00Z' });
  expect(item).toMatchObject({ accessAllowed: true, needsApproval: false, approvedAt: '2026-09-02T00:00:00Z',
    identity: { name: null, status: 'unavailable', authorization: 'incomplete' } });
  expect(item.accessLabel).toContain('authorization incomplete');
  expect(item.identity!.displayName).not.toContain('Fictional Alpha');
});
test('projects only access fields', () => {
  expect(JSON.stringify(projectEnrollmentAccess({ ...pending(), access_token: 'NEVER-OUTPUT', processor_key: 'NEVER-OUTPUT' } as any))).not.toContain('NEVER-OUTPUT');
  expect(ACCESS_COLUMNS).not.toMatch(/token|cipher|secret|password/);
});
test('refuses the wrong Supabase project without a database call', async () => {
  config.supabase.url = 'https://xrdisibfewptgkkwpcbq.supabase.co';
  await expect(service.list(filters)).rejects.toThrow('expected project');
  await expect(service.read('fixture-tenant-a')).rejects.toThrow('expected project');
  expect(mockFrom).not.toHaveBeenCalled();
});
test('reads a bounded safe projection and never filters only after page truncation', async () => {
  const b = builder({ data: [pending()], error: null }); mockFrom.mockReturnValue(b);
  expect(await service.list({ ...filters, status: 'pending' })).toMatchObject({ total: 1, pending: 1 });
  expect(b.select).toHaveBeenCalledWith(ACCESS_COLUMNS); expect(b.limit).toHaveBeenCalledWith(1000);
});
test('conditional update changes only approval fields for the exact tenant and current plan', async () => {
  jest.spyOn(service, 'read').mockResolvedValue(pending());
  const b = builder({ data: { ...pending(), test_access_approved_at: new Date().toISOString() }, error: null }); mockFrom.mockReturnValue(b);
  expect(await service.approve(actor, 'fixture-tenant-a', input())).toMatchObject({ accessAllowed: true });
  expect(b.eq).toHaveBeenCalledWith('location_id', 'fixture-tenant-a');
  expect(b.eq).toHaveBeenCalledWith('marketplace_plan_key', 'test');
  expect(b.eq).toHaveBeenCalledWith('status', 'active');
  expect(b.is).toHaveBeenCalledWith('test_access_approved_at', null);
  expect(Object.keys(b.update.mock.calls[0][0]).sort()).toEqual(['test_access_approved_at','test_access_approved_by','test_access_note','test_access_revoked_at']);
});
test('idempotent retry preserves an existing approval date without a write', async () => {
  jest.spyOn(service, 'read').mockResolvedValue({ ...pending(), test_access_approved_at: '2026-09-02T00:00:00Z' });
  expect(await service.approve(actor, 'fixture-tenant-a', input())).toMatchObject({ approvedAt: '2026-09-02T00:00:00Z' });
  expect(mockFrom).not.toHaveBeenCalled();
});
test.each(['standard','legacy','unknown'] as const)('cannot grant free access to the %s plan', async (plan) => {
  jest.spyOn(service, 'read').mockResolvedValue({ ...pending(), marketplace_plan_key: plan });
  await expect(service.approve(actor, 'fixture-tenant-a', input())).rejects.toThrow('not eligible');
  expect(mockFrom).not.toHaveBeenCalled();
});
test('rejects stale state and concurrent mutations without pretending they succeeded', async () => {
  jest.spyOn(service, 'read').mockResolvedValue({ ...pending(), updated_at: '2026-09-02T00:00:00Z' });
  await expect(service.approve(actor, 'fixture-tenant-a', input())).rejects.toThrow('state changed'); expect(mockFrom).not.toHaveBeenCalled();
  jest.spyOn(service, 'read').mockResolvedValue(pending()); mockFrom.mockReturnValue(builder({ data: null, error: null }));
  await expect(service.approve(actor, 'fixture-tenant-a', input())).rejects.toThrow('state changed');
});
test('WholePay requires separate provisioning confirmation and a merchant reference', async () => {
  const row = { ...pending(), marketplace_plan_key: 'wholepay' as const };
  jest.spyOn(service, 'read').mockResolvedValue(row);
  const body = { ...input(), version: projectEnrollmentAccess(row).version };
  await expect(service.approve(actor, 'fixture-tenant-a', body)).rejects.toThrow('WholePay-provisioned');
  expect(mockFrom).not.toHaveBeenCalled();
  const b = builder({ data: { ...row, wholepay_approved_at: new Date().toISOString() }, error: null }); mockFrom.mockReturnValue(b);
  expect(await service.approve(actor, 'fixture-tenant-a', { ...body, wholepayVerified: true, merchantReference: 'synthetic-reference' })).toMatchObject({ accessAllowed: true });
  expect(b.update.mock.calls[0][0]).toHaveProperty('wholepay_merchant_reference', 'synthetic-reference');
  expect(b.update.mock.calls[0][0]).not.toHaveProperty('test_access_approved_at');
});
