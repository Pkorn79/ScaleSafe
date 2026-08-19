import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { MarketplaceEntitlementError, NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { MerchantRecord, merchantRepository } from '../repositories/merchant.repository';

export type MarketplacePlanKey = 'legacy' | 'test' | 'standard' | 'wholepay' | 'unknown';
export type MarketplaceBillingStatus = 'unknown' | 'pending' | 'complete' | 'failed';
export type EntitledProcessor = 'stripe' | 'nmi' | 'whop';

const TEST_PLAN_ID = process.env.GHL_MARKETPLACE_TEST_PLAN_ID
  || '6a79e1a07f2a3778d481f0ad';
const STANDARD_PLAN_ID = process.env.GHL_MARKETPLACE_STANDARD_PLAN_ID
  || '6a5aaf8e77d47a4f4f207bcb';
const WHOLEPAY_PLAN_ID = process.env.GHL_MARKETPLACE_WHOLEPAY_PLAN_ID
  || '6a5aafc2d91fdf0b8aace176';

export interface MarketplaceEntitlement {
  planId: string | null;
  planKey: MarketplacePlanKey;
  planLabel: string;
  billingStatus: MarketplaceBillingStatus;
  accessAllowed: boolean;
  accessState: 'active' | 'needs_test_access_approval' | 'needs_wholepay_approval' | 'payment_failed' | 'unknown_plan';
  message: string;
  testAccessApproved: boolean;
  testAccessApprovedAt: string | null;
  wholepayApproved: boolean;
  wholepayApprovedAt: string | null;
  processors: Record<EntitledProcessor, boolean>;
}

function normalizedPlanId(value: unknown): string {
  return String(value || '').trim();
}

export function marketplacePlanKey(planId: unknown): MarketplacePlanKey {
  const normalized = normalizedPlanId(planId);
  if (!normalized) return 'unknown';
  if (normalized === TEST_PLAN_ID) return 'test';
  if (normalized === STANDARD_PLAN_ID) return 'standard';
  if (normalized === WHOLEPAY_PLAN_ID) return 'wholepay';
  return 'unknown';
}

export function normalizeMarketplaceBillingStatus(value: unknown): MarketplaceBillingStatus {
  const status = String(value || '').trim().toLowerCase();
  if (['complete', 'completed', 'paid', 'active', 'success', 'succeeded'].includes(status)) return 'complete';
  if (['pending', 'processing', 'in_progress'].includes(status)) return 'pending';
  if (['failed', 'failure', 'declined', 'past_due', 'unpaid'].includes(status)) return 'failed';
  return 'unknown';
}

function merchantPlanKey(merchant: Partial<MerchantRecord>): MarketplacePlanKey {
  const stored = String(merchant.marketplace_plan_key || '').toLowerCase();
  if (stored === 'legacy' || stored === 'test' || stored === 'standard' || stored === 'wholepay' || stored === 'unknown') {
    return stored;
  }
  return merchant.marketplace_plan_id ? marketplacePlanKey(merchant.marketplace_plan_id) : 'legacy';
}

function wholepayApprovalIsActive(merchant: Partial<MerchantRecord>): boolean {
  if (!merchant.wholepay_approved_at) return false;
  if (!merchant.wholepay_approval_revoked_at) return true;
  return new Date(merchant.wholepay_approved_at).getTime()
    > new Date(merchant.wholepay_approval_revoked_at).getTime();
}

function testAccessApprovalIsActive(merchant: Partial<MerchantRecord>): boolean {
  if (!merchant.test_access_approved_at) return false;
  if (!merchant.test_access_revoked_at) return true;
  return new Date(merchant.test_access_approved_at).getTime()
    > new Date(merchant.test_access_revoked_at).getTime();
}

export function marketplaceEntitlementForMerchant(
  merchant: Partial<MerchantRecord>,
): MarketplaceEntitlement {
  const planKey = merchantPlanKey(merchant);
  const billingStatus = normalizeMarketplaceBillingStatus(merchant.marketplace_billing_status);
  const testAccessApproved = testAccessApprovalIsActive(merchant);
  const wholepayApproved = wholepayApprovalIsActive(merchant);
  const base = {
    planId: merchant.marketplace_plan_id || null,
    planKey,
    billingStatus,
    testAccessApproved,
    testAccessApprovedAt: merchant.test_access_approved_at || null,
    wholepayApproved,
    wholepayApprovedAt: merchant.wholepay_approved_at || null,
  };

  if (billingStatus === 'failed' && planKey !== 'test') {
    return {
      ...base,
      planLabel: planKey === 'wholepay' ? 'WholePay Approved Merchant' : 'ScaleSafe Standard',
      accessAllowed: false,
      accessState: 'payment_failed',
      message: 'Marketplace billing needs attention before ScaleSafe can be used.',
      processors: { stripe: false, nmi: false, whop: false },
    };
  }

  if (planKey === 'legacy') {
    return {
      ...base,
      planLabel: 'Legacy installation',
      accessAllowed: true,
      accessState: 'active',
      message: 'This installation predates Marketplace billing and remains fully enabled.',
      processors: { stripe: true, nmi: true, whop: true },
    };
  }

  if (planKey === 'test' && testAccessApproved) {
    return {
      ...base,
      planLabel: 'ScaleSafe Test Access',
      accessAllowed: true,
      accessState: 'active',
      message: 'Full ScaleSafe access is enabled for Marketplace review and approved beta testing.',
      processors: { stripe: true, nmi: true, whop: true },
    };
  }

  if (planKey === 'test') {
    return {
      ...base,
      planLabel: 'ScaleSafe Test Access',
      accessAllowed: false,
      accessState: 'needs_test_access_approval',
      message: 'This no-cost installation must be approved for this exact sub-account by ScaleSafe HQ.',
      processors: { stripe: false, nmi: false, whop: false },
    };
  }

  if (planKey === 'standard') {
    return {
      ...base,
      planLabel: 'ScaleSafe Standard',
      accessAllowed: true,
      accessState: 'active',
      message: 'Stripe and Whop are available on this plan.',
      processors: { stripe: true, nmi: false, whop: true },
    };
  }

  if (planKey === 'wholepay' && wholepayApproved) {
    return {
      ...base,
      planLabel: 'WholePay Approved Merchant',
      accessAllowed: true,
      accessState: 'active',
      message: 'WholePay approval is active. Stripe, Whop, and NMI are available.',
      processors: { stripe: true, nmi: true, whop: true },
    };
  }

  if (planKey === 'wholepay') {
    return {
      ...base,
      planLabel: 'WholePay Approved Merchant',
      accessAllowed: false,
      accessState: 'needs_wholepay_approval',
      message: 'This plan requires an active NMI merchant account established through WholePay and approval by ScaleSafe HQ.',
      processors: { stripe: false, nmi: false, whop: false },
    };
  }

  return {
    ...base,
    planLabel: 'Unrecognized Marketplace plan',
    accessAllowed: false,
    accessState: 'unknown_plan',
    message: 'ScaleSafe could not verify this Marketplace plan. Contact support before using the app.',
    processors: { stripe: false, nmi: false, whop: false },
  };
}

export function assertMarketplaceAppAccess(merchant: Partial<MerchantRecord>): MarketplaceEntitlement {
  const entitlement = marketplaceEntitlementForMerchant(merchant);
  if (!entitlement.accessAllowed) {
    throw new MarketplaceEntitlementError(entitlement.message, entitlement.accessState);
  }
  return entitlement;
}

export async function assertNewProcessorActivityAllowed(
  locationId: string,
  processor: EntitledProcessor,
): Promise<MarketplaceEntitlement> {
  const merchant = await merchantRepository.getByLocationId(locationId);
  const entitlement = assertMarketplaceAppAccess(merchant);
  if (!entitlement.processors[processor]) {
    throw new MarketplaceEntitlementError(
      processor === 'nmi'
        ? 'New NMI payment activity is available only to WholePay-approved merchants. Existing payment records and lifecycle controls remain available.'
        : `${processor === 'whop' ? 'Whop' : 'Stripe'} is not available on this Marketplace plan.`,
      'processor_not_in_plan',
    );
  }
  return entitlement;
}

function eventKey(body: Record<string, any>, eventType: string, locationId: string): string {
  const supplied = String(body.id || body.eventId || body.event_id || body.webhookId || '').trim();
  if (supplied) return `ghl:${locationId}:${eventType}:${supplied}`;
  return `ghl:${locationId}:${eventType}:${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
}

async function recordEvent(input: {
  body: Record<string, any>;
  eventType: string;
  merchant: MerchantRecord;
  previousPlanId?: string | null;
  newPlanId?: string | null;
  billingStatus?: MarketplaceBillingStatus | null;
}): Promise<void> {
  const payloadSha256 = crypto.createHash('sha256').update(JSON.stringify(input.body)).digest('hex');
  const { error } = await getSupabase().from('marketplace_entitlement_events').upsert({
    event_key: eventKey(input.body, input.eventType, input.merchant.location_id),
    event_type: input.eventType,
    merchant_id: input.merchant.id,
    location_id: input.merchant.location_id,
    previous_plan_id: input.previousPlanId || null,
    new_plan_id: input.newPlanId || null,
    billing_status: input.billingStatus || null,
    payload_sha256: payloadSha256,
  }, { onConflict: 'event_key', ignoreDuplicates: true });
  if (error) throw error;
}

export async function applyMarketplacePlan(input: {
  locationId: string;
  planId: unknown;
  body: Record<string, any>;
  eventType: string;
  previousPlanId?: unknown;
}): Promise<MerchantRecord> {
  const planId = normalizedPlanId(input.planId);
  if (!planId) throw new ValidationError('Marketplace plan event did not include a plan ID');
  const merchant = await merchantRepository.findByLocationId(input.locationId);
  if (!merchant) throw new NotFoundError(`Merchant ${input.locationId}`);
  const planKey = marketplacePlanKey(planId);
  const updated = await merchantRepository.update(input.locationId, {
    marketplace_plan_id: planId,
    marketplace_plan_key: planKey,
    marketplace_plan_updated_at: new Date().toISOString(),
  });
  await recordEvent({
    body: input.body,
    eventType: input.eventType,
    merchant: updated,
    previousPlanId: normalizedPlanId(input.previousPlanId) || merchant.marketplace_plan_id,
    newPlanId: planId,
  });
  logger.info({ locationId: input.locationId, planKey }, 'Marketplace plan recorded');
  return updated;
}

export async function applyMarketplaceBillingStatus(input: {
  locationId: string;
  status: unknown;
  body: Record<string, any>;
  eventType: string;
}): Promise<MerchantRecord> {
  const merchant = await merchantRepository.findByLocationId(input.locationId);
  if (!merchant) throw new NotFoundError(`Merchant ${input.locationId}`);
  const billingStatus = normalizeMarketplaceBillingStatus(input.status);
  const updated = await merchantRepository.update(input.locationId, {
    marketplace_billing_status: billingStatus,
    marketplace_billing_updated_at: new Date().toISOString(),
  });
  await recordEvent({
    body: input.body,
    eventType: input.eventType,
    merchant: updated,
    newPlanId: updated.marketplace_plan_id,
    billingStatus,
  });
  logger.info({ locationId: input.locationId, billingStatus }, 'Marketplace billing status recorded');
  return updated;
}

export async function setWholepayApproval(input: {
  locationId: string;
  approved: boolean;
  approvedBy: string;
  merchantReference?: string;
}): Promise<MarketplaceEntitlement> {
  const merchant = await merchantRepository.getByLocationId(input.locationId);
  if (merchantPlanKey(merchant) !== 'wholepay') {
    throw new ValidationError('WholePay approval can be changed only for a merchant on the WholePay Marketplace plan.');
  }
  const now = new Date().toISOString();
  const updated = await merchantRepository.update(input.locationId, input.approved ? {
    wholepay_approved_at: now,
    wholepay_approved_by: input.approvedBy,
    wholepay_approval_revoked_at: null,
    wholepay_merchant_reference: String(input.merchantReference || '').trim() || merchant.wholepay_merchant_reference || null,
  } : {
    wholepay_approval_revoked_at: now,
  });
  return marketplaceEntitlementForMerchant(updated);
}

export async function setTestAccessApproval(input: {
  locationId: string;
  approved: boolean;
  approvedBy: string;
  note?: string;
}): Promise<MarketplaceEntitlement> {
  const merchant = await merchantRepository.getByLocationId(input.locationId);
  if (merchantPlanKey(merchant) !== 'test') {
    throw new ValidationError('Test access can be changed only for a merchant on the ScaleSafe Test Access plan.');
  }
  const now = new Date().toISOString();
  const updated = await merchantRepository.update(input.locationId, input.approved ? {
    test_access_approved_at: now,
    test_access_approved_by: input.approvedBy,
    test_access_revoked_at: null,
    test_access_note: String(input.note || '').trim() || merchant.test_access_note || null,
  } : {
    test_access_revoked_at: now,
  });
  return marketplaceEntitlementForMerchant(updated);
}

export const marketplacePlanIds = {
  test: TEST_PLAN_ID,
  standard: STANDARD_PLAN_ID,
  wholepay: WHOLEPAY_PLAN_ID,
};
