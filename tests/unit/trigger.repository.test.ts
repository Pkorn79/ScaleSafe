const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { triggerRepository } from '../../src/repositories/trigger.repository';

function subscriptionQuery(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe('trigger repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    { code: '42P01', message: 'relation "trigger_subscriptions" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.trigger_subscriptions' in the schema cache" },
    { code: undefined, message: 'relation public.trigger_subscriptions does not exist' },
  ])('returns an empty list only for an expected missing-table error', async (error) => {
    mockFrom.mockReturnValue(subscriptionQuery({ data: null, error }));

    await expect(triggerRepository.getActiveSubscriptions('loc_1', 'ss_app_event'))
      .resolves.toEqual([]);
  });

  it('throws a transient database error even when its message names the table', async () => {
    const error = {
      code: '57014',
      message: 'canceling statement due to timeout while reading trigger_subscriptions',
    };
    mockFrom.mockReturnValue(subscriptionQuery({ data: null, error }));

    await expect(triggerRepository.getActiveSubscriptions('loc_1', 'ss_app_event'))
      .rejects.toBe(error);
  });

  it('throws schema errors other than a missing table', async () => {
    const error = {
      code: 'PGRST204',
      message: "Could not find the 'is_active' column of 'trigger_subscriptions' in the schema cache",
    };
    mockFrom.mockReturnValue(subscriptionQuery({ data: null, error }));

    await expect(triggerRepository.getActiveSubscriptions('loc_1', 'ss_app_event'))
      .rejects.toBe(error);
  });
});
