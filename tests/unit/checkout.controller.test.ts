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
    body,
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
              data: { business_name: 'Test Biz', default_processor: 'nmi' },
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

      // Verify charge was called with correct amount (cents)
      expect(mockProcessor.charge.mock.calls[0][0].amount).toBe(5000);

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
      };
      const merchant = { id: 'merch-1', location_id: 'loc-1' };

      mockGetMerchantByPublishableKey.mockResolvedValue(null);
      mockFrom.mockImplementation((table: string) => {
        if (table === 'offers_mirror') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: offer, error: null }),
            }),
          };
        }
        if (table === 'merchants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: merchant, error: null }),
              }),
            }),
          };
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

    it('verifies consent token before processing', async () => {
      // Mock enrollment lookup — consent not found
      mockFrom.mockReturnValue({
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
        consentToken: 'bad_token',
      });
      const res = mockRes();
      await processPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockProcessor.charge).not.toHaveBeenCalled();
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
