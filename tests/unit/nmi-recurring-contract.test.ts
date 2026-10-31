import axios from 'axios';
import { NmiClient } from '../../src/clients/nmi.client';
import { nextBillingDate } from '../../src/utils/billing-calendar';
jest.mock('axios');
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const post = axios.post as jest.Mock;
const client = new NmiClient({ securityKey: 'test-only', tokenizationKey: 'test-only' });
const request = { paymentMethodId: 'test-vault', customerId: 'test-vault', planAmount: 40000,
  interval: 'monthly' as const, totalPayments: 2, startDate: '2026-11-30' };

describe('NMI recurring request contract (offline, not gateway certification)', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it.each([['monthly', '1'], ['quarterly', '3'], ['annual', '12']] as const)(
    '%s sends the NMI-required day and month frequency', async (interval, months) => {
      // Refuse the same invalid request that the real gateway rejected; never unconditional success.
      post.mockImplementation(async (_url, body) => {
        const p = new URLSearchParams(body);
        if (!p.get('day_of_month')) return { data: 'response=3&responsetext=day of month is required' };
        expect(p.get('month_frequency')).toBe(months);
        expect(p.get('day_of_month')).toBe('30');
        expect(p.get('day_frequency')).toBeNull();
        expect(p.get('plan_amount')).toBe('400.00');
        expect(p.get('plan_payments')).toBe('2');
        expect(p.get('start_date')).toBe('20261130');
        return { data: 'response=1&subscription_id=test-sub' };
      });
      expect((await client.createSubscription({ ...request, interval })).success).toBe(true);
      expect(post).toHaveBeenCalledTimes(1);
    });
  it('preserves the original 31st anchor with a February first charge', async () => {
    post.mockResolvedValue({ data: 'response=1&subscription_id=test-sub' });
    await client.createSubscription({ ...request, startDate: nextBillingDate('monthly', new Date('2026-01-31')), billingDayOfMonth: 31 });
    const params = new URLSearchParams(post.mock.calls[0][1]);
    expect(params.get('start_date')).toBe('20260228');
    expect(params.get('day_of_month')).toBe('31');
  });
  it('explicitly sends zero payments for an ongoing subscription', async () => {
    post.mockResolvedValue({ data: 'response=1&subscription_id=test-sub' });
    await client.createSubscription({ ...request, totalPayments: 0 });
    expect(new URLSearchParams(post.mock.calls[0][1]).get('plan_payments')).toBe('0');
  });
  it.each([-1, 1.5, NaN])('rejects invalid payment count %s without contacting NMI', async totalPayments => {
    await expect(client.createSubscription({ ...request, totalPayments })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each([['daily', '1'], ['weekly', '7'], ['biweekly', '14']] as const)(
    'preserves %s day-based scheduling', async (interval, days) => {
      post.mockResolvedValue({ data: 'response=1&subscription_id=test-sub' });
      await client.createSubscription({ ...request, interval });
      const params = new URLSearchParams(post.mock.calls[0][1]);
      expect(params.get('day_frequency')).toBe(days);
      expect(params.get('day_of_month')).toBeNull();
      expect(params.get('month_frequency')).toBeNull();
    });
  it.each([0, 32, 1.5, NaN])('rejects invalid anchor %s before contacting NMI', async billingDayOfMonth => {
    await expect(client.createSubscription({ ...request, billingDayOfMonth })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it.each(['', '<html>error</html>', 'response=1', 'response=unexpected'])(
    'treats an incomplete response as uncertain, not permission to retry', async data => {
      post.mockResolvedValue({ data });
      expect(await client.createSubscription(request)).toMatchObject({ success: false, outcomeUnknown: true, status: 'pending' });
      expect(post).toHaveBeenCalledTimes(1);
    });
  it('does not repeat a timed-out create request', async () => {
    post.mockRejectedValue(new Error('timeout'));
    expect(await client.createSubscription(request)).toMatchObject({ success: false, outcomeUnknown: true });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('keeps an explicit gateway rejection distinct from uncertainty', async () => {
    post.mockResolvedValue({ data: 'response=3&responsetext=day of month is required' });
    expect(await client.createSubscription(request)).toMatchObject({ success: false, status: 'failed', errorMessage: 'day of month is required' });
  });
});
