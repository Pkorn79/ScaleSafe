import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import { moneyOperationService, type MoneyOperationRecord } from './money-operation.service';
import { paymentLifecycleService } from './payment-lifecycle.service';
import {
  refundReconciliationService,
  type RefundReconciliationClaim,
} from './refund-reconciliation.service';
import { AdaptivePoller } from '../utils/adaptive-poller';
import { commandCenterHealthService } from './command-center-health.service';
import { triggerDeliveryJobService } from './trigger-delivery-job.service';
import { evidenceService } from './evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS, WORKFLOW_PAYMENT_CONTACT_FIELDS } from '../constants/ghl-fields';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { formatMoney } from '../utils/offer-display';

const workerId = `money_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
let running = false;

function request(operation: MoneyOperationRecord): Record<string, any> {
  return (operation.request_payload || {}) as Record<string, any>;
}

function reconciliation(operation: MoneyOperationRecord): Record<string, any> {
  return (operation.reconciliation_payload || {}) as Record<string, any>;
}

async function findEnrollment(operation: MoneyOperationRecord): Promise<any | null> {
  const payload = request(operation);
  const recovery = reconciliation(operation);
  const enrollmentId = recovery.enrollmentId || payload.enrollmentId;
  if (!enrollmentId) return null;
  const { data, error } = await getSupabase()
    .from('enrollments')
    .select('id, contact_id, offer_id, payment_type, payments_made, payments_total')
    .eq('id', enrollmentId)
    .eq('location_id', operation.location_id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureTransactionMapping(operation: MoneyOperationRecord, subscription = false): Promise<void> {
  const payload = request(operation);
  const processorReference = operation.processor_reference;
  if (!processorReference) throw new Error('Processor reference is missing');
  const processorColumn = subscription ? 'processor_subscription_id' : 'processor_transaction_id';
  const { data: existing, error: readError } = await getSupabase()
    .from('transaction_mappings')
    .select('id')
    .eq('location_id', operation.location_id)
    .eq(processorColumn, processorReference)
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return;

  const { error } = await getSupabase().from('transaction_mappings').insert({
    merchant_id: operation.merchant_id,
    location_id: operation.location_id,
    ghl_transaction_id: payload.transactionId || payload.ghlTransactionId || payload.ghlTxId || null,
    ghl_subscription_id: payload.ghlSubscriptionId || payload.ghlSubId || null,
    ghl_order_id: payload.ghlOrderId || null,
    ...(subscription
      ? { processor_subscription_id: processorReference }
      : {
        processor_transaction_id: processorReference,
        processor_charge_id: reconciliation(operation).chargeId || processorReference,
      }),
    processor_type: operation.processor_type,
    contact_id: payload.contactId || null,
  });
  if (error) throw error;
}

async function ensureSubscriptionMapping(operation: MoneyOperationRecord, subscriptionId: string, contactId: string): Promise<void> {
  const payload = request(operation);
  const { data: existing, error: readError } = await getSupabase()
    .from('transaction_mappings')
    .select('id')
    .eq('location_id', operation.location_id)
    .eq('processor_subscription_id', subscriptionId)
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return;

  const { error } = await getSupabase().from('transaction_mappings').insert({
    merchant_id: operation.merchant_id,
    location_id: operation.location_id,
    ghl_transaction_id: payload.transactionId || payload.ghlTransactionId || payload.ghlTxId || null,
    ghl_subscription_id: payload.ghlSubscriptionId || payload.ghlSubId || null,
    ghl_order_id: payload.ghlOrderId || null,
    processor_subscription_id: subscriptionId,
    processor_type: operation.processor_type,
    contact_id: contactId || payload.contactId || null,
  });
  if (error?.code === '23505') return;
  if (error) throw error;
}

async function ensurePaymentLedger(operation: MoneyOperationRecord): Promise<{ enrollment: any | null; contactId: string }> {
  const payload = request(operation);
  const recovery = reconciliation(operation);
  const processorReference = operation.processor_reference;
  if (!processorReference) throw new Error('Processor transaction reference is missing');

  const { data: existing, error: existingError } = await getSupabase()
    .from('payment_events')
    .select('id, contact_id, enrollment_id')
    .eq('location_id', operation.location_id)
    .eq('processor', operation.processor_type)
    .eq('processor_transaction_id', processorReference)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { enrollment: await findEnrollment(operation), contactId: existing.contact_id };

  const enrollment = await findEnrollment(operation);
  const contactId = String(recovery.contactId || payload.contactId || enrollment?.contact_id || '');
  if (!contactId) throw new Error('Cannot reconcile payment without a verified contact');
  const amountCents = Number(payload.amountCents || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Cannot reconcile payment without integer cents');

  const { error: insertError } = await getSupabase().from('payment_events').insert({
    merchant_id: operation.merchant_id,
    location_id: operation.location_id,
    contact_id: contactId,
    enrollment_id: enrollment?.id || null,
    offer_id: payload.offerId || enrollment?.offer_id || null,
    event_type: 'sale',
    processor: operation.processor_type,
    processor_transaction_id: processorReference,
    amount: amountCents / 100,
    currency: String(payload.currency || 'usd').toLowerCase(),
    payment_number: 1,
    payments_total: recovery.paymentsTotal || enrollment?.payments_total || null,
    payments_remaining: recovery.paymentsTotal ? Math.max(0, Number(recovery.paymentsTotal) - 1) : null,
    source: operation.operation_type === 'manual_sale_charge' ? 'quick_manual_sale_reconciliation' : 'checkout_reconciliation',
    is_recurring: false,
    payment_status: recovery.paymentProcessing || recovery.status === 'processing' ? 'processing' : 'succeeded',
    processor_subscription_id: recovery.processorSubscriptionId || null,
    payment_method_type: payload.paymentMethod || 'card',
    selected_payment_method: payload.paymentMethod || 'card',
    customer_email: payload.contactEmail || payload.email || null,
    line_items: Array.isArray(payload.lineItems) ? payload.lineItems : [],
    raw_webhook_payload: {
      reconciled_from_money_operation: operation.id,
      operation_type: operation.operation_type,
    },
  });
  if (insertError) throw insertError;
  return { enrollment, contactId };
}

async function reconcileCharge(operation: MoneyOperationRecord): Promise<Record<string, unknown>> {
  const payload = request(operation);
  const recovery = reconciliation(operation);
  const { enrollment, contactId } = await ensurePaymentLedger(operation);
  await ensureTransactionMapping(operation, false);

  if (enrollment) {
    const subscriptionId = String(recovery.processorSubscriptionId || '');
    const recurringPayment = ['installment', 'installments', 'subscription'].includes(
      String(payload.paymentChoice || enrollment.payment_type || '').toLowerCase(),
    );
    const { error } = await getSupabase()
      .from('enrollments')
      .update({
        contact_id: contactId,
        payment_transaction_id: operation.processor_reference,
        payment_amount: Number(payload.amountCents || 0) / 100,
        processor_type: operation.processor_type,
        initial_payment_status: recovery.paymentProcessing || recovery.status === 'processing' ? 'processing' : 'succeeded',
        initial_payment_method: payload.paymentMethod || 'card',
        ...(subscriptionId ? {
          processor_subscription_id: subscriptionId,
          billing_setup_status: 'ok',
          billing_setup_error: null,
          next_billing_date_source: 'processor',
          ...(recovery.nextBillingDate ? { next_billing_date: recovery.nextBillingDate } : {}),
        } : recurringPayment ? {
          billing_setup_status: 'needs_reconciliation',
          billing_setup_error: 'Payment was confirmed, but the processor recurring subscription must be verified before billing can continue.',
          next_billing_date: null,
        } : {}),
      })
      .eq('id', enrollment.id)
      .eq('location_id', operation.location_id);
    if (error) throw error;
    if (subscriptionId) await ensureSubscriptionMapping(operation, subscriptionId, contactId);
  }

  return recovery.clientResponse || operation.response_payload || {
    success: true,
    chargeId: operation.processor_reference,
    paymentStatus: recovery.paymentProcessing || recovery.status === 'processing' ? 'processing' : 'succeeded',
    reconciled: true,
  };
}

async function reconcileAchIntent(operation: MoneyOperationRecord): Promise<Record<string, unknown>> {
  const payload = request(operation);
  const recovery = reconciliation(operation);
  const enrollmentId = recovery.enrollmentId || payload.enrollmentId;
  if (enrollmentId) {
    const { error } = await getSupabase()
      .from('enrollments')
      .update({
        ...(recovery.contactId ? { contact_id: recovery.contactId } : {}),
        ...(recovery.contactEmail ? { email: recovery.contactEmail } : {}),
        payment_transaction_id: operation.processor_reference,
      })
      .eq('id', enrollmentId)
      .eq('location_id', operation.location_id);
    if (error) throw error;
  }
  if (!recovery.clientResponse) throw new Error('ACH intent replay response is missing');
  return recovery.clientResponse;
}

async function ensureDunningRecoveryEvidence(params: {
  operation: MoneyOperationRecord;
  original: any;
  successfulPayment: any;
  offerId: string | null;
  paymentNumber: number;
  paymentsRemaining: number | null;
  runningTotal: number;
}): Promise<void> {
  const { operation, original, successfulPayment } = params;
  const supabase = getSupabase();
  const findExisting = async (): Promise<any | null> => {
    const { data, error } = await supabase
      .from('evidence_payment_confirmation')
      .select('id')
      .eq('location_id', operation.location_id)
      .eq('contact_id', original.contact_id)
      .eq('payment_event_id', successfulPayment.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  if (await findExisting()) return;

  const amount = Number(successfulPayment.amount ?? original.amount ?? 0);
  const currency = String(successfulPayment.currency || original.currency || 'usd').toUpperCase();
  try {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
      operation.location_id,
      original.contact_id,
      'dunning_retry_reconciliation',
      {
        amount,
        currency,
        payment_date: new Date().toISOString(),
        ghl_transaction_id: successfulPayment.processor_transaction_id,
        payment_event_id: successfulPayment.id,
        payment_number: params.paymentNumber,
        payments_remaining: params.paymentsRemaining,
        running_total: params.runningTotal,
        processor: successfulPayment.processor,
        enrollment_id: original.enrollment_id || null,
        raw_payload: {
          dunning_retry: true,
          original_payment_event_id: original.id,
          successful_payment_event_id: successfulPayment.id,
          money_operation_id: operation.id,
        },
        ...buildDefenseEvidenceFields({
          summary: `Dunning retry recovered payment of ${formatMoney(amount)}. Transaction: ${successfulPayment.processor_transaction_id}.`,
          title: 'Dunning Recovery Payment',
          proofRole: 'payment_history',
          relevance: {
            tags: ['credit_not_processed', 'cancelled_recurring'],
            priority: 'high',
            confidence: 'strong',
          },
          enrollmentId: original.enrollment_id || null,
          paymentEventId: successfulPayment.id,
          metadata: {
            actor: 'processor',
            service: {
              enrollmentId: original.enrollment_id || null,
              offerId: params.offerId,
            },
            transaction: {
              paymentEventId: successfulPayment.id,
              processor: successfulPayment.processor,
              transactionId: successfulPayment.processor_transaction_id,
              amount,
              currency,
              paymentSequence: params.paymentNumber,
            },
            source: {
              system: 'dunning_retry_reconciliation',
              recordId: successfulPayment.processor_transaction_id,
              rawEventType: 'dunning_resolved',
            },
          },
        }),
      },
    );
  } catch (error: any) {
    if (error?.code !== '23505' || !(await findExisting())) throw error;
  }
}

async function queueDunningRecoveryDelivery(params: {
  operation: MoneyOperationRecord;
  original: any;
  successfulPayment: any;
  enrollment: any | null;
  offerId: string | null;
  paymentNumber: number;
  paymentsTotal: number | null;
  paymentsRemaining: number | null;
  runningTotal: number;
}): Promise<void> {
  const { operation, original, successfulPayment, enrollment } = params;
  const amount = Number(successfulPayment.amount ?? original.amount ?? 0);
  const isFinal = enrollment?.payment_type !== 'subscription'
    && params.paymentsTotal !== null
    && params.paymentNumber >= params.paymentsTotal;
  const enrollmentStatus = String(enrollment?.status || '').toLowerCase();
  const restoreEnrollmentStatus = !enrollment
    || ['active', 'enrolled', 'past_due', 'delinquent'].includes(enrollmentStatus);
  const contactFieldUpdates: Record<string, unknown> = {
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: isFinal ? 'Completed' : 'Current',
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(amount),
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE]: new Date().toISOString().slice(0, 10),
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE]: params.paymentNumber,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING]: params.paymentsRemaining,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.SUCCESSFUL_PAYMENT_COUNT]: params.paymentNumber,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID]: formatMoney(params.runningTotal),
    ...(restoreEnrollmentStatus ? { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled' } : {}),
  };

  const { job } = await triggerDeliveryJobService.enqueue({
    locationId: operation.location_id,
    triggerKey: 'ss_payment_received',
    idempotencyKey: `dunning-recovery:${successfulPayment.id}`,
    contactId: original.contact_id,
    contactFieldUpdates,
    payload: {
      event_type: 'payment_received',
      location_id: operation.location_id,
      locationId: operation.location_id,
      contact_id: original.contact_id,
      contactId: original.contact_id,
      enrollment_id: original.enrollment_id || '',
      enrollmentId: original.enrollment_id || '',
      offer_id: params.offerId || '',
      offerId: params.offerId || '',
      processor: successfulPayment.processor,
      amount,
      amount_display: formatMoney(amount),
      amountDisplay: formatMoney(amount),
      transaction_id: successfulPayment.processor_transaction_id,
      transactionId: successfulPayment.processor_transaction_id,
      payment_number: params.paymentNumber,
      paymentNumber: params.paymentNumber,
      payments_total: params.paymentsTotal,
      paymentsTotal: params.paymentsTotal,
      payments_remaining: params.paymentsRemaining,
      paymentsRemaining: params.paymentsRemaining,
      running_total: params.runningTotal,
      runningTotal: params.runningTotal,
      running_total_display: formatMoney(params.runningTotal),
      runningTotalDisplay: formatMoney(params.runningTotal),
      action: 'dunning_resolved',
      payment_kind: 'dunning_recovery',
      paymentKind: 'dunning_recovery',
      payment_source: 'dunning_retry_reconciliation',
      paymentSource: 'dunning_retry_reconciliation',
      payment_timing: 'dunning_recovery',
      paymentTiming: 'dunning_recovery',
      receipt_only: true,
      receiptOnly: true,
      send_receipt: true,
      sendReceipt: true,
      send_welcome: false,
      sendWelcome: false,
    },
  });
  if (!job?.id) throw new Error('Dunning recovery trigger delivery was not durably queued');
}

async function reconcileDunning(operation: MoneyOperationRecord): Promise<Record<string, unknown>> {
  const payload = request(operation);
  const transactionId = operation.processor_reference;
  if (!transactionId) throw new Error('Dunning transaction reference is missing');
  const paymentEventId = String(payload.paymentEventId || '');
  const contactId = String(payload.contactId || '');
  if (!paymentEventId || !contactId) throw new Error('Dunning reconciliation identity is incomplete');
  const { data: original, error: originalError } = await getSupabase()
    .from('payment_events')
    .select('id, merchant_id, enrollment_id, offer_id, amount, currency, contact_id, processor, processor_transaction_id, dunning_status')
    .eq('id', paymentEventId)
    .eq('merchant_id', operation.merchant_id)
    .eq('location_id', operation.location_id)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (originalError) throw originalError;
  if (!original) throw new Error('Original dunning payment event is missing');
  if (operation.processor_type !== original.processor) {
    throw new Error('Dunning reconciliation processor does not match the original failed payment');
  }
  if (transactionId === original.processor_transaction_id) {
    throw new Error('Dunning reconciliation requires a distinct successful payment reference');
  }

  let enrollment: any | null = null;
  let recurringResult: any | null = null;
  if (original.enrollment_id) {
    let interval = 'monthly';
    const { data, error: enrollmentError } = await getSupabase()
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, status, payment_type, payments_made, payments_total')
      .eq('id', original.enrollment_id)
      .eq('merchant_id', operation.merchant_id)
      .eq('location_id', operation.location_id)
      .eq('contact_id', original.contact_id)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    enrollment = data || null;
    if (!enrollment) throw new Error('Dunning enrollment is missing from the reconciled tenant');
    if (enrollment?.offer_id) {
      const { data: offer } = await getSupabase()
        .from('offers_mirror')
        .select('installment_frequency')
        .eq('id', enrollment.offer_id)
        .eq('location_id', operation.location_id)
        .maybeSingle();
      if (offer?.installment_frequency) interval = offer.installment_frequency;
    }
    const { data: rpcData, error } = await getSupabase().rpc('record_recurring_payment', {
      p_enrollment_id: original.enrollment_id,
      p_location_id: operation.location_id,
      p_processor: operation.processor_type,
      p_transaction_id: transactionId,
      p_amount: original.amount,
      p_next_billing_date: null,
      p_next_billing_source: 'estimated',
      p_interval: interval,
      p_source: 'dunning_retry_reconciliation',
      p_raw_payload: { dunning_retry: true, original_payment_event_id: original.id, money_operation_id: operation.id },
    });
    if (error) throw error;
    recurringResult = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  } else {
    await ensurePaymentLedger(operation);
  }

  const { data: successfulPayment, error: successError } = await getSupabase()
    .from('payment_events')
    .select('id, merchant_id, location_id, contact_id, enrollment_id, offer_id, processor, processor_transaction_id, amount, currency, payment_number, payments_total')
    .eq('merchant_id', operation.merchant_id)
    .eq('location_id', operation.location_id)
    .eq('contact_id', original.contact_id)
    .eq('processor', original.processor)
    .eq('event_type', 'sale')
    .eq('processor_transaction_id', transactionId)
    .maybeSingle();
  if (successError) throw successError;
  if (!successfulPayment?.id || successfulPayment.id === original.id) {
    throw new Error('Dunning recovery is not backed by a distinct successful payment record');
  }

  if (enrollment && ['past_due', 'delinquent'].includes(String(enrollment.status || '').toLowerCase())) {
    const { data: restoredRows, error: restoreError } = await getSupabase()
      .from('enrollments')
      .update({ status: 'enrolled' })
      .eq('id', enrollment.id)
      .eq('merchant_id', operation.merchant_id)
      .eq('location_id', operation.location_id)
      .eq('contact_id', original.contact_id)
      .in('status', ['past_due', 'delinquent'])
      .select('id');
    if (restoreError) throw restoreError;
    if (Array.isArray(restoredRows) && restoredRows.length > 0) enrollment.status = 'enrolled';
  }

  const paymentNumber = Number(successfulPayment.payment_number || recurringResult?.payments_made || enrollment?.payments_made || 1);
  const rawPaymentsTotal = successfulPayment.payments_total ?? recurringResult?.payments_total ?? enrollment?.payments_total;
  const paymentsTotal = rawPaymentsTotal === null || rawPaymentsTotal === undefined
    ? null
    : Number(rawPaymentsTotal);
  const paymentsRemaining = paymentsTotal === null ? null : Math.max(0, paymentsTotal - paymentNumber);
  const runningTotal = Number(successfulPayment.amount ?? original.amount ?? 0) * paymentNumber;
  const offerId = successfulPayment.offer_id || original.offer_id || enrollment?.offer_id || null;

  await ensureDunningRecoveryEvidence({
    operation,
    original,
    successfulPayment,
    offerId,
    paymentNumber,
    paymentsRemaining,
    runningTotal,
  });
  await queueDunningRecoveryDelivery({
    operation,
    original,
    successfulPayment,
    enrollment,
    offerId,
    paymentNumber,
    paymentsTotal,
    paymentsRemaining,
    runningTotal,
  });

  if (original.dunning_status !== 'resolved') {
    const { data: resolvedRows, error: resolveError } = await getSupabase()
      .from('payment_events')
      .update({ dunning_status: 'resolved', dunning_resolved_at: new Date().toISOString() })
      .eq('id', original.id)
      .eq('merchant_id', operation.merchant_id)
      .eq('location_id', operation.location_id)
      .eq('contact_id', original.contact_id)
      .in('dunning_status', ['active', 'retrying', 'escalated'])
      .select('id');
    if (resolveError) throw resolveError;
    if (!Array.isArray(resolvedRows) || resolvedRows.length !== 1) {
      const { data: current, error: currentError } = await getSupabase()
        .from('payment_events')
        .select('id, dunning_status')
        .eq('id', original.id)
        .eq('merchant_id', operation.merchant_id)
        .eq('location_id', operation.location_id)
        .eq('contact_id', original.contact_id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (current?.dunning_status !== 'resolved') {
        throw new Error('Dunning recovery status was not resolved');
      }
    }
  }
  return { success: true };
}

async function reconcileResume(operation: MoneyOperationRecord): Promise<Record<string, unknown>> {
  const payload = request(operation);
  const response = operation.response_payload || {};
  const subscriptionId = response.subscriptionId || operation.processor_reference;
  if (!payload.enrollmentId || !subscriptionId) throw new Error('Subscription resume reconciliation data is incomplete');
  const { error } = await getSupabase()
    .from('enrollments')
    .update({
      status: 'enrolled',
      processor_subscription_id: subscriptionId,
      next_billing_date: String(response.nextPaymentDate || payload.startDate || '').slice(0, 10) || null,
    })
    .eq('id', payload.enrollmentId)
    .eq('location_id', operation.location_id)
    .eq('contact_id', payload.contactId);
  if (error) throw error;
  return { success: true, subscriptionId, nextPaymentDate: response.nextPaymentDate || payload.startDate || null };
}

async function reconcileMappingOnly(operation: MoneyOperationRecord): Promise<Record<string, unknown>> {
  await ensureTransactionMapping(operation, operation.operation_type === 'query_url_subscription');
  return operation.response_payload || { success: true };
}

async function processOperation(operation: MoneyOperationRecord): Promise<void> {
  try {
    let response: Record<string, unknown>;
    switch (operation.operation_type) {
      case 'checkout_charge':
      case 'manual_sale_charge':
        response = await reconcileCharge(operation);
        break;
      case 'checkout_ach_intent':
      case 'manual_sale_ach_intent':
        response = await reconcileAchIntent(operation);
        break;
      case 'query_url_charge':
      case 'query_url_subscription':
        response = await reconcileMappingOnly(operation);
        break;
      case 'dunning_retry':
        response = await reconcileDunning(operation);
        break;
      case 'subscription_resume':
        response = await reconcileResume(operation);
        break;
      default:
        throw new Error(`No reconciliation handler for ${operation.operation_type}`);
    }
    await moneyOperationService.markRecorded({
      id: operation.id,
      locationId: operation.location_id,
      response,
      processorType: operation.processor_type || undefined,
      processorReference: operation.processor_reference,
      providerCalled: operation.provider_called,
    });
    logger.info({ operationId: operation.id, operationType: operation.operation_type }, 'Money operation reconciled');
  } catch (err: any) {
    logger.error({ err: err.message, operationId: operation.id, operationType: operation.operation_type }, 'Money reconciliation failed');
    await moneyOperationService.scheduleReconciliationRetry({
      id: operation.id,
      locationId: operation.location_id,
      workerId,
      attempt: Number(operation.reconciliation_attempts || 1),
      error: err.message || String(err),
    });
  }
}

async function findRefundEvent(claim: RefundReconciliationClaim, processor: string): Promise<any | null> {
  if (!claim.processor_refund_id) return null;
  const { data, error } = await getSupabase()
    .from('payment_events')
    .select('id')
    .eq('location_id', claim.location_id)
    .eq('processor', processor)
    .eq('event_type', 'refund')
    .eq('processor_transaction_id', claim.processor_refund_id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findSignedWhopRefundEvent(claim: RefundReconciliationClaim, original: any): Promise<any | null> {
  let query: any = getSupabase()
    .from('payment_events')
    .select('id, processor_transaction_id, raw_webhook_payload')
    .eq('location_id', claim.location_id)
    .eq('processor', 'whop')
    .eq('event_type', 'refund');
  if (original.contact_id) query = query.eq('contact_id', original.contact_id);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).find((refund: any) => {
    const raw = refund?.raw_webhook_payload || {};
    return raw.refund_claim_id === claim.id
      || raw.original_payment_event_id === original.id
      || raw.original_processor_transaction_id === original.processor_transaction_id;
  }) || null;
}

async function processRefundClaim(claim: RefundReconciliationClaim): Promise<void> {
  try {
    const { data: original, error: originalError } = await getSupabase()
      .from('payment_events')
      .select('id, merchant_id, location_id, contact_id, enrollment_id, offer_id, processor, processor_transaction_id, amount, currency, processor_subscription_id')
      .eq('id', claim.original_payment_event_id)
      .eq('location_id', claim.location_id)
      .maybeSingle();
    if (originalError) throw originalError;
    if (!original) throw new Error('Original payment event is missing');

    const refundProcessor = claim.processor || original.processor;
    if (!refundProcessor) throw new Error('Refund processor is missing');
    let inserted = false;
    let refundEvent: any | null;
    if (refundProcessor === 'whop') {
      refundEvent = await findSignedWhopRefundEvent(claim, original);
      if (!refundEvent) {
        throw new Error('Awaiting signed Whop refund confirmation');
      }
    } else {
      if (!claim.processor_refund_id) throw new Error('Processor refund reference is missing');
      refundEvent = await findRefundEvent(claim, refundProcessor);
    }
    if (!refundEvent && refundProcessor !== 'whop') {
      const { data, error } = await getSupabase()
        .from('payment_events')
        .insert({
          merchant_id: original.merchant_id,
          location_id: claim.location_id,
          contact_id: original.contact_id,
          enrollment_id: original.enrollment_id || null,
          offer_id: original.offer_id || null,
          event_type: 'refund',
          processor: refundProcessor,
          processor_transaction_id: claim.processor_refund_id,
          amount: Number(claim.amount_cents) / 100,
          currency: original.currency || 'usd',
          source: 'refund_reconciliation',
          is_recurring: false,
          raw_webhook_payload: {
            original_payment_event_id: original.id,
            original_processor_transaction_id: original.processor_transaction_id,
            refund_claim_id: claim.id,
            reconciled_from_refund_claim: true,
          },
        })
        .select('id')
        .single();
      if (error?.code === '23505') {
        refundEvent = await findRefundEvent(claim, refundProcessor);
      } else if (error) {
        throw error;
      } else {
        refundEvent = data;
        inserted = true;
      }
    }
    if (!refundEvent?.id) throw new Error('Refund payment event could not be reconciled');

    await refundReconciliationService.markRecorded({
      claimId: claim.id,
      locationId: claim.location_id,
      workerId,
      refundPaymentEventId: refundEvent.id,
    });

    if (inserted) {
      let programName = '';
      if (original.offer_id) {
        const { data: offer, error: offerError } = await getSupabase()
          .from('offers_mirror')
          .select('offer_name')
          .eq('id', original.offer_id)
          .eq('location_id', claim.location_id)
          .maybeSingle();
        if (offerError) logger.warn({ err: offerError.message, claimId: claim.id }, 'Refund reconciliation offer lookup failed');
        programName = offer?.offer_name || '';
      }
      try {
        await paymentLifecycleService.notifyRefundProcessed(claim.location_id, original.contact_id, {
          amount: Number(claim.amount_cents) / 100,
          refundType: Number(claim.amount_cents) < Math.round(Number(original.amount || 0) * 100) ? 'partial' : 'full',
          reason: 'Refund processed',
          transactionId: claim.processor_refund_id || undefined,
          enrollmentId: original.enrollment_id || null,
          offerId: original.offer_id || null,
          programName,
          processor: refundProcessor,
          subscriptionId: original.processor_subscription_id || null,
        });
      } catch (notifyError: any) {
        logger.error({ err: notifyError.message, claimId: claim.id }, 'Reconciled refund notification failed');
      }
    }
    logger.info({ claimId: claim.id, refundEventId: refundEvent.id }, 'Refund claim reconciled');
  } catch (err: any) {
    logger.error({ err: err.message, claimId: claim.id }, 'Refund reconciliation failed');
    await refundReconciliationService.scheduleRetry({
      claimId: claim.id,
      locationId: claim.location_id,
      workerId,
      attempt: Number(claim.reconciliation_attempts || 1),
      error: err.message || String(err),
    });
  }
}

async function tick(): Promise<number> {
  if (running) return 0;
  running = true;
  const startedAt = new Date();
  let workCount = 0;
  let tickError: unknown;
  try {
    const [operations, refundClaims] = await Promise.all([
      moneyOperationService.claimReconciliation(workerId, 20),
      refundReconciliationService.claim(workerId, 20),
    ]);
    await Promise.all([
      ...operations.map(processOperation),
      ...refundClaims.map(processRefundClaim),
    ]);
    workCount = operations.length + refundClaims.length;
    return workCount;
  } catch (err: any) {
    tickError = err;
    logger.error({ err: err.message }, 'Money reconciliation worker tick failed');
    return 0;
  } finally {
    running = false;
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.money_reconciliation',
      instanceId: workerId,
      startedAt,
      workCount,
      error: tickError,
    });
  }
}

const poller = new AdaptivePoller({
  task: tick,
  taskTimeoutMs: commandCenterHealthService.workerTimeoutMs('worker.money_reconciliation'),
  onTimeout: ({ startedAt, timedOutAt }) => commandCenterHealthService.recordWorkerTick({
    workerKey: 'worker.money_reconciliation',
    instanceId: workerId,
    startedAt,
    completedAt: timedOutAt,
    workCount: 0,
    timedOut: true,
  }),
});

export const moneyReconciliationWorker = {
  start(): void {
    poller.start();
  },
  async runOnce(): Promise<void> {
    await tick();
  },
  wake(): void {
    poller.wake();
  },
  stop(): void {
    poller.stop();
  },
};
