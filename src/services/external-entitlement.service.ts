export type ExternalCommerceEventType = 'purchase_paid' | 'subscription_created' | 'payment_succeeded'
  | 'payment_failed' | 'subscription_cancelled' | 'full_refund' | 'partial_refund' | 'dunning_exhausted';

export interface EntitlementPolicy {
  gracePeriodDays: number;
  revokeOnCancellation: boolean;
  revokeOnFullRefund: boolean;
  revokeOnDunningExhausted: boolean;
}

export interface EntitlementDecision {
  desiredState: 'active' | 'grace' | 'revoked' | null;
  reason: string;
  graceExpiresAt: string | null;
}

export function decideEntitlement(
  eventType: ExternalCommerceEventType,
  policy: EntitlementPolicy,
  occurredAt: string,
): EntitlementDecision {
  if (['purchase_paid', 'subscription_created', 'payment_succeeded'].includes(eventType)) {
    return { desiredState: 'active', reason: eventType, graceExpiresAt: null };
  }
  if (eventType === 'payment_failed') {
    const days = Math.max(0, Math.min(90, Math.round(policy.gracePeriodDays || 0)));
    return {
      desiredState: days > 0 ? 'grace' : null,
      reason: days > 0 ? 'payment_failed_grace' : 'payment_failed_no_automatic_revocation',
      graceExpiresAt: days > 0 ? new Date(new Date(occurredAt).getTime() + days * 86_400_000).toISOString() : null,
    };
  }
  if (eventType === 'partial_refund') {
    return { desiredState: null, reason: 'partial_refund_never_revokes', graceExpiresAt: null };
  }
  if (eventType === 'subscription_cancelled') {
    return { desiredState: policy.revokeOnCancellation ? 'revoked' : null, reason: 'subscription_cancelled', graceExpiresAt: null };
  }
  if (eventType === 'full_refund') {
    return { desiredState: policy.revokeOnFullRefund ? 'revoked' : null, reason: 'full_refund', graceExpiresAt: null };
  }
  return {
    desiredState: policy.revokeOnDunningExhausted ? 'revoked' : null,
    reason: 'dunning_exhausted',
    graceExpiresAt: null,
  };
}
