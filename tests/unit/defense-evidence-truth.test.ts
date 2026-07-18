import { pulseExhibitSummary, reconcilePaymentLineItems } from '../../src/services/defense-exhibits.service';

test('pulse summaries append current follow-up truth even when a stale stored summary exists', () => {
  const summary = pulseExhibitSummary({
    checkin_date: '2026-07-07T22:00:00Z',
    sentiment_score: 3,
    feedback_text: 'Going well',
    follow_up_needed: true,
    follow_up_action: 'Merchant follow-up requested from pulse check-in',
    defense_summary: 'The client submitted a pulse check-in and reported no concerns.',
  });

  expect(summary).toContain('reported no concerns');
  expect(summary).toContain('requested merchant follow-up');
  expect(summary).toContain('Merchant follow-up requested from pulse check-in');
});

test('payment line-item reconciliation identifies explained and unexplained totals', () => {
  expect(reconcilePaymentLineItems(2065, [
    { type: 'base_offer', amountCents: 200_000 },
    { type: 'dual_pricing_adjustment', amountCents: 6500 },
  ])).toEqual({ hasLineItems: true, lineItemTotal: 2065, difference: 0, reconciled: true, reconciledAsBankPrice: false });

  // Without the stored dual-pricing context, bank-price components still do
  // not reconcile to a card charge — the uplift is never assumed.
  expect(reconcilePaymentLineItems(2065, [
    { type: 'base_offer', amountCents: 200_000 },
  ])).toEqual({ hasLineItems: true, lineItemTotal: 2000, difference: 65, reconciled: false, reconciledAsBankPrice: false });
});
