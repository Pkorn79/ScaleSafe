const mockHealthUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFireTrigger = jest.fn().mockResolvedValue(undefined);

function countQuery(count: number) {
  const query: any = {
    eq: jest.fn(() => query),
    gte: jest.fn().mockResolvedValue({ count, error: null }),
  };
  return query;
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: jest.fn().mockResolvedValue({
            data: [{ id: 'merchant_1', location_id: 'loc_1', stripe_connected: false }],
            error: null,
          }),
        };
      }
      if (table === 'processor_configs') {
        const query: any = {
          eq: jest.fn(() => query),
          limit: jest.fn(() => query),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'nmi_config_1' }, error: null }),
        };
        return { select: jest.fn(() => query) };
      }
      if (table === 'payment_events') {
        return { select: jest.fn(() => countQuery(2)) };
      }
      if (table === 'dispute_events') {
        return { select: jest.fn(() => countQuery(0)) };
      }
      if (table === 'account_health_snapshots') {
        const historyQuery: any = {
          eq: jest.fn(() => historyQuery),
          order: jest.fn(() => historyQuery),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
        return {
          upsert: mockHealthUpsert,
          select: jest.fn(() => historyQuery),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  }),
}));

jest.mock('../../src/services/stripe-health.service', () => ({
  StripeHealthService: jest.fn(() => ({
    computeHealthSnapshot: jest.fn(),
  })),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: mockFireTrigger },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { runDailyHealthCheck } from '../../src/jobs/daily-health-check';

describe('runDailyHealthCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHealthUpsert.mockResolvedValue({ error: null });
  });

  it('upserts the daily NMI snapshot using the uniqueness boundary', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback();
      return 0 as any;
    }) as any);

    await expect(runDailyHealthCheck()).resolves.toEqual({ processed: 1, failed: 0 });

    expect(mockHealthUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant_1',
        location_id: 'loc_1',
        processor: 'nmi',
        snapshot_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      { onConflict: 'merchant_id,processor,snapshot_date' },
    );

    timeoutSpy.mockRestore();
  });
});
