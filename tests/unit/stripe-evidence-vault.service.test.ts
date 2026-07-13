const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test' },
    logLevel: 'silent',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeEvidenceVaultService } from '../../src/services/stripe-evidence-vault.service';

describe('stripeEvidenceVaultService.createVaultEntryFromWebhook', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fills the Charge id and fingerprint when charge.succeeded follows the PaymentIntent event', async () => {
    const update = jest.fn();
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'vault_1',
          stripe_charge_id: null,
          card_fingerprint: null,
          customer_device_fingerprint: null,
        },
        error: null,
      }),
      update: jest.fn((payload: any) => {
        update(payload);
        return chain;
      }),
      then: (resolve: any) => resolve({ error: null }),
    };
    mockFrom.mockReturnValue(chain);

    await stripeEvidenceVaultService.createVaultEntryFromWebhook({
      id: 'pi_1',
      latest_charge: {
        id: 'ch_1',
        payment_method_details: { card: { fingerprint: 'fp_1' } },
      },
      metadata: {},
    }, { id: 'merchant_1' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      stripe_charge_id: 'ch_1',
      card_fingerprint: 'fp_1',
    }));
  });

  it('throws when a new vault row cannot be persisted so Stripe can retry', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      insert: jest.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
    };
    mockFrom.mockReturnValue(chain);

    await expect(stripeEvidenceVaultService.createVaultEntryFromWebhook({
      id: 'pi_2',
      latest_charge: 'ch_2',
      metadata: {},
    }, { id: 'merchant_1' })).rejects.toMatchObject({ message: 'database unavailable' });
  });
});
