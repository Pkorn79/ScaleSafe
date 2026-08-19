const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', liveMode: false },
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

  it('fills defense metadata when payment_intent.succeeded follows a sparse Charge-created row', async () => {
    const update = jest.fn();
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'vault_2',
          stripe_charge_id: 'ch_2',
          stripe_customer_id: null,
          offer_id: null,
          customer_name: null,
          customer_email: null,
          customer_ip: null,
          customer_billing_address: null,
          offer_title: null,
          offer_description: null,
          terms_accepted: false,
          terms_accepted_at: null,
          card_fingerprint: null,
          customer_device_fingerprint: null,
          ce30_fields_complete: false,
          metadata_written: false,
          evidence_score: 0,
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
      id: 'pi_2',
      latest_charge: 'ch_2',
      customer: 'cus_2',
      receipt_email: 'client@example.com',
      description: 'Certification Offer',
      metadata: {
        scalesafe_offer_id: '924251a4-5ddc-4b91-88ab-bae37e473c67',
        customer_ip: '203.0.113.10',
        customer_device_fingerprint: 'device_2',
        first_name: 'ScaleSafe',
        last_name: 'Certification',
        terms_accepted: 'true',
        terms_accepted_at: '2026-07-13T17:00:00.000Z',
      },
    }, { id: 'merchant_1' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      stripe_customer_id: 'cus_2',
      offer_id: '924251a4-5ddc-4b91-88ab-bae37e473c67',
      customer_name: 'ScaleSafe Certification',
      customer_email: 'client@example.com',
      customer_ip: '203.0.113.10',
      offer_title: 'Certification Offer',
      offer_description: 'Certification Offer',
      terms_accepted: true,
      terms_accepted_at: '2026-07-13T17:00:00.000Z',
      customer_device_fingerprint: 'device_2',
      ce30_fields_complete: true,
      metadata_written: true,
      evidence_score: 15,
    }));
  });

  it('replaces the generic checkout label with offer metadata from the richer webhook', async () => {
    const update = jest.fn();
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'vault_generic',
          stripe_charge_id: 'ch_generic',
          stripe_customer_id: null,
          offer_id: '924251a4-5ddc-4b91-88ab-bae37e473c67',
          customer_name: null,
          customer_email: null,
          customer_ip: null,
          customer_billing_address: null,
          offer_title: 'ScaleSafe Payment',
          offer_description: 'ScaleSafe Payment',
          terms_accepted: false,
          terms_accepted_at: null,
          card_fingerprint: null,
          customer_device_fingerprint: null,
          ce30_fields_complete: false,
          metadata_written: true,
          evidence_score: 0,
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
      id: 'pi_generic',
      latest_charge: 'ch_generic',
      description: 'ScaleSafe Payment',
      metadata: {
        offer_name: 'CERT 2026-07-13 Stripe PIF',
        offer_description: 'Live certification offer',
      },
    }, { id: 'merchant_1' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      offer_title: 'CERT 2026-07-13 Stripe PIF',
      offer_description: 'Live certification offer',
    }));
  });

  it('creates a Charge-first vault row with the offer and defense metadata intact', async () => {
    const insert = jest.fn().mockResolvedValue({ data: null, error: null });
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      insert,
    };
    mockFrom.mockReturnValue(chain);

    await stripeEvidenceVaultService.createVaultEntryFromWebhook({
      id: 'pi_3',
      latest_charge: {
        id: 'ch_3',
        description: 'Certification Offer',
        billing_details: {
          name: 'ScaleSafe Certification',
          email: 'client@example.com',
          address: { country: 'US', postal_code: '38568' },
        },
        payment_method_details: { card: { fingerprint: 'fp_3' } },
      },
      customer: 'cus_3',
      metadata: {
        scalesafe_offer_id: '924251a4-5ddc-4b91-88ab-bae37e473c67',
        customer_ip: '203.0.113.10',
        terms_accepted: 'true',
      },
    }, { id: 'merchant_1' });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      stripe_payment_intent_id: 'pi_3',
      stripe_charge_id: 'ch_3',
      stripe_customer_id: 'cus_3',
      offer_id: '924251a4-5ddc-4b91-88ab-bae37e473c67',
      customer_name: 'ScaleSafe Certification',
      customer_email: 'client@example.com',
      customer_billing_address: { country: 'US', postal_code: '38568' },
      offer_title: 'Certification Offer',
      offer_description: 'Certification Offer',
      customer_ip: '203.0.113.10',
      card_fingerprint: 'fp_3',
      terms_accepted: true,
      ce30_fields_complete: true,
      metadata_written: true,
      evidence_score: 25,
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
