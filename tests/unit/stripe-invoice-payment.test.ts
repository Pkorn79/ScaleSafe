import {
  stripeInvoiceIsFullyPaid,
  stripeInvoicePaymentReference,
} from '../../src/utils/stripe-invoice-payment';

describe('Stripe InvoicePayment helpers', () => {
  it('requires both paid status and zero remaining balance', () => {
    expect(stripeInvoiceIsFullyPaid({ status: 'paid', amount_remaining: 0 })).toBe(true);
    expect(stripeInvoiceIsFullyPaid({ status: 'open', amount_remaining: 0 })).toBe(false);
    expect(stripeInvoiceIsFullyPaid({ status: 'paid', amount_remaining: 1 })).toBe(false);
    expect(stripeInvoiceIsFullyPaid({ status: 'paid' })).toBe(false);
  });

  it('selects the most recently paid distinct InvoicePayment reference', () => {
    expect(stripeInvoicePaymentReference({
      id: 'in_1',
      payments: {
        data: [
          {
            id: 'inpay_older',
            status: 'paid',
            status_transitions: { paid_at: 100 },
            payment: { payment_intent: 'pi_older' },
          },
          {
            id: 'inpay_latest',
            status: 'paid',
            status_transitions: { paid_at: 200 },
            payment: { payment_intent: 'pi_latest' },
          },
        ],
      },
    })).toMatchObject({
      transactionId: 'pi_latest',
      invoicePaymentId: 'inpay_latest',
    });
  });
});
