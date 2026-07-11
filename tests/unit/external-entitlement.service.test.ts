import { decideEntitlement } from '../../src/services/external-entitlement.service';

const policy = {
  gracePeriodDays: 7,
  revokeOnCancellation: true,
  revokeOnFullRefund: true,
  revokeOnDunningExhausted: true,
};

describe('external entitlement policy', () => {
  it('grants access only from positive commerce truth', () => {
    expect(decideEntitlement('purchase_paid', policy, '2026-07-10T12:00:00Z')).toMatchObject({ desiredState: 'active' });
    expect(decideEntitlement('payment_succeeded', policy, '2026-07-10T12:00:00Z')).toMatchObject({ desiredState: 'active' });
  });

  it('uses grace rather than revocation after a first failed payment', () => {
    expect(decideEntitlement('payment_failed', policy, '2026-07-10T12:00:00Z')).toEqual({
      desiredState: 'grace',
      reason: 'payment_failed_grace',
      graceExpiresAt: '2026-07-17T12:00:00.000Z',
    });
  });

  it('never revokes automatically for a partial refund', () => {
    expect(decideEntitlement('partial_refund', policy, '2026-07-10T12:00:00Z')).toMatchObject({
      desiredState: null,
      reason: 'partial_refund_never_revokes',
    });
  });

  it('honors explicit cancellation, full-refund, and exhausted-dunning policy', () => {
    expect(decideEntitlement('subscription_cancelled', policy, '2026-07-10T12:00:00Z').desiredState).toBe('revoked');
    expect(decideEntitlement('full_refund', policy, '2026-07-10T12:00:00Z').desiredState).toBe('revoked');
    expect(decideEntitlement('dunning_exhausted', policy, '2026-07-10T12:00:00Z').desiredState).toBe('revoked');
  });
});
