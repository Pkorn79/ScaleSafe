import crypto from 'crypto';
import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { createProcessorClient, resolveProcessor } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { triggerService } from '../services/trigger.service';
import { nmiDiagnosticLogService } from '../services/nmi-diagnostic-log.service';
import { processorConfigService } from '../services/processor-config.service';
import { dualPricingService } from '../services/dual-pricing.service';
import { merchantService } from '../services/merchant.service';
import { offerService } from '../services/offer.service';
import { ghlApi } from '../clients/ghl.client';
import { createPublicActionToken } from '../utils/public-action-token';
import { config as appConfig } from '../config';
import { ProcessorConfig, VerifyResult } from '../types/processor.types';
import { logger } from '../utils/logger';

const TRANSACTION_SUCCESS = 'transaction.sale.success';
const TRANSACTION_FAILURE = 'transaction.sale.failure';
const TRANSACTION_UNKNOWN = 'transaction.sale.unknown';
const TRANSACTION_AUTH_SUCCESS = 'transaction.auth.success';
const TRANSACTION_CAPTURE_SUCCESS = 'transaction.capture.success';
const TRANSACTION_REFUND_SUCCESS = 'transaction.refund.success';
const TRANSACTION_VOID_SUCCESS = 'transaction.void.success';
const TRANSACTION_CHECK_SETTLE = 'transaction.check.status.settle';
const TRANSACTION_CHECK_RETURN = 'transaction.check.status.return';
const TRANSACTION_CHECK_LATE_RETURN = 'transaction.check.status.latereturn';
const TRANSACTION_CHECK_STATUS_EVENTS = new Set([
  TRANSACTION_CHECK_SETTLE,
  TRANSACTION_CHECK_RETURN,
  TRANSACTION_CHECK_LATE_RETURN,
]);
const TRANSACTION_REVERSAL_FAILURES = new Set([
  'transaction.refund.failure',
  'transaction.void.failure',
]);
const TRANSACTION_LOG_ONLY_EVENTS = new Set([
  TRANSACTION_AUTH_SUCCESS,
  TRANSACTION_CAPTURE_SUCCESS,
  'transaction.auth.failure',
  'transaction.capture.failure',
  'settlement.batch.complete',
  'settlement.batch.failure',
  'recurring.subscription.add',
  'recurring.subscription.update',
  'recurring.subscription.delete',
]);

function formatMoney(amount: number): string {
  return `$${Number(amount || 0).toFixed(2)}`;
}

type SupabaseClient = ReturnType<typeof getSupabase>;
type RecurringSetupState = 'ready' | 'pending' | 'failed';

function normalizePaymentType(value: unknown): string {
  const raw = String(value || 'pif').toLowerCase();
  if (raw === 'installments') return 'installment';
  if (raw === 'one_time' || raw === 'one-time') return 'pif';
  return raw || 'pif';
}

function isRecurringPaymentType(value: unknown): boolean {
  return ['installment', 'subscription'].includes(normalizePaymentType(value));
}

function processorInterval(frequency: string | null | undefined): 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' {
  const freq = String(frequency || '').toLowerCase();
  if (freq === 'daily') return 'daily';
  if (freq === 'weekly') return 'weekly';
  if (freq === 'bi_weekly' || freq === 'biweekly') return 'biweekly';
  if (freq === 'quarterly') return 'quarterly';
  if (freq === 'annual') return 'annual';
  return 'monthly';
}

function computeNextBillingDate(frequency: string | null | undefined, from: Date = new Date()): string {
  const next = new Date(from);
  switch (processorInterval(frequency)) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'annual': next.setFullYear(next.getFullYear() + 1); break;
    case 'monthly':
    default: next.setMonth(next.getMonth() + 1); break;
  }
  return next.toISOString().split('T')[0];
}

async function buildPaidEnrollmentUrl(params: {
  locationId: string;
  offerId: string;
  contactId: string;
  enrollmentId: string;
}): Promise<string> {
  let funnelBaseUrl = '';
  try {
    const merchantConfig = await merchantService.getFullConfig(params.locationId);
    funnelBaseUrl = merchantConfig.enrollmentFunnelUrl || '';
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), locationId: params.locationId, offerId: params.offerId, enrollmentId: params.enrollmentId },
      'Failed to load merchant funnel URL for NMI paid enrollment link',
    );
  }
  const link = offerService.generateEnrollmentLink(params.offerId, appConfig.appUrl, 'full_enrollment', funnelBaseUrl);
  const paidToken = createPublicActionToken({
    action: 'paid_enrollment',
    locationId: params.locationId,
    contactId: params.contactId,
    enrollmentId: params.enrollmentId,
    ttlSeconds: 30 * 24 * 60 * 60,
  });
  const url = new URL(link);
  url.searchParams.set('paidEnrollmentToken', paidToken);
  return url.toString();
}

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

type NmiSignatureHeader = {
  format: 'merchant_portal' | 'legacy';
  value: string;
};

function getSignatureHeader(req: Request): NmiSignatureHeader | null {
  const merchantPortal = String(req.get('Webhook-Signature') || '').trim();
  if (merchantPortal) return { format: 'merchant_portal', value: merchantPortal };

  const legacy = String(req.get('Signature') || '').trim();
  return legacy ? { format: 'legacy', value: legacy } : null;
}

function constantTimeTextMatch(sentValue: string, expectedValue: string): boolean {
  const sent = Buffer.from(sentValue, 'utf8');
  const expected = Buffer.from(expectedValue, 'utf8');
  return sent.length === expected.length && crypto.timingSafeEqual(sent, expected);
}

function verifySignature(raw: Buffer, signatureHeader: NmiSignatureHeader, secret: string): boolean {
  if (!signatureHeader?.value || !secret) return false;

  if (signatureHeader.format === 'merchant_portal') {
    const match = /^t=([^,]+),s=([^,]+)$/.exec(signatureHeader.value);
    if (!match) return false;

    const signedPayload = Buffer.concat([
      Buffer.from(`${match[1]}.`, 'utf8'),
      raw,
    ]);
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    return constantTimeTextMatch(match[2], expected);
  }

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
    return constantTimeTextMatch(signatureHeader.value, expected);
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
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('id', enrollmentId)
      .single();
    if (data) return data;
  }

  const subscriptionId = getSubscriptionId(payload);
  if (subscriptionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
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
  signature: NmiSignatureHeader,
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
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('id', enrollmentId)
      .eq('location_id', config.location_id)
      .single();
    if (data) return data;
  }

  const subscriptionId = getSubscriptionId(payload);
  if (subscriptionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
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
  achAccessPolicy: 'after_settlement' | 'after_submission';
}> {
  if (!offerId) return { offerName: '', installmentFrequency: 'monthly', achAccessPolicy: 'after_settlement' };
  const { data } = await supabase
    .from('offers_mirror')
    .select('offer_name, installment_frequency, ach_access_policy')
    .eq('id', offerId)
    .single();
  return {
    offerName: data?.offer_name || '',
    installmentFrequency: data?.installment_frequency || 'monthly',
    achAccessPolicy: data?.ach_access_policy === 'after_submission' ? 'after_submission' : 'after_settlement',
  };
}

async function fireNmiAchReceipt(params: {
  locationId: string;
  contactId: string;
  enrollmentId?: string | null;
  offerId?: string | null;
  offerName?: string;
  amount: number;
  transactionId: string;
  paymentKind: string;
  paymentTiming: string;
  paymentSource: string;
  achPaymentStatus: string;
}): Promise<void> {
  await triggerService.fireTrigger(params.locationId, 'ss_payment_received', {
    event_type: 'payment_received',
    location_id: params.locationId,
    locationId: params.locationId,
    contact_id: params.contactId,
    contactId: params.contactId,
    enrollment_id: params.enrollmentId || '',
    enrollmentId: params.enrollmentId || '',
    offer_id: params.offerId || '',
    offerId: params.offerId || '',
    program_name: params.offerName || '',
    programName: params.offerName || '',
    offer_name: params.offerName || '',
    offerName: params.offerName || '',
    processor: 'nmi',
    source: params.paymentSource,
    payment_source: params.paymentSource,
    paymentSource: params.paymentSource,
    payment_timing: params.paymentTiming,
    paymentTiming: params.paymentTiming,
    amount: params.amount,
    amount_display: formatMoney(params.amount),
    amountDisplay: formatMoney(params.amount),
    transaction_id: params.transactionId,
    transactionId: params.transactionId,
    payment_kind: params.paymentKind,
    paymentKind: params.paymentKind,
    receipt_only: true,
    receiptOnly: true,
    send_receipt: true,
    sendReceipt: true,
    send_welcome: false,
    sendWelcome: false,
    ach_payment_status: params.achPaymentStatus,
    achPaymentStatus: params.achPaymentStatus,
  });
}

async function sendNmiAchPaidEnrollmentLink(params: {
  locationId: string;
  contactId: string;
  enrollmentId: string;
  offerId: string;
  offerName: string;
  amount: number;
  customerEmail: string;
  rawPayload: any;
  achPaymentStatus: string;
}): Promise<void> {
  const enrollmentUrl = await buildPaidEnrollmentUrl({
    locationId: params.locationId,
    offerId: params.offerId,
    contactId: params.contactId,
    enrollmentId: params.enrollmentId,
  });

  try {
    const api = await ghlApi(params.locationId);
    await api.put(`/contacts/${params.contactId}`, {
      customField: {
        'contact.ss_enrollment_link': enrollmentUrl,
        'contact.ss_current_offer_name': params.offerName,
        'contact.ss_enrollment_status': 'paid_pending_enrollment',
      },
    });
  } catch (err: any) {
    logger.warn({ err: err.message, contactId: params.contactId }, 'NMI ACH quick manual sale contact field sync failed');
  }

  await triggerService.fireTrigger(params.locationId, 'ss_send_enrollment_link', {
    event_type: 'send_enrollment_link',
    location_id: params.locationId,
    locationId: params.locationId,
    contact_id: params.contactId,
    contactId: params.contactId,
    enrollment_id: params.enrollmentId,
    enrollmentId: params.enrollmentId,
    offer_id: params.offerId,
    offerId: params.offerId,
    offer_name: params.offerName,
    offerName: params.offerName,
    program_name: params.offerName,
    programName: params.offerName,
    enrollment_url: enrollmentUrl,
    enrollmentUrl,
    payment_status: 'paid_pending_enrollment',
    paymentStatus: 'paid_pending_enrollment',
    payment_source: 'quick_manual_sale',
    paymentSource: 'quick_manual_sale',
    payment_timing: 'before_enrollment',
    paymentTiming: 'before_enrollment',
    enrollment_status: 'paid_pending_enrollment',
    enrollmentStatus: 'paid_pending_enrollment',
    send_welcome: false,
    sendWelcome: false,
    ach_payment_status: params.achPaymentStatus,
    achPaymentStatus: params.achPaymentStatus,
    amount: params.amount,
    first_name: firstString(params.rawPayload, ['first_name', 'metadata.first_name']) || '',
    firstName: firstString(params.rawPayload, ['first_name', 'metadata.first_name']) || '',
    last_name: firstString(params.rawPayload, ['last_name', 'metadata.last_name']) || '',
    lastName: firstString(params.rawPayload, ['last_name', 'metadata.last_name']) || '',
    email: params.customerEmail,
  });
}

async function claimNmiAchRecurringSetup(
  supabase: SupabaseClient,
  locationId: string,
  enrollmentId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from('enrollments').update({
    billing_setup_status: 'needs_reconciliation',
    billing_setup_error: 'Recurring billing setup is in progress or requires reconciliation.',
  })
    .eq('id', enrollmentId)
    .eq('location_id', locationId)
    .in('billing_setup_status', ['pending', 'ok'])
    .is('processor_subscription_id', null)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function setupNmiAchRecurringAfterSettlement(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  enrollmentId: string,
  transactionId: string,
): Promise<RecurringSetupState> {
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, merchant_id, location_id, contact_id, offer_id, payment_type, payments_made, payments_total, processor_subscription_id, next_billing_date, billing_setup_status')
    .eq('id', enrollmentId)
    .eq('location_id', config.location_id)
    .maybeSingle();

  if (!enrollment || !isRecurringPaymentType(enrollment.payment_type)) return 'ready';
  if (enrollment.processor_subscription_id) return 'ready';

  const paymentType = normalizePaymentType(enrollment.payment_type);
  const remainingPayments = paymentType === 'subscription'
    ? 0
    : Math.max(0, Number(enrollment.payments_total || 0) - Number(enrollment.payments_made || 1));

  if (paymentType === 'installment' && remainingPayments <= 0) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'ok',
      billing_completed_at: new Date().toISOString(),
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'ready';
  }

  const { data: offer } = await supabase
    .from('offers_mirror')
    .select('id, location_id, offer_name, price, payment_type, installment_amount, installment_frequency, dual_pricing_enabled, ach_enabled, ach_access_policy, nmi_processor_id')
    .eq('id', enrollment.offer_id)
    .eq('location_id', config.location_id)
    .maybeSingle();

  if (!offer) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'failed',
      billing_setup_error: 'NMI ACH payment settled, but the offer was not found for recurring setup.',
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'failed';
  }

  const { data: nmiMethods } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('location_id', config.location_id)
    .eq('contact_id', enrollment.contact_id)
    .eq('processor_type', 'nmi')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  const savedMethod = (nmiMethods || []).find((method: any) => (
    method.payment_method_kind === 'ach'
    || !!method.bank_last_four
    || String(method.card_brand || '').toLowerCase() === 'bank'
  ));
  const vaultId = savedMethod?.nmi_customer_vault_id || '';
  if (!vaultId) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'failed',
      billing_setup_error: 'NMI ACH payment settled, but no saved NMI bank vault was available for recurring setup.',
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'failed';
  }

  const quote = await dualPricingService.quoteOffer(offer as any, paymentType, 'ach');
  if (quote.selectedAmountCents <= 0) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'failed',
      billing_setup_error: 'NMI ACH recurring setup failed because the recurring amount was not valid.',
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'failed';
  }

  const { config: procConfig } = await resolveProcessor(enrollment.merchant_id, config.location_id, {
    processor_override: 'nmi',
    nmi_processor_id: offer.nmi_processor_id || config.nmi_processor_id || null,
  });
  const processor = createProcessorClient(procConfig);
  const startDate = enrollment.next_billing_date || computeNextBillingDate(offer.installment_frequency);
  const claimed = await claimNmiAchRecurringSetup(supabase, config.location_id, enrollment.id);
  if (!claimed) {
    const { data: current, error } = await supabase.from('enrollments')
      .select('processor_subscription_id, billing_setup_status')
      .eq('id', enrollment.id)
      .eq('location_id', config.location_id)
      .maybeSingle();
    if (error) throw error;
    if (current?.processor_subscription_id) return 'ready';
    return current?.billing_setup_status === 'failed' ? 'failed' : 'pending';
  }

  let subResult;
  try {
    subResult = await processor.createSubscription({
      paymentMethodId: vaultId,
      customerId: vaultId,
      planAmount: quote.selectedAmountCents,
      interval: processorInterval(offer.installment_frequency),
      totalPayments: remainingPayments,
      startDate,
      description: offer.offer_name || 'ScaleSafe ACH Recurring Plan',
      metadata: {
        enrollment_id: enrollment.id,
        offer_id: enrollment.offer_id || '',
        contact_id: enrollment.contact_id || '',
        location_id: config.location_id,
        payment_type: paymentType,
        payment_method_type: 'ach',
      },
      idempotencyKey: `nmi-ach-recurring-${enrollment.id}-${transactionId}`,
    });
  } catch (err: any) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'needs_reconciliation',
      billing_setup_error: `NMI ACH recurring setup result is unknown: ${err?.message || 'NMI request failed'}`,
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'pending';
  }

  if (!subResult.success || !subResult.subscriptionId) {
    const resultUnknown = /approved recurring setup.*did not return a subscription id/i.test(subResult.errorMessage || '');
    await supabase.from('enrollments').update({
      billing_setup_status: resultUnknown ? 'needs_reconciliation' : 'failed',
      billing_setup_error: subResult.errorMessage || 'NMI ACH recurring subscription creation failed.',
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return resultUnknown ? 'pending' : 'failed';
  }

  const { error: saveError } = await supabase.from('enrollments').update({
    processor_subscription_id: subResult.subscriptionId,
    processor_type: 'nmi',
    billing_setup_status: 'ok',
    billing_setup_error: null,
    next_billing_date_source: 'processor',
    ...(subResult.nextPaymentDate ? { next_billing_date: subResult.nextPaymentDate.split('T')[0] } : { next_billing_date: startDate }),
  }).eq('id', enrollment.id).eq('location_id', config.location_id);

  if (saveError) {
    await supabase.from('enrollments').update({
      billing_setup_status: 'needs_reconciliation',
      billing_setup_error: `NMI ACH subscription ${subResult.subscriptionId} was created but could not be saved: ${saveError.message}`,
      next_billing_date: null,
    }).eq('id', enrollment.id).eq('location_id', config.location_id);
    return 'pending';
  }

  return 'ready';
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

async function processAchStatusEvent(
  supabase: SupabaseClient,
  config: ProcessorConfig,
  payload: any,
  logId: string | null,
): Promise<void> {
  const eventType = getEventType(payload);
  const transactionId = getTransactionId(payload);
  if (!transactionId) {
    await updateDiagnosticLog(logId, {
      action: 'ignored_ach_status_missing_transaction_id',
      verification_status: 'failed',
      error_message: 'NMI ACH status event did not include a transaction id',
    });
    return;
  }

  const { data: payment } = await supabase
    .from('payment_events')
    .select('id, merchant_id, location_id, contact_id, enrollment_id, offer_id, processor, processor_transaction_id, amount, currency, customer_email, payment_status, source, raw_webhook_payload')
    .eq('location_id', config.location_id)
    .eq('processor', 'nmi')
    .eq('processor_transaction_id', transactionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment) {
    await updateDiagnosticLog(logId, {
      matched: false,
      action: 'ach_status_unmatched_payment',
      verification_status: 'skipped',
      error_message: `No ScaleSafe payment matched NMI ACH transaction ${transactionId}`,
    });
    return;
  }

  const isSettle = eventType === TRANSACTION_CHECK_SETTLE;
  const isLateReturn = eventType === TRANSACTION_CHECK_LATE_RETURN;
  const paymentStatus = isSettle ? 'settled' : (isLateReturn ? 'late_return' : 'returned');
  const timestampColumn = isSettle ? 'settled_at' : 'returned_at';
  const now = new Date().toISOString();
  const returnReason = isSettle ? null : (getResponseText(payload) || getResponseCode(payload) || eventType);

  const updatePayload: Record<string, unknown> = {
    payment_status: paymentStatus,
    [timestampColumn]: now,
    return_reason: returnReason,
    raw_webhook_payload: payload,
  };
  const { error: updateErr } = await supabase
    .from('payment_events')
    .update(updatePayload)
    .eq('id', payment.id);
  if (updateErr) {
    await updateDiagnosticLog(logId, {
      action: 'ach_status_payment_update_failed',
      verification_status: 'failed',
      payment_event_id: payment.id,
      error_message: updateErr.message,
    });
    return;
  }

  let enrollment: any = null;
  if (payment.enrollment_id) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, location_id, contact_id, email, payment_type, payments_total, processor_type, status, offer_id, processor_subscription_id, next_billing_date')
      .eq('id', payment.enrollment_id)
      .eq('location_id', config.location_id)
      .maybeSingle();
    enrollment = data || null;

    if (enrollment) {
      await supabase.from('enrollments').update({
        initial_payment_status: paymentStatus,
        initial_payment_settled_at: isSettle ? now : null,
        initial_payment_returned_at: isSettle ? null : now,
        initial_payment_return_reason: returnReason,
        ...(isSettle ? {} : { status: 'payment_returned' }),
      } as any).eq('id', enrollment.id).eq('location_id', config.location_id);
    }
  }

  if (isSettle) {
    if (enrollment && payment.source === 'quick_manual_sale' && String(enrollment.status || '') === 'payment_processing') {
      const { offerName } = await offerDetails(supabase, enrollment.offer_id || payment.offer_id || null);
      const recurringState = await setupNmiAchRecurringAfterSettlement(
        supabase,
        config,
        enrollment.id,
        transactionId,
      );
      await supabase.from('enrollments').update({
        status: 'paid_pending_enrollment',
        initial_payment_status: paymentStatus,
        initial_payment_settled_at: now,
        ...(!isRecurringPaymentType(enrollment.payment_type) || recurringState === 'ready'
          ? { billing_setup_status: 'ok' }
          : {}),
      } as any).eq('id', enrollment.id).eq('location_id', config.location_id);

      const raw = payment.raw_webhook_payload || {};
      if (enrollment.offer_id && enrollment.contact_id && raw?.sendEnrollment !== false && raw?.send_enrollment !== false) {
        await sendNmiAchPaidEnrollmentLink({
          locationId: config.location_id,
          contactId: enrollment.contact_id,
          enrollmentId: enrollment.id,
          offerId: enrollment.offer_id,
          offerName,
          amount: Number(payment.amount || 0),
          customerEmail: payment.customer_email || enrollment.email || '',
          rawPayload: raw,
          achPaymentStatus: paymentStatus,
        });
      }

      await fireNmiAchReceipt({
        locationId: config.location_id,
        contactId: enrollment.contact_id || payment.contact_id || '',
        enrollmentId: enrollment.id,
        offerId: enrollment.offer_id || payment.offer_id || '',
        offerName,
        amount: Number(payment.amount || 0),
        transactionId,
        paymentKind: enrollment.payment_type || 'pif',
        paymentTiming: 'before_enrollment',
        paymentSource: 'quick_manual_sale',
        achPaymentStatus: paymentStatus,
      });
    } else if (enrollment && ['payment_processing', 'consent_captured'].includes(String(enrollment.status || ''))) {
      if (isRecurringPaymentType(enrollment.payment_type)) {
        const recurringState = await setupNmiAchRecurringAfterSettlement(
          supabase,
          config,
          enrollment.id,
          transactionId,
        );
        if (recurringState !== 'ready') {
          const { offerName } = await offerDetails(supabase, enrollment.offer_id || payment.offer_id || null);
          await fireNmiAchReceipt({
            locationId: config.location_id,
            contactId: enrollment.contact_id || payment.contact_id || '',
            enrollmentId: enrollment.id,
            offerId: enrollment.offer_id || payment.offer_id || '',
            offerName,
            amount: Number(payment.amount || 0),
            transactionId,
            paymentKind: enrollment.payment_type || 'pif',
            paymentTiming: 'during_enrollment',
            paymentSource: 'nmi_ach_settlement',
            achPaymentStatus: paymentStatus,
          });
          return;
        }
      }
      await phase2EnrollmentService.completeEnrollment({
        enrollmentId: enrollment.id,
        locationId: enrollment.location_id,
        contactId: enrollment.contact_id || payment.contact_id || '',
        contactEmail: payment.customer_email || enrollment.email || '',
        paymentAmount: Number(payment.amount || 0),
        paymentType: enrollment.payment_type || 'pif',
        transactionId,
        paymentsTotal: enrollment.payments_total || null,
        processorType: 'nmi',
        paymentSource: 'nmi_ach_settlement',
        skipPaymentEvent: true,
      });
    } else if (!payment.enrollment_id && payment.contact_id) {
      const { offerName } = await offerDetails(supabase, payment.offer_id || null);
      await triggerService.fireTrigger(payment.location_id, 'ss_payment_received', {
        event_type: 'payment_received',
        location_id: payment.location_id,
        locationId: payment.location_id,
        contact_id: payment.contact_id,
        contactId: payment.contact_id,
        offer_id: payment.offer_id || '',
        offerId: payment.offer_id || '',
        program_name: offerName,
        programName: offerName,
        offer_name: offerName,
        offerName,
        processor: 'nmi',
        source: 'nmi_ach_settlement',
        payment_source: 'nmi_ach_settlement',
        paymentSource: 'nmi_ach_settlement',
        payment_timing: 'settlement',
        paymentTiming: 'settlement',
        amount: Number(payment.amount || 0),
        amount_display: formatMoney(Number(payment.amount || 0)),
        amountDisplay: formatMoney(Number(payment.amount || 0)),
        transaction_id: transactionId,
        transactionId,
        payment_kind: 'manual_sale',
        paymentKind: 'manual_sale',
        receipt_only: true,
        receiptOnly: true,
        send_receipt: true,
        sendReceipt: true,
        send_welcome: false,
        sendWelcome: false,
      });
    }
  }

  await updateDiagnosticLog(logId, {
    matched: true,
    action: `ach_${paymentStatus}_recorded`,
    verification_status: 'verified',
    payment_event_id: payment.id,
    enrollment_id: payment.enrollment_id || null,
    error_message: returnReason,
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

  if (TRANSACTION_CHECK_STATUS_EVENTS.has(eventType)) {
    await processAchStatusEvent(supabase, config, effectivePayload, logId);
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
  const signature = getSignatureHeader(req);
  const signaturePresent = signature !== null;

  if (processorConfigId) {
    const config = await loadProcessorConfig(supabase, processorConfigId);
    if (!signaturePresent) {
      return { config, signaturePresent, signatureVerified: null, invalidSignatureConfig: config };
    }
    if (!config?.nmi_webhook_secret_encrypted) {
      return { config, signaturePresent, signatureVerified: false, invalidSignatureConfig: config };
    }
    const secret = processorConfigService.decryptNmiWebhookSecret(config);
    const signatureVerified = verifySignature(rawPayload(req), signature!, secret);
    return {
      config: signatureVerified ? config : null,
      signaturePresent,
      signatureVerified,
      invalidSignatureConfig: config,
    };
  }

  if (signaturePresent) {
    const config = await findConfigBySignature(supabase, rawPayload(req), signature!);
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
          'NMI webhook signature did not match the stored signing key',
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
        'NMI webhook signature header was missing',
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
          ? 'Webhook signature received, but no NMI signing key is saved yet; proceeding by transaction verification/matching'
          : 'No webhook signature on official NMI event; proceeding by transaction verification/matching',
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
