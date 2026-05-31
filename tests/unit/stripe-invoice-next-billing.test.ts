import { stripeInvoiceNextBillingDate } from '../../src/controllers/stripe-webhook.controller';

describe('stripeInvoiceNextBillingDate', () => {
  it('returns the current-period end of a subscription-cycle invoice as YYYY-MM-DD', () => {
    // 2026-08-15T00:00:00Z = 1786752000 epoch seconds
    const invoice = { lines: { data: [{ period: { start: 1784073600, end: 1786752000 } }] } };
    expect(stripeInvoiceNextBillingDate(invoice)).toBe('2026-08-15');
  });

  it('uses the last line when an invoice has multiple lines', () => {
    const invoice = {
      lines: { data: [
        { period: { end: 1784073600 } }, // 2026-07-15
        { period: { end: 1786752000 } }, // 2026-08-15
      ] },
    };
    expect(stripeInvoiceNextBillingDate(invoice)).toBe('2026-08-15');
  });

  it('returns null when the invoice has no period end (caller falls back to estimate)', () => {
    expect(stripeInvoiceNextBillingDate({ lines: { data: [] } })).toBeNull();
    expect(stripeInvoiceNextBillingDate({})).toBeNull();
    expect(stripeInvoiceNextBillingDate({ lines: { data: [{ period: {} }] } })).toBeNull();
  });
});
