const mockOAuthToken = jest.fn();
const mockOAuthDeauthorize = jest.fn();
const mockWebhookEndpointsCreate = jest.fn();
const mockWebhookEndpointsDel = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockProcessorUpdate = jest.fn();
const mockProcessorInsert = jest.fn();
const mockMerchantUpdate = jest.fn();

jest.mock('stripe', () => {
  return jest.fn(() => ({
    oauth: {
      token: mockOAuthToken,
      deauthorize: mockOAuthDeauthorize,
    },
    webhookEndpoints: {
      create: mockWebhookEndpointsCreate,
      del: mockWebhookEndpointsDel,
    },
    accounts: {
      retrieve: mockAccountsRetrieve,
    },
  }));
});

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_xxx', clientId: 'ca_test_client', webhookSecret: '', liveMode: false },
    ghl: { ssoKey: 'test-sso-key' },
    processorEncryptionKey: 'test-processor-encryption-key',
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent',
    isDev: true,
    isProd: false,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn((table: string) => {
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        maybeSingle: jest.fn().mockResolvedValue({
          data: table === 'processor_configs' ? { id: 'pc_1' } : null,
          error: null,
        }),
        update: jest.fn((payload: any) => {
          if (table === 'processor_configs') mockProcessorUpdate(payload);
          if (table === 'merchants') mockMerchantUpdate(payload);
          return chain;
        }),
        insert: jest.fn((payload: any) => {
          mockProcessorInsert(payload);
          return Promise.resolve({ error: null });
        }),
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return chain;
    }),
  })),
}));

import { stripeConnectService } from '../../src/services/stripe-connect.service';

describe('StripeConnectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateAuthUrl', () => {
    it('generates correct authorization URL', () => {
      const url = stripeConnectService.generateAuthUrl('loc_123', 'merchant@test.com');

      expect(url).toContain('https://connect.stripe.com/oauth/authorize');
      expect(url).toContain('client_id=ca_test_client');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=read_write');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state') || '';
      expect(stripeConnectService.parseCallbackState(state)).toBe('loc_123');
      expect(url).toContain('stripe_user%5Bemail%5D=merchant%40test.com');
    });

    it('generates URL without email prefill', () => {
      const url = stripeConnectService.generateAuthUrl('loc_456');

      const parsed = new URL(url);
      const state = parsed.searchParams.get('state') || '';
      expect(stripeConnectService.parseCallbackState(state)).toBe('loc_456');
      expect(url).not.toContain('stripe_user');
    });

    it('includes redirect_uri', () => {
      const url = stripeConnectService.generateAuthUrl('loc_789');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.scalesafe.com%2Fauth%2Fstripe%2Fcallback');
    });

    it('rejects tampered callback state', () => {
      const url = stripeConnectService.generateAuthUrl('loc_123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state') || '';

      expect(() => stripeConnectService.parseCallbackState(`${state}x`)).toThrow('state');
    });
  });

  describe('handleCallback', () => {
    it('exchanges code for stripe_user_id', async () => {
      mockOAuthToken.mockResolvedValue({
        stripe_user_id: 'acct_connected123',
        scope: 'read_write',
        livemode: false,
      });

      const result = await stripeConnectService.handleCallback('ac_code123', 'loc_123');

      expect(result.stripeUserId).toBe('acct_connected123');
      expect(result.scope).toBe('read_write');
      expect(result.livemode).toBe(false);

      expect(mockOAuthToken).toHaveBeenCalledWith({
        grant_type: 'authorization_code',
        code: 'ac_code123',
      });
    });

    it('throws if stripe_user_id is missing', async () => {
      mockOAuthToken.mockResolvedValue({ scope: 'read_write' });

      await expect(
        stripeConnectService.handleCallback('ac_bad', 'loc_1'),
      ).rejects.toThrow('stripe_user_id');
    });

    it('rejects an OAuth account returned in the wrong Stripe mode', async () => {
      mockOAuthToken.mockResolvedValue({
        stripe_user_id: 'acct_live_connected',
        scope: 'read_write',
        livemode: true,
      });

      await expect(
        stripeConnectService.handleCallback('ac_live_code', 'loc_1'),
      ).rejects.toMatchObject({ code: 'OAUTH_MODE_MISMATCH' });
      expect(mockWebhookEndpointsCreate).not.toHaveBeenCalled();
    });
  });

  describe('registerWebhooks', () => {
    it('creates webhook endpoint on connected account', async () => {
      mockWebhookEndpointsCreate.mockResolvedValue({ id: 'we_test1', secret: 'whsec_test1' });

      const webhook = await stripeConnectService.registerWebhooks(
        'acct_test1',
        'loc_123',
      );

      expect(webhook).toEqual({ endpointId: 'we_test1', signingSecret: 'whsec_test1' });

      const [params, opts] = mockWebhookEndpointsCreate.mock.calls[0];
      expect(params.url).toBe('https://app.scalesafe.com/webhooks/stripe/loc_123');
      expect(params.enabled_events).toEqual([
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
        'radar.early_fraud_warning.created',
        'payment_intent.processing',
        'payment_intent.payment_failed',
        'setup_intent.succeeded',
        'setup_intent.setup_failed',
        'charge.succeeded',
        'payment_intent.succeeded',
        'charge.refunded',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
        'customer.subscription.deleted',
        'customer.subscription.updated',
      ]);
      expect(opts.stripeAccount).toBe('acct_test1');
    });
  });

  describe('saveConnection', () => {
    it('persists the Stripe mode with the connected account', async () => {
      await stripeConnectService.saveConnection(
        'merchant_1',
        'loc_1',
        'acct_test1',
        false,
        'we_test1',
      );

      expect(mockProcessorUpdate).toHaveBeenCalledWith(expect.objectContaining({
        stripe_user_id: 'acct_test1',
        stripe_livemode: false,
        stripe_webhook_endpoint_id: 'we_test1',
      }));
      expect(mockMerchantUpdate).toHaveBeenCalledWith(expect.objectContaining({
        stripe_connected: true,
        stripe_user_id: 'acct_test1',
      }));
    });
  });

  describe('disconnect', () => {
    it('deauthorizes and removes webhook', async () => {
      mockWebhookEndpointsDel.mockResolvedValue({});
      mockOAuthDeauthorize.mockResolvedValue({});

      await stripeConnectService.disconnect('acct_test1', 'we_test1');

      expect(mockWebhookEndpointsDel).toHaveBeenCalledWith(
        'we_test1',
        { stripeAccount: 'acct_test1' },
      );
      expect(mockOAuthDeauthorize).toHaveBeenCalledWith({
        client_id: 'ca_test_client',
        stripe_user_id: 'acct_test1',
      });
    });

    it('continues if webhook deletion fails', async () => {
      mockWebhookEndpointsDel.mockRejectedValue(new Error('Not found'));
      mockOAuthDeauthorize.mockResolvedValue({});

      // Should not throw
      await stripeConnectService.disconnect('acct_test1', 'we_test1');
      expect(mockOAuthDeauthorize).toHaveBeenCalled();
    });
  });

  describe('verifyConnection', () => {
    it('returns valid with account name', async () => {
      mockAccountsRetrieve.mockResolvedValue({
        id: 'acct_test1',
        business_profile: { name: 'Test Biz' },
      });

      const result = await stripeConnectService.verifyConnection('acct_test1');
      expect(result.valid).toBe(true);
      expect(result.accountName).toBe('Test Biz');
    });

    it('returns invalid on error', async () => {
      mockAccountsRetrieve.mockRejectedValue(new Error('Invalid'));

      const result = await stripeConnectService.verifyConnection('acct_bad');
      expect(result.valid).toBe(false);
    });
  });
});
