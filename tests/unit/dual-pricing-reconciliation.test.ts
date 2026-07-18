/**
 * Dual-pricing reconciliation tests (from the 2026-07-18 Oke test dispute).
 *
 * A card charge under dual pricing is recorded with bank-price components
 * ($2,000) while the processor charged the card price ($2,065). The
 * reconciler must recognize that pairing via the stored uplift or the
 * checkout pricing snapshot instead of emitting a false
 * "components do not reconcile" warning on the defense packet.
 */

import { reconcilePaymentLineItems } from '../../src/services/defense-exhibits.service';

const bankComponents = [
  { type: 'base_offer', label: "Oke's 2nd Offer test (One-Time Payment)", amountCents: 200000, amount: 2000 },
];

describe('reconcilePaymentLineItems', () => {
  it('reconciles when components match the charge exactly', () => {
    const result = reconcilePaymentLineItems(2000, bankComponents);
    expect(result.reconciled).toBe(true);
    expect(result.reconciledAsBankPrice).toBe(false);
    expect(result.lineItemTotal).toBe(2000);
  });

  it('reconciles a card charge against bank-price components via the stored uplift', () => {
    const result = reconcilePaymentLineItems(2065, bankComponents, {
      selectedPaymentMethod: 'card',
      cardUpliftPercent: 3.25,
    });
    expect(result.reconciled).toBe(true);
    expect(result.reconciledAsBankPrice).toBe(true);
  });

  it('reconciles via the checkout pricing snapshot when no uplift percent is stored', () => {
    const result = reconcilePaymentLineItems(2065, bankComponents, {
      selectedPaymentMethod: 'card',
      cardUpliftPercent: null,
      checkoutPricing: { bank_amount_cents: 200000, card_amount_cents: 206500 },
    });
    expect(result.reconciled).toBe(true);
    expect(result.reconciledAsBankPrice).toBe(true);
  });

  it('does not apply the uplift to an ACH charge', () => {
    const result = reconcilePaymentLineItems(2065, bankComponents, {
      selectedPaymentMethod: 'ach',
      cardUpliftPercent: 3.25,
    });
    expect(result.reconciled).toBe(false);
  });

  it('still flags a card charge whose amount matches neither price', () => {
    const result = reconcilePaymentLineItems(2100, bankComponents, {
      selectedPaymentMethod: 'card',
      cardUpliftPercent: 3.25,
      checkoutPricing: { bank_amount_cents: 200000, card_amount_cents: 206500 },
    });
    expect(result.reconciled).toBe(false);
    expect(result.difference).toBe(100);
  });

  it('never reconciles an uplift-only match when components already include the card-price row', () => {
    const fullCardComponents = [
      ...bankComponents,
      { type: 'dual_pricing_adjustment', label: 'Card price difference (3.25% above bank-transfer price)', amountCents: 6500, amount: 65 },
    ];
    const result = reconcilePaymentLineItems(2065, fullCardComponents, {
      selectedPaymentMethod: 'card',
      cardUpliftPercent: 3.25,
    });
    expect(result.reconciled).toBe(true);
    expect(result.reconciledAsBankPrice).toBe(false);
  });

  it('reports missing components without claiming reconciliation', () => {
    const result = reconcilePaymentLineItems(2065, []);
    expect(result.hasLineItems).toBe(false);
    expect(result.reconciled).toBe(false);
  });
});
