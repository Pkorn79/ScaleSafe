import { formatMoney, getPaidInFullDisplayPrice } from '../../src/utils/offer-display';

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
});
