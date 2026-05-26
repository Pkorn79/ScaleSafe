/**
 * Integration test: Payment flow — NMI and Stripe end-to-end.
 * Mocks external APIs (NMI, Stripe, Supabase) but tests internal service orchestration.
 */

// Mock Supabase before any imports
const mockSupabaseData: Record<string, any[]> = {};
const mockInsertedRows: Record<string, any[]> = {};

function resetStores() {
  Object.keys(mockSupabaseData).forEach(k => delete mockSupabaseData[k]);
  Object.keys(mockInsertedRows).forEach(k => delete mockInsertedRows[k]);
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => createMockTable(table),
  }),
}));

function createMockTable(table: string) {
  const rows = mockSupabaseData[table] || [];
  if (!mockInsertedRows[table]) mockInsertedRows[table] = [];

  return {
    select: (cols?: string) => createQuery(table, rows, 'select'),
    insert: (data: any) => {
      const row = { id: `mock_${table}_${Date.now()}`, created_at: new Date().toISOString(), ...data };
      if (!mockInsertedRows[table]) mockInsertedRows[table] = [];
      mockInsertedRows[table].push(row);
      return {
        select: () => ({
          single: () => ({ data: row, error: null }),
        }),
      };
    },
    update: (data: any) => createQuery(table, rows, 'update'),
    upsert: (data: any, _opts?: any) => {
      const row = { id: `mock_${table}_${Date.now()}`, ...data };
      if (!mockInsertedRows[table]) mockInsertedRows[table] = [];
      mockInsertedRows[table].push(row);
      return {
        select: () => ({
          single: () => ({ data: row, error: null }),
        }),
      };
    },
    delete: () => createQuery(table, rows, 'delete'),
  };
}

function createQuery(table: string, rows: any[], _op: string) {
  let filtered = [...rows];
  const chain: any = {
    eq: (col: string, val: any) => {
      filtered = filtered.filter(r => r[col] === val);
      return chain;
    },
    or: (_expr: string) => chain,
    order: (_col: string, _opts?: any) => chain,
    limit: (_n: number) => chain,
    single: () => ({ data: filtered[0] || null, error: filtered.length === 0 ? { message: 'not found' } : null }),
    then: (resolve: any, reject: any) => Promise.resolve({ data: filtered, error: null }).then(resolve, reject),
  };
  // For update/delete, return success
  if (_op === 'update' || _op === 'delete') {
    chain.single = () => ({ data: filtered[0] || null, error: null });
  }
  return chain;
}

// Mock axios (NMI calls)
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock stripe — shared mock instance so all StripeClient instances use same mock
const mockStripeInstance = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  refunds: { create: jest.fn() },
  customers: { list: jest.fn(), create: jest.fn() },
  paymentMethods: { attach: jest.fn(), retrieve: jest.fn(), list: jest.fn() },
  accounts: { retrieve: jest.fn() },
  prices: { create: jest.fn() },
  subscriptions: { create: jest.fn(), cancel: jest.fn() },
};

jest.mock('stripe', () => {
  return jest.fn(() => mockStripeInstance);
});

// Mock config
jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_fake', publishableKey: 'pk_test_fake', webhookSecret: 'whsec_fake', clientId: '' },
    appUrl: 'http://localhost:3000',
    processorEncryptionKey: 'a'.repeat(64),
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { NmiClient } from '../../src/clients/nmi.client';
import { StripeClient } from '../../src/clients/stripe.client';
import { resolveProcessor, createProcessorClient } from '../../src/services/processor.factory';

describe('Payment Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
  });

  describe('NMI End-to-End', () => {
    it('should charge via NMI and return approved result', async () => {
      // Mock NMI response (sale success)
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=txn_12345&response_code=100&avsresponse=Y&cvvresponse=M',
      });

      const nmiClient = new NmiClient({
        securityKey: 'test_security_key_12345',
        tokenizationKey: 'test_tok_key',
        processorId: undefined,
      });

      const result = await nmiClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'nmi_token_abc',
        description: 'Test charge',
        metadata: {
          customer_email: 'test@example.com',
          customer_ip: '1.2.3.4',
          first_name: 'John',
          last_name: 'Doe',
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      expect(result.transactionId).toBe('txn_12345');
      expect(result.avsResponse).toBe('Y');
      expect(result.cvvResponse).toBe('M');

      // Verify NMI was called with correct params
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://secure.nmi.com/api/transact.php',
        expect.any(String),
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it('should handle NMI declined card gracefully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=2&responsetext=DECLINE&transactionid=txn_99999&response_code=200',
      });

      const nmiClient = new NmiClient({
        securityKey: 'test_key_12345678',
        tokenizationKey: 'test_tok',
      });

      const result = await nmiClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'nmi_token_abc',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('declined');
      expect(result.errorMessage).toBe('DECLINE');
    });

    it('should process NMI refund successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=ref_12345',
      });

      const nmiClient = new NmiClient({
        securityKey: 'test_key_12345678',
        tokenizationKey: 'test_tok',
      });

      const result = await nmiClient.refund({
        transactionId: 'txn_12345',
        amount: 2500,
      });

      expect(result.success).toBe(true);
      expect(result.refundId).toBe('ref_12345');
      expect(result.status).toBe('refunded');
    });

    it('should include processor_id for multi-MID routing', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=txn_mid',
      });

      const nmiClient = new NmiClient({
        securityKey: 'test_key_12345678',
        tokenizationKey: 'test_tok',
        processorId: 'processor_abc',
      });

      await nmiClient.charge({
        amount: 10000,
        currency: 'usd',
        paymentToken: 'tok_abc',
      });

      const callBody = mockedAxios.post.mock.calls[0][1] as string;
      expect(callBody).toContain('processor_id=processor_abc');
    });

    it('should handle NMI network error with ProcessorError', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ECONNRESET'));

      const nmiClient = new NmiClient({
        securityKey: 'test_key_12345678',
        tokenizationKey: 'test_tok',
      });

      await expect(nmiClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'tok_abc',
      })).rejects.toThrow('NMI API request failed');
    });
  });

  describe('Stripe End-to-End', () => {
    it('should charge via Stripe and return approved result', async () => {
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_test_123',
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
        latest_charge: 'ch_test_123',
      });

      const stripeClient = new StripeClient({ stripeAccountId: 'acct_test_123' });

      const result = await stripeClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'pm_test_123',
        description: 'Test charge',
        metadata: {
          scalesafe_offer_id: 'offer_1',
          terms_accepted: 'true',
          terms_accepted_at: '2026-04-03T00:00:00Z',
          ce30_eligible: 'true',
          customer_ip: '1.2.3.4',
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('approved');
      expect(result.transactionId).toBe('pi_test_123');
      expect(result.chargeId).toBe('ch_test_123');
    });

    it('should handle Stripe 3DS required', async () => {
      mockStripeInstance.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_3ds_test',
        status: 'requires_action',
        amount: 5000,
        currency: 'usd',
        latest_charge: null,
        next_action: {
          redirect_to_url: { url: 'https://stripe.com/3ds' },
        },
      });

      const stripeClient = new StripeClient({ stripeAccountId: 'acct_test_123' });

      const result = await stripeClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'pm_3ds_test',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending_3ds');
      expect(result.threeDSecureUrl).toBe('https://stripe.com/3ds');
    });

    it('should handle Stripe card declined error', async () => {
      const declineError = new Error('Your card was declined') as any;
      declineError.type = 'StripeCardError';
      declineError.code = 'card_declined';

      mockStripeInstance.paymentIntents.create.mockRejectedValueOnce(declineError);

      const stripeClient = new StripeClient({ stripeAccountId: 'acct_test_123' });

      const result = await stripeClient.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: 'pm_declined',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('declined');
      expect(result.errorMessage).toBe('Your card was declined');
    });
  });

  describe('Processor Switching', () => {
    it('should use offer-level processor override when set', async () => {
      // Set up mock data: merchant with both processors
      mockSupabaseData['merchants'] = [
        { id: 'merchant_1', default_processor: 'nmi' },
      ];
      mockSupabaseData['processor_configs'] = [
        {
          id: 'config_stripe',
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor_type: 'stripe',
          is_active: true,
          is_default: true,
          stripe_user_id: 'acct_test',
        },
      ];

      const { processorType } = await resolveProcessor(
        'merchant_1',
        'loc_1',
        { processor_override: 'stripe', nmi_processor_id: null },
      );

      expect(processorType).toBe('stripe');
    });

    it('should fall back to merchant default when offer has no override', async () => {
      mockSupabaseData['merchants'] = [
        { id: 'merchant_1', default_processor: 'nmi' },
      ];
      mockSupabaseData['processor_configs'] = [
        {
          id: 'config_nmi',
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor_type: 'nmi',
          is_active: true,
          is_default: true,
          nmi_security_key_encrypted: 'fake_enc',
          nmi_tokenization_key: 'tok_key',
        },
      ];

      const { processorType } = await resolveProcessor(
        'merchant_1',
        'loc_1',
        { processor_override: null, nmi_processor_id: null },
      );

      expect(processorType).toBe('nmi');
    });

    it('should throw when no processor is configured', async () => {
      mockSupabaseData['merchants'] = [
        { id: 'merchant_1', default_processor: null },
      ];
      mockSupabaseData['processor_configs'] = [];

      await expect(resolveProcessor('merchant_1', 'loc_1')).rejects.toThrow(
        'No processor configured',
      );
    });

    it('should not guess a config when multiple configs share one processor type and no default is set', async () => {
      mockSupabaseData['merchants'] = [
        { id: 'merchant_1', default_processor: null },
      ];
      mockSupabaseData['processor_configs'] = [
        {
          id: 'config_nmi_a',
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor_type: 'nmi',
          is_active: true,
          is_default: false,
        },
        {
          id: 'config_nmi_b',
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor_type: 'nmi',
          is_active: true,
          is_default: false,
        },
      ];

      await expect(resolveProcessor('merchant_1', 'loc_1')).rejects.toThrow(
        'Multiple active processor configs found',
      );
    });

    it('should not use the first active config when the default row is missing', async () => {
      mockSupabaseData['merchants'] = [
        { id: 'merchant_1', default_processor: 'nmi' },
      ];
      mockSupabaseData['processor_configs'] = [
        {
          id: 'config_nmi',
          merchant_id: 'merchant_1',
          location_id: 'loc_1',
          processor_type: 'nmi',
          is_active: true,
          is_default: false,
        },
      ];

      await expect(resolveProcessor('merchant_1', 'loc_1')).rejects.toThrow(
        'No default active nmi configuration found',
      );
    });
  });
});
