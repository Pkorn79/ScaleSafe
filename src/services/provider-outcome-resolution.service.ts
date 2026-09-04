import { getSupabase } from '../clients/supabase.client';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export type ProviderOutcomeKind = 'money_operation' | 'refund_claim' | 'defense_submission' | 'billing_setup';
export type ProviderOutcomeResolution = 'provider_accepted' | 'not_processed';

export interface ProviderOutcomeResolutionInput {
  kind: ProviderOutcomeKind;
  id: string;
  resolution: ProviderOutcomeResolution;
  confirmation: string;
  providerReference?: string;
  responsePayload?: Record<string, unknown>;
  reconciliationPayload?: Record<string, unknown>;
  nextBillingDate?: string;
  adminLabel: string;
  ipAddress: string;
  userAgent: string;
}

const TARGETS: Record<ProviderOutcomeKind, {
  table: string;
  auditTarget: string;
  providerReferenceColumn: string;
  statusColumn: string;
  unresolvedStatus: string;
}> = {
  money_operation: {
    table: 'money_operations',
    auditTarget: 'money_operation',
    providerReferenceColumn: 'processor_reference',
    statusColumn: 'status',
    unresolvedStatus: 'unknown',
  },
  refund_claim: {
    table: 'payment_refund_claims',
    auditTarget: 'refund_claim',
    providerReferenceColumn: 'processor_refund_id',
    statusColumn: 'status',
    unresolvedStatus: 'unknown',
  },
  defense_submission: {
    table: 'defense_submission_claims',
    auditTarget: 'defense_submission',
    providerReferenceColumn: 'provider_reference',
    statusColumn: 'status',
    unresolvedStatus: 'unknown',
  },
  billing_setup: {
    table: 'enrollments',
    auditTarget: 'billing_setup',
    providerReferenceColumn: 'processor_subscription_id',
    statusColumn: 'billing_setup_status',
    unresolvedStatus: 'needs_reconciliation',
  },
};

function requiredConfirmation(resolution: ProviderOutcomeResolution): string {
  return resolution === 'provider_accepted'
    ? 'CONFIRM PROVIDER ACCEPTED'
    : 'CONFIRM NOT PROCESSED';
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateProviderOutcomeResolution(input: ProviderOutcomeResolutionInput): void {
  if (!TARGETS[input.kind]) throw new ValidationError('Unsupported provider outcome type.');
  if (!['provider_accepted', 'not_processed'].includes(input.resolution)) {
    throw new ValidationError('Resolution must be provider_accepted or not_processed.');
  }
  if (input.confirmation !== requiredConfirmation(input.resolution)) {
    throw new ValidationError(`Type ${requiredConfirmation(input.resolution)} to confirm this resolution.`);
  }
  if (input.resolution === 'provider_accepted' && !String(input.providerReference || '').trim()) {
    throw new ValidationError('A verified processor reference is required when the provider accepted the request.');
  }
  if (
    input.kind === 'billing_setup'
    && input.resolution === 'provider_accepted'
    && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.nextBillingDate || ''))
  ) {
    throw new ValidationError('A verified next billing date in YYYY-MM-DD format is required for an accepted subscription.');
  }
  if (input.responsePayload !== undefined && !plainObject(input.responsePayload)) {
    throw new ValidationError('responsePayload must be a JSON object.');
  }
  if (input.reconciliationPayload !== undefined && !plainObject(input.reconciliationPayload)) {
    throw new ValidationError('reconciliationPayload must be a JSON object.');
  }
}

async function strictAudit(input: {
  action: string;
  locationId: string;
  targetType: string;
  targetId: string;
  adminLabel: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getSupabase().from('hq_admin_audit_logs').insert({
    action: input.action,
    target_location_id: input.locationId,
    target_type: input.targetType,
    target_id: input.targetId,
    admin_label: input.adminLabel,
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    metadata: input.metadata,
  });
  if (error) throw new Error(`HQ audit log could not be written: ${error.message || String(error)}`);
}

function acceptedUpdates(
  kind: ProviderOutcomeKind,
  providerReference: string,
  responsePayload?: Record<string, unknown>,
  reconciliationPayload?: Record<string, unknown>,
  nextBillingDate?: string,
): Record<string, unknown> {
  const target = TARGETS[kind];
  if (kind === 'billing_setup') {
    return {
      billing_setup_status: 'ok',
      billing_setup_error: null,
      processor_subscription_id: providerReference,
      next_billing_date: nextBillingDate,
      next_billing_date_source: 'processor',
    };
  }
  return {
    status: 'provider_accepted',
    provider_called: true,
    [target.providerReferenceColumn]: providerReference,
    provider_accepted_at: new Date().toISOString(),
    error_message: null,
    ...(kind !== 'defense_submission' ? {
      reconciliation_lease_owner: null,
      reconciliation_lease_expires_at: null,
      reconciliation_next_attempt_at: null,
    } : {}),
    ...(kind === 'money_operation' && responsePayload ? { response_payload: responsePayload } : {}),
    ...(kind === 'money_operation' && reconciliationPayload ? { reconciliation_payload: reconciliationPayload } : {}),
  };
}

function notProcessedUpdates(kind: ProviderOutcomeKind): Record<string, unknown> {
  const target = TARGETS[kind];
  if (kind === 'billing_setup') {
    return {
      billing_setup_status: 'failed',
      billing_setup_error: 'HQ verified that the processor did not create the recurring subscription. Recurring billing requires repair.',
      processor_subscription_id: null,
      next_billing_date: null,
      next_billing_date_source: null,
    };
  }
  return {
    status: 'failed',
    provider_called: false,
    [target.providerReferenceColumn]: null,
    provider_started_at: null,
    provider_accepted_at: null,
    error_message: 'HQ verified that the provider did not process this request; an exact retry is permitted.',
    ...(kind !== 'defense_submission' ? {
      reconciliation_lease_owner: null,
      reconciliation_lease_expires_at: null,
      reconciliation_next_attempt_at: null,
    } : {}),
    ...(kind === 'money_operation' ? {
      response_payload: null,
      reconciliation_payload: null,
    } : {}),
  };
}

function dunningPaymentEventTarget(existing: Record<string, any>): {
  paymentEventId: string;
  merchantId: string;
  contactId: string | null;
} | null {
  if (existing.operation_type !== 'dunning_retry') return null;
  const request = plainObject(existing.request_payload) ? existing.request_payload : {};
  const paymentEventId = String(request.paymentEventId || '').trim();
  const merchantId = String(existing.merchant_id || '').trim();
  const contactId = String(request.contactId || '').trim() || null;
  if (!paymentEventId || !merchantId) {
    throw new Error('Dunning retry outcome is missing its tenant-scoped payment-event binding.');
  }
  return { paymentEventId, merchantId, contactId };
}

function unresolvedMoneyOperationUpdates(existing: Record<string, any>): Record<string, unknown> {
  return {
    status: existing.status,
    provider_called: existing.provider_called,
    processor_reference: existing.processor_reference,
    provider_started_at: existing.provider_started_at,
    provider_accepted_at: existing.provider_accepted_at,
    error_message: existing.error_message,
    reconciliation_lease_owner: existing.reconciliation_lease_owner,
    reconciliation_lease_expires_at: existing.reconciliation_lease_expires_at,
    reconciliation_next_attempt_at: existing.reconciliation_next_attempt_at,
    response_payload: existing.response_payload,
    reconciliation_payload: existing.reconciliation_payload,
  };
}

export const providerOutcomeResolutionService = {
  async resolve(input: ProviderOutcomeResolutionInput): Promise<Record<string, unknown>> {
    validateProviderOutcomeResolution(input);
    const target = TARGETS[input.kind];
    const supabase = getSupabase();

    const { data: existing, error: readError } = await supabase
      .from(target.table)
      .select('*')
      .eq('id', input.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) throw new NotFoundError('Provider outcome');
    const currentStatus = String(existing[target.statusColumn] || '');
    if (currentStatus !== target.unresolvedStatus) {
      throw new ConflictError(`Only an unresolved provider outcome can be resolved; current status is '${currentStatus}'.`);
    }

    if (
      input.kind === 'money_operation'
      && input.resolution === 'provider_accepted'
      && ['checkout_ach_intent', 'manual_sale_ach_intent'].includes(String(existing.operation_type || ''))
    ) {
      const response = input.responsePayload || {};
      if (!String(response.clientSecret || '').trim() || !String(response.paymentIntentId || '').trim()) {
        throw new ValidationError('Accepted ACH intent recovery requires responsePayload.clientSecret and responsePayload.paymentIntentId from Stripe.');
      }
      if (String(response.paymentIntentId) !== String(input.providerReference)) {
        throw new ValidationError('The ACH paymentIntentId must match the verified processor reference.');
      }
    }

    const locationId = String(existing.location_id || '');
    if (!locationId) throw new Error('Provider outcome has no tenant binding.');
    const providerReference = String(input.providerReference || '').trim();
    const dunningTarget = input.kind === 'money_operation' && input.resolution === 'not_processed'
      ? dunningPaymentEventTarget(existing as Record<string, any>)
      : null;

    await strictAudit({
      action: 'hq.provider_outcome_resolution_requested',
      locationId,
      targetType: target.auditTarget,
      targetId: input.id,
      adminLabel: input.adminLabel,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        resolution: input.resolution,
        prior_status: currentStatus,
        operation_type: existing.operation_type || null,
        processor: existing.processor_type || existing.processor || null,
        provider_reference: providerReference || null,
      },
    });

    const updates = input.resolution === 'provider_accepted'
      ? acceptedUpdates(input.kind, providerReference, input.responsePayload, input.reconciliationPayload, input.nextBillingDate)
      : notProcessedUpdates(input.kind);
    if (
      input.kind === 'refund_claim'
      && input.resolution === 'not_processed'
      && existing.claimed_by === 'query_url'
    ) {
      // HighLevel provides no refund-attempt ID, so Query URL refunds use a
      // durable request fingerprint. Clear it only after HQ has verified that
      // the provider did not process the request, permitting the exact retry.
      updates.request_fingerprint = null;
    }
    const { data: updated, error: updateError } = await supabase
      .from(target.table)
      .update(updates)
      .eq('id', input.id)
      .eq('location_id', locationId)
      .eq(target.statusColumn, target.unresolvedStatus)
      .select('*')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new ConflictError('Provider outcome changed before this resolution could be saved. Reload and review it again.');

    if (dunningTarget) {
      let paymentUpdate = supabase
        .from('payment_events')
        .update({ dunning_status: 'active' })
        .eq('id', dunningTarget.paymentEventId)
        .eq('merchant_id', dunningTarget.merchantId)
        .eq('location_id', locationId);
      if (dunningTarget.contactId) {
        paymentUpdate = paymentUpdate.eq('contact_id', dunningTarget.contactId);
      }
      const { data: resetPayment, error: resetError } = await paymentUpdate
        .eq('dunning_status', 'retrying')
        .select('id')
        .maybeSingle();
      if (resetError || !resetPayment) {
        const { data: restored, error: restoreError } = await supabase
          .from(target.table)
          .update(unresolvedMoneyOperationUpdates(existing as Record<string, any>))
          .eq('id', input.id)
          .eq('location_id', locationId)
          .eq(target.statusColumn, 'failed')
          .eq('provider_called', false)
          .select('id')
          .maybeSingle();
        if (restoreError || !restored) {
          throw new Error(`Dunning retry could not be reactivated and its outcome rollback failed: ${resetError?.message || 'payment event did not match'}; ${restoreError?.message || 'outcome did not match'}`);
        }
        if (resetError) throw resetError;
        throw new ConflictError('The tenant-scoped dunning payment event is no longer retrying. Reload and review it again.');
      }
    }

    const updatedRow = updated as Record<string, any>;
    try {
      await strictAudit({
        action: 'hq.provider_outcome_resolved',
        locationId,
        targetType: target.auditTarget,
        targetId: input.id,
        adminLabel: input.adminLabel,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: {
          resolution: input.resolution,
          resulting_status: updatedRow[target.statusColumn],
          provider_reference: providerReference || null,
        },
      });
    } catch (auditError: any) {
      // The mandatory pre-mutation audit already records the authorized action.
      // Do not tell the operator the state change failed after it succeeded.
      logger.error({ err: auditError?.message || String(auditError), id: input.id }, 'HQ provider outcome completion audit failed');
    }

    return {
      id: updatedRow.id,
      locationId: updatedRow.location_id,
      status: updatedRow[target.statusColumn],
      resolution: input.resolution,
    };
  },
};
