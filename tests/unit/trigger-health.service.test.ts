const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { triggerHealthService } from '../../src/services/trigger-health.service';

function thenableQuery(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => query),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe('trigger health service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T15:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not keep stale no-subscription logs in the recent warning list', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'trigger_subscriptions') {
        return thenableQuery({
          data: [{ trigger_key: 'ss_app_event', subscription_url: 'https://example.test/hook', is_active: true }],
          error: null,
        });
      }
      if (table === 'trigger_delivery_logs') {
        return thenableQuery({
          data: [{
            trigger_key: 'ss_app_event',
            subscription_url: 'no_subscription',
            status: 'no_subscription',
            payload: { event_type: 'upcoming_payment_reminder' },
            created_at: '2026-05-01T15:00:00.000Z',
          }],
          error: null,
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const report = await triggerHealthService.getHealth('loc_1');
    const appEvent = report.rows.find((row) => row.key === 'ss_app_event');

    expect(appEvent?.lastNoSubscriptionAt).toBe('2026-05-01T15:00:00.000Z');
    expect(report.recentNoSubscriptionTriggers).not.toContain('ss_app_event');
  });

  it('keeps fresh no-subscription logs in the recent warning list', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'trigger_subscriptions') {
        return thenableQuery({
          data: [{ trigger_key: 'ss_app_event', subscription_url: 'https://example.test/hook', is_active: true }],
          error: null,
        });
      }
      if (table === 'trigger_delivery_logs') {
        return thenableQuery({
          data: [{
            trigger_key: 'ss_app_event',
            subscription_url: 'no_subscription',
            status: 'no_subscription',
            payload: { event_type: 'upcoming_payment_reminder' },
            created_at: '2026-06-04T15:00:00.000Z',
          }],
          error: null,
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const report = await triggerHealthService.getHealth('loc_1');

    expect(report.recentNoSubscriptionTriggers).toContain('ss_app_event');
  });
});
