import { billingDate, nextBillingDate } from '../../src/utils/billing-calendar';

describe('billing calendar', () => {
  it.each([
    ['monthly', '2026-01-31', '2026-02-28'],
    ['monthly', '2028-01-31', '2028-02-29'],
    ['monthly', '2026-10-30', '2026-11-30'],
    ['monthly', '2026-10-01', '2026-11-01'],
    ['quarterly', '2026-01-31', '2026-04-30'],
    ['annual', '2028-02-29', '2029-02-28'],
    ['daily', '2026-12-31', '2027-01-01'],
    ['weekly', '2026-10-30', '2026-11-06'],
    ['bi_weekly', '2026-10-30', '2026-11-13'],
  ])('%s from %s produces %s without overflow', (frequency, from, expected) => {
    const source = new Date(from);
    expect(nextBillingDate(frequency, source)).toBe(expected);
    expect(source.toISOString().slice(0, 10)).toBe(from);
  });
  it('uses UTC calendar dates independent of server timezone', () => {
    expect(nextBillingDate('monthly', new Date('2026-01-31T23:30:00-06:00'))).toBe('2026-03-01');
  });
  it('restores a month-end anchor after a short month', () => {
    expect(nextBillingDate('monthly', new Date('2026-02-28'), 31)).toBe('2026-03-31');
    expect(nextBillingDate('quarterly', new Date('2026-04-30'), 31)).toBe('2026-07-31');
  });
  it.each(['invalid', '2026-02-30', '2026-13-01'])('rejects invalid date %s', value => {
    expect(() => billingDate(value)).toThrow('Invalid billing date');
  });
});
