const mockUpsert = jest.fn();
const mockFrom = jest.fn(() => ({ upsert: mockUpsert }));
const mockGetVaultEntryForCharge = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/services/stripe-evidence-vault.service', () => ({
  stripeEvidenceVaultService: {
    getVaultEntryForCharge: (...args: any[]) => mockGetVaultEntryForCharge(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: any[]) => mockLoggerError(...args),
    debug: jest.fn(),
  },
}));

jest.mock('stripe', () => jest.fn(() => ({})));

import { stripeEfwService } from '../../src/services/stripe-efw.service';

const merchant = {
  id: 'merchant-1',
  location_id: 'location-1',
};

const efw = {
  id: 'issfr_1',
  charge: 'ch_1',
  payment_intent: 'pi_1',
  fraud_type: 'card_never_received',
};

describe('stripeEfwService.handleEfw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVaultEntryForCharge.mockResolvedValue({ evidence_score: 72 });
    mockUpsert.mockResolvedValue({ error: null });
    jest.spyOn(stripeEfwService, 'getCurrentDisputeRate').mockResolvedValue(0.001);
    jest.spyOn(stripeEfwService, 'alertMerchantEfw').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('upserts an EFW using the merchant-scoped Stripe warning key', async () => {
    await stripeEfwService.handleEfw(efw, merchant);

    expect(mockFrom).toHaveBeenCalledWith('efw_events');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-1',
        location_id: 'location-1',
        stripe_efw_id: 'issfr_1',
      }),
      { onConflict: 'merchant_id,stripe_efw_id' },
    );
    expect(stripeEfwService.alertMerchantEfw).toHaveBeenCalledTimes(1);
  });

  it('surfaces a database upsert error and does not report success', async () => {
    const upsertError = {
      message: 'no unique or exclusion constraint matching the ON CONFLICT specification',
      code: '42P10',
    };
    mockUpsert.mockResolvedValue({ error: upsertError });

    await expect(stripeEfwService.handleEfw(efw, merchant)).rejects.toBe(upsertError);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: upsertError.message,
        code: upsertError.code,
        merchantId: 'merchant-1',
        efwId: 'issfr_1',
      }),
      'Failed to persist Stripe EFW',
    );
    expect(stripeEfwService.alertMerchantEfw).not.toHaveBeenCalled();
  });
});
