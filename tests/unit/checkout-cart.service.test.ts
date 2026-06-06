const addons = [
  {
    id: 'addon-bump',
    offer_id: 'offer-1',
    location_id: 'loc-1',
    kind: 'order_bump',
    title: 'VIP onboarding call',
    description: 'Extra kickoff support',
    price: 0.5,
    active: true,
    sort_order: 0,
  },
  {
    id: 'addon-inactive',
    offer_id: 'offer-1',
    location_id: 'loc-1',
    kind: 'pre_payment_upsell',
    title: 'Inactive upgrade',
    description: '',
    price: 10,
    active: false,
    sort_order: 1,
  },
];

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const state: Record<string, any> = { table, filters: [] as Array<[string, any]> };
      const builder: any = {
        select: () => builder,
        order: () => builder,
        eq: (column: string, value: any) => {
          state.filters.push([column, value]);
          return builder;
        },
        then: (resolve: any) => {
          if (table === 'offer_checkout_addons') {
            let rows = [...addons];
            for (const [column, value] of state.filters) {
              rows = rows.filter((row: any) => row[column] === value);
            }
            resolve({ data: rows, error: null });
            return;
          }
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  }),
}));

jest.mock('../../src/services/dual-pricing.service', () => {
  const actual = jest.requireActual('../../src/services/dual-pricing.service');
  return {
    ...actual,
    dualPricingService: {
      getActiveControl: jest.fn().mockResolvedValue({
        id: 'control-1',
        location_id: 'loc-1',
        card_uplift_percent: 3,
        processor_deduction_percent: 2.912621359223301,
        enabled_processors: ['stripe', 'nmi'],
        effective_at: '2026-06-01T00:00:00Z',
      }),
    },
  };
});

import { checkoutCartService } from '../../src/services/checkout-cart.service';

const offer: any = {
  id: 'offer-1',
  location_id: 'loc-1',
  offer_name: 'ScaleSafe Beta',
  price: 1,
  payment_type: 'one_time',
  pif_discount_enabled: false,
  pif_price: null,
  installment_amount: null,
  dual_pricing_enabled: true,
  ach_enabled: true,
  ach_access_policy: 'after_settlement',
};

describe('checkoutCartService', () => {
  it('adds selected one-time add-ons before applying card uplift', async () => {
    const quote = await checkoutCartService.quoteOffer(offer, ['addon-bump'], 'pif', 'card');

    expect(quote.baseAmountCents).toBe(100);
    expect(quote.addonAmountCents).toBe(50);
    expect(quote.achAmountCents).toBe(150);
    expect(quote.cardAmountCents).toBe(155);
    expect(quote.selectedAmountCents).toBe(155);
    expect(quote.lineItems).toEqual([
      expect.objectContaining({ type: 'base_offer', amountCents: 100 }),
      expect.objectContaining({ type: 'order_bump', addonId: 'addon-bump', amountCents: 50 }),
    ]);
  });

  it('rejects inactive or tampered add-on ids', async () => {
    await expect(checkoutCartService.quoteOffer(offer, ['addon-inactive'], 'pif', 'card'))
      .rejects.toThrow('One or more selected add-ons are no longer available.');
  });
});
