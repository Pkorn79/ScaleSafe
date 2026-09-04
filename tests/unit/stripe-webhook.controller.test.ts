const mockConstructEvent = jest.fn();
const mockDisputesRetrieve = jest.fn();
const mockFrom = jest.fn();
const mockPaymentEventUpdate = jest.fn();
const mockDecrypt = jest.fn((value: string) => value.replace('enc:', ''));

jest.mock('stripe', () => {
  return jest.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    disputes: {
      retrieve: mockDisputesRetrieve,
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

const mockPrepareForStripeDispute = jest.fn();
const mockRecordOutcome = jest.fn();
jest.mock('../../src/services/defense.service', () => ({
  defenseService: {
    prepareForStripeDispute: mockPrepareForStripeDispute,
    recordOutcome: mockRecordOutcome,
  },
}));

// Per-test row for the defense_packets lookup in charge.dispute.closed
let mockPacketRow: any = null;

jest.mock('../../src/services/recurring-payment.service', () => ({
  handleRecurringPaymentSuccess: jest.fn(),
  handleRecurringPaymentFailure: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_global', liveMode: false },
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
          stripe_livemode: false,
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

  if (table === 'payment_events') {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      update: jest.fn((payload: any) => {
        mockPaymentEventUpdate(payload);
        return chain;
      }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    return chain;
  }

  if (table === 'dispute_events') {
    const chain: any = {
      upsert: jest.fn().mockResolvedValue({ error: null }),
      update: jest.fn(() => chain),
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'de_row_1' }, error: null }),
      then: (resolve: any) => resolve({ error: null }),
    };
    return chain;
  }

  if (table === 'defense_packets') {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      maybeSingle: jest.fn().mockImplementation(() => Promise.resolve({ data: mockPacketRow, error: null })),
    };
    return chain;
  }

  return {};
}

describe('handleStripeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPacketRow = null;
    // Default: re-fetch fails → handler falls back to the webhook payload
    mockDisputesRetrieve.mockRejectedValue(new Error('not mocked'));
    mockFrom.mockImplementation(tableMock);
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'unhandled.event',
      account: 'acct_1',
      livemode: false,
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

  it('normalizes charge.succeeded under the PaymentIntent id and enriches the ledger', async () => {
    const { stripeEvidenceVaultService } = require('../../src/services/stripe-evidence-vault.service');
    mockConstructEvent.mockReturnValue({
      id: 'evt_charge',
      type: 'charge.succeeded',
      account: 'acct_1',
      livemode: false,
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_1',
          created: 1780000000,
          payment_method_details: { card: { last4: '4242', fingerprint: 'fp_1' } },
        },
      },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();
    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(stripeEvidenceVaultService.createVaultEntryFromWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pi_1',
        latest_charge: expect.objectContaining({ id: 'ch_1' }),
      }),
      expect.objectContaining({ id: 'merch_1' }),
    );
    expect(mockPaymentEventUpdate).toHaveBeenCalledWith(expect.objectContaining({
      processor_charge_id: 'ch_1',
      payment_method_last4: '4242',
      payment_status: 'succeeded',
    }));
  });

  it('returns 500 so Stripe retries when payment evidence persistence fails', async () => {
    const { stripeEvidenceVaultService } = require('../../src/services/stripe-evidence-vault.service');
    (stripeEvidenceVaultService.createVaultEntryFromWebhook as jest.Mock)
      .mockRejectedValueOnce(new Error('vault unavailable'));
    mockConstructEvent.mockReturnValue({
      id: 'evt_pi',
      type: 'payment_intent.succeeded',
      account: 'acct_1',
      livemode: false,
      data: { object: { id: 'pi_2', latest_charge: 'ch_2', created: 1780000000, metadata: {} } },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();
    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ received: false, error: 'handler_failed' });
  });

  it('rejects a merchant-specific webhook when the Stripe account does not match', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'unhandled.event',
      account: 'acct_other',
      livemode: false,
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

  it('rejects a signed webhook from the wrong Stripe mode', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_live',
      type: 'unhandled.event',
      account: 'acct_1',
      livemode: true,
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
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe webhook mode mismatch' });
  });

  it('auto-PREPARES a defense packet on charge.dispute.created and never auto-submits', async () => {
    const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');
    (stripeDisputeService.triageDispute as jest.Mock).mockResolvedValue({ score: 85 });
    mockPrepareForStripeDispute.mockResolvedValue('def_1');

    mockConstructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'charge.dispute.created',
      account: 'acct_1',
      livemode: false,
      data: {
        object: {
          id: 'dp_1',
          charge: 'ch_1',
          payment_intent: 'pi_1',
          reason: 'fraudulent',
          status: 'needs_response',
          amount: 5000,
          currency: 'usd',
          evidence_details: { due_by: 1780000000 },
        },
      },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPrepareForStripeDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: expect.objectContaining({ id: 'merch_1' }),
        stripeDispute: expect.objectContaining({ id: 'dp_1' }),
      }),
    );
    // The old ungated path must be gone: no direct evidence submission from the webhook.
    expect(stripeDisputeService.submitEvidence).not.toHaveBeenCalled();
    expect(stripeDisputeService.assembleEvidencePacket).not.toHaveBeenCalled();
  });

  it('re-fetches the dispute with the modern API version so CE 3.0 eligibility survives old webhook endpoints', async () => {
    const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');
    (stripeDisputeService.triageDispute as jest.Mock).mockResolvedValue({ score: 70 });
    mockPrepareForStripeDispute.mockResolvedValue('def_1');
    // Webhook payload rendered at api_version 2022-11-15: eligibility stripped
    mockConstructEvent.mockReturnValue({
      id: 'evt_5',
      type: 'charge.dispute.created',
      account: 'acct_1',
      livemode: false,
      data: {
        object: {
          id: 'dp_ce3', charge: 'ch_5', payment_intent: 'pi_5', reason: 'fraudulent',
          status: 'needs_response', amount: 5000, currency: 'usd',
          enhanced_eligibility_types: [],
        },
      },
    });
    // Modern retrieve returns the full eligibility
    mockDisputesRetrieve.mockResolvedValue({
      id: 'dp_ce3', charge: 'ch_5', payment_intent: 'pi_5', reason: 'fraudulent',
      status: 'needs_response', amount: 5000, currency: 'usd',
      enhanced_eligibility_types: ['visa_compelling_evidence_3'],
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();
    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDisputesRetrieve).toHaveBeenCalledWith('dp_ce3', undefined, { stripeAccount: 'acct_1' });
    // The ENRICHED dispute flows through (auto-prepare receives eligibility)
    expect(mockPrepareForStripeDispute).toHaveBeenCalledWith(expect.objectContaining({
      stripeDispute: expect.objectContaining({ enhanced_eligibility_types: ['visa_compelling_evidence_3'] }),
    }));
  });

  it('a triage failure does not 500 the webhook (dispute row already persisted)', async () => {
    const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');
    (stripeDisputeService.triageDispute as jest.Mock).mockRejectedValue(new Error('stripe rate limit'));
    mockPrepareForStripeDispute.mockResolvedValue('def_1');
    mockConstructEvent.mockReturnValue({
      id: 'evt_6',
      type: 'charge.dispute.created',
      account: 'acct_1',
      livemode: false,
      data: {
        object: { id: 'dp_6', charge: 'ch_6', reason: 'general', status: 'needs_response', amount: 100, currency: 'usd' },
      },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();
    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Auto-prepare still runs even when triage blew up
    expect(mockPrepareForStripeDispute).toHaveBeenCalled();
  });

  it('skips auto-prepare when the dispute arrives already resolved (e.g. RDR auto-refund)', async () => {
    const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');
    (stripeDisputeService.triageDispute as jest.Mock).mockResolvedValue({ score: 50 });

    mockConstructEvent.mockReturnValue({
      id: 'evt_4',
      type: 'charge.dispute.created',
      account: 'acct_1',
      livemode: false,
      data: {
        object: { id: 'dp_3', charge: 'ch_3', reason: 'fraudulent', status: 'charge_refunded', amount: 2500, currency: 'usd' },
      },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPrepareForStripeDispute).not.toHaveBeenCalled();
  });

  it('still returns 200 when auto-prepare fails (dispute row is already persisted)', async () => {
    const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');
    (stripeDisputeService.triageDispute as jest.Mock).mockResolvedValue({ score: 10 });
    mockPrepareForStripeDispute.mockRejectedValue(new Error('contact lookup blew up'));

    mockConstructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'charge.dispute.created',
      account: 'acct_1',
      livemode: false,
      data: {
        object: { id: 'dp_2', charge: 'ch_2', reason: 'general', status: 'needs_response', amount: 100, currency: 'usd' },
      },
    });

    const req: any = {
      params: { locationId: 'loc_1' },
      headers: { 'stripe-signature': 'sig_1' },
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();

    await handleStripeWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(stripeDisputeService.submitEvidence).not.toHaveBeenCalled();
  });

  function closedEvent(status: string, id = 'dp_closed') {
    return {
      id: 'evt_closed',
      type: 'charge.dispute.closed',
      account: 'acct_1',
      livemode: false,
      data: { object: { id, charge: 'ch_9', reason: 'fraudulent', status, amount: 5000, currency: 'usd' } },
    };
  }

  const closedReq = () => ({
    params: { locationId: 'loc_1' },
    headers: { 'stripe-signature': 'sig_1' },
    rawBody: Buffer.from('{}'),
  } as any);

  it('auto-records a WON verdict on the linked defense packet', async () => {
    mockPacketRow = { id: 'def_9', lifecycle_status: 'submitted' };
    mockConstructEvent.mockReturnValue(closedEvent('won'));

    const res = mockResponse();
    await handleStripeWebhook(closedReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRecordOutcome).toHaveBeenCalledWith('def_9', 'won', { notes: 'Recorded automatically from Stripe' });
  });

  it('records a dismissed inquiry (warning_closed) as withdrawn — NEVER as lost', async () => {
    mockPacketRow = { id: 'def_9', lifecycle_status: 'submitted' };
    mockConstructEvent.mockReturnValue(closedEvent('warning_closed'));

    const res = mockResponse();
    await handleStripeWebhook(closedReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRecordOutcome).toHaveBeenCalledWith('def_9', 'withdrawn', expect.any(Object));
    expect(mockRecordOutcome).not.toHaveBeenCalledWith(expect.anything(), 'lost', expect.anything());
  });

  it('does not auto-record when no defense packet is linked to the dispute', async () => {
    mockPacketRow = null;
    mockConstructEvent.mockReturnValue(closedEvent('lost'));

    const res = mockResponse();
    await handleStripeWebhook(closedReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  it('does not double-record when the packet already has a terminal outcome', async () => {
    mockPacketRow = { id: 'def_9', lifecycle_status: 'won' };
    mockConstructEvent.mockReturnValue(closedEvent('won'));

    const res = mockResponse();
    await handleStripeWebhook(closedReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  it('still 200s when auto-recording fails (dispute_events already updated)', async () => {
    mockPacketRow = { id: 'def_9', lifecycle_status: 'submitted' };
    mockRecordOutcome.mockRejectedValueOnce(new Error('GHL down'));
    mockConstructEvent.mockReturnValue(closedEvent('won'));

    const res = mockResponse();
    await handleStripeWebhook(closedReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
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

describe('pre-routing failure containment', () => {
  it('returns 500 instead of crashing when the platform payment mode is unconfigured', async () => {
    // Pre-fix, expectedStripeLiveMode() threw past the handler as an unhandled
    // promise rejection, killing the shared multi-tenant process.
    const { config } = require('../../src/config');
    const original = config.stripe.liveMode;
    config.stripe.liveMode = undefined;
    try {
      mockConstructEvent.mockReturnValue({
        id: 'evt_guard', type: 'unhandled.event', account: 'acct_1', livemode: false, data: { object: {} },
      });
      const req: any = { params: {}, headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}'), rawBody: Buffer.from('{}') };
      const res = mockResponse();

      await expect(handleStripeWebhook(req, res)).resolves.toBeUndefined();

      expect(res.statusCode).toBe(500);
    } finally {
      config.stripe.liveMode = original;
    }
  });
});

describe('invoice.payment_failed dunning identity', () => {
  it('passes the invoice id as the failure transaction id so repeat attempts dedupe', async () => {
    const recurring = require('../../src/services/recurring-payment.service');
    (recurring.handleRecurringPaymentFailure as jest.Mock).mockResolvedValue({ paymentEventId: 'pe_f' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        const chain: any = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'enr_1', merchant_id: 'merch_1', location_id: 'loc_1',
              contact_id: 'c_1', offer_id: 'offer_1', processor_subscription_id: 'sub_1',
            },
            error: null,
          }),
        };
        return chain;
      }
      return tableMock(table);
    });
    mockConstructEvent.mockReturnValue({
      id: 'evt_inv_fail',
      type: 'invoice.payment_failed',
      account: 'acct_1',
      livemode: false,
      data: { object: { id: 'in_123', subscription: 'sub_1', amount_due: 5000 } },
    });

    const req: any = {
      params: {},
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from('{}'),
      rawBody: Buffer.from('{}'),
    };
    const res = mockResponse();
    await handleStripeWebhook(req, res);

    expect(recurring.handleRecurringPaymentFailure).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: 'in_123',
      amountCents: 5000,
    }));
    expect(res.statusCode).toBe(200);
  });
});
