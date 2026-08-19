jest.mock('stripe', () => {
  const mockStripe = {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    refunds: { create: jest.fn() },
    customers: {
      list: jest.fn(),
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    paymentMethods: {
      attach: jest.fn(),
      retrieve: jest.fn(),
      list: jest.fn(),
    },
    prices: { create: jest.fn() },
    subscriptions: {
      create: jest.fn(),
      cancel: jest.fn(),
      update: jest.fn(),
    },
    accounts: { retrieve: jest.fn() },
  };

  return jest.fn(() => mockStripe);
});

// Mock config
jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_xxx', clientId: 'ca_xxx', webhookSecret: '', liveMode: false },
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { StripeClient } from '../../src/clients/stripe.client';

const Stripe = require('stripe');

function getMock(): any {
  // Get the mock instance created by the constructor
  return Stripe.mock.results[0]?.value || Stripe();
}

describe('StripeClient', () => {
  let client: StripeClient;
  let mockStripe: any;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new StripeClient({ stripeAccountId: 'acct_test123' });
    mockStripe = getMock();
  });

  describe('charge', () => {
    it('creates PaymentIntent with correct params and stripeAccount', async () => {
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_test1',
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
        latest_charge: 'ch_test1',
      });

      const result = await client.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'pm_test1',
        description: 'Test charge',
        idempotencyKey: 'checkout-attempt-123',
        metadata: {
          scalesafe_offer_id: 'offer_1',
          terms_accepted: 'true',
          terms_accepted_at: '2026-04-03T00:00:00Z',
          ce30_eligible: 'true',
          customer_email: 'test@test.com',
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      expect(result.transactionId).toBe('pi_test1');
      expect(result.chargeId).toBe('ch_test1');

      // Verify stripeAccount header
      const [params, opts] = mockStripe.paymentIntents.create.mock.calls[0];
      expect(opts.stripeAccount).toBe('acct_test123');
      expect(opts.idempotencyKey).toBe('checkout-attempt-123');
      expect(params.amount).toBe(5000);
      expect(params.payment_method).toBe('pm_test1');
      expect(params.confirm).toBe(true);

      // Verify CE 3.0 metadata
      expect(params.metadata.scalesafe_offer_id).toBe('offer_1');
      expect(params.metadata.terms_accepted).toBe('true');
      expect(params.metadata.ce30_eligible).toBe('true');
    });

    it('handles 3DS requirement', async () => {
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_3ds',
        status: 'requires_action',
        amount: 1000,
        currency: 'usd',
        latest_charge: null,
        next_action: { redirect_to_url: { url: 'https://stripe.com/3ds' } },
      });

      const result = await client.charge({
        amount: 1000,
        currency: 'usd',
        paymentToken: 'pm_test2',
        requestThreeDSecure: true,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending_3ds');
      expect(result.threeDSecureUrl).toBe('https://stripe.com/3ds');

      const [params] = mockStripe.paymentIntents.create.mock.calls[0];
      expect(params.payment_method_options.card.request_three_d_secure).toBe('any');
    });

    it('compacts oversized line-item metadata without losing checkout amounts', async () => {
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_metadata',
        status: 'succeeded',
        amount: 206500,
        currency: 'usd',
        latest_charge: 'ch_metadata',
      });

      const lineItems = [
        { type: 'base_offer', label: 'Full Offer Test', amountCents: 190000, amount: 1900 },
        { type: 'order_bump', addonId: 'e56dded4-d3f9-47f5-86f7-0da2d41e44b8', label: 'Onboarding Call', description: 'x'.repeat(220), amountCents: 10000, amount: 100 },
        { type: 'dual_pricing_adjustment', label: 'Card price difference (3.25% above bank-transfer price)', description: 'x'.repeat(220), amountCents: 6500, amount: 65, pricing: { selectedPaymentMethod: 'card' } },
      ];

      await client.charge({
        amount: 206500,
        currency: 'usd',
        paymentToken: 'pm_metadata',
        metadata: {
          line_items: JSON.stringify(lineItems),
          offer_description: 'y'.repeat(700),
        },
      });

      const [params] = mockStripe.paymentIntents.create.mock.calls[0];
      expect(params.metadata.line_items.length).toBeLessThanOrEqual(500);
      expect(params.metadata.offer_description.length).toBe(500);
      expect(JSON.parse(params.metadata.line_items)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'base_offer', amountCents: 190000 }),
        expect.objectContaining({ type: 'order_bump', amountCents: 10000 }),
        expect.objectContaining({ type: 'dual_pricing_adjustment', amountCents: 6500 }),
      ]));
    });

    it('handles card decline as StripeCardError', async () => {
      const cardErr = new Error('Your card was declined');
      (cardErr as any).type = 'StripeCardError';
      (cardErr as any).code = 'card_declined';
      mockStripe.paymentIntents.create.mockRejectedValue(cardErr);

      const result = await client.charge({
        amount: 500,
        currency: 'usd',
        paymentToken: 'pm_bad',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('declined');
      expect(result.errorMessage).toBe('Your card was declined');
    });
  });

  describe('createAchPaymentIntent', () => {
    it('uses stable idempotency keys for both customer and PaymentIntent creation', async () => {
      mockStripe.customers.list.mockResolvedValue({ data: [] });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_ach' });
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_ach', client_secret: 'secret', status: 'requires_payment_method',
      });

      await client.createAchPaymentIntent({
        amount: 5000,
        customerEmail: 'ach@example.com',
        idempotencyKey: 'checkout-ach-attempt-123',
      });

      expect(mockStripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ach@example.com' }),
        expect.objectContaining({ stripeAccount: 'acct_test123', idempotencyKey: 'checkout-ach-attempt-123-customer' }),
      );
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5000, customer: 'cus_ach' }),
        expect.objectContaining({ stripeAccount: 'acct_test123', idempotencyKey: 'checkout-ach-attempt-123' }),
      );
    });

    it('applies the same metadata limit to ACH PaymentIntents', async () => {
      mockStripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_ach' }] });
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_ach', client_secret: 'secret', status: 'requires_payment_method',
      });

      await client.createAchPaymentIntent({
        amount: 5000,
        customerEmail: 'ach@example.com',
        metadata: { offer_description: 'z'.repeat(700) },
      });

      const [params] = mockStripe.paymentIntents.create.mock.calls[0];
      expect(params.metadata.offer_description.length).toBe(500);
    });
  });

  describe('cancelSubscription', () => {
    it('passes stripeAccount as the third SDK argument', async () => {
      mockStripe.subscriptions.cancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });

      const result = await client.cancelSubscription('sub_123');

      expect(result.success).toBe(true);
      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(
        'sub_123',
        undefined,
        { stripeAccount: 'acct_test123' },
      );
    });
  });

  describe('resumeSubscription', () => {
    it('updates pause_collection using the existing subscription id', async () => {
      mockStripe.subscriptions.update.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        current_period_end: 1780000000,
      });

      const result = await client.resumeSubscription({
        subscriptionId: 'sub_123',
        customerId: '',
        paymentMethodId: '',
        planAmount: 0,
        interval: 'monthly',
        remainingPayments: 0,
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe('sub_123');
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_123',
        { pause_collection: null },
        { stripeAccount: 'acct_test123' },
      );
    });
  });

  describe('createSubscription (Group B — no day-1 double-bill)', () => {
    function futureIso(days: number) {
      return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    beforeEach(() => {
      mockStripe.prices.create.mockResolvedValue({ id: 'price_test1' });
      mockStripe.subscriptions.create.mockResolvedValue({
        id: 'sub_test1',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });
    });

    it('anchors the first cycle to a future startDate and disables proration (prevents day-1 double bill)', async () => {
      const startDate = futureIso(7);
      const result = await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 50, // $0.50 — the PMG 2-pay repro
        interval: 'weekly',
        totalPayments: 2,
        startDate,
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe('sub_test1');

      const [params, opts] = mockStripe.subscriptions.create.mock.calls[0];
      // The fix: Stripe must NOT auto-bill a subscription_create invoice on day 1.
      // The upfront installment is taken once via processor.charge(); the recurring
      // schedule starts at the *next* cycle, not at creation.
      expect(params.billing_cycle_anchor).toBe(Math.floor(new Date(startDate).getTime() / 1000));
      expect(params.proration_behavior).toBe('none');
      expect(opts.stripeAccount).toBe('acct_test123'); // runs on the connected account
    });

    it('omits billing_cycle_anchor when no startDate is given', async () => {
      await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 50,
        interval: 'weekly',
        totalPayments: 2,
      });

      const [params] = mockStripe.subscriptions.create.mock.calls[0];
      expect(params.billing_cycle_anchor).toBeUndefined();
      expect(params.proration_behavior).toBeUndefined();
    });

    it('does not anchor when startDate is effectively now (inside the 60s guard)', async () => {
      await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 50,
        interval: 'weekly',
        totalPayments: 2,
        startDate: new Date(Date.now() + 5 * 1000).toISOString(), // +5s
      });

      const [params] = mockStripe.subscriptions.create.mock.calls[0];
      expect(params.billing_cycle_anchor).toBeUndefined();
      expect(params.proration_behavior).toBeUndefined();
    });

    it('uses stable idempotency keys for both price and subscription creation', async () => {
      await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 5000,
        interval: 'monthly',
        totalPayments: 0,
        idempotencyKey: 'ach-recurring-enrollment-1',
      });

      expect(mockStripe.prices.create.mock.calls[0][1]).toEqual(expect.objectContaining({
        idempotencyKey: 'ach-recurring-enrollment-1-price',
      }));
      expect(mockStripe.subscriptions.create.mock.calls[0][1]).toEqual(expect.objectContaining({
        idempotencyKey: 'ach-recurring-enrollment-1-subscription',
      }));
    });

    it('throws an unknown-result error when subscriptions.create loses the response', async () => {
      const connectionError = new Error('Connection closed after request');
      (connectionError as any).type = 'StripeConnectionError';
      mockStripe.subscriptions.create.mockRejectedValueOnce(connectionError);

      await expect(client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 5000,
        interval: 'monthly',
        totalPayments: 0,
        idempotencyKey: 'ach-recurring-enrollment-2',
      })).rejects.toEqual(expect.objectContaining({
        code: 'STRIPE_SUBSCRIPTION_RESULT_UNKNOWN',
        isRetryable: true,
      }));
    });

    it('returns a definitive failure when Stripe rejects subscription parameters', async () => {
      const invalidRequest = new Error('Invalid customer');
      (invalidRequest as any).type = 'StripeInvalidRequestError';
      mockStripe.subscriptions.create.mockRejectedValueOnce(invalidRequest);

      const result = await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_bad',
        planAmount: 5000,
        interval: 'monthly',
        totalPayments: 0,
      });

      expect(result).toEqual(expect.objectContaining({ success: false, status: 'failed' }));
    });
  });

  describe('refund', () => {
    it('creates refund with stripeAccount', async () => {
      mockStripe.refunds.create.mockResolvedValue({
        id: 're_test1',
        status: 'succeeded',
        amount: 5000,
      });

      const result = await client.refund({ transactionId: 'pi_test1' });

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('re_test1');
      expect(result.status).toBe('refunded');

      const [params, opts] = mockStripe.refunds.create.mock.calls[0];
      expect(params.payment_intent).toBe('pi_test1');
      expect(opts.stripeAccount).toBe('acct_test123');
    });

    it('passes amount for partial refund', async () => {
      mockStripe.refunds.create.mockResolvedValue({
        id: 're_partial',
        status: 'succeeded',
        amount: 2500,
      });

      await client.refund({ transactionId: 'pi_test1', amount: 2500 });

      const [params] = mockStripe.refunds.create.mock.calls[0];
      expect(params.amount).toBe(2500);
    });

    it('creates refund against a charge when the stored transaction ID is a charge ID', async () => {
      mockStripe.refunds.create.mockResolvedValue({
        id: 're_charge',
        status: 'succeeded',
        amount: 5000,
      });

      await client.refund({ transactionId: 'ch_test1' });

      const [params] = mockStripe.refunds.create.mock.calls[0];
      expect(params.charge).toBe('ch_test1');
      expect(params.payment_intent).toBeUndefined();
    });
  });

  describe('saveCard', () => {
    it('finds or creates customer then attaches payment method', async () => {
      mockStripe.customers.list.mockResolvedValue({ data: [] });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new1' });
      mockStripe.paymentMethods.attach.mockResolvedValue({});
      mockStripe.paymentMethods.retrieve.mockResolvedValue({
        id: 'pm_saved1',
        card: { last4: '4242', brand: 'visa', exp_month: 12, exp_year: 2027 },
      });

      const result = await client.saveCard({
        paymentToken: 'pm_saved1',
        contactId: 'contact_1',
        customerEmail: 'jane@test.com',
        customerName: 'Jane Smith',
      });

      expect(result.success).toBe(true);
      expect(result.customerId).toBe('cus_new1');
      expect(result.cardLastFour).toBe('4242');
      expect(result.cardBrand).toBe('visa');

      // Verify stripeAccount on all calls
      expect(mockStripe.customers.list.mock.calls[0][1].stripeAccount).toBe('acct_test123');
      expect(mockStripe.customers.create.mock.calls[0][1].stripeAccount).toBe('acct_test123');
      expect(mockStripe.paymentMethods.attach.mock.calls[0][2].stripeAccount).toBe('acct_test123');
    });

    it('reuses existing customer', async () => {
      mockStripe.customers.list.mockResolvedValue({
        data: [{ id: 'cus_existing' }],
      });
      mockStripe.paymentMethods.attach.mockResolvedValue({});
      mockStripe.paymentMethods.retrieve.mockResolvedValue({
        id: 'pm_1',
        card: { last4: '1234', brand: 'mastercard', exp_month: 6, exp_year: 2028 },
      });

      const result = await client.saveCard({
        paymentToken: 'pm_1',
        contactId: 'c1',
        customerEmail: 'jane@test.com',
      });

      expect(result.customerId).toBe('cus_existing');
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });
  });

  describe('createSubscription', () => {
    it('creates price and subscription with cancel_at', async () => {
      mockStripe.prices.create.mockResolvedValue({ id: 'price_test1' });
      mockStripe.subscriptions.create.mockResolvedValue({
        id: 'sub_test1',
        status: 'active',
        current_period_end: 1730000000,
      });

      const result = await client.createSubscription({
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        planAmount: 50000,
        interval: 'monthly',
        totalPayments: 12,
        description: 'Monthly Coaching',
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe('sub_test1');

      // Verify price creation on connected account
      const [priceParams, priceOpts] = mockStripe.prices.create.mock.calls[0];
      expect(priceParams.unit_amount).toBe(50000);
      expect(priceParams.recurring.interval).toBe('month');
      expect(priceOpts.stripeAccount).toBe('acct_test123');

      // Verify subscription has cancel_at
      const [subParams] = mockStripe.subscriptions.create.mock.calls[0];
      expect(subParams.cancel_at).toBeDefined();
      expect(subParams.customer).toBe('cus_1');
    });
  });

  describe('testConnection', () => {
    it('verifies connected account', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test123',
        business_profile: { name: 'Test Business' },
      });

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Test Business');
    });

    it('returns failure on error', async () => {
      mockStripe.accounts.retrieve.mockRejectedValue(new Error('Not found'));

      const result = await client.testConnection();
      expect(result.success).toBe(false);
    });
  });

  describe('verifyTransaction', () => {
    it('retrieves PaymentIntent and maps status', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_verify1',
        status: 'succeeded',
        amount: 3000,
      });

      const result = await client.verifyTransaction('pi_verify1');
      expect(result.success).toBe(true);
      expect(result.status).toBe('settled');
      expect(result.amount).toBe(3000);

      // #15: stripeAccount must be the 3rd (options) arg, not the 2nd (params) arg.
      const [_id, params, opts] = mockStripe.paymentIntents.retrieve.mock.calls[0];
      expect(params).toBeUndefined();
      expect(opts.stripeAccount).toBe('acct_test123');
    });
  });

  describe('error handling', () => {
    it('treats StripeConnectionError as retryable', async () => {
      const connErr = new Error('Network error');
      (connErr as any).type = 'StripeConnectionError';
      (connErr as any).code = 'network_error';
      mockStripe.refunds.create.mockRejectedValue(connErr);

      try {
        await client.refund({ transactionId: 'pi_1' });
        fail('Expected error');
      } catch (err: any) {
        expect(err.isRetryable).toBe(true);
        expect(err.processor).toBe('stripe');
      }
    });

    it('treats StripeAuthenticationError as non-retryable', async () => {
      const authErr = new Error('Invalid API Key');
      (authErr as any).type = 'StripeAuthenticationError';
      (authErr as any).code = 'authentication_error';
      mockStripe.refunds.create.mockRejectedValue(authErr);

      try {
        await client.refund({ transactionId: 'pi_1' });
        fail('Expected error');
      } catch (err: any) {
        expect(err.isRetryable).toBe(false);
        expect(err.message).toBe('Stripe authentication failed');
      }
    });
  });
});
