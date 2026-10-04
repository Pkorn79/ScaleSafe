import crypto from 'crypto';
import { Request } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { MerchantRecord } from '../repositories/merchant.repository';
import { marketplaceEntitlementForMerchant } from './marketplace-entitlement.service';
import { ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from '../utils/errors';
import { LocationIdentity, LOCATION_IDENTITY_COLUMNS, projectLocationIdentity } from '../utils/merchant-location-identity';

export type AccessProduct = 'enrollments' | 'evidence';
export interface MerchantAccess {
  product: AccessProduct;
  locationId: string;
  businessName: string | null;
  identity?: LocationIdentity;
  installed: boolean;
  planKey: string;
  planLabel: string;
  billingStatus: string;
  accessAllowed: boolean;
  accessLabel: string;
  approvalKind: 'test' | 'wholepay' | 'beta' | null;
  needsApproval: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  note: string | null;
  version: string;
}
export interface AccessPage {
  product: AccessProduct;
  items: MerchantAccess[];
  total: number;
  pending: number;
  installed: number;
  limit: number;
  offset: number;
  generatedAt: string;
  approvalAvailable: boolean;
}
export interface AccessFilters { query: string; status: 'all' | 'pending' | 'active' | 'disconnected'; limit: number; offset: number }
export interface AccessApproval { version: string; note: string; wholepayVerified: boolean; merchantReference: string }

// Never select OAuth, processor, customer or document data for access management.
export const ACCESS_COLUMNS = `location_id,business_name,status,installed_at,updated_at,marketplace_plan_key,marketplace_plan_id,marketplace_billing_status,test_access_approved_at,test_access_approved_by,test_access_revoked_at,test_access_note,wholepay_approved_at,wholepay_approved_by,wholepay_approval_revoked_at,wholepay_merchant_reference,${LOCATION_IDENTITY_COLUMNS}` as const;
const CAS_COLUMNS = ['status', 'installed_at', 'updated_at', 'marketplace_plan_key', 'marketplace_plan_id', 'marketplace_billing_status', 'test_access_approved_at', 'test_access_revoked_at', 'wholepay_approved_at', 'wholepay_approval_revoked_at'] as const;

function assertProject(): void {
  if (new URL(config.supabase.url).hostname !== 'zddyagfotdtfbcdursqu.supabase.co') {
    throw new ServiceUnavailableError('Enrollment access management is not connected to the expected project');
  }
}

export function projectEnrollmentAccess(row: Partial<MerchantRecord>): MerchantAccess {
  const entitlement = marketplaceEntitlementForMerchant(row);
  const installed = row.status === 'active' && Boolean(row.installed_at);
  const approvalKind = entitlement.planKey === 'test' ? 'test' : entitlement.planKey === 'wholepay' ? 'wholepay' : null;
  const needsApproval = installed && ['needs_test_access_approval', 'needs_wholepay_approval'].includes(entitlement.accessState);
  const identity = projectLocationIdentity(row);
  return {
    product: 'enrollments', locationId: row.location_id!, businessName: row.business_name || null, installed,
    identity,
    planKey: entitlement.planKey,
    planLabel: ({ test: 'Free / Test Access', standard: 'Standard (paid plan)', wholepay: 'WholePay merchant plan', legacy: 'Legacy installation', unknown: 'Unrecognized plan' })[entitlement.planKey],
    billingStatus: entitlement.billingStatus,
    accessAllowed: installed && entitlement.accessAllowed,
    accessLabel: !installed ? 'Not installed / inactive' : needsApproval ? 'Approval needed' : entitlement.accessAllowed
      ? identity.authorization === 'incomplete' ? 'Plan access approved; authorization incomplete' : 'Plan access active'
      : entitlement.accessState === 'payment_failed' ? 'Billing needs attention' : 'Plan needs review',
    approvalKind, needsApproval,
    approvedAt: approvalKind === 'test' ? row.test_access_approved_at || null : approvalKind === 'wholepay' ? row.wholepay_approved_at || null : null,
    approvedBy: approvalKind === 'test' ? row.test_access_approved_by || null : approvalKind === 'wholepay' ? row.wholepay_approved_by || null : null,
    note: approvalKind === 'test' ? row.test_access_note || null : null,
    version: crypto.createHash('sha256').update(JSON.stringify(CAS_COLUMNS.map(key => row[key] ?? null))).digest('hex'),
  };
}

export function accessPage(product: AccessProduct, items: MerchantAccess[], filters: AccessFilters, approvalAvailable: boolean): AccessPage {
  const search = filters.query.toLowerCase();
  const matching = items.filter(item => (!search || (item.identity?.name || '').toLowerCase().includes(search) || (item.businessName || '').toLowerCase().includes(search) || item.locationId.toLowerCase().includes(search))
    && (filters.status === 'all' || filters.status === 'pending' && item.needsApproval || filters.status === 'active' && item.accessAllowed || filters.status === 'disconnected' && !item.installed));
  return { product, items: matching.slice(filters.offset, filters.offset + filters.limit), total: matching.length,
    pending: items.filter(item => item.needsApproval).length, installed: items.filter(item => item.installed).length,
    limit: filters.limit, offset: filters.offset, generatedAt: new Date().toISOString(), approvalAvailable };
}

export const operatorMerchantAccessService = {
  async list(filters: AccessFilters): Promise<AccessPage> {
    assertProject();
    const rows: MerchantAccess[] = [];
    // Bounded keyset scan evaluates the actual entitlement
    // logic before filtering/paging, so pending totals never mean "this page only".
    let after: string | null = null;
    for (;;) {
      let query = getSupabase().from('merchants').select(ACCESS_COLUMNS).order('location_id').limit(1000);
      if (after) query = query.gt('location_id', after);
      const { data, error } = await query;
      if (error || !data) throw new ServiceUnavailableError('Merchant access could not be loaded');
      rows.push(...data.map(row => projectEnrollmentAccess(row as Partial<MerchantRecord>)));
      if (rows.length > 10000) throw new ServiceUnavailableError('Merchant access reporting exceeded its safe portfolio limit');
      if (data.length < 1000) break;
      after = data[data.length - 1].location_id;
    }
    return accessPage('enrollments', rows, filters, true);
  },

  async read(locationId: string): Promise<Partial<MerchantRecord>> {
    assertProject();
    const { data, error } = await getSupabase().from('merchants').select(ACCESS_COLUMNS).eq('location_id', locationId).maybeSingle();
    if (error) throw new ServiceUnavailableError('Merchant access could not be loaded');
    if (!data) throw new NotFoundError('Merchant installation');
    return data as Partial<MerchantRecord>;
  },

  async approve(req: Request, locationId: string, input: AccessApproval): Promise<MerchantAccess> {
    const row = await this.read(locationId);
    const current = projectEnrollmentAccess(row);
    if (!current.installed || !current.approvalKind) throw new ConflictError('This installation is not eligible for manual approval');
    if (current.accessAllowed) return current; // Retry after a lost response must not reset approval dates.
    if (current.version !== input.version || !current.needsApproval) throw new ConflictError('Merchant state changed. Reload this account before approving');
    if (current.approvalKind === 'wholepay' && (!input.wholepayVerified || !input.merchantReference)) {
      throw new ValidationError('Confirm the active WholePay-provisioned NMI account and enter its merchant reference');
    }
    const actor = req.operatorContext!;
    const now = new Date().toISOString();
    const patch = current.approvalKind === 'test' ? {
      test_access_approved_at: now, test_access_approved_by: actor.operatorUserId,
      test_access_revoked_at: null, test_access_note: input.note,
    } : {
      wholepay_approved_at: now, wholepay_approved_by: actor.operatorUserId,
      wholepay_approval_revoked_at: null, wholepay_merchant_reference: input.merchantReference,
    };
    // Durable intent must exist before the mutation. The route records the outcome
    // under the same correlation ID. CAS refuses a concurrent plan/install change.
    let update = getSupabase().from('merchants').update(patch).eq('location_id', locationId);
    for (const key of CAS_COLUMNS) update = row[key] == null ? update.is(key, null) : update.eq(key, row[key]!);
    const { data, error } = await update.select(ACCESS_COLUMNS).maybeSingle();
    if (error) throw new ServiceUnavailableError('Approval outcome is not confirmed. Reload this account before retrying');
    if (!data) throw new ConflictError('Merchant state changed. Reload this account before approving');
    return projectEnrollmentAccess(data as Partial<MerchantRecord>);
  },
};
