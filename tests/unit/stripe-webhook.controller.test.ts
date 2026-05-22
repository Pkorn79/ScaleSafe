const mockConstructEvent = jest.fn();
const mockFrom = jest.fn();
const mockDecrypt = jest.fn((value: string) => value.replace('enc:', ''));

jest.mock('stripe', () => {
  return jest.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/services/processor-config.service', () => ({
  decrypt: mockDecrypt,
}));

jest.mock('../../src/services/stripe-evidence-vault.service', () => ({
  stripeEvidenceVaultService: { createVaultEntryFromWebhook: jest.fn() },
}));

jest.mock('../../src/services/stripe-dispute.service', () => ({
  stripeDisputeService: {
    triageDispute: jest.fn(),
    assembleEvidencePacket: jest.fn(),
    submitEvidence: jest.fn(),
  },
}));

jest.mock('../../src/services/stripe-efw.service', () => ({
  stripeEfwService: { handleEfw: jest.fn() },
}));

jest.mock('../../src/services/recurring-payment.service', () => ({
  handleRecurringPaymentSuccess: jest.fn(),
  handleRecurringPaymentFailure: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_global' },
    logLevel: 'silent',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { handleStripeWebhook } from '../../src/controllers/stripe-webhook.controller';

function mockResponse(): any {
  return {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: any) {
      this.body = body;
      return this;
    }),
  };
}

function tableMock(table: string) {
  if (table === 'processor_configs') {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'pc_1',
          merchant_id: 'merch_1',
          location_id: 'loc_1',
          stripe_user_id: 'acct_1',
          stripe_webhook_secret_encrypted: 'enc:whsec_loc',
        },
        error: null,
      }),
    };
    return chain;
  }

  if (table === 'merchants') {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'merch_1',
          location_id: 'loc_1',
          stripe_user_id: 'acct_1',
        },
        error: null,
      }),
    };
    return chain;
  }

  return {};
}

describe('handleStripeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockImplementation(tableMock);
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'unhandled.event',
      account: 'acct_1',
      data: { object: { id: 'obj_1' } },
    });
  });

  it('verifies merchant-specific webhook routes with the stored endpoint secret', async () => {
    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      body: Buffer.from('{}'),
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(mockConstructEvent).toHaveBeenCalledWith(req.rawBody, 'sig_1', 'whsec_loc');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('rejects a merchant-specific webhook when the Stripe account does not match', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'unhandled.event',
      account: 'acct_other',
      data: { object: { id: 'obj_1' } },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe account mismatch' });
  });

  it('keeps the legacy global webhook route working with the global secret', async () => {
    const req: any = {
      params: {},
      headers: { 'stripe-signature': 'sig_legacy' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(mockConstructEvent).toHaveBeenCalledWith(req.rawBody, 'sig_legacy', 'whsec_global');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
