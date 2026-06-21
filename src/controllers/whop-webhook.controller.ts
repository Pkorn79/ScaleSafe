import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { offerRepository } from '../repositories/offer.repository';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { whopConfigService } from '../services/whop-config.service';
import { whopService } from '../services/whop.service';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

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

function amountCents(payload: any): number {
  const b = body(payload);
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
    ?? b?.settlement_amount;
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
  return firstString(
    b?.membership_id,
    b?.membershipId,
    b?.membership?.id,
    b?.member?.id,
    b?.id,
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

function paymentsTotalForOffer(offer: any): number | null {
  if (offer?.payment_type === 'installments') return Number(offer.num_payments || 1);
  return null;
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
    body(payload)?.checkout_session_id,
    body(payload)?.checkoutSessionId,
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
  const email = firstString(b?.customer?.email, b?.email, b?.payer_email, meta.email);
  const contactId = firstString(meta.contact_id, b?.customer?.metadata?.contact_id);
  const amount = amountCents(payload) / 100;
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
      payment_type: paymentTypeForOffer(offer),
      payments_total: paymentsTotalForOffer(offer),
    } as any)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function handlePaymentSucceeded(payload: any, locationId: string, merchantId: string): Promise<void> {
  const txnId = paymentId(payload);
  const duplicatePayment = txnId
    ? await getSupabase()
      .from('payment_events')
      .select('id')
      .eq('location_id', locationId)
      .eq('processor', 'whop')
      .eq('processor_transaction_id', txnId)
      .maybeSingle()
    : null;
  if (duplicatePayment?.data?.id) {
    logger.info({ locationId, txnId }, 'Whop payment webhook duplicate ignored by transaction ID');
    return;
  }

  let enrollment = await findEnrollment(payload, locationId);
  if (!enrollment) enrollment = await createQuickCheckoutEnrollment(payload, locationId, merchantId);
  if (!enrollment) {
    logger.warn({ locationId, txnId, metadata: metadata(payload) }, 'Whop payment succeeded but no enrollment match found');
    return;
  }

  const offer = enrollment.offer_id
    ? await offerRepository.findById(enrollment.offer_id, locationId)
    : null;
  const amount = amountCents(payload);
  const b = body(payload);
  await getSupabase()
    .from('enrollments')
    .update({
      checkout_type: 'whop',
      processor_type: 'whop',
      whop_payment_id: txnId || null,
      whop_membership_id: membershipId(payload) || enrollment.whop_membership_id || null,
      processor_subscription_id: membershipId(payload) || enrollment.processor_subscription_id || enrollment.whop_membership_id || null,
      whop_setup_intent_id: firstString(b?.setup_intent_id, b?.setupIntentId) || enrollment.whop_setup_intent_id || null,
    } as any)
    .eq('id', enrollment.id)
    .eq('location_id', locationId);

  if (enrollment.status !== 'enrolled') {
    await phase2EnrollmentService.completeEnrollment({
      enrollmentId: enrollment.id,
      locationId,
      contactId: enrollment.contact_id || firstString(metadata(payload).contact_id),
      contactEmail: enrollment.email || firstString(b?.customer?.email, b?.email),
      paymentAmount: amount / 100,
      paymentType: paymentTypeForOffer(offer),
      transactionId: txnId || `whop_${Date.now()}`,
      paymentsTotal: paymentsTotalForOffer(offer),
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
      payments_made: Number(enrollment.payments_made || 0),
      payments_total: enrollment.payments_total,
      payment_type: enrollment.payment_type || paymentTypeForOffer(offer),
      processor_subscription_id: enrollment.whop_membership_id || membershipId(payload) || null,
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

async function handleRefund(payload: any, locationId: string, merchantId: string): Promise<void> {
  const txnId = paymentId(payload) || firstString(body(payload)?.refund_id, body(payload)?.id);
  const enrollment = await findEnrollment(payload, locationId);
  const amount = amountCents(payload) / 100;
  await getSupabase().from('payment_events').insert({
    merchant_id: merchantId,
    location_id: locationId,
    contact_id: enrollment?.contact_id || firstString(metadata(payload).contact_id),
    enrollment_id: enrollment?.id || null,
    offer_id: enrollment?.offer_id || firstString(metadata(payload).offer_id),
    event_type: 'refund',
    processor: 'whop',
    processor_transaction_id: txnId || null,
    amount: amount ? -Math.abs(amount) : 0,
    currency: 'usd',
    source: 'whop_webhook',
    raw_webhook_payload: payload,
  } as any);

  if (enrollment?.contact_id) {
    try {
      await triggerService.fireTrigger(locationId, 'ss_refund_processed', {
        event_type: 'refund_processed',
        location_id: locationId,
        locationId,
        contact_id: enrollment.contact_id,
        contactId: enrollment.contact_id,
        enrollment_id: enrollment.id,
        enrollmentId: enrollment.id,
        offer_id: enrollment.offer_id,
        offerId: enrollment.offer_id,
        processor: 'whop',
        amount,
        amount_display: `$${amount.toFixed(2)}`,
        amountDisplay: `$${amount.toFixed(2)}`,
        transaction_id: txnId,
        transactionId: txnId,
      });
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: enrollment.id }, 'Whop refund trigger failed');
    }
  }
}

async function handleMembership(payload: any, locationId: string, active: boolean): Promise<void> {
  const enrollment = await findEnrollment(payload, locationId);
  if (!enrollment) return;
  const b = body(payload);
  await getSupabase()
    .from('enrollments')
    .update({
      whop_membership_id: membershipId(payload) || enrollment.whop_membership_id || null,
      processor_subscription_id: membershipId(payload) || enrollment.processor_subscription_id || enrollment.whop_membership_id || null,
      whop_reconciliation_status: active ? 'membership_active' : 'membership_deactivated',
      ...(active && b?.renewal_period_end ? { next_billing_date: String(b.renewal_period_end).slice(0, 10) } : {}),
      ...(active ? {} : { cancelled_at: new Date().toISOString() }),
    } as any)
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
  if (whopEventId && await idempotencyRepository.exists(whopEventId, 'whop_webhook', cfg.location_id)) {
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
    } else if (whopEventType === 'membership.activated' || whopEventType === 'membership.went_valid') {
      await handleMembership(payload, cfg.location_id, true);
    } else if (whopEventType === 'membership.deactivated' || whopEventType === 'membership.went_invalid') {
      await handleMembership(payload, cfg.location_id, false);
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
    res.json({ received: true });
  } catch (err: any) {
    logger.error({ err: err.message, eventType: whopEventType, eventId: whopEventId }, 'Whop webhook processing failed');
    res.status(500).json({ error: 'Whop webhook processing failed' });
  }
}
