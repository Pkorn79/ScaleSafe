import crypto from 'crypto';
import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { nmiDiagnosticLogService } from '../services/nmi-diagnostic-log.service';
import { processorConfigService } from '../services/processor-config.service';
import { ProcessorConfig, VerifyResult } from '../types/processor.types';
import { logger } from '../utils/logger';

const TRANSACTION_SUCCESS = 'transaction.sale.success';
const TRANSACTION_FAILURE = 'transaction.sale.failure';
const TRANSACTION_UNKNOWN = 'transaction.sale.unknown';
const TRANSACTION_AUTH_SUCCESS = 'transaction.auth.success';
const TRANSACTION_CAPTURE_SUCCESS = 'transaction.capture.success';
const TRANSACTION_REFUND_SUCCESS = 'transaction.refund.success';
const TRANSACTION_VOID_SUCCESS = 'transaction.void.success';
const TRANSACTION_REVERSAL_FAILURES = new Set([
  'transaction.refund.failure',
  'transaction.void.failure',
]);
const TRANSACTION_LOG_ONLY_EVENTS = new Set([
  TRANSACTION_AUTH_SUCCESS,
  TRANSACTION_CAPTURE_SUCCESS,
  'transaction.auth.failure',
  'transaction.capture.failure',
]);

type SupabaseClient = ReturnType<typeof getSupabase>;

function valueAt(obj: any, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, obj);
}

function firstString(obj: any, paths: string[]): string {
  for (const path of paths) {
    const value = valueAt(obj, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function firstNumber(obj: any, paths: string[]): number {
  for (const path of paths) {
    const value = valueAt(obj, path);
    const parsed = Number.parseFloat(String(value ?? ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function eventBody(payload: any): any {
  return payload?.event_body || payload?.eventBody || payload?.data || payload || {};
}

function getEventId(payload: any): string {
  return firstString(payload, ['event_id', 'eventId', 'id']);
}

function getEventType(payload: any): string {
  return firstString(payload, ['event_type', 'eventType', 'type']);
}

export function isNmiOfficialEventPayload(payload: any): boolean {
  const eventType = getEventType(payload);
  return !!(
    payload?.event_body
    || payload?.eventBody
    || payload?.event_id
    || payload?.eventId
    || eventType.startsWith('transaction.')
    || eventType.startsWith('recurring.')
  );
}

function getSubscriptionId(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, [
    'subscription_id',
    'subscriptionid',
    'subscription.id',
    'recurring_subscription_id',
    'recurring.id',
    'reference_id',
    'referenceid',
    'action.subscription_id',
    'action.subscriptionid',
  ]);
}

function getTransactionId(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, [
    'transaction_id',
    'transactionid',
    'transaction.id',
    'action.transaction_id',
    'action.transactionid',
    'id',
  ]);
}

function getEnrollmentId(payload: any): string {
  const body = eventBody(payload);
  const candidate = firstString(body, [
    'merchant_defined_fields.enrollment_id',
    'merchant_defined_fields.merchant_defined_field_1',
    'merchant_defined_field_1',
    'metadata.enrollment_id',
    'order_id',
    'orderid',
    'action.order_id',
  ]);
  return isUuid(candidate) ? candidate : '';
}

function getTransactionSource(payload: any): string {
  const body = eventBody(payload);
  const recurring = firstString(body, ['action.recurring', 'recurring', 'transaction.recurring']);
  if (['1', 'true', 'yes'].includes(recurring.toLowerCase())) return 'recurring';
  return firstString(body, ['action.source', 'source', 'transaction.source']).toLowerCase();
}

function getAmount(payload: any): number {
  const body = eventBody(payload);
  return firstNumber(body, [
    'action.amount',
    'amount',
    'amount_authorized',
    'action.amount_authorized',
    'requested_amount',
    'transaction.amount',
    'plan.amount',
  ]);
}

function getResponseCode(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, ['action.response_code', 'response_code', 'response']);
}

function getResponseText(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, ['action.response_text', 'responsetext', 'response_text', 'message']);
}

function getProcessorId(payload: any, config: ProcessorConfig): string {
  const body = eventBody(payload);
  return firstString(body, ['processor_id', 'action.processor_id', 'processor.id']) || config.nmi_processor_id || '';
}

function getNmiMerchantId(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, ['merchant.id', 'merchant_id']);
}

function getOriginalTransactionId(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, [
    'action.original_transaction_id',
    'action.original_transactionid',
    'transaction.original_transaction_id',
    'original_transaction_id',
    'original_transactionid',
    'parent_transaction_id',
    'related_transaction_id',
  ]);
}

function payloadWithTransactionLookup(payload: any, verification: VerifyResult): any {
  const body = eventBody(payload);
  const merchantDefinedFields = {
    ...(body?.merchant_defined_fields || {}),
    ...(verification.merchantDefinedFields || {}),
  };

  return {
    ...payload,
    event_body: {
      ...body,
      transaction_id: body?.transaction_id || body?.transactionid || verification.transactionId,
      amount: getAmount(payload) || (verification.amount ? verification.amount / 100 : undefined),
      subscription_id: getSubscriptionId(payload) || verification.subscriptionId,
      order_id: firstString(body, ['order_id', 'orderid']) || verification.orderId,
      customer_vault_id: firstString(body, ['customer_vault_id', 'customer_vaultid']) || verification.customerVaultId,
      processor_id: firstString(body, ['processor_id', 'action.processor_id', 'processor.id']) || verification.processorId,
      source: getTransactionSource(payload) || verification.source || (verification.recurring ? 'recurring' : undefined),
      recurring: firstString(body, ['action.recurring', 'recurring', 'transaction.recurring']) || (verification.recurring ? 'true' : undefined),
      response_code: getResponseCode(payload) || verification.responseCode,
      response_text: getResponseText(payload) || verification.responseText,
      processor_response_code: verification.processorResponseCode,
      processor_response_description: verification.processorResponseDescription,
      processor_response_text: verification.processorResponseText,
      currency: firstString(body, ['currency']) || verification.currency,
      ip_address: firstString(body, ['ip_address']) || verification.ipAddress,
      original_transaction_id: getOriginalTransactionId(payload) || verification.originalTransactionId,
      merchant_defined_fields: merchantDefinedFields,
      merchant_defined_field_1: body?.merchant_defined_field_1 || merchantDefinedFields.merchant_defined_field_1,
      merchant_defined_field_2: body?.merchant_defined_field_2 || merchantDefinedFields.merchant_defined_field_2,
      merchant_defined_field_3: body?.merchant_defined_field_3 || merchantDefinedFields.merchant_defined_field_3,
      merchant_defined_field_4: body?.merchant_defined_field_4 || merchantDefinedFields.merchant_defined_field_4,
      merchant_defined_field_5: body?.merchant_defined_field_5 || merchantDefinedFields.merchant_defined_field_5,
    },
  };
}

function rawPayload(req: Request): Buffer {
  if ((req as any).rawBody instanceof Buffer) return (req as any).rawBody;
  return Buffer.from(JSON.stringify(req.body || {}));
}

function verifySignature(raw: Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expectedHex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expectedBase64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const expectedBase64Url = crypto.createHmac('sha256', secret).update(raw).digest('base64url');
  const candidates = [
    expectedHex,
    expectedBase64,
    expectedBase64Url,
    expectedBase64Url.replace(/=+$/, ''),
  ];

  return candidates.some((expected) => {
    const sentValue = signatureHeader.trim();
    const sent = Buffer.from(sentValue, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    return sent.length === want.length && crypto.timingSafeEqual(sent, want);
  });
}

async function loadProcessorConfig(supabase: SupabaseClient, configId: string): Promise<ProcessorConfig | null> {
  const { data } = await supabase
    .from('processor_configs')
    .select('*')
    .eq('id', configId)
    .eq('processor_type', 'nmi')
    .eq('is_active', true)
    .single();

  return (data || null) as ProcessorConfig | null;
}

async function loadActiveNmiConfigs(supabase: SupabaseClient): Promise<ProcessorConfig[]> {
  const { data } = await supabase
    .from('processor_configs')
    .select('*')
    .eq('processor_type', 'nmi')
    .eq('is_active', true);

  return (data || []) as ProcessorConfig[];
}

async function loadConfigForEnrollment(supabase: SupabaseClient, enrollment: any): Promise<ProcessorConfig | null> {
  if (!enrollment?.merchant_id || !enrollment?.location_id) return null;
  const { data } = await supabase
    .from('processor_configs')
    .select('*')
    .eq('merchant_id', enrollment.merchant_id)
    .eq('location_id', enrollment.location_id)
    .eq('processor_type', 'nmi')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .single();

  return (data || null) as ProcessorConfig | null;
}

async function findEnrollmentWithoutConfig(supabase: SupabaseClient, payload: any): Promise<any | null> {
  const enrollmentId = getEnrollmentId(payload);
  if (enrollmentId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('id', enrollmentId)
      .single();
    if (data) return data;
  }

  const subscriptionId = getSubscriptionId(payload);
  if (subscriptionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('processor_subscription_id', subscriptionId)
      .single();
    if (data) return data;
  }

  return null;
}

async function loadConfigFromPayload(supabase: SupabaseClient, payload: any): Promise<ProcessorConfig | null> {
  const enrollment = await findEnrollmentWithoutConfig(supabase, payload);
  return loadConfigForEnrollment(supabase, enrollment);
}

async function findConfigBySignature(
  supabase: SupabaseClient,
  raw: Buffer,
  signature: string,
): Promise<ProcessorConfig | null> {
  const configs = await loadActiveNmiConfigs(supabase);
  for (const config of configs) {
    if (!config.nmi_webhook_secret_encrypted) continue;
    try {
      const secret = processorConfigService.decryptNmiWebhookSecret(config);
      if (verifySignature(raw, signature, secret)) return config;
    } catch {
      // Bad local key should not stop checking the next config.
    }
  }
  return null;
}

async function updateWebhookStatus(
  supabase: SupabaseClient,
  configId: string,
  status: string,
  errorMessage: string | null,
): Promise<void> {
  await supabase
    .from('processor_configs')
    .update({
      nmi_webhook_status: status,
      nmi_webhook_last_verified_at: status === 'verified' ? new Date().toISOString() : null,
      nmi_webhook_last_error: errorMessage,
    })
    .eq('id', configId);
}

async function createDiagnosticLog(
  config: ProcessorConfig,
  payload: any,
  fields: Record<string, unknown> = {},
): Promise<string | null> {
  const body = eventBody(payload);
  return nmiDiagnosticLogService.create({
    webhook_kind: 'nmi_event',
    event_id: getEventId(payload) || null,
    event_type: getEventType(payload) || null,
    signature_verified: fields.signature_verified ?? true,
    merchant_id: config.merchant_id,
    location_id: config.location_id,
    nmi_merchant_id: getNmiMerchantId(payload) || null,
    nmi_processor_id: getProcessorId(payload, config) || null,
    processor_subscription_id: getSubscriptionId(payload) || null,
    transaction_id: getTransactionId(payload) || null,
    amount: getAmount(payload) || null,
    response_code: getResponseCode(payload) || null,
    response_text: getResponseText(payload) || null,
    verification_status: getTransactionId(payload) ? 'pending' : 'skipped',
    action: 'received',
    raw_keys: Array.from(new Set([
      ...Object.keys(payload || {}),
      ...Object.keys(body || {}).map((key) => `event_body.${key}`),
    ])).sort(),
    ...fields,
  });
}

async function createUnmatchedDiagnosticLog(
  payload: any,
  fields: Record<string, unknown> = {},
): Promise<string | null> {
  const body = eventBody(payload);
  return nmiDiagnosticLogService.create({
    webhook_kind: 'nmi_event',
    event_id: getEventId(payload) || null,
    event_type: getEventType(payload) || null,
    signature_verified: fields.signature_verified ?? false,
    nmi_merchant_id: getNmiMerchantId(payload) || null,
    nmi_processor_id: firstString(body, ['processor_id', 'action.processor_id', 'processor.id']) || null,
    processor_subscription_id: getSubscriptionId(payload) || null,
    transaction_id: getTransactionId(payload) || null,
    amount: getAmount(payload) || null,
    response_code: getResponseCode(payload) || null,
    response_text: getResponseText(payload) || null,
    matched: false,
    verification_status: 'skipped',
    action: 'unmatched_event_received',
    raw_keys: Array.from(new Set([
      ...Object.keys(payload || {}),
      ...Object.keys(body || {}).map((key) => `event_body.${key}`),
    ])).sort(),
    ...fields,
  });
}

async function updateDiagnosticLog(logId: string | null, fields: Record<string, unknown>): Promise<void> {
  await nmiDiagnosticLogService.update(logId, fields);
}

async function findEnrollment(supabase: SupabaseClient, config: ProcessorConfig, payload: any): Promise<any | null> {
  const enrollmentId = getEnrollmentId(payload);
  if (enrollmentId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('id', enrollmentId)
      .eq('location_id', config.location_id)
      .single();
    if (data) return data;
  }

  const subscriptionId = getSubscriptionId(payload);
  if (subscriptionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('processor_subscription_id', subscriptionId)
      .eq('location_id', config.location_id)
      .single();
    if (data) return data;
  }

  return null;
}

async function offerDetails(supabase: SupabaseClient, offerId: string | null): Promise<{
  offerName: string;
  installmentFrequency: string;
}> {
  if (!offerId) return { offerName: '', installmentFrequency: 'monthly' };
  const { data } = await supabase
    .from('offers_mirror')
    .select('offer_name, installment_frequency')
    .eq('id', offerId)
    .single();
  return {
    offerName: data?.offer_name || '',
    installmentFrequency: data?.installment_frequency || 'monthly',
  };
}

async function processMatchedReversalEvent(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  payload: any,
  logId: string | null,
  verification: VerifyResult | null,
): Promise<void> {
  const eventType = getEventType(payload);
  const transactionId = getTransactionId(payload);
  const originalTransactionId = getOriginalTransactionId(payload) || verification?.originalTransactionId || '';
  const reversalType = eventType === TRANSACTION_VOID_SUCCESS ? 'void' : 'refund';

  if (!transactionId) {
    await updateDiagnosticLog(logId, {
      action: `ignored_${reversalType}_missing_transaction_id`,
      verification_status: 'failed',
      error_message: `NMI ${reversalType} event did not include a transaction id`,
    });
    return;
  }

  const { data: duplicate } = await supabase
    .from('payment_events')
    .select('id')
    .eq('location_id', config.location_id)
    .eq('processor', 'nmi')
    .eq('processor_transaction_id', transactionId)
    .maybeSingle();
  if (duplicate) {
    await updateDiagnosticLog(logId, {
      duplicate: true,
      action: `duplicate_${reversalType}_transaction`,
      verification_status: 'skipped',
      payment_event_id: duplicate.id,
    });
    return;
  }

  if (!originalTransactionId) {
    await updateDiagnosticLog(logId, {
      action: `${reversalType}_received_original_transaction_missing`,
      verification_status: verification ? 'verified' : 'skipped',
      error_message: `NMI ${reversalType} event did not include an original transaction id; logged only`,
    });
    return;
  }

  const { data: originalPayment } = await supabase
    .from('payment_events')
    .select('id, merchant_id, location_id, contact_id, enrollment_id, offer_id, processor_subscription_id, amount, currency, event_type, is_recurring')
    .eq('location_id', config.location_id)
    .eq('processor', 'nmi')
    .eq('processor_transaction_id', originalTransactionId)
    .in('event_type', ['sale', 'subscription_payment', 'capture'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!originalPayment) {
    await updateDiagnosticLog(logId, {
      matched: false,
      action: `${reversalType}_received_original_payment_unmatched`,
      verification_status: verification ? 'verified' : 'skipped',
      error_message: `No ScaleSafe payment matched original NMI transaction ${originalTransactionId}`,
    });
    return;
  }

  const amount = getAmount(payload) || (verification?.amount ? verification.amount / 100 : Number(originalPayment.amount || 0));
  const { data: reversal, error } = await supabase
    .from('payment_events')
    .insert({
      merchant_id: originalPayment.merchant_id,
      location_id: originalPayment.location_id,
      contact_id: originalPayment.contact_id,
      enrollment_id: originalPayment.enrollment_id || null,
      offer_id: originalPayment.offer_id || null,
      event_type: reversalType,
      processor: 'nmi',
      processor_transaction_id: transactionId,
      processor_subscription_id: originalPayment.processor_subscription_id || getSubscriptionId(payload) || null,
      amount,
      currency: originalPayment.currency || 'usd',
      source: 'nmi_webhook_event',
      is_recurring: Boolean(originalPayment.is_recurring),
      raw_webhook_payload: {
        event_id: getEventId(payload) || null,
        event_type: eventType,
        original_payment_event_id: originalPayment.id,
        original_processor_transaction_id: originalTransactionId,
        verification_status: verification?.status || null,
      },
    })
    .select('id')
    .single();

  if (error) {
    await updateDiagnosticLog(logId, {
      action: `${reversalType}_record_failed`,
      verification_status: verification ? 'verified' : 'skipped',
      error_message: error.message,
    });
    return;
  }

  await updateDiagnosticLog(logId, {
    matched: true,
    action: `${reversalType}_recorded`,
    verification_status: verification ? 'verified' : 'skipped',
    payment_event_id: reversal?.id || null,
    error_message: null,
  });
}

async function processTransactionEvent(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  payload: any,
  logId: string | null,
): Promise<void> {
  let effectivePayload = payload;
  const eventType = getEventType(effectivePayload);
  let source = getTransactionSource(effectivePayload);
  let verification: VerifyResult | null = null;

  if (TRANSACTION_LOG_ONLY_EVENTS.has(eventType)) {
    await updateDiagnosticLog(logId, {
      action: 'logged_transaction_event',
      verification_status: 'skipped',
      error_message: `${eventType} logged for diagnostics only`,
    });
    return;
  }

  if (TRANSACTION_REVERSAL_FAILURES.has(eventType)) {
    await updateDiagnosticLog(logId, {
      action: 'logged_reversal_failure',
      verification_status: 'failed',
      error_message: getResponseText(effectivePayload) || `${eventType} reported by NMI`,
    });
    return;
  }

  if ([TRANSACTION_REFUND_SUCCESS, TRANSACTION_VOID_SUCCESS].includes(eventType)) {
    const transactionId = getTransactionId(effectivePayload);
    if (transactionId) {
      try {
        verification = await createProcessorClient(config).verifyTransaction(transactionId);
        if (verification.success) effectivePayload = payloadWithTransactionLookup(effectivePayload, verification);
      } catch (err: any) {
        await updateDiagnosticLog(logId, {
          verification_status: 'error',
          error_message: err.message || 'NMI transaction lookup threw for reversal event',
        });
      }
    }
    await processMatchedReversalEvent(supabase, config, effectivePayload, logId, verification);
    return;
  }

  if (source && source !== 'recurring') {
    await updateDiagnosticLog(logId, {
      action: 'ignored_non_recurring_event',
      verification_status: 'skipped',
      error_message: `Transaction source was ${source}, not recurring`,
    });
    return;
  }

  const transactionId = getTransactionId(effectivePayload);
  let enrollment = await findEnrollment(supabase, config, effectivePayload);
  if (!enrollment && transactionId) {
    try {
      verification = await createProcessorClient(config).verifyTransaction(transactionId);
      if (verification.success) {
        effectivePayload = payloadWithTransactionLookup(effectivePayload, verification);
        source = getTransactionSource(effectivePayload);
        enrollment = await findEnrollment(supabase, config, effectivePayload);
        await updateDiagnosticLog(logId, {
          verification_status: 'verified',
          processor_subscription_id: getSubscriptionId(effectivePayload) || null,
          error_message: enrollment
            ? null
            : 'NMI transaction lookup succeeded but did not recover enrollment-matching metadata',
        });
      }
    } catch (err: any) {
      await updateDiagnosticLog(logId, {
        verification_status: 'error',
        error_message: err.message || 'NMI transaction lookup threw while matching webhook',
      });
    }
  }

  if (!enrollment) {
    await updateDiagnosticLog(logId, {
      matched: false,
      action: 'ignored_unmatched_event',
      error_message: 'No enrollment matched NMI event metadata or subscription id',
    });
    return;
  }

  if (eventType === TRANSACTION_SUCCESS && source !== 'recurring' && !getSubscriptionId(effectivePayload)) {
    await updateDiagnosticLog(logId, {
      action: 'ignored_non_recurring_event',
      verification_status: verification ? 'verified' : 'skipped',
      error_message: 'Sale event did not include recurring source or subscription id',
    });
    return;
  }

  await updateDiagnosticLog(logId, {
    matched: true,
    enrollment_id: enrollment.id,
    merchant_id: enrollment.merchant_id,
    location_id: enrollment.location_id,
  });

  if (eventType === TRANSACTION_SUCCESS && !transactionId) {
    await updateDiagnosticLog(logId, {
      action: 'ignored_missing_transaction_id',
      verification_status: 'failed',
      error_message: 'Approved NMI sale event did not include a transaction id',
    });
    return;
  }

  if (transactionId) {
    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('processor_transaction_id', transactionId)
      .eq('location_id', enrollment.location_id)
      .maybeSingle();

    if (existing) {
      await updateDiagnosticLog(logId, {
        duplicate: true,
        action: 'duplicate_transaction',
        verification_status: 'skipped',
        payment_event_id: existing.id,
      });
      return;
    }
  }

  const amountCents = Math.round(getAmount(effectivePayload) * 100);
  const { offerName, installmentFrequency } = await offerDetails(supabase, enrollment.offer_id);

  if (eventType === TRANSACTION_SUCCESS) {
    if (transactionId && !verification) {
      try {
        const processor = createProcessorClient(config);
        verification = await processor.verifyTransaction(transactionId);
        if (!verification.success) {
          await updateDiagnosticLog(logId, {
            action: 'ignored_verification_failed',
            verification_status: 'failed',
            error_message: 'NMI query verification did not confirm the transaction',
          });
          return;
        }
        await updateDiagnosticLog(logId, { verification_status: 'verified' });
      } catch (err: any) {
        await updateDiagnosticLog(logId, {
          action: 'ignored_verification_error',
          verification_status: 'error',
          error_message: err.message || 'NMI query verification threw',
        });
        return;
      }
    }

    const result = await handleRecurringPaymentSuccess({
      enrollment,
      processorType: 'nmi',
      transactionId: transactionId || `nmi_event_${Date.now()}`,
      amountCents: amountCents || verification?.amount || 0,
      offerName,
      installmentFrequency,
      source: 'nmi_webhook_event',
    });

    await updateDiagnosticLog(logId, {
      action: result.paymentEventId ? 'processed_success' : 'processed_success_payment_event_missing',
      error_message: result.paymentEventId ? null : 'Recurring payment handler did not return a payment_event id',
      payment_event_id: result.paymentEventId,
    });
    return;
  }

  const failed = await handleRecurringPaymentFailure({
    enrollment,
    processorType: 'nmi',
    transactionId: transactionId || null,
    amountCents,
    errorMessage: getResponseText(effectivePayload) || `NMI event: ${eventType}`,
    errorCode: getResponseCode(effectivePayload) || eventType,
    source: 'nmi_webhook_event',
  });

  await updateDiagnosticLog(logId, {
    action: failed.paymentEventId ? 'processed_failure' : 'processed_failure_payment_event_missing',
    verification_status: eventType === TRANSACTION_UNKNOWN ? 'unknown' : 'skipped',
    error_message: failed.paymentEventId ? (getResponseText(effectivePayload) || `NMI event: ${eventType}`) : 'Failed payment handler did not return a payment_event id',
    payment_event_id: failed.paymentEventId,
  });
}

async function processSubscriptionEvent(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  payload: any,
  logId: string | null,
): Promise<void> {
  const enrollment = await findEnrollment(supabase, config, payload);
  if (!enrollment) {
    await updateDiagnosticLog(logId, {
      matched: false,
      action: 'subscription_event_unmatched',
      error_message: 'No enrollment matched NMI subscription event metadata or subscription id',
    });
    return;
  }

  const eventType = getEventType(payload);
  const subscriptionId = getSubscriptionId(payload);
  const updates: Record<string, unknown> = {};
  if (subscriptionId && !enrollment.processor_subscription_id) {
    updates.processor_subscription_id = subscriptionId;
    updates.processor_type = 'nmi';
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('enrollments').update(updates).eq('id', enrollment.id);
  }

  await updateDiagnosticLog(logId, {
    matched: true,
    enrollment_id: enrollment.id,
    merchant_id: enrollment.merchant_id,
    location_id: enrollment.location_id,
    processor_subscription_id: subscriptionId || enrollment.processor_subscription_id || null,
    verification_status: 'skipped',
    action: eventType === 'recurring.subscription.delete'
      ? 'subscription_deleted'
      : eventType === 'recurring.subscription.update'
        ? 'subscription_updated'
        : 'subscription_confirmed',
  });
}

async function rejectInvalidSignature(
  supabase: SupabaseClient,
  res: Response,
  config: ProcessorConfig | null,
  payload: any,
  message: string,
): Promise<void> {
  if (config) {
    await createDiagnosticLog(config, payload, {
      signature_verified: false,
      verification_status: 'failed',
      action: 'ignored_invalid_signature',
      error_message: message,
    });
    await updateWebhookStatus(supabase, config.id, 'signature_failed', message);
  } else {
    await createUnmatchedDiagnosticLog(payload, {
      signature_verified: false,
      verification_status: 'failed',
      action: 'ignored_invalid_signature',
      error_message: message,
    });
  }
  logger.warn({ eventType: getEventType(payload), eventId: getEventId(payload) }, 'NMI official webhook rejected: invalid signature');
  res.status(401).json({ received: false, error: 'invalid signature' });
}

async function resolveOfficialWebhookConfig(
  supabase: SupabaseClient,
  req: Request,
  payload: any,
  processorConfigId?: string,
): Promise<{
  config: ProcessorConfig | null;
  signaturePresent: boolean;
  signatureVerified: boolean | null;
  invalidSignatureConfig: ProcessorConfig | null;
}> {
  const signature = String(req.get('Signature') || req.get('signature') || '');
  const signaturePresent = !!signature.trim();

  if (processorConfigId) {
    const config = await loadProcessorConfig(supabase, processorConfigId);
    if (!signaturePresent) {
      return { config, signaturePresent, signatureVerified: null, invalidSignatureConfig: config };
    }
    if (!config?.nmi_webhook_secret_encrypted) {
      return { config, signaturePresent, signatureVerified: false, invalidSignatureConfig: config };
    }
    const secret = processorConfigService.decryptNmiWebhookSecret(config);
    const signatureVerified = verifySignature(rawPayload(req), signature, secret);
    return {
      config: signatureVerified ? config : null,
      signaturePresent,
      signatureVerified,
      invalidSignatureConfig: config,
    };
  }

  if (signaturePresent) {
    const config = await findConfigBySignature(supabase, rawPayload(req), signature);
    if (config) return { config, signaturePresent, signatureVerified: true, invalidSignatureConfig: config };
    const configFromPayload = await loadConfigFromPayload(supabase, payload);
    if (configFromPayload && !configFromPayload.nmi_webhook_secret_encrypted) {
      return { config: configFromPayload, signaturePresent, signatureVerified: null, invalidSignatureConfig: configFromPayload };
    }
    return { config: null, signaturePresent, signatureVerified: false, invalidSignatureConfig: configFromPayload };
  }

  const config = await loadConfigFromPayload(supabase, payload);
  return { config, signaturePresent, signatureVerified: null, invalidSignatureConfig: config };
}

export async function processNmiOfficialWebhookRequest(
  req: Request,
  res: Response,
  options: { processorConfigId?: string; requireSignature?: boolean } = {},
): Promise<void> {
  const supabase = getSupabase();
  const processorConfigId = options.processorConfigId || '';
  const payload = req.body || {};
  let config: ProcessorConfig | null = null;
  let logId: string | null = null;

  try {
    const resolved = await resolveOfficialWebhookConfig(
      supabase,
      req,
      payload,
      processorConfigId || undefined,
    );
    config = resolved.config;

    if (!config) {
      if (resolved.signaturePresent && resolved.signatureVerified === false) {
        await rejectInvalidSignature(
          supabase,
          res,
          resolved.invalidSignatureConfig,
          payload,
          'NMI Signature header did not match stored webhook key',
        );
        return;
      }
      logger.warn({
        eventType: getEventType(payload),
        eventId: getEventId(payload),
        subscriptionId: getSubscriptionId(payload),
        transactionId: getTransactionId(payload),
      }, 'NMI official webhook could not be matched to a processor config');
      await createUnmatchedDiagnosticLog(payload, {
        signature_verified: resolved.signatureVerified === true,
        action: 'ignored_unmatched_processor_config',
        error_message: 'No active NMI processor config matched this official NMI event',
      });
      res.status(200).json({ received: true, matched: false });
      return;
    }

    if (options.requireSignature && !resolved.signaturePresent) {
      await rejectInvalidSignature(
        supabase,
        res,
        config,
        payload,
        'NMI Signature header was missing',
      );
      return;
    }

    const eventId = getEventId(payload);
    if (eventId) {
      const { data: existing } = await supabase
        .from('nmi_silent_post_logs')
        .select('id, action')
        .eq('event_id', eventId)
        .maybeSingle();
      if (existing) {
        logger.info({ eventId, eventType: getEventType(payload) }, 'NMI official webhook duplicate event skipped');
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
    }

    logId = await createDiagnosticLog(config, payload);
    if (resolved.signatureVerified === true) {
      await updateDiagnosticLog(logId, { signature_verified: true });
      await updateWebhookStatus(supabase, config.id, 'verified', null);
    } else {
      await updateDiagnosticLog(logId, {
        signature_verified: false,
        error_message: resolved.signaturePresent
          ? 'Signature header received, but no NMI webhook key is saved yet; proceeding by transaction verification/matching'
          : 'No Signature header on official NMI event; proceeding by transaction verification/matching',
      });
    }

    const eventType = getEventType(payload);
    if (eventType.startsWith('transaction.')) {
      await processTransactionEvent(supabase, config, payload, logId);
    } else if (eventType.startsWith('recurring.subscription.')) {
      await processSubscriptionEvent(supabase, config, payload, logId);
    } else {
      await updateDiagnosticLog(logId, {
        action: 'ignored_unhandled_event_type',
        verification_status: 'skipped',
        error_message: `Unhandled NMI event type: ${eventType || 'unknown'}`,
      });
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack, processorConfigId }, 'NMI official webhook handler error');
    if (config) {
      await updateDiagnosticLog(logId, {
        action: 'handler_error',
        error_message: err.message || 'NMI official webhook handler error',
      });
      await updateWebhookStatus(supabase, config.id, 'error', err.message || 'NMI official webhook handler error');
    }
    res.status(200).json({ received: true });
  }
}

/**
 * POST /webhooks/nmi/events/:processorConfigId
 *
 * Optional direct official webhook route. The merchant-facing NMI setup should
 * normally use /webhooks/nmi/silent-post, which now detects official events too.
 */
export async function handleNmiWebhookEvent(req: Request, res: Response): Promise<void> {
  await processNmiOfficialWebhookRequest(req, res, {
    processorConfigId: String(req.params.processorConfigId || ''),
    requireSignature: true,
  });
}
