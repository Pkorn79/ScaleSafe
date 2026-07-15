import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { offerRepository } from '../repositories/offer.repository';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { whopConfigService } from '../services/whop-config.service';
import { whopService } from '../services/whop.service';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { paymentLifecycleService } from '../services/payment-lifecycle.service';
import { logger } from '../utils/logger';
import { paymentEventRepository } from '../repositories/paymentEvent.repository';
import { payFirstEnrollmentService } from '../services/pay-first-enrollment.service';

function firstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function eventType(payload: any): string {
  return firstString(payload?.type, payload?.event_type, payload?.eventType, payload?.name);
}

function body(payload: any): any {
  return payload?.data || payload?.event_body || payload?.eventBody || payload?.resource || payload;
}

function metadata(payload: any): Record<string, any> {
  const b = body(payload);
  return b?.metadata
    || b?.payment?.metadata
    || b?.membership?.metadata
    || b?.checkout_session?.metadata
    || b?.checkoutSession?.metadata
    || {};
}

async function findExistingContactIdByEmail(locationId: string, email: string): Promise<string> {
  if (!locationId || !email) return '';
  const { data } = await getSupabase()
    .from('enrollments')
    .select('contact_id')
    .eq('location_id', locationId)
    .eq('email', email)
    .not('contact_id', 'is', null)
    .not('contact_id', 'eq', '')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.contact_id || '';
}

async function resolveWhopContactId(locationId: string, payload: any): Promise<string> {
  const meta = metadata(payload);
  const b = body(payload);
  const explicitContactId = firstString(meta.contact_id, meta.contactId, b?.customer?.metadata?.contact_id);
  if (explicitContactId) return explicitContactId;

  const email = firstString(
    meta.contact_email,
    meta.contactEmail,
    meta.email,
    b?.customer?.email,
    b?.email,
    b?.payer_email,
  ).toLowerCase();
  if (!email) return '';

  const existingContactId = await findExistingContactIdByEmail(locationId, email);
  if (existingContactId) return existingContactId;

  const contactName = firstString(meta.contact_name, meta.contactName, b?.customer?.name, b?.name);
  const nameParts = contactName.trim().split(/\s+/).filter(Boolean);
  const api = await ghlApi(locationId);
  const upsertRes = await api.post('/contacts/upsert', {
    firstName: nameParts[0] || email.split('@')[0] || 'Client',
    lastName: nameParts.slice(1).join(' ') || '',
    email,
    phone: firstString(meta.contact_phone, meta.contactPhone, b?.customer?.phone, b?.phone) || undefined,
    locationId,
  });
  return upsertRes.data.contact?.id || upsertRes.data.id || '';
}

function parseLineItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function lineItems(payload: any, enrollment?: any): unknown[] {
  const meta = metadata(payload);
  const b = body(payload);
  const parsed = [
    ...parseLineItems(meta.line_items),
    ...parseLineItems(meta.lineItems),
    ...parseLineItems(b?.line_items),
    ...parseLineItems(b?.lineItems),
  ];
  if (parsed.length > 0) return parsed;
  return parseLineItems(enrollment?.selected_checkout_items);
}

function mergedLineItems(payload: any, ...enrollments: any[]): unknown[] {
  const fromPayload = lineItems(payload);
  if (fromPayload.length > 0) return fromPayload;
  for (const enrollment of enrollments) {
    const fromEnrollment = parseLineItems(enrollment?.selected_checkout_items);
    if (fromEnrollment.length > 0) return fromEnrollment;
  }
  return [];
}

function amountCents(payload: any): number {
  const b = body(payload);
  const meta = metadata(payload);
  const centsRaw = b?.amount_cents
    ?? b?.payment?.amount_cents
    ?? b?.amount_total
    ?? b?.payment?.amount_total
    ?? b?.total_cents
    ?? b?.usd_total_cents;
  if (centsRaw !== undefined && centsRaw !== null && centsRaw !== '') {
    const cents = Number(centsRaw);
    return Number.isFinite(cents) ? Math.round(cents) : 0;
  }

  const raw = b?.amount
    ?? b?.payment?.amount
    ?? b?.total
    ?? b?.usd_total
    ?? b?.subtotal
    ?? b?.amount_after_fees
    ?? b?.settlement_amount
    ?? meta.due_today_amount
    ?? meta.selected_amount
    ?? meta.amount;
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return 0;
  if (typeof raw === 'string' && raw.includes('.')) return Math.round(n * 100);
  return Math.round(n * 100);
}

function paymentId(payload: any): string {
  const b = body(payload);
  return firstString(
    b?.id,
    b?.payment_id,
    b?.paymentId,
    b?.payment?.id,
    b?.charge?.id,
    payload?.id,
  );
}

function membershipId(payload: any): string {
  const b = body(payload);
  const explicitMembershipId = firstString(
    b?.membership_id,
    b?.membershipId,
    b?.membership?.id,
    b?.member?.id,
  );
  if (explicitMembershipId) return explicitMembershipId;
  const resourceId = firstString(b?.id);
  return resourceId.startsWith('mem_') ? resourceId : '';
}

function refundId(payload: any): string {
  const b = body(payload);
  return firstString(
    /^rf_/.test(String(b?.refund_id || '')) ? b.refund_id : '',
    /^rf_/.test(String(b?.refundId || '')) ? b.refundId : '',
    /^rf_/.test(String(b?.refund?.id || '')) ? b.refund.id : '',
    /^rf_/.test(String(b?.id || '')) ? b.id : '',
  );
}

function originalPaymentId(payload: any): string {
  const b = body(payload);
  return firstString(
    b?.payment_id,
    b?.paymentId,
    b?.payment?.id,
    b?.charge?.id,
    metadata(payload).original_processor_transaction_id,
  );
}

function companyId(payload: any): string {
  const b = body(payload);
  const meta = metadata(payload);
  return firstString(
    b?.company_id,
    b?.companyId,
    b?.company?.id,
    payload?.company_id,
    payload?.companyId,
    meta.company_id,
  );
}

function eventId(req: Request, payload: any): string {
  return firstString(
    req.headers['webhook-id'],
    req.headers['svix-id'],
    payload?.id,
    payload?.event_id,
    payload?.eventId,
    paymentId(payload),
    membershipId(payload),
  );
}

function paymentTypeForOffer(offer: any): string {
  if (offer?.payment_type === 'installments') return 'installment';
  if (offer?.payment_type === 'subscription') return 'subscription';
  return 'pif';
}

function normalizePaymentType(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (['pif', 'paid_in_full', 'paid-in-full', 'one_time', 'one-time'].includes(normalized)) return 'pif';
  if (['installment', 'installments'].includes(normalized)) return 'installment';
  if (['subscription', 'recurring'].includes(normalized)) return 'subscription';
  return '';
}

function hasCheckoutMetadata(payload: any): boolean {
  const meta = metadata(payload);
  return Boolean(
    meta.checkout_mode
    || meta.checkoutMode
    || meta.checkout_session_id
    || meta.checkoutSessionId
    || meta.payment_choice
    || meta.paymentChoice
    || meta.due_today_amount !== undefined
    || meta.selected_amount !== undefined
    || meta.future_recurring_amount !== undefined
    || lineItems(payload).length > 0
  );
}

function paymentTypeForCheckout(payload: any, enrollment: any, offer: any): string {
  const meta = metadata(payload);
  const explicitChoice = normalizePaymentType(
    meta.payment_choice
    || meta.paymentChoice
    || meta.payment_type
    || meta.paymentType,
  );
  if (explicitChoice) return explicitChoice;

  // Older ScaleSafe Whop sessions did not send payment_choice. Their checkout
  // metadata did include the future recurring amount, which unambiguously
  // distinguishes a one-time selection from a recurring selection.
  if (hasCheckoutMetadata(payload) && meta.future_recurring_amount !== undefined) {
    const futureRecurringAmount = Number(meta.future_recurring_amount);
    if (Number.isFinite(futureRecurringAmount) && futureRecurringAmount <= 0) return 'pif';
  }

  return normalizePaymentType(enrollment?.payment_type) || paymentTypeForOffer(offer);
}

function paymentsTotalForCheckout(paymentType: string, offer: any, enrollment?: any): number | null {
  if (paymentType === 'installment') {
    const enrollmentTotal = Number(enrollment?.payments_total);
    if (Number.isFinite(enrollmentTotal) && enrollmentTotal > 0) return enrollmentTotal;
    return Number(offer?.num_payments || 1);
  }
  return null;
}

async function reconcileCheckoutBillingSelection(input: {
  enrollment: any;
  locationId: string;
  paymentType: string;
  paymentsTotal: number | null;
}): Promise<void> {
  const updates: Record<string, unknown> = {
    payment_type: input.paymentType,
    payments_total: input.paymentsTotal,
  };
  if (input.paymentType === 'pif') {
    updates.next_billing_date = null;
    updates.next_billing_date_source = null;
    updates.billing_setup_status = 'ok';
    updates.billing_completed_at = input.enrollment.billing_completed_at
      || input.enrollment.enrolled_at
      || new Date().toISOString();
  }
  const { error } = await getSupabase()
    .from('enrollments')
    .update(updates as any)
    .eq('id', input.enrollment.id)
    .eq('location_id', input.locationId);
  if (error) throw error;
}

async function findEnrollment(payload: any, locationId: string): Promise<any | null> {
  const meta = metadata(payload);
  const supabase = getSupabase();
  const enrollmentId = firstString(meta.enrollment_id, meta.enrollmentId);
  if (enrollmentId) {
    const { data } = await supabase
      .from('enrollments')
      .select('*')
      .eq('id', enrollmentId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (data) return data;
  }

  const sessionId = firstString(
    meta.checkout_session_id,
    meta.checkoutSessionId,
    meta.checkout_configuration_id,
    meta.checkoutConfigurationId,
    body(payload)?.checkout_session_id,
    body(payload)?.checkoutSessionId,
    body(payload)?.checkout_configuration_id,
    body(payload)?.checkoutConfigurationId,
    body(payload)?.checkout_session?.id,
  );
  if (sessionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('whop_checkout_session_id', sessionId)
      .maybeSingle();
    if (data) return data;
  }

  const whopMemberId = membershipId(payload);
  if (whopMemberId) {
    const { data: byWhopMembership } = await supabase
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('whop_membership_id', whopMemberId)
      .maybeSingle();
    if (byWhopMembership) return byWhopMembership;

    const { data: byProcessorSubscription } = await supabase
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('processor_subscription_id', whopMemberId)
      .maybeSingle();
    if (byProcessorSubscription) return byProcessorSubscription;
  }
  return null;
}

async function createQuickCheckoutEnrollment(payload: any, locationId: string, merchantId: string): Promise<any | null> {
  const meta = metadata(payload);
  if (meta.checkout_mode !== 'quick_checkout') return null;
  const offerId = firstString(meta.offer_id, meta.offerId);
  if (!offerId) return null;
  const offer = await offerRepository.findById(offerId, locationId);
  if (!offer) return null;
  const b = body(payload);
  const email = firstString(
    b?.customer?.email,
    b?.email,
    b?.payer_email,
    meta.contact_email,
    meta.contactEmail,
    meta.email,
  );
  let contactId = '';
  try {
    contactId = await resolveWhopContactId(locationId, payload);
  } catch (err: any) {
    logger.warn({ err: err.message, locationId, offerId, hasEmail: !!email }, 'Whop quick checkout contact resolution failed');
    contactId = firstString(meta.contact_id, meta.contactId, b?.customer?.metadata?.contact_id);
  }
  const amount = amountCents(payload) / 100;
  const selectedItems = lineItems(payload);
  const selectedPaymentType = paymentTypeForCheckout(payload, null, offer);
  const { data, error } = await getSupabase()
    .from('enrollments')
    .insert({
      location_id: locationId,
      merchant_id: merchantId,
      contact_id: contactId,
      offer_id: offer.id,
      email: email || null,
      status: 'consent_captured',
      checkout_type: 'whop',
      processor_type: 'whop',
      whop_payment_id: paymentId(payload) || null,
      whop_membership_id: membershipId(payload) || null,
      payment_amount: amount,
      payment_type: selectedPaymentType,
      payments_total: paymentsTotalForCheckout(selectedPaymentType, offer),
      selected_checkout_items: selectedItems,
    } as any)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function findPaidPaymentEvent(locationId: string, enrollmentId: string, txnId?: string): Promise<any | null> {
  let query = getSupabase()
    .from('payment_events')
    .select('id, event_type, processor_transaction_id')
    .eq('location_id', locationId)
    .eq('enrollment_id', enrollmentId)
    .eq('processor', 'whop')
    .in('event_type', ['sale', 'payment_success', 'subscription_payment', 'capture'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (txnId) query = query.eq('processor_transaction_id', txnId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function recordInitialWhopSale(input: {
  payload: any;
  locationId: string;
  merchantId: string;
  enrollment: any;
  txnId: string;
  amount: number;
  lineItems: unknown[];
  paymentsTotal: number | null;
}): Promise<void> {
  const paymentsTotal = input.paymentsTotal;
  const paymentsRemaining = paymentsTotal == null ? undefined : Math.max(0, paymentsTotal - 1);
  const record = {
    merchant_id: input.enrollment.merchant_id || input.merchantId,
    location_id: input.locationId,
    contact_id: input.enrollment.contact_id || firstString(metadata(input.payload).contact_id),
    enrollment_id: input.enrollment.id,
    offer_id: input.enrollment.offer_id,
    event_type: 'sale',
    processor: 'whop',
    processor_transaction_id: input.txnId,
    processor_subscription_id: membershipId(input.payload) || input.enrollment.processor_subscription_id || input.enrollment.whop_membership_id || null,
    amount: input.amount,
    currency: 'usd',
    payment_number: 1,
    payments_total: paymentsTotal,
    payments_remaining: paymentsRemaining,
    source: 'whop_webhook',
    is_recurring: false,
    raw_webhook_payload: input.payload,
    line_items: input.lineItems,
  } as const;

  const existing = await paymentEventRepository.findByTransactionId('whop', input.txnId, input.locationId);
  if (existing?.id) {
    const { error } = await getSupabase()
      .from('payment_events')
      .update({
        ...record,
        event_type: 'sale',
      } as any)
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  await paymentEventRepository.create(record);
}

async function handlePaymentSucceeded(payload: any, locationId: string, merchantId: string): Promise<void> {
  const txnId = paymentId(payload);
  const checkoutMode = firstString(metadata(payload).checkout_mode, metadata(payload).checkoutMode);
  let enrollment = await findEnrollment(payload, locationId);
  if (!enrollment) enrollment = await createQuickCheckoutEnrollment(payload, locationId, merchantId);
  if (!enrollment) {
    logger.warn({ locationId, txnId, metadata: metadata(payload) }, 'Whop payment succeeded but no enrollment match found');
    return;
  }

  const offer = enrollment.offer_id
    ? await offerRepository.findById(enrollment.offer_id, locationId)
    : null;
  const selectedPaymentType = paymentTypeForCheckout(payload, enrollment, offer);
  const selectedPaymentsTotal = paymentsTotalForCheckout(selectedPaymentType, offer, enrollment);
  const amount = amountCents(payload);
  const selectedLineItems = mergedLineItems(payload, enrollment);
  const b = body(payload);
  const { error: enrollmentUpdateError } = await getSupabase()
    .from('enrollments')
    .update({
      checkout_type: 'whop',
      processor_type: 'whop',
      whop_payment_id: txnId || null,
      whop_membership_id: membershipId(payload) || enrollment.whop_membership_id || null,
      processor_subscription_id: ['installment', 'subscription'].includes(selectedPaymentType)
        ? membershipId(payload) || enrollment.processor_subscription_id || enrollment.whop_membership_id || null
        : null,
      whop_setup_intent_id: firstString(b?.setup_intent_id, b?.setupIntentId) || enrollment.whop_setup_intent_id || null,
      ...(selectedLineItems.length > 0 ? { selected_checkout_items: selectedLineItems } : {}),
    } as any)
    .eq('id', enrollment.id)
    .eq('location_id', locationId);
  if (enrollmentUpdateError) throw enrollmentUpdateError;

  const existingPaidEvent = await findPaidPaymentEvent(locationId, enrollment.id, txnId);
  const { data: latestEnrollment } = await getSupabase()
    .from('enrollments')
    .select('*')
    .eq('id', enrollment.id)
    .eq('location_id', locationId)
    .maybeSingle();
  const currentEnrollment = latestEnrollment || enrollment;
  const currentLineItems = mergedLineItems(payload, currentEnrollment, enrollment);
  const alreadyStartedRecurring = currentEnrollment.status === 'enrolled'
    && Number(currentEnrollment.payments_made || 0) > 0
    && ['installment', 'subscription'].includes(normalizePaymentType(currentEnrollment.payment_type) || selectedPaymentType);
  const isCheckoutPayment = Boolean(
    existingPaidEvent?.event_type === 'sale'
    || (!alreadyStartedRecurring && hasCheckoutMetadata(payload)),
  );

  if (isCheckoutPayment) {
    if (checkoutMode === 'quick_manual_sale') {
      await reconcileCheckoutBillingSelection({
        enrollment: currentEnrollment,
        locationId,
        paymentType: selectedPaymentType,
        paymentsTotal: selectedPaymentsTotal,
      });
      const { data: refreshedManualSaleEnrollment } = await getSupabase()
        .from('enrollments')
        .select('*')
        .eq('id', enrollment.id)
        .eq('location_id', locationId)
        .maybeSingle();
      if (!existingPaidEvent?.id) {
        await recordInitialWhopSale({
          payload,
          locationId,
          merchantId,
          enrollment: refreshedManualSaleEnrollment || currentEnrollment,
          txnId: txnId || `whop_${Date.now()}`,
          amount: amount / 100,
          lineItems: mergedLineItems(payload, refreshedManualSaleEnrollment, currentEnrollment, enrollment),
          paymentsTotal: selectedPaymentsTotal,
        });
      }
      await payFirstEnrollmentService.finalizeWhopManualSale({
        locationId,
        enrollmentId: enrollment.id,
        transactionId: txnId || `whop_${Date.now()}`,
        amount: amount / 100,
        paymentType: selectedPaymentType,
        sendEnrollment: firstString(metadata(payload).send_enrollment, metadata(payload).sendEnrollment) !== 'false',
      });
      return;
    }

    if (!existingPaidEvent?.id && currentEnrollment.status !== 'enrolled') {
      await phase2EnrollmentService.completeEnrollment({
        enrollmentId: enrollment.id,
        locationId,
        contactId: currentEnrollment.contact_id || enrollment.contact_id || firstString(metadata(payload).contact_id),
        contactEmail: currentEnrollment.email || enrollment.email || firstString(b?.customer?.email, b?.email),
        paymentAmount: amount / 100,
        paymentType: selectedPaymentType,
        transactionId: txnId || `whop_${Date.now()}`,
        paymentsTotal: selectedPaymentsTotal,
        processorType: 'whop',
        paymentSource: 'whop_webhook',
        skipPaymentEvent: true,
      });
    }
    await reconcileCheckoutBillingSelection({
      enrollment: currentEnrollment,
      locationId,
      paymentType: selectedPaymentType,
      paymentsTotal: selectedPaymentsTotal,
    });
    const { data: refreshed } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('id', enrollment.id)
      .eq('location_id', locationId)
      .maybeSingle();
    await recordInitialWhopSale({
      payload,
      locationId,
      merchantId,
      enrollment: refreshed || enrollment,
      txnId: txnId || `whop_${Date.now()}`,
      amount: amount / 100,
      lineItems: mergedLineItems(payload, refreshed, currentEnrollment, enrollment),
      paymentsTotal: selectedPaymentsTotal,
    });
    return;
  }

  if (existingPaidEvent?.id) {
    logger.info({ locationId, txnId, enrollmentId: enrollment.id }, 'Whop non-checkout payment duplicate ignored');
    return;
  }

  if (enrollment.status !== 'enrolled') {
    await phase2EnrollmentService.completeEnrollment({
      enrollmentId: enrollment.id,
      locationId,
      contactId: enrollment.contact_id || firstString(metadata(payload).contact_id),
      contactEmail: enrollment.email || firstString(b?.customer?.email, b?.email),
      paymentAmount: amount / 100,
      paymentType: selectedPaymentType,
      transactionId: txnId || `whop_${Date.now()}`,
      paymentsTotal: selectedPaymentsTotal,
      processorType: 'whop',
      paymentSource: 'whop_webhook',
    });
    return;
  }

  await handleRecurringPaymentSuccess({
    enrollment: {
      id: enrollment.id,
      merchant_id: enrollment.merchant_id || merchantId,
      location_id: locationId,
      contact_id: enrollment.contact_id || '',
      offer_id: enrollment.offer_id,
      program_name_snapshot: enrollment.program_name_snapshot || null,
      payments_made: Number(enrollment.payments_made || 0),
      payments_total: enrollment.payments_total,
      payment_type: normalizePaymentType(enrollment.payment_type) || selectedPaymentType,
      processor_subscription_id: enrollment.processor_subscription_id || enrollment.whop_membership_id || membershipId(payload) || null,
    },
    processorType: 'whop',
    transactionId: txnId || `whop_${Date.now()}`,
    amountCents: amount,
    offerName: offer?.offer_name || '',
    installmentFrequency: offer?.installment_frequency || 'monthly',
    source: 'whop_webhook',
  });
}

async function handlePaymentFailed(payload: any, locationId: string, merchantId: string): Promise<void> {
  const enrollment = await findEnrollment(payload, locationId);
  if (!enrollment) return;
  const offer = enrollment.offer_id ? await offerRepository.findById(enrollment.offer_id, locationId) : null;
  await handleRecurringPaymentFailure({
    enrollment: {
      id: enrollment.id,
      merchant_id: enrollment.merchant_id || merchantId,
      location_id: locationId,
      contact_id: enrollment.contact_id || '',
      offer_id: enrollment.offer_id,
      processor_subscription_id: enrollment.whop_membership_id || null,
    },
    processorType: 'whop',
    transactionId: paymentId(payload) || null,
    amountCents: amountCents(payload),
    errorMessage: firstString(body(payload)?.failure_reason, body(payload)?.error?.message, 'Whop payment failed'),
    source: 'whop_webhook',
  });
  logger.warn({ enrollmentId: enrollment.id, offerId: offer?.id }, 'Whop payment failure recorded');
}

async function findOriginalWhopPaymentEvent(locationId: string, transactionId: string): Promise<any | null> {
  if (!transactionId.startsWith('pay_')) return null;
  const { data, error } = await getSupabase()
    .from('payment_events')
    .select('id, merchant_id, contact_id, enrollment_id, offer_id, processor_transaction_id, processor_subscription_id')
    .eq('location_id', locationId)
    .eq('processor', 'whop')
    .eq('processor_transaction_id', transactionId)
    .in('event_type', ['sale', 'payment_success', 'subscription_payment', 'capture'])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findMatchingWhopRefundClaim(
  locationId: string,
  originalPaymentEventId: string,
  refundAmountCents: number,
): Promise<any | null> {
  if (!originalPaymentEventId || refundAmountCents <= 0) return null;
  const { data, error } = await getSupabase()
    .from('payment_refund_claims')
    .select('id')
    .eq('location_id', locationId)
    .eq('original_payment_event_id', originalPaymentEventId)
    .eq('amount_cents', refundAmountCents)
    .in('status', ['processing', 'unknown', 'provider_accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function markWhopRefundClaimRecorded(
  locationId: string,
  claimId: string,
  refundEventId: string,
  processorRefundId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('payment_refund_claims')
    .update({
      status: 'recorded',
      processor_refund_id: processorRefundId,
      refund_payment_event_id: refundEventId,
      recorded_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', claimId)
    .eq('location_id', locationId);
  if (error) throw error;
}

async function handleRefund(payload: any, locationId: string, merchantId: string): Promise<void> {
  const originalTxnId = originalPaymentId(payload);
  const txnId = refundId(payload);
  if (!txnId) {
    throw new Error('Whop refund webhook is missing its canonical rf_ refund ID');
  }
  const originalPayment = await findOriginalWhopPaymentEvent(locationId, originalTxnId);
  const enrollment = await findEnrollment(payload, locationId);
  const refundAmountCents = amountCents(payload);
  const amount = refundAmountCents / 100;
  const matchingClaim = originalPayment?.id
    ? await findMatchingWhopRefundClaim(locationId, originalPayment.id, refundAmountCents)
    : null;
  const { data: existingRefund, error: existingRefundError } = await getSupabase()
    .from('payment_events')
    .select('id')
    .eq('location_id', locationId)
    .eq('processor', 'whop')
    .eq('event_type', 'refund')
    .eq('processor_transaction_id', txnId)
    .limit(1)
    .maybeSingle();
  if (existingRefundError) throw existingRefundError;
  if (existingRefund?.id) {
    if (matchingClaim?.id) {
      await markWhopRefundClaimRecorded(locationId, matchingClaim.id, existingRefund.id, txnId);
    }
    logger.info({ locationId, txnId, originalTxnId }, 'Whop refund webhook duplicate ignored');
    return;
  }

  const { data: insertedRefund, error: refundInsertError } = await getSupabase().from('payment_events').insert({
    merchant_id: originalPayment?.merchant_id || merchantId,
    location_id: locationId,
    contact_id: originalPayment?.contact_id || enrollment?.contact_id || firstString(metadata(payload).contact_id),
    enrollment_id: originalPayment?.enrollment_id || enrollment?.id || null,
    offer_id: originalPayment?.offer_id || enrollment?.offer_id || firstString(metadata(payload).offer_id),
    event_type: 'refund',
    processor: 'whop',
    processor_transaction_id: txnId || null,
    amount: amount ? Math.abs(amount) : 0,
    currency: 'usd',
    source: 'whop_webhook',
    raw_webhook_payload: {
      ...payload,
      original_processor_transaction_id: originalTxnId || null,
      original_payment_event_id: originalPayment?.id || null,
      refund_claim_id: matchingClaim?.id || null,
    },
  } as any).select('id').single();
  if (refundInsertError?.code === '23505') {
    const { data: concurrentRefund, error: concurrentRefundError } = await getSupabase()
      .from('payment_events')
      .select('id')
      .eq('location_id', locationId)
      .eq('processor', 'whop')
      .eq('event_type', 'refund')
      .eq('processor_transaction_id', txnId)
      .limit(1)
      .maybeSingle();
    if (concurrentRefundError) throw concurrentRefundError;
    if (matchingClaim?.id && concurrentRefund?.id) {
      await markWhopRefundClaimRecorded(locationId, matchingClaim.id, concurrentRefund.id, txnId);
    }
    logger.info({ locationId, txnId, originalTxnId }, 'Concurrent Whop refund webhook duplicate ignored');
    return;
  }
  if (refundInsertError) throw refundInsertError;

  if (matchingClaim?.id && insertedRefund?.id) {
    await markWhopRefundClaimRecorded(locationId, matchingClaim.id, insertedRefund.id, txnId);
  }

  const contactId = originalPayment?.contact_id || enrollment?.contact_id || firstString(metadata(payload).contact_id);
  if (contactId) {
    await paymentLifecycleService.notifyRefundProcessed(locationId, contactId, {
      amount: Math.abs(amount),
      refundType: 'processor_webhook',
      reason: 'Whop refund processed',
      transactionId: txnId,
      enrollmentId: originalPayment?.enrollment_id || enrollment?.id || null,
      offerId: originalPayment?.offer_id || enrollment?.offer_id || null,
      processor: 'whop',
      subscriptionId: originalPayment?.processor_subscription_id
        || enrollment?.processor_subscription_id
        || enrollment?.whop_membership_id
        || null,
    });
  }
}

async function handleMembership(payload: any, locationId: string, active: boolean, action?: 'pause' | 'resume' | 'cancel'): Promise<void> {
  const enrollment = await findEnrollment(payload, locationId);
  if (!enrollment) return;
  const b = body(payload);
  const recurringEnrollment = ['installment', 'subscription'].includes(
    normalizePaymentType(enrollment.payment_type),
  );
  const updates: Record<string, unknown> = {
    whop_membership_id: membershipId(payload) || enrollment.whop_membership_id || null,
    processor_subscription_id: recurringEnrollment
      ? membershipId(payload) || enrollment.processor_subscription_id || enrollment.whop_membership_id || null
      : null,
    whop_reconciliation_status: active ? 'membership_active' : 'membership_deactivated',
    ...(active && recurringEnrollment && b?.renewal_period_end
      ? { next_billing_date: String(b.renewal_period_end).slice(0, 10) }
      : {}),
  };
  if (action === 'pause' && recurringEnrollment) {
    updates.status = 'paused';
    updates.next_billing_date = null;
  } else if (action === 'resume' && recurringEnrollment) {
    updates.status = 'enrolled';
  } else if ((action === 'cancel' || !active) && recurringEnrollment) {
    updates.status = 'cancelled';
    updates.cancelled_at = new Date().toISOString();
    updates.next_billing_date = null;
  }

  await getSupabase()
    .from('enrollments')
    .update(updates as any)
    .eq('id', enrollment.id)
    .eq('location_id', locationId);
}

export async function handleWhopWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const payload = req.body || {};
  const meta = metadata(payload);
  const locationId = firstString(meta.location_id, meta.locationId, body(payload)?.location_id);
  const cfg = locationId
    ? await whopConfigService.get(locationId)
    : await whopConfigService.findByCompanyId(companyId(payload));
  if (!cfg) {
    res.status(400).json({ error: 'Whop config not found' });
    return;
  }
  const secret = whopConfigService.decryptWebhookSecret(cfg);
  if (!secret || !whopService.verifyStandardWebhook(rawBody, req.headers, secret)) {
    logger.warn({ locationId: cfg.location_id, eventType: eventType(payload) }, 'Invalid Whop webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const whopEventType = eventType(payload);
  const whopEventId = eventId(req, payload);
  const duplicateDelivery = Boolean(
    whopEventId && await idempotencyRepository.exists(whopEventId, 'whop_webhook', cfg.location_id),
  );
  if (duplicateDelivery && whopEventType !== 'payment.succeeded') {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    const merchant = await merchantRepository.getByLocationId(cfg.location_id);
    if (whopEventType === 'payment.succeeded') {
      await handlePaymentSucceeded(payload, cfg.location_id, merchant.id);
    } else if (whopEventType === 'payment.failed') {
      await handlePaymentFailed(payload, cfg.location_id, merchant.id);
    } else if (whopEventType === 'refund.created') {
      await handleRefund(payload, cfg.location_id, merchant.id);
    } else if (whopEventType === 'membership.paused') {
      await handleMembership(payload, cfg.location_id, false, 'pause');
    } else if (whopEventType === 'membership.resumed') {
      await handleMembership(payload, cfg.location_id, true, 'resume');
    } else if (whopEventType === 'membership.cancelled' || whopEventType === 'membership.canceled') {
      await handleMembership(payload, cfg.location_id, false, 'cancel');
    } else if (whopEventType === 'membership.activated' || whopEventType === 'membership.went_valid') {
      await handleMembership(payload, cfg.location_id, true);
    } else if (whopEventType === 'membership.deactivated' || whopEventType === 'membership.went_invalid') {
      await handleMembership(payload, cfg.location_id, false, 'cancel');
    } else if (whopEventType === 'setup_intent.succeeded') {
      const enrollment = await findEnrollment(payload, cfg.location_id);
      if (enrollment) {
        await getSupabase()
          .from('enrollments')
          .update({ whop_setup_intent_id: firstString(body(payload)?.id, body(payload)?.setup_intent_id) } as any)
          .eq('id', enrollment.id)
          .eq('location_id', cfg.location_id);
      }
    } else if (whopEventType === 'dispute.created') {
      // #28: record Whop disputes in dispute_events (NOT payment_events — 'chargeback' is not a
      // valid payment_events event_type and the insert would fail the CHECK constraint and be
      // lost). The Stripe-named dispute-id column carries the Whop id (prefixed). Throw on error
      // so the outer 500 + webhook idempotency retries safely.
      const whopDisputeId = `whop_${paymentId(payload) || whopEventId || firstString(meta.contact_id) || 'unknown'}`;
      const { error: disputeErr } = await getSupabase().from('dispute_events').insert({
        merchant_id: merchant.id,
        location_id: cfg.location_id,
        contact_id: firstString(meta.contact_id) || null,
        processor: 'whop',
        stripe_dispute_id: whopDisputeId,
        reason: 'whop_dispute',
        status: 'needs_response',
        amount: amountCents(payload) / 100,
        currency: 'usd',
        raw_dispute_object: payload,
      } as any);
      if (disputeErr) {
        logger.error({ err: disputeErr.message, eventId: whopEventId }, 'Whop dispute persist to dispute_events failed');
        throw disputeErr;
      }
    } else {
      logger.info({ eventType: whopEventType, eventId: whopEventId }, 'Whop webhook acknowledged without action');
    }
    if (whopEventId) {
      await idempotencyRepository.record(whopEventId, 'whop_webhook', cfg.location_id, { eventType: whopEventType });
    }
    res.json({ received: true, ...(duplicateDelivery ? { duplicate: true } : {}) });
  } catch (err: any) {
    logger.error({ err: err.message, eventType: whopEventType, eventId: whopEventId }, 'Whop webhook processing failed');
    res.status(500).json({ error: 'Whop webhook processing failed' });
  }
}
