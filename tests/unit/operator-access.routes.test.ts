import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
const mockSession = jest.fn(); const mockAudit = jest.fn(); const mockApprove = jest.fn(); const mockEvidenceApprove = jest.fn(); const mockList = jest.fn(); const mockEvidenceList = jest.fn();
jest.mock('../../src/services/operator-authorization.service', () => ({ operatorAuthorizationService: {
  resolveSessionToken: (...a:any[]) => mockSession(...a), auditRequest: (...a:any[]) => mockAudit(...a),
  hasPermission: (actor:any, permission:string) => actor.permissions.has(permission), canAccessLocation: () => true,
} }));
jest.mock('../../src/services/operator-merchant-access.service', () => ({ operatorMerchantAccessService: {
  approve: (...a:any[]) => mockApprove(...a), list: (...a:any[]) => mockList(...a),
} }));
jest.mock('../../src/services/operator-evidence-access.service', () => ({ operatorEvidenceAccessService: {
  approve: (...a:any[]) => mockEvidenceApprove(...a), list: (...a:any[]) => mockEvidenceList(...a),
} }));
jest.mock('../../src/utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
import { config } from '../../src/config';
import routes from '../../src/routes/operator.routes';
import { errorHandler } from '../../src/middleware/errorHandler';
const csrf = 'synthetic-csrf';
const owner = () => ({ operatorUserId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', organizationId: '33333333-3333-4333-8333-333333333333',
  organizationType: 'platform', role: 'platform_owner', permissions: new Set(['platform.merchant_access.approve','platform.merchants.read','platform.evidence.read']), csrfTokenHash: createHash('sha256').update(csrf).digest('hex') });
const body = { version: 'a'.repeat(64), note: 'Invited beta merchant' };
const app = () => express().use(express.json()).use(routes).use(errorHandler);
const post = (product='enrollments') => request(app()).post('/internal/operator/api/access/'+product+'/tenant-a/approve').set('Host','ops.scalesafe.app').set('Origin','https://ops.scalesafe.app')
  .set('Cookie','__Host-scalesafe_ops=fixture; __Host-scalesafe_ops_csrf='+csrf).set('x-csrf-token',csrf);
beforeEach(() => {
  jest.clearAllMocks(); Object.assign(config.operator,{enabled:true,authEnabled:true,healthEnabled:false,host:'ops.scalesafe.app',origin:'https://ops.scalesafe.app'});
  mockSession.mockResolvedValue({context:owner()}); mockAudit.mockResolvedValue('audit-fixture');
  mockApprove.mockResolvedValue({ product:'enrollments', locationId:'tenant-a', accessAllowed:true });
  mockEvidenceApprove.mockResolvedValue({ product:'evidence', locationId:'tenant-a', accessAllowed:true });
  mockList.mockResolvedValue({items:[],pending:0}); mockEvidenceList.mockResolvedValue({items:[],pending:1});
});
test('owner can approve while monitoring is disabled; intent precedes the correct product write', async () => {
  const result = await post().send(body); expect(result.status).toBe(200); expect(result.body.auditComplete).toBe(true);
  expect(mockAudit.mock.invocationCallOrder[0]).toBeLessThan(mockApprove.mock.invocationCallOrder[0]);
  expect(mockAudit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'operator.access.enrollments.approve',result:'succeeded',targetLocationId:'tenant-a'}));
  expect(mockEvidenceApprove).not.toHaveBeenCalled();
  expect((await post('evidence').send(body)).status).toBe(200);
  expect(mockEvidenceApprove).toHaveBeenCalledWith('tenant-a',expect.objectContaining(body),owner().operatorUserId,owner().sessionId,expect.any(String));
});
test.each(['platform_ops','platform_support','security_auditor','reseller_owner','reseller_operator','reseller_viewer'])('rejects %s even if its permission set is accidentally broadened', async (role) => {
  mockSession.mockResolvedValue({context:{...owner(),role}});
  expect((await post().send(body)).status).toBe(404); expect(mockApprove).not.toHaveBeenCalled();
});
test('rejects merchant host, missing/expired session, mixed identity, wrong origin and CSRF', async () => {
  expect((await post().set('Host','dashboard.scalesafe.app').send(body)).status).toBe(404);
  expect((await post().set('Cookie','').send(body)).status).toBe(401);
  expect((await post().set('x-location-id','tenant-b').send(body)).status).toBe(400);
  expect((await post().set('Origin','https://evil.example').send(body)).status).toBe(403);
  expect((await post().set('x-csrf-token','wrong').send(body)).status).toBe(403);
  mockSession.mockResolvedValue({context:null}); expect((await post().send(body)).status).toBe(401);
  expect(mockApprove).not.toHaveBeenCalled(); expect(mockEvidenceApprove).not.toHaveBeenCalled();
});
test('audit intent failure stops the approval; completion audit failure is explicitly reported', async () => {
  mockAudit.mockRejectedValueOnce(new Error('Audit unavailable'));
  expect((await post().send(body)).status).toBe(500); expect(mockApprove).not.toHaveBeenCalled();
  mockAudit.mockResolvedValueOnce('intent').mockRejectedValueOnce(new Error('Completion unavailable'));
  const result = await post().send(body); expect(result.status).toBe(200); expect(result.body.auditComplete).toBe(false);
});
test('bad inputs and unknown products never change data', async () => {
  expect((await post().send({...body,note:''})).status).toBe(400);
  expect((await post().send({...body,version:'stale'})).status).toBe(400);
  expect((await post('other').send(body)).status).toBe(404);
  expect(mockApprove).not.toHaveBeenCalled();
});
test('read pagination is bounded and portfolio access requires the matching product permission', async () => {
  const get = (suffix='') => request(app()).get('/internal/operator/api/access/evidence'+suffix).set('Host','ops.scalesafe.app').set('Cookie','__Host-scalesafe_ops=fixture');
  expect((await get()).status).toBe(200); expect(mockEvidenceList).toHaveBeenCalledWith({ query:'',status:'all',limit:50,offset:0 });
  expect((await get('?limit=51')).status).toBe(400);
  expect((await get('?status=foo')).status).toBe(400);
  mockSession.mockResolvedValue({context:{...owner(),permissions:new Set(['platform.merchants.read'])}});
  expect((await get()).status).toBe(404);
});
