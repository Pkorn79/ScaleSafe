import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { ConflictError } from '../utils/errors';

export type MoneyOperationType =
  | 'checkout_charge'
  | 'checkout_ach_intent'
  | 'manual_sale_charge'
  | 'manual_sale_ach_intent'
  | 'query_url_charge'
  | 'query_url_subscription'
  | 'dunning_retry'
  | 'subscription_resume'
  | 'refund';

export interface MoneyOperationRecord {
  id: string;
  location_id: string;
  merchant_id: string | null;
  operation_type: MoneyOperationType;
  operation_key: string;
  request_fingerprint: string;
  request_payload: Record<string, unknown> | null;
  claimed_at?: string | null;
  status: 'processing' | 'provider_accepted' | 'recorded' | 'failed' | 'unknown';
  provider_called: boolean;
  processor_type: string | null;
  processor_reference: string | null;
  response_payload: Record<string, unknown> | null;
  reconciliation_payload: Record<string, unknown> | null;
  reconciliation_attempts: number;
  error_message: string | null;
  provider_started_at?: string | null;
}

export type MoneyOperationBeginResult =
  | { action: 'execute'; operation: MoneyOperationRecord }
  | { action: 'replay'; operation: MoneyOperationRecord; response: Record<string, unknown> }
  | { action: 'blocked'; operation: MoneyOperationRecord };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function requestFingerprint(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function operationUnavailable(error: any): Error {
  if (
    error?.code === '42P01'
    || error?.code === '42883'
    || String(error?.message || '').includes('money_operations')
    || String(error?.message || '').includes('claim_money_reconciliation_operations')
  ) {
    return new Error('Durable money-operation safeguards are not installed. Apply migration 098 before processing payments.');
  }
  return error;
}

export const moneyOperationService = {
  fingerprint: requestFingerprint,

  async begin(input: {
    locationId: string;
    merchantId?: string | null;
    operationType: MoneyOperationType;
    operationKey: string;
    request: unknown;
  }): Promise<MoneyOperationBeginResult> {
    const fingerprint = requestFingerprint(input.request);
    const row = {
      location_id: input.locationId,
      merchant_id: input.merchantId || null,
      operation_type: input.operationType,
      operation_key: input.operationKey,
      request_fingerprint: fingerprint,
      request_payload: canonicalize(input.request),
      status: 'processing',
      provider_called: false,
    };
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('money_operations')
      .insert(row)
      .select('*')
      .single();

    if (!error && data) return { action: 'execute', operation: data as MoneyOperationRecord };
    if (error?.code !== '23505') throw operationUnavailable(error);

    const { data: existing, error: existingError } = await supabase
      .from('money_operations')
      .select('*')
      .eq('location_id', input.locationId)
      .eq('operation_type', input.operationType)
      .eq('operation_key', input.operationKey)
      .maybeSingle();
    if (existingError) throw operationUnavailable(existingError);
    if (!existing) throw new ConflictError('Payment operation is already processing.');
    if (existing.request_fingerprint !== fingerprint) {
      throw new ConflictError('The payment operation key was reused with different request details.');
    }
    if (existing.status === 'recorded' && existing.response_payload) {
      return {
        action: 'replay',
        operation: existing as MoneyOperationRecord,
        response: existing.response_payload as Record<string, unknown>,
      };
    }
    const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : NaN;
    if (
      existing.status === 'processing'
      && !existing.provider_called
      && Number.isFinite(claimedAt)
      && claimedAt <= Date.now() - 5 * 60 * 1000
    ) {
      const reclaimedAt = new Date().toISOString();
      const { data: reclaimed, error: reclaimError } = await supabase
        .from('money_operations')
        .update({ claimed_at: reclaimedAt, error_message: null })
        .eq('id', existing.id)
        .eq('location_id', input.locationId)
        .eq('status', 'processing')
        .eq('provider_called', false)
        .eq('claimed_at', existing.claimed_at)
        .select('*')
        .maybeSingle();
      if (reclaimError) throw operationUnavailable(reclaimError);
      if (reclaimed) return { action: 'execute', operation: reclaimed as MoneyOperationRecord };
    }
    if (existing.status === 'failed' && !existing.provider_called) {
      const { data: retried, error: retryError } = await supabase
        .from('money_operations')
        .update({
          status: 'processing',
          error_message: null,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('location_id', input.locationId)
        .eq('status', 'failed')
        .eq('provider_called', false)
        .select('*')
        .maybeSingle();
      if (retryError) throw operationUnavailable(retryError);
      if (retried) return { action: 'execute', operation: retried as MoneyOperationRecord };
    }
    return { action: 'blocked', operation: existing as MoneyOperationRecord };
  },

  async markProviderAccepted(input: {
    id: string;
    locationId: string;
    processorType: string;
    processorReference?: string | null;
    response?: Record<string, unknown>;
    reconciliationPayload?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('money_operations')
      .update({
        status: 'provider_accepted',
        provider_called: true,
        processor_type: input.processorType,
        processor_reference: input.processorReference || null,
        response_payload: input.response || null,
        reconciliation_payload: input.reconciliationPayload || null,
        provider_accepted_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', input.id)
      .eq('location_id', input.locationId);
    if (error) throw operationUnavailable(error);
  },

  /**
   * Persist the ambiguous boundary before an external money call. If the
   * process exits after the provider receives the request, the operation is
   * visibly blocked for reconciliation instead of looking safe to retry.
   */
  async markProviderStarted(input: {
    id: string;
    locationId: string;
    processorType: string;
  }): Promise<void> {
    const { data, error } = await getSupabase()
      .from('money_operations')
      .update({
        status: 'unknown',
        provider_called: true,
        processor_type: input.processorType,
        provider_started_at: new Date().toISOString(),
        error_message: 'Processor request started; awaiting confirmed result.',
      })
      .eq('id', input.id)
      .eq('location_id', input.locationId)
      .eq('status', 'processing')
      .eq('provider_called', false)
      .select('id')
      .maybeSingle();
    if (error) throw operationUnavailable(error);
    if (!data) throw new ConflictError('Payment operation is no longer available for processor execution.');
  },

  async markRecorded(input: {
    id: string;
    locationId: string;
    response: Record<string, unknown>;
    processorType?: string;
    processorReference?: string | null;
    providerCalled?: boolean;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('money_operations')
      .update({
        status: 'recorded',
        response_payload: input.response,
        recorded_at: new Date().toISOString(),
        reconciled_at: new Date().toISOString(),
        reconciliation_lease_owner: null,
        reconciliation_lease_expires_at: null,
        reconciliation_next_attempt_at: null,
        ...(input.processorType ? { processor_type: input.processorType } : {}),
        ...(input.processorReference !== undefined ? { processor_reference: input.processorReference } : {}),
        ...(input.providerCalled !== undefined ? { provider_called: input.providerCalled } : {}),
        error_message: null,
      })
      .eq('id', input.id)
      .eq('location_id', input.locationId);
    if (error) throw operationUnavailable(error);
  },

  async markUnknown(input: {
    id: string;
    locationId: string;
    processorType?: string;
    error: string;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('money_operations')
      .update({
        status: 'unknown',
        provider_called: true,
        processor_type: input.processorType || null,
        error_message: input.error,
      })
      .eq('id', input.id)
      .eq('location_id', input.locationId);
    if (error) throw operationUnavailable(error);
  },

  async markFailedBeforeProvider(input: {
    id: string;
    locationId: string;
    error: string;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('money_operations')
      .update({ status: 'failed', provider_called: false, error_message: input.error })
      .eq('id', input.id)
      .eq('location_id', input.locationId)
      .eq('provider_called', false);
    if (error) throw operationUnavailable(error);
  },

  async claimReconciliation(workerId: string, limit = 20): Promise<MoneyOperationRecord[]> {
    const { data, error } = await getSupabase().rpc('claim_money_reconciliation_operations', {
      p_limit: limit,
      p_worker_id: workerId,
      p_lease_seconds: 120,
    });
    if (error) throw operationUnavailable(error);
    return (data || []) as MoneyOperationRecord[];
  },

  async scheduleReconciliationRetry(input: {
    id: string;
    locationId: string;
    workerId: string;
    attempt: number;
    error: string;
  }): Promise<void> {
    const delaySeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, input.attempt - 1)));
    const { error } = await getSupabase()
      .from('money_operations')
      .update({
        reconciliation_lease_owner: null,
        reconciliation_lease_expires_at: null,
        reconciliation_next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        error_message: `Local reconciliation failed: ${input.error}`,
      })
      .eq('id', input.id)
      .eq('location_id', input.locationId)
      .eq('status', 'provider_accepted')
      .eq('reconciliation_lease_owner', input.workerId);
    if (error) throw operationUnavailable(error);
  },
};
