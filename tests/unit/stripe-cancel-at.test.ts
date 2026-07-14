import { stripeCancelAtSeconds } from '../../src/clients/stripe.client';

describe('stripeCancelAtSeconds (#16 calendar cancel_at)', () => {
  it('computes cancel_at via calendar months, not fixed 30-day seconds', () => {
    const start = Date.UTC(2026, 0, 15); // 2026-01-15
    const got = stripeCancelAtSeconds(start, 'monthly', 2);
    // +2 calendar months = the exact 2026-03-15 billing boundary.
    const expected = Math.floor(Date.UTC(2026, 2, 15) / 1000);
    expect(got).toBe(expected);
    // The buggy fixed-seconds version would be start + 2*30*86400 (= 2026-03-16), which overshoots.
    expect(got).not.toBe(Math.floor(start / 1000) + 2 * 30 * 86400);
  });

  it.each([
    ['daily', 2, Date.UTC(2026, 6, 15)],
    ['weekly', 2, Date.UTC(2026, 6, 27)],
    ['biweekly', 2, Date.UTC(2026, 7, 10)],
    ['quarterly', 2, Date.UTC(2027, 0, 13)],
  ])('keeps the final %s installment on a full billing boundary', (interval, totalPayments, expectedMs) => {
    const start = Date.UTC(2026, 6, 13);
    expect(stripeCancelAtSeconds(start, interval, totalPayments)).toBe(Math.floor(expectedMs / 1000));
  });

  it('handles annual via calendar years', () => {
    const start = Date.UTC(2026, 5, 10); // 2026-06-10
    expect(stripeCancelAtSeconds(start, 'annual', 1)).toBe(Math.floor(Date.UTC(2027, 5, 10) / 1000));
  });

  it('returns undefined for open-ended subscriptions (totalPayments 0)', () => {
    expect(stripeCancelAtSeconds(Date.UTC(2026, 0, 1), 'monthly', 0)).toBeUndefined();
  });
});
