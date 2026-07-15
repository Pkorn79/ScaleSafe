export interface BillingDisplayEnrollment {
  status?: string | null;
  paymentType?: string | null;
  billingSetupStatus?: string | null;
  billingCompletedAt?: string | null;
  billingIssue?: unknown;
  paymentsMade?: number | string | null;
  paymentsTotal?: number | string | null;
  nextBillingDate?: string | null;
  offerName?: string | null;
  installmentAmount?: number | string | null;
  paymentAmount?: number | string | null;
}

function normalizeDateOnly(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function localTodayDateOnly(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isScheduledBillingEnrollment(
  enrollment: BillingDisplayEnrollment,
  today = localTodayDateOnly(),
): boolean {
  const status = String(enrollment.status || '').toLowerCase();
  if (!['enrolled', 'active'].includes(status)) return false;

  const paymentType = String(enrollment.paymentType || '').toLowerCase();
  if (!['installment', 'installments', 'subscription'].includes(paymentType)) return false;

  const billingStatus = String(enrollment.billingSetupStatus || 'ok').toLowerCase();
  if (['failed', 'pending', 'needs_reconciliation'].includes(billingStatus)) return false;
  if (enrollment.billingCompletedAt || enrollment.billingIssue) return false;

  if (paymentType !== 'subscription') {
    const made = Number(enrollment.paymentsMade || 0);
    const total = Number(enrollment.paymentsTotal || 0);
    if (total > 0 && made >= total) return false;
  }

  const nextDate = normalizeDateOnly(enrollment.nextBillingDate);
  const todayDate = normalizeDateOnly(today);
  return Boolean(nextDate && todayDate && nextDate >= todayDate);
}

export function nextScheduledBilling<T extends BillingDisplayEnrollment>(
  enrollments: T[] | null | undefined,
  today = localTodayDateOnly(),
): T | null {
  return [...(enrollments || [])]
    .filter((enrollment) => isScheduledBillingEnrollment(enrollment, today))
    .sort((left, right) => {
      const dateOrder = normalizeDateOnly(left.nextBillingDate)
        .localeCompare(normalizeDateOnly(right.nextBillingDate));
      if (dateOrder !== 0) return dateOrder;
      return String(left.offerName || '').localeCompare(String(right.offerName || ''));
    })[0] || null;
}

export function offerProcessorKey(offer: Record<string, unknown>): 'nmi' | 'stripe' | 'whop' | 'fanbasis' | 'account_default' {
  const checkoutType = String(offer.checkout_type || offer.checkoutType || 'direct').toLowerCase();
  if (checkoutType === 'whop') return 'whop';
  if (checkoutType === 'fanbasis') return 'fanbasis';

  const override = String(offer.processor_override || offer.processorOverride || '').toLowerCase();
  if (override === 'nmi') return 'nmi';
  if (override === 'stripe') return 'stripe';
  return 'account_default';
}

export function offerProcessorLabel(offer: Record<string, unknown>): string {
  return ({
    nmi: 'NMI',
    stripe: 'Stripe',
    whop: 'Whop',
    fanbasis: 'FanBasis',
    account_default: 'Account default',
  } as const)[offerProcessorKey(offer)];
}
