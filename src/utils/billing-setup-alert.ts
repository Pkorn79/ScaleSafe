export function billingSetupAlert(enrollment: any, now = new Date()): {
  title: string; detail: string; escalated: boolean; uncertain: boolean;
} | null {
  if (!['enrolled', 'active', 'paused', 'paid_pending_enrollment', 'billing_setup_failed'].includes(enrollment.status)) return null;
  if (!['installment', 'installments', 'subscription'].includes(enrollment.payment_type)) return null;
  if (enrollment.billing_completed_at || (enrollment.payment_type !== 'subscription'
    && Number(enrollment.payments_total) > 0
    && Number(enrollment.payments_made) >= Number(enrollment.payments_total))) return null;
  const status = enrollment.billing_setup_status;
  if (!['failed', 'pending', 'needs_reconciliation'].includes(status)) return null;
  const started = Date.parse(enrollment.enrolled_at || enrollment.created_at || '');
  const age = Number.isFinite(started) ? now.getTime() - started : Infinity;
  if (status === 'pending' && age < 15 * 60_000) return null;
  const uncertain = status !== 'failed' || Boolean(enrollment.processor_subscription_id);
  const escalated = uncertain || age >= 24 * 60 * 60_000;
  return {
    title: `${escalated ? 'Escalated: ' : ''}automatic billing ${uncertain ? 'unconfirmed' : 'not established'}`,
    detail: uncertain
      ? 'Payment was received, but automatic billing must be verified at the processor. Do not create another schedule or charge again before reconciliation.'
      : 'Payment was received, but future payments are not scheduled. Billing setup remains unresolved and requires merchant/HQ review.',
    escalated, uncertain,
  };
}
