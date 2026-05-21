import { formatMoney, getPaidInFullDisplayPrice, getSelectedPlanReceiptPrice } from '../../src/utils/offer-display';

describe('offer display helpers', () => {
  test('formats money consistently for workflow fields', () => {
    expect(formatMoney(10)).toBe('$10.00');
    expect(formatMoney('10.5')).toBe('$10.50');
    expect(formatMoney(null)).toBe('');
  });

  test('uses the discounted paid-in-full price when the offer has a PIF discount', () => {
    expect(getPaidInFullDisplayPrice({
      price: 1000,
      pif_price: 750,
      pif_discount_enabled: true,
    })).toBe(750);
  });

  test('falls back to full price when no PIF discount is active', () => {
    expect(getPaidInFullDisplayPrice({
      price: 1000,
      pif_price: 750,
      pif_discount_enabled: false,
    })).toBe(1000);
  });

  test('uses PIF discount only when the selected plan is PIF', () => {
    const offer = { price: 990, pif_price: 750, pif_discount_enabled: true };

    expect(getSelectedPlanReceiptPrice(offer, 'pif')).toBe(750);
    expect(getSelectedPlanReceiptPrice(offer, 'installment')).toBe(990);
    expect(getSelectedPlanReceiptPrice(offer, 'subscription')).toBe(990);
  });
});
