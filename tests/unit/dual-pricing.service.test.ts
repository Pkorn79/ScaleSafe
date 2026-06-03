import {
  baseCardAmountCents,
  buildDualPricingQuote,
  calculateProcessorDeductionPercent,
} from '../../src/services/dual-pricing.service';

const offer: any = {
  id: 'offer_1',
  payment_type: 'installments',
  price: 100,
  installment_amount: 50,
  num_payments: 2,
  pif_discount_enabled: true,
  pif_price: 97,
  dual_pricing_enabled: true,
  ach_enabled: true,
  ach_access_policy: 'after_settlement',
};

const control: any = {
  id: 'control_1',
  card_uplift_percent: 3,
  processor_deduction_percent: calculateProcessorDeductionPercent(3),
  enabled_processors: ['stripe', 'nmi'],
  effective_at: new Date().toISOString(),
};

describe('dual-pricing service', () => {
  it('calculates the processor deduction from the visible card uplift', () => {
    expect(calculateProcessorDeductionPercent(3)).toBeCloseTo(2.912621, 6);
  });

  it('uses the current offer amount as the bank/base amount', () => {
    expect(baseCardAmountCents(offer, 'pif')).toBe(9700);
    expect(baseCardAmountCents(offer, 'installments')).toBe(5000);
  });

  it('quotes card above the bank/base amount when dual pricing is enabled', () => {
    const quote = buildDualPricingQuote(offer, control, 'pif', 'ach');
    expect(quote.achAmountCents).toBe(9700);
    expect(quote.cardAmountCents).toBe(9991);
    expect(quote.selectedAmountCents).toBe(9700);
    expect(quote.processorDeductionPercent).toBeCloseTo(2.912621, 6);
  });

  it('keeps card selected by default', () => {
    const quote = buildDualPricingQuote(offer, control, 'installments', 'card');
    expect(quote.achAmountCents).toBe(5000);
    expect(quote.cardAmountCents).toBe(5150);
    expect(quote.selectedAmountCents).toBe(5150);
  });
});
