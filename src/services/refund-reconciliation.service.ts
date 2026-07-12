import { getSupabase } from '../clients/supabase.client';

export interface RefundReconciliationClaim {
  id: string;
  location_id: string;
  original_payment_event_id: string;
  amount_cents: number;
  status: 'provider_accepted';
  processor: string | null;
  processor_refund_id: string | null;
  reconciliation_attempts: number;
}

function migrationError(error: any): Error {
  if (
    error?.code === '42P01'
    || error?.code === '42883'
    || String(error?.message || '').includes('claim_refund_reconciliation_claims')
  ) {
    return new Error('Refund reconciliation safeguards are not installed. Apply migration 098.');
  }
  return error;
}

export const refundReconciliationService = {
  async claim(workerId: string, limit = 20): Promise<RefundReconciliationClaim[]> {
    const { data, error } = await getSupabase().rpc('claim_refund_reconciliation_claims', {
      p_limit: limit,
      p_worker_id: workerId,
      p_lease_seconds: 120,
    });
    if (error) throw migrationError(error);
    return (data || []) as RefundReconciliationClaim[];
  },

  async markRecorded(input: {
    claimId: string;
    locationId: string;
    workerId: string;
    refundPaymentEventId: string;
  }): Promise<void> {
    const { data, error } = await getSupabase()
      .from('payment_refund_claims')
      .update({
        status: 'recorded',
        refund_payment_event_id: input.refundPaymentEventId,
        recorded_at: new Date().toISOString(),
        reconciliation_lease_owner: null,
        reconciliation_lease_expires_at: null,
        reconciliation_next_attempt_at: null,
        error_message: null,
      })
      .eq('id', input.claimId)
      .eq('location_id', input.locationId)
      .eq('status', 'provider_accepted')
      .eq('reconciliation_lease_owner', input.workerId)
      .select('id')
      .maybeSingle();
    if (error) throw migrationError(error);
    if (!data) throw new Error('Refund reconciliation claim was not finalized');
  },

  async scheduleRetry(input: {
    claimId: string;
    locationId: string;
    workerId: string;
    attempt: number;
    error: string;
  }): Promise<void> {
    const delaySeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, input.attempt - 1)));
    const { error } = await getSupabase()
      .from('payment_refund_claims')
      .update({
        reconciliation_lease_owner: null,
        reconciliation_lease_expires_at: null,
        reconciliation_next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        error_message: `Local refund reconciliation failed: ${input.error}`,
      })
      .eq('id', input.claimId)
      .eq('location_id', input.locationId)
      .eq('status', 'provider_accepted')
      .eq('reconciliation_lease_owner', input.workerId);
    if (error) throw migrationError(error);
  },
};
