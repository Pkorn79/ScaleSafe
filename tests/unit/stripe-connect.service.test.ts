const mockOAuthToken = jest.fn();
const mockOAuthDeauthorize = jest.fn();
const mockWebhookEndpointsCreate = jest.fn();
const mockWebhookEndpointsDel = jest.fn();
const mockAccountsRetrieve = jest.fn();

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
    stripe: { secretKey: 'sk_test_xxx', clientId: 'ca_test_client', webhookSecret: '' },
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
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(() => ({ data: {}, error: null })) })) })),
      update: jest.fn(() => ({ eq: jest.fn(() => ({ error: null })) })),
    })),
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
        livemode: true,
      });

      const result = await stripeConnectService.handleCallback('ac_code123', 'loc_123');

      expect(result.stripeUserId).toBe('acct_connected123');
      expect(result.scope).toBe('read_write');
      expect(result.livemode).toBe(true);

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
  });

  describe('registerWebhooks', () => {
    it('creates webhook endpoint on connected account', async () => {
      mockWebhookEndpointsCreate.mockResolvedValue({ id: 'we_test1' });

      const endpointId = await stripeConnectService.registerWebhooks(
        'acct_test1',
        'loc_123',
      );

      expect(endpointId).toBe('we_test1');

      const [params, opts] = mockWebhookEndpointsCreate.mock.calls[0];
      expect(params.url).toBe('https://app.scalesafe.com/webhooks/stripe/loc_123');
      expect(params.enabled_events).toContain('charge.dispute.created');
      expect(params.enabled_events).toContain('radar.early_fraud_warning.created');
      expect(opts.stripeAccount).toBe('acct_test1');
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
