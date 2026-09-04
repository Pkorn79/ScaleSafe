/**
 * ALLOW_UNSIGNED_STRIPE_STATE turns the OAuth state into an unauthenticated
 * tenant selector (attacker binds their Stripe account to a victim location).
 * It exists for local development only and must be dead in production.
 */

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_live_x', clientId: 'ca_x', webhookSecret: '', liveMode: true },
    ghl: { ssoKey: 'sso' },
    processorEncryptionKey: 'test-processor-encryption-key',
    appUrl: 'https://app.scalesafe.com',
    nodeEnv: 'production',
    isProd: true,
    isDev: false,
    logLevel: 'silent',
  },
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(() => ({ from: jest.fn() })),
}));

import { stripeConnectService } from '../../src/services/stripe-connect.service';

describe('Stripe Connect OAuth state in production', () => {
  const prev = process.env.ALLOW_UNSIGNED_STRIPE_STATE;
  afterAll(() => {
    if (prev === undefined) delete process.env.ALLOW_UNSIGNED_STRIPE_STATE;
    else process.env.ALLOW_UNSIGNED_STRIPE_STATE = prev;
  });

  it('rejects unsigned state even when ALLOW_UNSIGNED_STRIPE_STATE is set', () => {
    process.env.ALLOW_UNSIGNED_STRIPE_STATE = 'true';
    expect(() => stripeConnectService.parseCallbackState('victimLocation123'))
      .toThrow(/Invalid Stripe OAuth state/);
  });
});
