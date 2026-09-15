import axios from 'axios';
import { config } from '../config';
import { EVIDENCE_ORIGIN } from './operator-evidence.service';
import { AccessApproval, AccessFilters, AccessPage, MerchantAccess } from './operator-merchant-access.service';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../utils/errors';

const KEY = /^[A-Za-z0-9_-]{43,128}$/;
export function projectEvidenceAccess(value: any): MerchantAccess {
  if (value?.product !== 'evidence' || typeof value.locationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.locationId)
    || !['installed', 'accessAllowed', 'needsApproval'].every(key => typeof value[key] === 'boolean')
    || value.planKey !== 'beta' || value.approvalKind !== 'beta' || !/^[a-f0-9]{64}$/.test(value.version || '')
    || value.accessAllowed && (!value.installed || value.needsApproval) || value.needsApproval && !value.installed) throw new Error('Invalid Evidence access');
  const safeText = (text: unknown, max: number) => {
    if (text === null) return null;
    if (typeof text !== 'string' || text.length > max) throw new Error('Invalid Evidence field');
    return text;
  };
  const approvedAt = safeText(value.approvedAt, 40);
  if (approvedAt && !Number.isFinite(Date.parse(approvedAt))) throw new Error('Invalid approval date');
  return { product: 'evidence', locationId: value.locationId, businessName: safeText(value.businessName, 200),
    installed: value.installed, planKey: 'beta', planLabel: 'Free beta', billingStatus: 'not_applicable',
    accessAllowed: value.accessAllowed, accessLabel: !value.installed ? 'Not installed / inactive' : value.accessAllowed ? 'Access active' : 'Approval needed',
    approvalKind: 'beta', needsApproval: value.needsApproval, approvedAt, approvedBy: safeText(value.approvedBy, 200), note: safeText(value.note, 500), version: value.version };
}

async function request(path: string, body?: object, params?: object): Promise<any> {
  const token = body ? config.operator.evidenceApprovalToken : config.operator.evidenceReadToken;
  if (!KEY.test(token) || body && token === config.operator.evidenceReadToken) throw new ServiceUnavailableError(body ? 'Evidence approval connection is not configured' : 'Evidence access connection is not configured');
  try {
    const response = await axios.request({ method: body ? 'POST' : 'GET', url: EVIDENCE_ORIGIN + '/internal/command-center/access' + path,
      headers: { Authorization: 'Bearer ' + token }, data: body, params,
      timeout: 8000, maxRedirects: 0, maxContentLength: 262144, proxy: false });
    return response.data;
  } catch (error) {
    // Never propagate Axios errors: they contain the private request credential.
    if (axios.isAxiosError(error) && error.response?.status === 409) throw new ConflictError('Evidence installation changed. Reload before approving');
    if (axios.isAxiosError(error) && error.response?.status === 404) throw new NotFoundError('Evidence access endpoint or installation');
    throw new ServiceUnavailableError(body ? 'Evidence approval outcome is unconfirmed. Reload this account before retrying' : 'Evidence access is unavailable');
  }
}
function available(upstream: unknown): boolean {
  return upstream === true && KEY.test(config.operator.evidenceApprovalToken) && config.operator.evidenceApprovalToken !== config.operator.evidenceReadToken;
}
export const operatorEvidenceAccessService = {
  async list(filters: AccessFilters): Promise<AccessPage> {
    const data = await request('', undefined, filters);
    try {
      if (data?.product !== 'evidence' || !Array.isArray(data.items) || data.limit !== filters.limit || data.offset !== filters.offset
        || !['total', 'pending', 'installed'].every(key => Number.isSafeInteger(data[key]) && data[key] >= 0 && data[key] <= 10000)
        || data.items.length !== Math.min(filters.limit, Math.max(0, data.total - filters.offset))
        || data.pending > data.installed || typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt))
        || Date.parse(data.generatedAt) > Date.now() + 60000) throw new Error('Invalid page');
      const items = data.items.map(projectEvidenceAccess);
      if (new Set(items.map((item: MerchantAccess) => item.locationId)).size !== items.length) throw new Error('Duplicate location');
      return { product: 'evidence', items, total: data.total, pending: data.pending, installed: data.installed,
        limit: filters.limit, offset: filters.offset, generatedAt: data.generatedAt, approvalAvailable: available(data.approvalAvailable) };
    } catch { throw new ServiceUnavailableError('Evidence access response could not be verified'); }
  },
  async get(locationId: string) {
    const data = await request('/' + encodeURIComponent(locationId));
    try {
      const merchant = projectEvidenceAccess(data.merchant);
      if (merchant.locationId !== locationId) throw new Error('Wrong installation');
      return { merchant, approvalAvailable: available(data.approvalAvailable) };
    } catch { throw new ServiceUnavailableError('Evidence installation could not be verified'); }
  },
  async approve(locationId: string, input: AccessApproval, actorOperatorUserId: string, actorSessionId: string, correlationId: string) {
    const data = await request('/' + encodeURIComponent(locationId) + '/approve', {
      version: input.version, note: input.note, actorOperatorUserId, actorSessionId, correlationId,
    });
    try {
      const merchant = projectEvidenceAccess(data.merchant);
      if (merchant.locationId !== locationId || !merchant.accessAllowed) throw new Error('Unverified approval');
      return merchant;
    } catch { throw new ServiceUnavailableError('Evidence approval outcome is unconfirmed. Reload this account before retrying'); }
  },
};
