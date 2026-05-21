import crypto from 'crypto';
import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { nmiDiagnosticLogService } from '../services/nmi-diagnostic-log.service';
import { processorConfigService } from '../services/processor-config.service';
import { ProcessorConfig } from '../types/processor.types';
import { logger } from '../utils/logger';

const TRANSACTION_SUCCESS = 'transaction.sale.success';
const TRANSACTION_FAILURE = 'transaction.sale.failure';
const TRANSACTION_UNKNOWN = 'transaction.sale.unknown';

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

function getSubscriptionId(payload: any): string {
  const body = eventBody(payload);
  return firstString(body, [
    'subscription_id',
    'subscription.id',
    'recurring_subscription_id',
    'recurring.id',
    'reference_id',
    'referenceid',
    'action.subscription_id',
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
  return firstString(body, ['action.source', 'source', 'transaction.source']).toLowerCase();
}

function getAmount(payload: any): number {
  const body = eventBody(payload);
  return firstNumber(body, ['action.amount', 'amount', 'requested_amount', 'transaction.amount', 'plan.amount']);
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

function rawPayload(req: Request): Buffer {
  if ((req as any).rawBody instanceof Buffer) return (req as any).rawBody;
  return Buffer.from(JSON.stringify(req.body || {}));
}

function verifySignature(raw: Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expectedHex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expectedBase64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const candidates = [expectedHex, expectedBase64];

  return candidates.some((expected) => {
    const sent = Buffer.from(signatureHeader.trim(), 'utf8');
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

async function processTransactionEvent(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  payload: any,
  logId: string | null,
): Promise<void> {
  const eventType = getEventType(payload);
  const source = getTransactionSource(payload);
  if (source && source !== 'recurring') {
    await updateDiagnosticLog(logId, {
      action: 'ignored_non_recurring_event',
      verification_status: 'skipped',
      error_message: `Transaction source was ${source}, not recurring`,
    });
    return;
  }

  const enrollment = await findEnrollment(supabase, config, payload);
  if (!enrollment) {
    await updateDiagnosticLog(logId, {
      matched: false,
      action: 'ignored_unmatched_event',
      error_message: 'No enrollment matched NMI event metadata or subscription id',
    });
    return;
  }

  await updateDiagnosticLog(logId, {
    matched: true,
    enrollment_id: enrollment.id,
    merchant_id: enrollment.merchant_id,
    location_id: enrollment.location_id,
  });

  const transactionId = getTransactionId(payload);
  if (transactionId) {
    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('processor_transaction_id', transactionId)
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

  const amountCents = Math.round(getAmount(payload) * 100);
  const { offerName, installmentFrequency } = await offerDetails(supabase, enrollment.offer_id);

  if (eventType === TRANSACTION_SUCCESS) {
    if (transactionId) {
      try {
        const processor = createProcessorClient(config);
        const verification = await processor.verifyTransaction(transactionId);
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
      amountCents,
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
    errorMessage: getResponseText(payload) || `NMI event: ${eventType}`,
    errorCode: getResponseCode(payload) || eventType,
    source: 'nmi_webhook_event',
  });

  await updateDiagnosticLog(logId, {
    action: failed.paymentEventId ? 'processed_failure' : 'processed_failure_payment_event_missing',
    verification_status: eventType === TRANSACTION_UNKNOWN ? 'unknown' : 'skipped',
    error_message: failed.paymentEventId ? (getResponseText(payload) || `NMI event: ${eventType}`) : 'Failed payment handler did not return a payment_event id',
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

/**
 * POST /webhooks/nmi/events/:processorConfigId
 *
 * NMI official webhooks are JSON and signed with the Signature header.
 */
export async function handleNmiWebhookEvent(req: Request, res: Response): Promise<void> {
  const supabase = getSupabase();
  const processorConfigId = String(req.params.processorConfigId || '');
  const payload = req.body || {};
  let config: ProcessorConfig | null = null;
  let logId: string | null = null;

  try {
    config = await loadProcessorConfig(supabase, processorConfigId);
    if (!config) {
      res.status(404).json({ received: false, error: 'NMI processor config not found' });
      return;
    }

    const signature = String(req.get('Signature') || req.get('signature') || '');
    const secret = processorConfigService.decryptNmiWebhookSecret(config);
    const signatureVerified = verifySignature(rawPayload(req), signature, secret);

    if (!signatureVerified) {
      logId = await createDiagnosticLog(config, payload, {
        signature_verified: false,
        verification_status: 'failed',
        action: 'ignored_invalid_signature',
        error_message: 'NMI Signature header did not match stored webhook secret',
      });
      await updateWebhookStatus(supabase, config.id, 'signature_failed', 'Latest NMI event had an invalid signature');
      logger.warn({ processorConfigId, eventType: getEventType(payload), eventId: getEventId(payload) }, 'NMI official webhook rejected: invalid signature');
      res.status(401).json({ received: false, error: 'invalid signature' });
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
    await updateWebhookStatus(supabase, config.id, 'verified', null);

    const eventType = getEventType(payload);
    if ([TRANSACTION_SUCCESS, TRANSACTION_FAILURE, TRANSACTION_UNKNOWN].includes(eventType)) {
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
