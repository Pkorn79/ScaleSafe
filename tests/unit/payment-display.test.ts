import {
  hasRemainingRecurringBilling,
  isScheduledBillingEnrollment,
  nextScheduledBilling,
  offerProcessorKey,
  offerProcessorLabel,
} from '../../src/ui/src/lib/paymentDisplay';

describe('payment display helpers', () => {
  const activeInstallment = {
    status: 'enrolled',
    paymentType: 'installments',
    billingSetupStatus: 'ok',
    paymentsMade: 1,
    paymentsTotal: 3,
    nextBillingDate: '2026-07-20',
    offerName: 'Program A',
  };

  it('shows only genuinely scheduled recurring billing', () => {
    expect(isScheduledBillingEnrollment(activeInstallment, '2026-07-14')).toBe(true);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, nextBillingDate: '2026-07-13' }, '2026-07-14')).toBe(false);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, paymentsMade: 3 }, '2026-07-14')).toBe(false);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, billingCompletedAt: '2026-07-14T12:00:00Z' }, '2026-07-14')).toBe(false);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, status: 'paused' }, '2026-07-14')).toBe(false);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, billingSetupStatus: 'failed' }, '2026-07-14')).toBe(false);
    expect(isScheduledBillingEnrollment({ ...activeInstallment, billingIssue: { code: 'missing_subscription' } }, '2026-07-14')).toBe(false);
  });

  it('does not treat fully paid installments as manageable recurring billing', () => {
    expect(hasRemainingRecurringBilling(activeInstallment)).toBe(true);
    expect(hasRemainingRecurringBilling({ ...activeInstallment, paymentsMade: 3 })).toBe(false);
    expect(hasRemainingRecurringBilling({ ...activeInstallment, billingCompletedAt: '2026-07-14T12:00:00Z' })).toBe(false);
    expect(hasRemainingRecurringBilling({ ...activeInstallment, paymentType: 'subscription', paymentsMade: 99, paymentsTotal: 99 })).toBe(true);
  });

  it('returns the nearest valid enrollment without borrowing a stale date', () => {
    const result = nextScheduledBilling([
      { ...activeInstallment, offerName: 'Stale Program', nextBillingDate: '2026-07-01' },
      { ...activeInstallment, offerName: 'Later Program', nextBillingDate: '2026-07-25' },
      { ...activeInstallment, offerName: 'Next Program', nextBillingDate: '2026-07-18' },
    ], '2026-07-14');

    expect(result?.offerName).toBe('Next Program');
  });

  it('labels hosted checkout channels before processor overrides', () => {
    expect(offerProcessorKey({ checkout_type: 'whop', processor_override: null })).toBe('whop');
    expect(offerProcessorLabel({ checkout_type: 'whop' })).toBe('Whop');
    expect(offerProcessorLabel({ checkout_type: 'direct', processor_override: 'nmi' })).toBe('NMI');
    expect(offerProcessorLabel({ checkout_type: 'direct', processor_override: null })).toBe('Account default');
  });
});
