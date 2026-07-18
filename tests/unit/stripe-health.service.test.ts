/**
 * Stripe Health Service tests - Phase S4
 *
 * Tests dispute rate computation, VAMP/MC threshold assessment,
 * risk level determination, upgrade suggestions, and processor-scoped reads.
 */

const mockSupabaseUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn();
const queryEqCalls: Record<string, Array<[string, any]>> = {};

const mockEmptyStripeList = () => jest.fn(() => ({
  autoPagingToArray: jest.fn().mockResolvedValue([]),
}));

jest.mock('stripe', () => jest.fn(() => ({
  disputes: { list: mockEmptyStripeList() },
  charges: { list: mockEmptyStripeList() },
  radar: { earlyFraudWarnings: { list: mockEmptyStripeList() } },
  balanceTransactions: { list: mockEmptyStripeList() },
})));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { StripeHealthService } from '../../src/services/stripe-health.service';

function tableQuery(table: string) {
  const singleData = table === 'merchants'
    ? { id: 'merchant_1', stripe_user_id: 'acct_123', stripe_connected: true, location_id: 'loc_1' }
    : null;
  const listData: any[] = [];
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn((column: string, value: any) => {
      queryEqCalls[table] = [...(queryEqCalls[table] || []), [column, value]];
      return chain;
    }),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(async () => ({ data: singleData, error: null })),
    upsert: mockSupabaseUpsert,
    then: (resolve: any) => resolve({ data: listData, error: null }),
  };
  return chain;
}

describe('StripeHealthService', () => {
  let service: StripeHealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(queryEqCalls).forEach((key) => delete queryEqCalls[key]);
    mockSupabaseUpsert.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => tableQuery(table));
    service = new StripeHealthService();
  });

  describe('assessRiskLevel', () => {
    it('returns critical at 0.90% dispute rate', () => {
      expect(service.assessRiskLevel(0.009, 0)).toBe('critical');
    });

    it('returns critical at 1.5% dispute rate', () => {
      expect(service.assessRiskLevel(0.015, 0)).toBe('critical');
    });

    it('returns high at 0.65% dispute rate', () => {
      expect(service.assessRiskLevel(0.0065, 0)).toBe('high');
    });

    it('returns high at 0.80% dispute rate', () => {
      expect(service.assessRiskLevel(0.008, 0)).toBe('high');
    });

    it('returns elevated at 0.50% dispute rate', () => {
      expect(service.assessRiskLevel(0.005, 0)).toBe('elevated');
    });

    it('returns elevated when EFW rate is high even if dispute rate is low', () => {
      expect(service.assessRiskLevel(0.001, 0.005)).toBe('elevated');
    });

    it('returns moderate at 0.30% dispute rate', () => {
      expect(service.assessRiskLevel(0.003, 0)).toBe('moderate');
    });

    it('returns low at 0.10% dispute rate', () => {
      expect(service.assessRiskLevel(0.001, 0)).toBe('low');
    });

    it('returns low at zero rates', () => {
      expect(service.assessRiskLevel(0, 0)).toBe('low');
    });
  });

  describe('assessVampStatus', () => {
    it('returns safe below 0.50%', () => {
      expect(service.assessVampStatus(0.004)).toBe('safe');
    });

    it('returns approaching at 0.50%', () => {
      expect(service.assessVampStatus(0.005)).toBe('approaching');
    });

    it('returns early_warning at 0.65%', () => {
      expect(service.assessVampStatus(0.0065)).toBe('early_warning');
    });

    it('returns standard_program at 0.90%', () => {
      expect(service.assessVampStatus(0.009)).toBe('standard_program');
    });

    it('returns standard_program above 0.90%', () => {
      expect(service.assessVampStatus(0.012)).toBe('standard_program');
    });
  });

  describe('assessMastercardStatus', () => {
    it('returns safe below 0.75%', () => {
      expect(service.assessMastercardStatus(0.005)).toBe('safe');
    });

    it('returns warning at 0.75%', () => {
      expect(service.assessMastercardStatus(0.0075)).toBe('warning');
    });

    it('returns warning at 1.0%', () => {
      expect(service.assessMastercardStatus(0.01)).toBe('warning');
    });

    it('returns ecm_program at 1.50%', () => {
      expect(service.assessMastercardStatus(0.015)).toBe('ecm_program');
    });

    it('returns ecm_program above 1.50%', () => {
      expect(service.assessMastercardStatus(0.02)).toBe('ecm_program');
    });
  });

  describe('shouldSuggestUpgrade', () => {
    it('suggests upgrade when dispute rate is high and evidence is low', () => {
      expect(service.shouldSuggestUpgrade(0.007, 50)).toBe(true);
    });

    it('does not suggest upgrade when dispute rate is low', () => {
      expect(service.shouldSuggestUpgrade(0.003, 50)).toBe(false);
    });

    it('does not suggest upgrade when evidence is high', () => {
      expect(service.shouldSuggestUpgrade(0.007, 80)).toBe(false);
    });

    it('does not suggest upgrade when both are borderline safe', () => {
      expect(service.shouldSuggestUpgrade(0.0065, 70)).toBe(false);
    });

    it('suggests upgrade at exactly 0.66% and 69%', () => {
      expect(service.shouldSuggestUpgrade(0.0066, 69)).toBe(true);
    });
  });

  describe('computeHealthSnapshot', () => {
    it('persists stripe as the processor discriminator', async () => {
      await service.computeHealthSnapshot('merchant_1', 'loc_1');

      expect(mockSupabaseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor: 'stripe',
          snapshot_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
        { onConflict: 'merchant_id,processor,snapshot_date' },
      );
    });

    it('uses the same upsert boundary on repeated same-day computations', async () => {
      await service.computeHealthSnapshot('merchant_1', 'loc_1');
      await service.computeHealthSnapshot('merchant_1', 'loc_1');

      expect(mockSupabaseUpsert).toHaveBeenCalledTimes(2);
      expect(mockSupabaseUpsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ merchant_id: 'merchant_1', processor: 'stripe' }),
        { onConflict: 'merchant_id,processor,snapshot_date' },
      );
    });
  });

  describe('stored snapshot reads', () => {
    it('scopes the latest snapshot to Stripe', async () => {
      await service.getLatestSnapshot('merchant_1', 'loc_1');

      expect(queryEqCalls.account_health_snapshots).toEqual(expect.arrayContaining([
        ['merchant_id', 'merchant_1'],
        ['location_id', 'loc_1'],
        ['processor', 'stripe'],
      ]));
    });

    it('scopes snapshot history to Stripe', async () => {
      await service.getSnapshotHistory('merchant_1', 'loc_1');

      expect(queryEqCalls.account_health_snapshots).toEqual(expect.arrayContaining([
        ['processor', 'stripe'],
      ]));
    });
  });
});
