const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const query: any = {
  select: jest.fn(() => query),
  eq: mockEq,
  maybeSingle: mockMaybeSingle,
};
mockEq.mockImplementation(() => query);

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn(() => query) }),
}));

jest.mock('../../src/config', () => ({
  config: { stripe: { liveMode: false } },
}));

import {
  assertStripeProcessorConfigMode,
  requireActiveStripeConnection,
  stripeConnectionModeMatches,
} from '../../src/services/stripe-connection-mode.service';

describe('Stripe connection mode boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEq.mockImplementation(() => query);
  });

  it('accepts only the platform mode', () => {
    expect(stripeConnectionModeMatches(false)).toBe(true);
    expect(stripeConnectionModeMatches(true)).toBe(false);
    expect(stripeConnectionModeMatches(null)).toBe(false);
    expect(() => assertStripeProcessorConfigMode({ stripe_livemode: true }))
      .toThrow(/running in test mode/i);
    expect(() => assertStripeProcessorConfigMode({ stripe_livemode: null }))
      .toThrow(/predates payment-mode verification/i);
  });

  it('returns one active, tenant-scoped Stripe connection in the expected mode', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        stripe_user_id: 'acct_test',
        stripe_livemode: false,
      },
      error: null,
    });

    const result = await requireActiveStripeConnection('merchant_1', 'loc_1');

    expect(result.stripe_user_id).toBe('acct_test');
    expect(mockEq).toHaveBeenCalledWith('merchant_id', 'merchant_1');
    expect(mockEq).toHaveBeenCalledWith('location_id', 'loc_1');
    expect(mockEq).toHaveBeenCalledWith('processor_type', 'stripe');
    expect(mockEq).toHaveBeenCalledWith('is_active', true);
  });

  it('fails closed when no verified connection exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(requireActiveStripeConnection('merchant_1', 'loc_1'))
      .rejects.toMatchObject({ code: 'STRIPE_CONNECTION_NOT_FOUND' });
  });
});
