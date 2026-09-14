import axios from 'axios';
import { config } from '../../src/config';
import { operatorEvidenceService, projectEvidenceOverview, EVIDENCE_ORIGIN } from '../../src/services/operator-evidence.service';
jest.mock('axios');
const mockGet=axios.get as jest.Mock;
const zero={customers:0,purchases:0,open_disputes:0,evidence_records:0,capture_issues:0,queued_jobs:0};
const report=()=>({product:'scalesafe-client-evidence',contractVersion:'command-center-evidence-v1',generatedAt:new Date().toISOString(),
 summary:{...zero,merchants:1,active_merchants:1},merchants:[{...zero,location_id:'loc-a',active:true,beta_enabled:true,installed_at:'2026-09-01T00:00:00Z',last_capture_at:null}],pagination:{limit:50,offset:0,total:1}});
beforeEach(()=>{jest.clearAllMocks();config.operator.evidenceReadToken='synthetic-reporting-fixture-'.padEnd(43,'x');});
test('no credential means no remote call and no misleading zero counts',async()=>{
 config.operator.evidenceReadToken='';
 expect(await operatorEvidenceService.overview(50,0)).toEqual({connection:'not_configured'});expect(mockGet).not.toHaveBeenCalled();
});
test('uses only the fixed Evidence origin with bounded reads and redirects disabled',async()=>{
 mockGet.mockResolvedValue({data:report()});
 expect(await operatorEvidenceService.overview(50,0)).toMatchObject({connection:'connected',product:'scalesafe-client-evidence'});
 expect(mockGet).toHaveBeenCalledWith(EVIDENCE_ORIGIN+'/internal/command-center/overview',expect.objectContaining({maxRedirects:0,timeout:6000,maxContentLength:262144,params:{limit:50,offset:0}}));
});
test('rejects a wrong product, malformed metrics, duplicate merchants, and incorrect page totals',()=>{
 for(const transform of [
  (d:any)=>{d.product='scalesafe-enrollments';},(d:any)=>{d.summary.customers='1';},
  (d:any)=>{d.summary.merchants=2;d.pagination.total=2;d.merchants.push(d.merchants[0]);},
  (d:any)=>{d.pagination.total=999;},(d:any)=>{d.summary.customers=-1;},
  (d:any)=>{d.generatedAt='2099-01-01';}
 ]) {const data=report();transform(data);expect(()=>projectEvidenceOverview(data,50,0)).toThrow();}
});
test('projects only the allowed aggregate fields and preserves stale timestamps',()=>{
 const data:any=report();data.generatedAt='2026-01-01T00:00:00Z';data.token='private';data.merchants[0].customer_name='private';
 const result=projectEvidenceOverview(data,50,0);
 expect(result.generatedAt).toBe('2026-01-01T00:00:00.000Z');expect(JSON.stringify(result)).not.toContain('private');
});
test('remote errors cannot expose secrets or reuse last-known successful counts',async()=>{
 mockGet.mockResolvedValueOnce({data:report()}).mockRejectedValueOnce(new Error('Bearer private-token'));
 expect(await operatorEvidenceService.overview(50,0)).toHaveProperty('summary');
 expect(await operatorEvidenceService.overview(50,0)).toEqual({connection:'unavailable'});
});
