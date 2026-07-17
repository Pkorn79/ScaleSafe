const mockGetMerchantByPublishableKey = jest.fn();
const mockGetMerchantByApiKey = jest.fn();

jest.mock('../../src/services/payment-provider.service', () => ({
  paymentProviderService: {
    getMerchantByPublishableKey: mockGetMerchantByPublishableKey,
    getMerchantByApiKey: mockGetMerchantByApiKey,
  },
}));

const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: mockResolveProcessor,
  createProcessorClient: mockCreateProcessorClient,
}));

const mockListConfigs = jest.fn();
jest.mock('../../src/services/processor-config.service', () => ({
  processorConfigService: { listConfigs: mockListConfigs },
}));

const mockSaveOrReusePaymentMethod = jest.fn();
jest.mock('../../src/services/payment-methods.service', () => ({
  saveOrReusePaymentMethod: (...args: any[]) => mockSaveOrReusePaymentMethod(...args),
}));

const mockCheckoutCartQuote = jest.fn();
jest.mock('../../src/services/checkout-cart.service', () => ({
  checkoutCartService: {
    normalizeAddonIds: jest.fn((ids: any) => Array.isArray(ids) ? ids : []),
    selectedAddonIdsForConsent: jest.fn().mockResolvedValue([]),
    quoteOffer: (...args: any[]) => mockCheckoutCartQuote(...args),
  },
}));

const mockFireTrigger = jest.fn();
jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => mockFireTrigger(...args) },
}));

const mockMoneyBegin = jest.fn();
const mockMoneyMarkProviderStarted = jest.fn();
const mockMoneyMarkProviderAccepted = jest.fn();
const mockMoneyMarkRecorded = jest.fn();
const mockMoneyMarkUnknown = jest.fn();
jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    begin: (...args: any[]) => mockMoneyBegin(...args),
    markProviderStarted: (...args: any[]) => mockMoneyMarkProviderStarted(...args),
    markProviderAccepted: (...args: any[]) => mockMoneyMarkProviderAccepted(...args),
    markRecorded: (...args: any[]) => mockMoneyMarkRecorded(...args),
    markUnknown: (...args: any[]) => mockMoneyMarkUnknown(...args),
  },
}));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: '', publishableKey: 'pk_test_xxx', clientId: '', webhookSecret: '' },
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getCheckoutConfig, processPayment, saveCard } from '../../src/controllers/checkout.controller';
import { Request, Response } from 'express';

function mockReq(body: any = {}, query: any = {}): Request {
  return {
    body: { paymentAttemptId: 'attempt_test_1234567890', ...body },
    query,
    headers: { 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '127.0.0.1' },
    ip: '1.2.3.4',
  } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const MERCHANT = { merchantId: 'merch-1', locationId: 'loc-1' };

function supabaseSingle(data: any, error: any = null) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn().mockResolvedValue({ data, error }),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

const mockProcessor = {
  processorType: 'nmi',
  charge: jest.fn(),
  saveCard: jest.fn(),
  refund: jest.fn(),
  listCards: jest.fn(),
  chargeStoredCard: jest.fn(),
  createSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  verifyTransaction: jest.fn(),
  testConnection: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMerchantByPublishableKey.mockResolvedValue(MERCHANT);
  mockResolveProcessor.mockResolvedValue({
    processorType: 'nmi',
    config: { processor_type: 'nmi' },
  });
  mockCreateProcessorClient.mockReturnValue(mockProcessor);
  mockSaveOrReusePaymentMethod.mockResolvedValue({ id: 'card_1' });
  mockMoneyBegin.mockResolvedValue({ action: 'execute', operation: { id: 'money-op-1' } });
  mockMoneyMarkProviderAccepted.mockResolvedValue(undefined);
  mockMoneyMarkRecorded.mockResolvedValue(undefined);
  mockMoneyMarkUnknown.mockResolvedValue(undefined);
  mockCheckoutCartQuote.mockResolvedValue({
    selectedAmountCents: 5000,
    selectedAmount: 50,
    futureRecurringSelectedAmountCents: 5000,
    lineItems: [],
  });
  mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
  // Default: no consent token lookup, insert succeeds
  mockFrom.mockReturnValue({
    insert: jest.fn().mockResolvedValue({ error: null }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null }),
      }),
    }),
  });
});

describe('Checkout Controller', () => {
  describe('getCheckoutConfig', () => {
    it('returns NMI config with tokenization key', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { business_name: 'Test Biz LLC', dba_name: 'Test Biz', default_processor: 'nmi' },
            }),
          }),
        }),
      });
      mockListConfigs.mockResolvedValue([{
        processor_type: 'nmi',
        is_active: true,
        is_default: true,
        nmi_tokenization_key: 'tok_xxx',
      }]);
      mockResolveProcessor.mockResolvedValue({
        processorType: 'nmi',
        config: {
          processor_type: 'nmi',
          nmi_tokenization_key: 'tok_xxx',
        },
      });

      const req = mockReq({}, { publishableKey: 'pk_test' });
      const res = mockRes();
      await getCheckoutConfig(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.processorType).toBe('nmi');
      expect(result.nmiTokenizationKey).toBe('tok_xxx');
      expect(result.merchantName).toBe('Test Biz');
    });

    it('returns Stripe config with account ID and publishable key', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { business_name: 'Stripe Biz', default_processor: 'stripe' },
            }),
          }),
        }),
      });
      mockListConfigs.mockResolvedValue([{
        processor_type: 'stripe',
        is_active: true,
        is_default: true,
        stripe_user_id: 'acct_test1',
      }]);
      mockResolveProcessor.mockResolvedValue({
        processorType: 'stripe',
        config: {
          processor_type: 'stripe',
          stripe_user_id: 'acct_test1',
        },
      });

      const req = mockReq({}, { publishableKey: 'pk_test' });
      const res = mockRes();
      await getCheckoutConfig(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.processorType).toBe('stripe');
      expect(result.stripeAccountId).toBe('acct_test1');
      expect(result.stripePublishableKey).toBe('pk_test_xxx');
    });

    it('returns 404 for invalid publishable key', async () => {
      mockGetMerchantByPublishableKey.mockResolvedValue(null);
      const req = mockReq({}, { publishableKey: 'bad' });
      const res = mockRes();
      await getCheckoutConfig(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('processPayment', () => {
    it('processes NMI payment and creates transaction mapping + event', async () => {
      mockProcessor.charge.mockResolvedValue({
        success: true,
        transactionId: 'txn_123',
        chargeId: 'txn_123',
        status: 'approved',
      });

      const insertFn = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({
        insert: insertFn,
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_card',
        amount: 5000,
        currency: 'USD',
        contactId: 'c1',
        contactEmail: 'test@test.com',
        contactName: 'Jane Smith',
        transactionId: 'ghl_tx_1',
        orderId: 'order_1',
      });
      const res = mockRes();
      await processPayment(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.chargeId).toBe('txn_123');

      const paymentEventInsert = insertFn.mock.calls
        .map((call: any[]) => call[0])
        .find((record: any) => record?.event_type === 'sale');
      expect(paymentEventInsert).toEqual(expect.objectContaining({
        processor_transaction_id: 'txn_123',
        processor_charge_id: 'txn_123',
        payment_status: 'succeeded',
        consent_linked: false,
      }));
      expect(paymentEventInsert.settled_at).toEqual(expect.any(String));

      // Verify charge was called with correct amount (cents)
      expect(mockProcessor.charge.mock.calls[0][0].amount).toBe(5000);
      expect(mockProcessor.charge.mock.calls[0][0].idempotencyKey).toMatch(/^checkout-/);
      expect(mockMoneyBegin).toHaveBeenCalledWith(expect.objectContaining({
        operationType: 'checkout_charge',
        request: expect.objectContaining({ paymentAttemptId: 'attempt_test_1234567890' }),
      }));
      expect(mockMoneyBegin.mock.calls[0][0].request).not.toHaveProperty('paymentTokenFingerprint');

      // Verify CE 3.0 metadata
      const meta = mockProcessor.charge.mock.calls[0][0].metadata;
      expect(meta.customer_email).toBe('test@test.com');
      expect(meta.customer_ip).toBe('1.2.3.4');
    });

    it('rejects offer checkout when submitted amount does not match selected plan', async () => {
      const offer = {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Security Test Offer',
        price: 100,
        payment_type: 'pif',
        installment_amount: 25,
        pif_price: null,
        pif_discount_enabled: false,
        processor_override: null,
        nmi_processor_id: null,
        active: true,
      };
      const merchant = { id: 'merch-1', location_id: 'loc-1' };

      mockGetMerchantByPublishableKey.mockResolvedValue(null);
      mockFrom.mockImplementation((table: string) => {
        if (table === 'offers_mirror') {
          return supabaseSingle(offer);
        }
        if (table === 'merchants') {
          return supabaseSingle(merchant);
        }
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      });

      const req = mockReq({
        offerId: 'offer-1',
        paymentToken: 'tok_card',
        amount: 1,
        currency: 'USD',
        paymentChoice: 'pif',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Payment amount does not match selected offer',
      });
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });

    it('rejects a publishable key paired with an offer from another location', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'offers_mirror') return supabaseSingle(null, { code: 'PGRST116' });
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        offerId: 'offer-other-location',
        paymentToken: 'tok_card',
        amount: 10000,
        currency: 'USD',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Offer not found' });
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });

    it('verifies consent token before processing', async () => {
      // Mock enrollment lookup — consent not found
      mockFrom.mockReturnValue(supabaseSingle(null));

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_card',
        amount: 5000,
        currency: 'USD',
        contactId: 'c1',
        contactEmail: 'test@test.com',
        consentToken: 'bad_token',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });

    it('rejects a consent token bound to a different offer before charging', async () => {
      const offer = {
        id: 'offer-b',
        location_id: 'loc-1',
        offer_name: 'Cheaper Offer',
        price: 10,
        payment_type: 'pif',
        processor_override: null,
        nmi_processor_id: null,
        active: true,
      };
      mockFrom.mockImplementation((table: string) => {
        if (table === 'offers_mirror') return supabaseSingle(offer);
        if (table === 'enrollments') {
          return supabaseSingle({
            id: 'enrollment-a',
            status: 'consent_captured',
            offer_id: 'offer-a',
            payment_type: 'pif',
          });
        }
        return supabaseSingle(null);
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        offerId: 'offer-b',
        consentToken: 'consent-a',
        paymentToken: 'tok_card',
        amount: 1000,
        currency: 'USD',
        paymentChoice: 'pif',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Consent does not match the selected offer or payment option.',
      });
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });

    it('rejects a payment choice that differs from the consent record', async () => {
      const offer = {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Dual Offer',
        price: 100,
        payment_type: 'installments',
        installment_amount: 25,
        pif_price: 90,
        pif_discount_enabled: true,
        processor_override: null,
        nmi_processor_id: null,
        active: true,
      };
      mockFrom.mockImplementation((table: string) => {
        if (table === 'offers_mirror') return supabaseSingle(offer);
        if (table === 'enrollments') {
          return supabaseSingle({
            id: 'enrollment-1',
            status: 'consent_captured',
            offer_id: 'offer-1',
            payment_type: 'installment',
          });
        }
        return supabaseSingle(null);
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        offerId: 'offer-1',
        consentToken: 'consent-1',
        paymentToken: 'tok_card',
        amount: 9000,
        currency: 'USD',
        paymentChoice: 'pif',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });

    it('creates a completed PIF enrollment without recurring state when dual-option Quick Checkout selects paid in full', async () => {
      const offer = {
        id: 'offer-dual-quick',
        location_id: 'loc-1',
        offer_name: 'Dual Quick Checkout',
        active: true,
        price: 100,
        payment_type: 'installments',
        installment_amount: 25,
        installment_frequency: 'monthly',
        num_payments: 4,
        pif_price: 90,
        pif_discount_enabled: true,
        processor_override: null,
        nmi_processor_id: null,
      };
      mockCheckoutCartQuote.mockResolvedValue({
        selectedAmountCents: 9000,
        selectedAmount: 90,
        futureRecurringSelectedAmountCents: 2500,
        lineItems: [],
      });
      mockProcessor.charge.mockResolvedValue({
        success: true,
        transactionId: 'txn_dual_pif',
        chargeId: 'txn_dual_pif',
        status: 'approved',
      });

      const inserts: Array<{ table: string; payload: any }> = [];
      mockFrom.mockImplementation((table: string) => {
        let operation: 'select' | 'insert' | 'update' = 'select';
        let payload: any = null;
        const execute = async () => {
          if (operation === 'insert') {
            inserts.push({ table, payload });
            return {
              data: table === 'enrollments' ? { id: 'enr_dual_pif' } : null,
              error: null,
            };
          }
          if (table === 'offers_mirror') return { data: offer, error: null };
          return { data: null, error: null };
        };
        const builder: any = {
          select: jest.fn(() => builder),
          insert: jest.fn((value: any) => {
            operation = 'insert';
            payload = value;
            return builder;
          }),
          update: jest.fn((value: any) => {
            operation = 'update';
            payload = value;
            return builder;
          }),
          eq: jest.fn(() => builder),
          single: jest.fn(() => execute()),
          maybeSingle: jest.fn(() => execute()),
          then: (resolve: any, reject: any) => execute().then(resolve, reject),
        };
        return builder;
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        offerId: offer.id,
        paymentToken: 'tok_card',
        amount: 9000,
        currency: 'USD',
        contactId: 'contact_1',
        contactEmail: 'client@example.com',
        contactName: 'Client One',
        paymentChoice: 'pif',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(inserts).toContainEqual(expect.objectContaining({
        table: 'enrollments',
        payload: expect.objectContaining({
          payment_type: 'pif',
          payments_total: null,
          next_billing_date: null,
          billing_setup_status: 'ok',
        }),
      }));
      expect(inserts).toContainEqual(expect.objectContaining({
        table: 'payment_customer_map',
        payload: expect.objectContaining({
          offer_id: offer.id,
          program_name: 'Dual Quick Checkout',
          payment_type: 'pif',
        }),
      }));
      expect(mockProcessor.createSubscription).not.toHaveBeenCalled();
    });

    it('saves card when requested and payment succeeds', async () => {
      mockProcessor.charge.mockResolvedValue({
        success: true,
        transactionId: 'txn_1',
        status: 'approved',
      });
      mockProcessor.saveCard.mockResolvedValue({
        success: true,
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        cardLastFour: '4242',
        cardBrand: 'visa',
        cardExpMonth: 12,
        cardExpYear: 2027,
      });

      const insertFn = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({
        insert: insertFn,
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_card',
        amount: 1000,
        currency: 'USD',
        contactId: 'c1',
        contactEmail: 'test@test.com',
        saveCard: true,
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(mockProcessor.saveCard).toHaveBeenCalled();
    });

    it('returns error on declined card', async () => {
      mockProcessor.charge.mockResolvedValue({
        success: false,
        transactionId: '',
        status: 'declined',
        errorMessage: 'Card declined',
      });

      mockFrom.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_bad',
        amount: 500,
        currency: 'USD',
        contactId: 'c1',
        contactEmail: 't@t.com',
      });
      const res = mockRes();
      await processPayment(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(false);
      expect(result.error).toBe('Card declined');
      expect(result.paymentAttemptStatus).toBe('declined');
    });

    it('does not mark a processor-approved charge recorded when the payment ledger insert fails', async () => {
      mockProcessor.charge.mockResolvedValue({
        success: true,
        transactionId: 'txn_ledger_failure',
        chargeId: 'txn_ledger_failure',
        status: 'approved',
      });
      mockFrom.mockImplementation((table: string) => ({
        insert: jest.fn().mockResolvedValue({
          error: table === 'payment_events' ? { message: 'ledger unavailable' } : null,
        }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
      }));

      const req = mockReq({
        publishableKey: 'pk_test', paymentToken: 'tok_card', amount: 5000,
        currency: 'USD', contactId: 'c1', contactEmail: 'test@test.com', contactName: 'Jane Smith',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(mockMoneyMarkProviderAccepted).toHaveBeenCalledTimes(1);
      expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('keeps checkout provider-accepted when a created subscription id cannot be saved', async () => {
      const offer = {
        id: 'offer-recurring',
        location_id: 'loc-1',
        offer_name: 'Recurring Checkout',
        active: true,
        price: 100,
        installment_amount: 100,
        installment_frequency: 'monthly',
        payment_type: 'installments',
        num_payments: 3,
        processor_override: 'stripe',
        nmi_processor_id: null,
      };
      mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
      mockCheckoutCartQuote.mockResolvedValue({
        selectedAmountCents: 10000,
        selectedAmount: 100,
        futureRecurringSelectedAmountCents: 10000,
        lineItems: [],
      });
      mockProcessor.charge.mockResolvedValue({
        success: true,
        transactionId: 'pi_checkout_subscription_save_failure',
        chargeId: 'ch_checkout_subscription_save_failure',
        status: 'approved',
        vaultedCustomerId: 'cus_1',
        vaultedCardLastFour: '4242',
        vaultedCardBrand: 'visa',
      });
      mockProcessor.createSubscription.mockResolvedValue({
        success: true,
        subscriptionId: 'sub_checkout_not_saved',
        status: 'active',
      });

      let enrollmentInserted = false;
      mockFrom.mockImplementation((table: string) => {
        let operation: 'select' | 'insert' | 'update' = 'select';
        let payload: any = null;
        const execute = async () => {
          if (operation === 'update') {
            if (table === 'enrollments' && payload?.processor_subscription_id) {
              return { data: null, error: { message: 'subscription mapping unavailable' } };
            }
            return { data: null, error: null };
          }
          if (operation === 'insert') {
            if (table === 'enrollments') {
              enrollmentInserted = true;
              return { data: { id: 'enr_checkout_recurring' }, error: null };
            }
            return { data: null, error: null };
          }
          if (table === 'offers_mirror') return { data: offer, error: null };
          if (table === 'enrollments') {
            return {
              data: enrollmentInserted ? {
                id: 'enr_checkout_recurring',
                offer_id: offer.id,
                payment_type: 'installment',
                payments_total: 3,
                next_billing_date: '2026-08-12',
              } : null,
              error: null,
            };
          }
          return { data: null, error: null };
        };
        const builder: any = {
          select: jest.fn(() => builder),
          insert: jest.fn((value: any) => {
            operation = 'insert';
            payload = value;
            return builder;
          }),
          update: jest.fn((value: any) => {
            operation = 'update';
            payload = value;
            return builder;
          }),
          eq: jest.fn(() => builder),
          in: jest.fn(() => builder),
          or: jest.fn(() => builder),
          order: jest.fn(() => builder),
          limit: jest.fn(() => builder),
          single: jest.fn(() => execute()),
          maybeSingle: jest.fn(() => execute()),
          then: (resolve: any, reject: any) => execute().then(resolve, reject),
        };
        return builder;
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        offerId: offer.id,
        paymentToken: 'pm_card',
        amount: 10000,
        currency: 'USD',
        contactId: 'contact_1',
        contactEmail: 'client@example.com',
        contactName: 'Client One',
        paymentChoice: 'installments',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        subscriptionId: 'sub_checkout_not_saved',
        billingIssue: expect.objectContaining({ code: 'processor_subscription_save_failed' }),
      }));
      expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
      expect(mockMoneyMarkProviderAccepted).toHaveBeenLastCalledWith(expect.objectContaining({
        processorReference: 'pi_checkout_subscription_save_failure',
        reconciliationPayload: expect.objectContaining({
          processorSubscriptionId: 'sub_checkout_not_saved',
        }),
      }));
    });

    it('replays a completed checkout without calling the processor again', async () => {
      mockMoneyBegin.mockResolvedValue({
        action: 'replay',
        operation: { id: 'money-op-recorded', status: 'recorded' },
        response: { success: true, chargeId: 'txn_replayed', paymentStatus: 'succeeded', paymentMethod: 'card' },
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_card',
        amount: 5000,
        currency: 'USD',
        contactId: 'c1',
        contactEmail: 'test@test.com',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ chargeId: 'txn_replayed' }));
      expect(mockProcessor.charge).not.toHaveBeenCalled();
    });
  });

  describe('saveCard', () => {
    it('saves card and creates payment_methods record', async () => {
      mockProcessor.saveCard.mockResolvedValue({
        success: true,
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
        cardLastFour: '4242',
        cardBrand: 'visa',
        cardExpMonth: 12,
        cardExpYear: 2027,
      });

      mockFrom.mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const req = mockReq({
        publishableKey: 'pk_test',
        paymentToken: 'tok_card',
        contactId: 'c1',
        contactEmail: 'test@test.com',
        contactName: 'Jane',
      });
      const res = mockRes();
      await saveCard(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.paymentMethodId).toBe('pm_1');
    });

    it('returns 401 for invalid publishable key', async () => {
      mockGetMerchantByPublishableKey.mockResolvedValue(null);
      const req = mockReq({
        publishableKey: 'bad',
        paymentToken: 'tok',
        contactEmail: 'e@e.com',
      });
      const res = mockRes();
      await saveCard(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
