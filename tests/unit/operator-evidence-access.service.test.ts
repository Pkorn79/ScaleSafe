import axios from 'axios';
import { config } from '../../src/config';
import { operatorEvidenceAccessService as service, projectEvidenceAccess } from '../../src/services/operator-evidence-access.service';
import { EVIDENCE_ORIGIN } from '../../src/services/operator-evidence.service';
jest.mock('axios');
const mockRequest = axios.request as jest.Mock;
const merchant = () => ({ product:'evidence',locationId:'tenant-a',businessName:null,installed:true,accessAllowed:false,needsApproval:true,
  planKey:'beta',approvalKind:'beta',approvedAt:null,approvedBy:null,note:null,version:'a'.repeat(64) });
const filters = { query:'',status:'all' as const,limit:50,offset:0 };
const page = () => ({ product:'evidence',items:[merchant()],total:1,pending:1,installed:1,limit:50,offset:0,generatedAt:new Date().toISOString(),approvalAvailable:true });
beforeEach(() => { jest.clearAllMocks(); config.operator.evidenceReadToken='synthetic-read-'.padEnd(43,'r'); config.operator.evidenceApprovalToken='synthetic-write-'.padEnd(43,'w'); });
test('read and write use separate credentials, fixed origin, no redirects and bounded payloads', async () => {
  mockRequest.mockResolvedValueOnce({data:page()});
  expect(await service.list(filters)).toMatchObject({approvalAvailable:true,pending:1});
  expect(mockRequest.mock.calls[0][0]).toMatchObject({method:'GET',url:EVIDENCE_ORIGIN+'/internal/command-center/access',headers:{Authorization:'Bearer '+config.operator.evidenceReadToken},maxRedirects:0,proxy:false,maxContentLength:262144});
  mockRequest.mockResolvedValueOnce({data:{merchant:{...merchant(),accessAllowed:true,needsApproval:false}}});
  await service.approve('tenant-a',{version:'a'.repeat(64),note:'Pilot',wholepayVerified:false,merchantReference:''},'owner','session','correlation');
  expect(mockRequest.mock.calls[1][0]).toMatchObject({method:'POST',headers:{Authorization:'Bearer '+config.operator.evidenceApprovalToken},data:{actorOperatorUserId:'owner',actorSessionId:'session',correlationId:'correlation'}});
});
test('absent or reused write credential cannot perform a mutation', async () => {
  config.operator.evidenceApprovalToken=config.operator.evidenceReadToken;
  await expect(service.approve('tenant-a',{} as any,'owner','session','correlation')).rejects.toThrow('not configured');
  expect(mockRequest).not.toHaveBeenCalled();
});
test('strictly projects the product and denies secret fields or another tenant in readback', async () => {
  expect(JSON.stringify(projectEvidenceAccess({...merchant(),token:'never-output'}))).not.toContain('never-output');
  expect(() => projectEvidenceAccess({...merchant(),product:'enrollments'})).toThrow();
  mockRequest.mockResolvedValue({data:{merchant:{...merchant(),locationId:'tenant-b'}}});
  await expect(service.get('tenant-a')).rejects.toThrow('could not be verified');
});
test('rejects malformed totals and strips credentials from uncertain upstream write errors', async () => {
  mockRequest.mockResolvedValueOnce({data:{...page(),total:2}});
  await expect(service.list(filters)).rejects.toThrow('could not be verified');
  mockRequest.mockRejectedValueOnce(new Error('Bearer private-key'));
  await expect(service.approve('tenant-a',{} as any,'owner','session','correlation')).rejects.toThrow('outcome is unconfirmed');
});
