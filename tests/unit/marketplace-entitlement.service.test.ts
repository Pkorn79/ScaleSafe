const mockGetByLocationId = jest.fn();
const mockFindByLocationId = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockGetByLocationId(...args),
    findByLocationId: (...args: any[]) => mockFindByLocationId(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  assertNewProcessorActivityAllowed,
  marketplaceEntitlementForMerchant,
  marketplacePlanIds,
  marketplacePlanKey,
  setWholepayApproval,
} from '../../src/services/marketplace-entitlement.service';

function merchant(overrides: Record<string, any> = {}) {
  return {
    location_id: 'loc_1',
    marketplace_plan_id: null,
    marketplace_plan_key: 'legacy',
    marketplace_billing_status: 'unknown',
    wholepay_approved_at: null,
    wholepay_approval_revoked_at: null,
    ...overrides,
  } as any;
}

describe('Marketplace entitlements', () => {
  beforeEach(() => jest.clearAllMocks());

  test('grandfathers installations that predate Marketplace billing', () => {
    const result = marketplaceEntitlementForMerchant(merchant());
    expect(result.accessAllowed).toBe(true);
    expect(result.processors).toEqual({ stripe: true, nmi: true, whop: true });
  });

  test('maps the two configured HighLevel plans exactly', () => {
    expect(marketplacePlanKey(marketplacePlanIds.standard)).toBe('standard');
    expect(marketplacePlanKey(marketplacePlanIds.wholepay)).toBe('wholepay');
    expect(marketplacePlanKey('unknown_plan')).toBe('unknown');
  });

  test('allows Stripe and Whop but not NMI on the standard plan', async () => {
    const row = merchant({
      marketplace_plan_id: marketplacePlanIds.standard,
      marketplace_plan_key: 'standard',
      marketplace_billing_status: 'complete',
    });
    const result = marketplaceEntitlementForMerchant(row);
    expect(result.accessAllowed).toBe(true);
    expect(result.processors).toEqual({ stripe: true, nmi: false, whop: true });

    mockGetByLocationId.mockResolvedValue(row);
    await expect(assertNewProcessorActivityAllowed('loc_1', 'nmi'))
      .rejects.toMatchObject({ code: 'MARKETPLACE_ENTITLEMENT_REQUIRED' });
  });

  test('locks the WholePay plan until HQ approval and unlocks all processors after approval', () => {
    const pending = merchant({
      marketplace_plan_id: marketplacePlanIds.wholepay,
      marketplace_plan_key: 'wholepay',
    });
    expect(marketplaceEntitlementForMerchant(pending)).toMatchObject({
      accessAllowed: false,
      accessState: 'needs_wholepay_approval',
    });

    const approved = { ...pending, wholepay_approved_at: '2026-07-17T12:00:00.000Z' };
    expect(marketplaceEntitlementForMerchant(approved)).toMatchObject({
      accessAllowed: true,
      processors: { stripe: true, nmi: true, whop: true },
    });

    const revoked = { ...approved, wholepay_approval_revoked_at: '2026-07-17T13:00:00.000Z' };
    expect(marketplaceEntitlementForMerchant(revoked)).toMatchObject({
      accessAllowed: false,
      accessState: 'needs_wholepay_approval',
    });
  });

  test('locks a recognized plan when HighLevel reports failed billing', () => {
    const result = marketplaceEntitlementForMerchant(merchant({
      marketplace_plan_id: marketplacePlanIds.standard,
      marketplace_plan_key: 'standard',
      marketplace_billing_status: 'failed',
    }));
    expect(result.accessAllowed).toBe(false);
    expect(result.accessState).toBe('payment_failed');
  });

  test('HQ approval is allowed only for the WholePay plan', async () => {
    mockGetByLocationId.mockResolvedValue(merchant({ marketplace_plan_key: 'standard' }));
    await expect(setWholepayApproval({
      locationId: 'loc_1',
      approved: true,
      approvedBy: 'operator',
    })).rejects.toThrow(/only for a merchant on the WholePay/i);

    const pending = merchant({
      marketplace_plan_id: marketplacePlanIds.wholepay,
      marketplace_plan_key: 'wholepay',
    });
    mockGetByLocationId.mockResolvedValue(pending);
    mockUpdate.mockResolvedValue({
      ...pending,
      wholepay_approved_at: '2026-07-17T12:00:00.000Z',
      wholepay_approved_by: 'operator',
    });
    const result = await setWholepayApproval({
      locationId: 'loc_1',
      approved: true,
      approvedBy: 'operator',
      merchantReference: 'mid_123',
    });
    expect(mockUpdate).toHaveBeenCalledWith('loc_1', expect.objectContaining({
      wholepay_approved_by: 'operator',
      wholepay_merchant_reference: 'mid_123',
    }));
    expect(result.accessAllowed).toBe(true);
  });
});
