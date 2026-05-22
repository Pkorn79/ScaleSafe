// Mock dependencies before imports
const mockGetMerchantByApiKey = jest.fn();
const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();

jest.mock('../../src/services/payment-provider.service', () => ({
  paymentProviderService: { getMerchantByApiKey: mockGetMerchantByApiKey },
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: mockResolveProcessor,
  createProcessorClient: mockCreateProcessorClient,
}));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/config', () => ({
  config: {
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { handleQueryUrl } from '../../src/controllers/query-url.controller';
import { Request, Response } from 'express';

function mockReq(body: any): Request {
  return { body } as Request;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

const MERCHANT = { merchantId: 'merch-1', locationId: 'loc-1' };

const mockProcessor = {
  verifyTransaction: jest.fn(),
  listCards: jest.fn(),
  chargeStoredCard: jest.fn(),
  createSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  refund: jest.fn(),
};

function mockRefundTables(mapping: any, originalPayment: any = { id: 'pe_original', amount: 100 }, priorRefunds: any[] = []) {
  const refundInsert = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'transaction_mappings') {
      return {
        select: jest.fn().mockReturnValue({
          or: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mapping }),
            }),
          }),
        }),
      };
    }

    if (table === 'payment_events') {
      return {
        insert: refundInsert,
        select: jest.fn((columns: string) => {
          if (columns === 'id, amount') {
            const chain: any = {};
            chain.eq = jest.fn().mockReturnValue(chain);
            chain.in = jest.fn().mockReturnValue(chain);
            chain.order = jest.fn().mockReturnValue(chain);
            chain.limit = jest.fn().mockReturnValue(chain);
            chain.maybeSingle = jest.fn().mockResolvedValue({ data: originalPayment, error: null });
            return chain;
          }
          return {
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: priorRefunds, error: null }),
              }),
            }),
          };
        }),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });
  return refundInsert;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMerchantByApiKey.mockResolvedValue(MERCHANT);
  mockResolveProcessor.mockResolvedValue({ processorType: 'nmi', config: { processor_type: 'nmi' } });
  mockCreateProcessorClient.mockReturnValue(mockProcessor);
});

describe('queryUrl Controller', () => {
  describe('authentication', () => {
    it('returns 401 for missing apiKey', async () => {
      const req = mockReq({ type: 'verify' });
      const res = mockRes();
      await handleQueryUrl(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 for invalid apiKey', async () => {
      mockGetMerchantByApiKey.mockResolvedValue(null);
      const req = mockReq({ type: 'verify', apiKey: 'bad_key' });
      const res = mockRes();
      await handleQueryUrl(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('unknown type', () => {
    it('returns 400 for unknown operation type', async () => {
      const req = mockReq({ type: 'unknown_op', apiKey: 'valid' });
      const res = mockRes();
      await handleQueryUrl(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('verify', () => {
    it('returns success:true for settled transaction', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { processor_transaction_id: 'txn_1', processor_type: 'nmi' },
              }),
            }),
          }),
        }),
      });

      mockProcessor.verifyTransaction.mockResolvedValue({
        success: true, status: 'settled', amount: 5000,
      });

      const req = mockReq({ type: 'verify', apiKey: 'valid', chargeId: 'ch_1' });
      const res = mockRes();
      await handleQueryUrl(req, res);
      expect(mockResolveProcessor).toHaveBeenCalledWith('merch-1', 'loc-1', {
        processor_override: 'nmi',
        nmi_processor_id: null,
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('list_payment_methods', () => {
    it('returns formatted card list', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{
                id: 'pm-1',
                card_brand: 'visa',
                card_last_four: '4242',
                card_exp_month: 12,
                card_exp_year: 2027,
                nmi_customer_vault_id: 'vault_1',
                stripe_customer_id: null,
              }],
            }),
          }),
        }),
      });

      const req = mockReq({ type: 'list_payment_methods', apiKey: 'valid', contactId: 'contact-1' });
      const res = mockRes();
      await handleQueryUrl(req, res);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('card');
      expect(result[0].title).toBe('Visa');
      expect(result[0].subTitle).toBe('**** **** **** 4242');
      expect(result[0].expiry).toBe('12/27');
      expect(result[0].customerId).toBe('vault_1');
      expect(result[0].imageUrl).toContain('visa.svg');
    });

    it('returns empty array when no payment methods', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      });

      const req = mockReq({ type: 'list_payment_methods', apiKey: 'valid', contactId: 'c1' });
      const res = mockRes();
      await handleQueryUrl(req, res);
      expect(res.json).toHaveBeenCalledWith([]);
    });
  });

  describe('charge_payment', () => {
    it('converts dollars to cents and returns chargeSnapshot', async () => {
      // Mock payment_methods lookup
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payment_methods') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { nmi_customer_vault_id: 'vault_1', stripe_customer_id: null },
                  }),
                }),
              }),
            }),
          };
        }
        // transaction_mappings insert
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      });

      mockProcessor.chargeStoredCard.mockResolvedValue({
        success: true,
        transactionId: 'txn_1',
        chargeId: 'ch_1',
        status: 'approved',
      });

      const req = mockReq({
        type: 'charge_payment',
        apiKey: 'valid',
        paymentMethodId: 'pm-1',
        contactId: 'c1',
        transactionId: 'ghl_tx_1',
        chargeDescription: 'Invoice - 1',
        amount: 100.00,
        currency: 'USD',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      // Verify dollars → cents conversion
      const chargeCall = mockProcessor.chargeStoredCard.mock.calls[0];
      expect(chargeCall[2].amount).toBe(10000); // $100.00 → 10000 cents

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.chargeSnapshot.amount).toBe(100.00); // cents → dollars in response
      expect(result.chargeSnapshot.status).toBe('succeeded');
    });
  });

  describe('create_subscription', () => {
    it('parses productDetails for interval and totalCycles', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payment_methods') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { nmi_customer_vault_id: 'vault_1', stripe_customer_id: null },
                  }),
                }),
              }),
            }),
          };
        }
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      });

      mockProcessor.createSubscription.mockResolvedValue({
        success: true,
        subscriptionId: 'sub_1',
        status: 'active',
        nextPaymentDate: '2026-11-03T00:00:00Z',
      });

      const req = mockReq({
        type: 'create_subscription',
        apiKey: 'valid',
        contactId: 'c1',
        paymentMethodId: 'pm-1',
        subscriptionId: 'ghl_sub_1',
        transactionId: 'ghl_tx_1',
        startDate: '2026-10-01',
        amount: 100.0,
        recurringAmount: '80.00',
        productDetails: [{
          name: 'Coaching Program',
          prices: [{
            type: 'recurring',
            amount: 80.0,
            recurring: { interval: 'month', intervalCount: 1 },
            totalCycles: 12,
          }],
        }],
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      // Verify subscription params
      const subCall = mockProcessor.createSubscription.mock.calls[0][0];
      expect(subCall.planAmount).toBe(8000); // $80.00 → 8000 cents
      expect(subCall.interval).toBe('monthly');
      expect(subCall.totalPayments).toBe(12);

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.subscription.subscriptionId).toBe('sub_1');
    });
  });

  describe('cancel_subscription', () => {
    it('cancels and returns status:canceled', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { processor_subscription_id: 'proc_sub_1', processor_type: 'nmi' },
              }),
            }),
          }),
        }),
      });

      mockProcessor.cancelSubscription.mockResolvedValue({ success: true });

      const req = mockReq({
        type: 'cancel_subscription',
        apiKey: 'valid',
        subscriptionId: 'ghl_sub_1',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      expect(mockResolveProcessor).toHaveBeenCalledWith('merch-1', 'loc-1', {
        processor_override: 'nmi',
        nmi_processor_id: null,
      });
      expect(res.json).toHaveBeenCalledWith({ status: 'canceled' });
    });

    it('uses the mapped Stripe processor when canceling a Stripe subscription', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { processor_subscription_id: 'stripe_sub_1', processor_type: 'stripe' },
              }),
            }),
          }),
        }),
      });

      mockProcessor.cancelSubscription.mockResolvedValue({ success: true });

      const req = mockReq({
        type: 'cancel_subscription',
        apiKey: 'valid',
        subscriptionId: 'ghl_sub_1',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      expect(mockResolveProcessor).toHaveBeenCalledWith('merch-1', 'loc-1', {
        processor_override: 'stripe',
        nmi_processor_id: null,
      });
      expect(mockProcessor.cancelSubscription).toHaveBeenCalledWith('stripe_sub_1');
      expect(res.json).toHaveBeenCalledWith({ status: 'canceled' });
    });
  });

  describe('refund', () => {
    it('converts dollars to cents for refund', async () => {
      const refundInsert = mockRefundTables({
        processor_transaction_id: 'txn_1',
        processor_type: 'nmi',
        contact_id: 'contact_1',
      });

      mockProcessor.refund.mockResolvedValue({
        success: true,
        refundId: 'ref_1',
        amount: 5000,
        status: 'refunded',
      });

      const req = mockReq({
        type: 'refund',
        apiKey: 'valid',
        amount: 50.00,
        chargeId: 'ch_1',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      expect(mockResolveProcessor).toHaveBeenCalledWith('merch-1', 'loc-1', {
        processor_override: 'nmi',
        nmi_processor_id: null,
      });
      // Verify dollars → cents
      expect(mockProcessor.refund.mock.calls[0][0].amount).toBe(5000);
      expect(refundInsert).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'refund',
        processor: 'nmi',
        processor_transaction_id: 'ref_1',
        amount: 50,
        raw_webhook_payload: expect.objectContaining({
          original_processor_transaction_id: 'txn_1',
        }),
      }));

      const result = (res.json as jest.Mock).mock.calls[0][0];
      expect(result.success).toBe(true);
      expect(result.amount).toBe(50.00);
    });

    it('uses the mapped Stripe processor when refunding a Stripe transaction', async () => {
      mockRefundTables({
        processor_transaction_id: 'stripe_txn_1',
        processor_type: 'stripe',
        contact_id: 'contact_1',
      });

      mockProcessor.refund.mockResolvedValue({
        success: true,
        refundId: 'ref_1',
        amount: 2500,
        status: 'refunded',
      });

      const req = mockReq({
        type: 'refund',
        apiKey: 'valid',
        amount: 25.00,
        chargeId: 'ch_1',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      expect(mockResolveProcessor).toHaveBeenCalledWith('merch-1', 'loc-1', {
        processor_override: 'stripe',
        nmi_processor_id: null,
      });
      expect(mockProcessor.refund).toHaveBeenCalledWith({
        transactionId: 'stripe_txn_1',
        amount: 2500,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Refund successful',
        id: 'ref_1',
        amount: 25.00,
        currency: 'USD',
      });
    });

    it('rejects refunds above the remaining refundable balance', async () => {
      mockRefundTables({
        processor_transaction_id: 'txn_1',
        processor_type: 'nmi',
        contact_id: 'contact_1',
      }, { id: 'pe_original', amount: 100 }, [{ amount: 80 }]);

      const req = mockReq({
        type: 'refund',
        apiKey: 'valid',
        amount: 25.00,
        chargeId: 'ch_1',
      });
      const res = mockRes();
      await handleQueryUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Refund amount exceeds remaining refundable balance',
      });
      expect(mockProcessor.refund).not.toHaveBeenCalled();
    });
  });
});
