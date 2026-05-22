const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { idempotencyRepository } from '../../src/repositories/idempotency.repository';

describe('idempotencyRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checks duplicates within the tenant scope', async () => {
    const eqCalls: Array<[string, string]> = [];
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn((column: string, value: string) => {
        eqCalls.push([column, value]);
        return chain;
      }),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'idem_1' }, error: null }),
    };
    mockFrom.mockReturnValue(chain);

    await expect(idempotencyRepository.exists('event_1', 'payment_reminder', 'loc_1')).resolves.toBe(true);

    expect(eqCalls).toEqual([
      ['location_id', 'loc_1'],
      ['event_id', 'event_1'],
      ['source', 'payment_reminder'],
    ]);
  });

  it('records the same event id separately for different locations', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });

    await idempotencyRepository.record('event_1', 'ghl_form', 'loc_1');
    await idempotencyRepository.record('event_1', 'ghl_form', 'loc_2');

    expect(insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event_id: 'event_1',
      source: 'ghl_form',
      location_id: 'loc_1',
    }));
    expect(insert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event_id: 'event_1',
      source: 'ghl_form',
      location_id: 'loc_2',
    }));
  });

  it('treats a tenant-scoped unique violation as a duplicate', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { code: '23505' } });
    mockFrom.mockReturnValue({ insert });

    await expect(idempotencyRepository.isDuplicate('event_1', 'external', 'loc_1')).resolves.toBe(true);
    expect(insert).toHaveBeenCalledWith({
      event_id: 'event_1',
      source: 'external',
      location_id: 'loc_1',
    });
  });
});
