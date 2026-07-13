import express from 'express';
import request from 'supertest';
import checkoutRoutes from '../../src/routes/checkout.routes';
import paymentUpdateRoutes from '../../src/routes/payment-update.routes';

jest.mock('../../src/controllers/checkout.controller', () => ({
  getCheckoutConfig: jest.fn(),
  getCheckoutConfigByOffer: jest.fn(),
  getCheckoutConfigByProduct: jest.fn(),
  getCheckoutQuote: jest.fn(),
  createStripeAchPaymentIntent: jest.fn(),
  finalizeStripeAchPayment: jest.fn(),
  createWhopCheckoutSession: jest.fn(),
  processPayment: jest.fn(),
  saveCard: jest.fn(),
}));

jest.mock('../../src/controllers/payment-update.controller', () => ({
  getPaymentUpdateConfig: jest.fn(),
  updatePaymentMethod: jest.fn(),
  cancelSubscriptionPublic: jest.fn(),
  getMilestoneConfig: jest.fn(),
  submitMilestoneSignoff: jest.fn(),
  getPulseCheckConfig: jest.fn(),
  submitPulseCheckin: jest.fn(),
}));

function app() {
  const server = express();
  server.use(checkoutRoutes);
  server.use(paymentUpdateRoutes);
  return server;
}

describe('public widget CSP', () => {
  const pages = [
    '/checkout',
    '/quick-checkout',
    '/payment-update',
    '/subscription-cancel',
    '/milestone-signoff',
    '/pulse-check',
  ];

  it.each(pages)('%s uses nonce-based scripts without unsafe inline handlers', async (path) => {
    const response = await request(app()).get(path).expect(200);
    const csp = response.header['content-security-policy'];

    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(response.text).toContain('<script nonce="');
    expect(response.text).not.toContain('onclick=');
  });

  it.each(['/checkout', '/quick-checkout'])('%s rotates attempt ids after a confirmed decline', async (path) => {
    const response = await request(app()).get(path).expect(200);

    expect(response.text).toContain("paymentAttemptStatus === 'declined'");
    expect(response.text).toContain('removeItem(');
  });

  it('binds quick-checkout attempts to the enrollment context and clears them after confirmed success', async () => {
    const response = await request(app()).get('/quick-checkout').expect(200);

    expect(response.text).toContain("consentToken || evidenceContextToken || ''");
    expect(response.text).toContain('clearCheckoutPaymentAttempt(paymentAttemptScope);');
    expect(response.text.lastIndexOf('clearCheckoutPaymentAttempt(paymentAttemptScope);'))
      .toBeGreaterThan(response.text.indexOf('// Success'));
  });
});
