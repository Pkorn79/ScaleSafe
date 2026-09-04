export interface StripeInvoicePaymentReference {
  transactionId: string;
  invoicePaymentId: string | null;
  amountPaidCents: number | null;
}

function objectId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

export function stripeInvoiceIsFullyPaid(invoice: any): boolean {
  return invoice?.status === 'paid'
    && typeof invoice?.amount_remaining === 'number'
    && Number.isFinite(invoice.amount_remaining)
    && invoice.amount_remaining === 0;
}

/**
 * Basil removed Invoice.charge and Invoice.payment_intent. A paid
 * InvoicePayment is now the authoritative link to the underlying payment.
 */
export function stripeInvoicePaymentReference(invoice: any): StripeInvoicePaymentReference | null {
  const invoiceId = objectId(invoice?.id);
  const payments = Array.isArray(invoice?.payments?.data) ? invoice.payments.data : [];

  const paidPayments = payments
    .filter((invoicePayment: any) => invoicePayment?.status === 'paid')
    .sort((left: any, right: any) => {
      const leftPaidAt = Number(left?.status_transitions?.paid_at ?? left?.created ?? 0);
      const rightPaidAt = Number(right?.status_transitions?.paid_at ?? right?.created ?? 0);
      return rightPaidAt - leftPaidAt;
    });

  for (const invoicePayment of paidPayments) {

    const payment = invoicePayment?.payment || {};
    const transactionId = objectId(payment.payment_intent)
      || objectId(payment.charge)
      || objectId(payment.payment_record)
      || objectId(invoicePayment?.id);

    if (!transactionId || transactionId === invoiceId) continue;

    const amountPaid = invoicePayment?.amount_paid;
    return {
      transactionId,
      invoicePaymentId: objectId(invoicePayment?.id),
      amountPaidCents: typeof amountPaid === 'number' && Number.isFinite(amountPaid)
        ? amountPaid
        : null,
    };
  }

  return null;
}

export function stripeInvoiceSubscriptionId(invoice: any): string | null {
  return objectId(invoice?.parent?.subscription_details?.subscription)
    || objectId(invoice?.subscription);
}
