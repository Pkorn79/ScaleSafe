import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { stripeEvidenceVaultService } from '../services/stripe-evidence-vault.service';
import { stripeDisputeService } from '../services/stripe-dispute.service';
import { stripeEfwService } from '../services/stripe-efw.service';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

function getStripe(): any {
  return new Stripe(config.stripe.secretKey);
}

/**
 * POST /webhooks/stripe
 * Unified webhook receiver for ALL Stripe events from ALL connected merchants.
 * Uses express.raw() — req.body is a Buffer, not parsed JSON.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig || !config.stripe.webhookSecret) {
    res.status(400).json({ error: 'Missing signature or webhook secret' });
    return;
  }

  let event: any;
  try {
    const stripe = getStripe();
    // Use rawBody (Buffer) preserved by captureRawBody middleware for signature verification
    const rawBody = (req as any).rawBody || req.body;
    event = stripe.webhooks.constructEvent(rawBody, sig, config.stripe.webhookSecret);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Webhook signature verification failed');
    res.status(400).json({ error: 'Webhook signature verification failed' });
    return;
  }

  // Identify merchant from connected account
  const stripeAccountId = event.account;
  if (!stripeAccountId) {
    // Platform-level event, not connected account
    res.status(200).json({ received: true });
    return;
  }

  const supabase = getSupabase();
  const { data: merchant } = await supabase
    .from('merchants')
    .select('*')
    .eq('stripe_user_id', stripeAccountId)
    .single();

  if (!merchant) {
    logger.warn({ stripeAccountId }, 'Webhook for unknown Stripe account');
    res.status(200).json({ received: true });
    return;
  }

  try {
    await routeWebhookEvent(event, merchant);
  } catch (err: any) {
    logger.error({ err: err.message, eventType: event.type, merchantId: merchant.id }, 'Webhook handler error');
  }

  res.status(200).json({ received: true });
}

async function routeWebhookEvent(event: any, merchant: any): Promise<void> {
  switch (event.type) {
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated':
      await handleDisputeEvent(event, merchant);
      break;

    case 'radar.early_fraud_warning.created':
      await handleEfwEvent(event, merchant);
      break;

    case 'charge.succeeded':
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event, merchant);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailure(event, merchant);
      break;

    case 'charge.refunded':
      logger.info({ merchantId: merchant.id, eventType: event.type }, 'Charge refunded event received');
      break;

    // ─── Subscription lifecycle (processor-native recurring billing) ───
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event, merchant);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event, merchant);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event, merchant);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event, merchant);
      break;

    default:
      logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
  }
}

// ─── Payment success → Evidence vault ────────────────────

async function handlePaymentSuccess(event: any, merchant: any): Promise<void> {
  const obj = event.data.object;
  // For charge.succeeded, the object is a Charge; for payment_intent.succeeded, it's a PaymentIntent
  const paymentIntentId = obj.payment_intent || obj.id;

  if (!paymentIntentId || paymentIntentId === obj.id && event.type === 'charge.succeeded') {
    // charge.succeeded — get the PI ID from the charge
    const piId = obj.payment_intent;
    if (piId) {
      await stripeEvidenceVaultService.createVaultEntryFromWebhook(
        { ...obj, id: piId, latest_charge: obj.id },
        merchant,
      );
    }
    return;
  }

  await stripeEvidenceVaultService.createVaultEntryFromWebhook(obj, merchant);
}

async function handlePaymentFailure(event: any, merchant: any): Promise<void> {
  const pi = event.data.object;
  logger.info(
    { merchantId: merchant.id, piId: pi.id, error: pi.last_payment_error?.message },
    'Payment failed',
  );
}

// ─── Dispute handler (Phase S3) ─────────────────────────

async function handleDisputeEvent(event: any, merchant: any): Promise<void> {
  const dispute = event.data.object;
  logger.info({ merchantId: merchant.id, disputeId: dispute.id, type: event.type }, 'Dispute event received');

  const supabase = getSupabase();

  switch (event.type) {
    case 'charge.dispute.created': {
      // Upsert the raw dispute record
      await supabase
        .from('dispute_events')
        .upsert({
          merchant_id: merchant.id,
          location_id: merchant.location_id,
          stripe_dispute_id: dispute.id,
          stripe_charge_id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || null,
          stripe_payment_intent_id: typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null,
          reason: dispute.reason,
          status: mapDisputeStatus(dispute.status),
          amount: (dispute.amount || 0) / 100,
          currency: dispute.currency || 'usd',
          evidence_due_by: dispute.evidence_details?.due_by
            ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
            : null,
          raw_dispute_object: event.data.object,
        }, { onConflict: 'stripe_dispute_id' });

      // Triage the dispute
      const result = await stripeDisputeService.triageDispute(dispute, merchant);

      // Auto-submit if merchant has it enabled AND score >= 60
      if (merchant.dispute_auto_submit && result.score >= 60) {
        try {
          const packet = await stripeDisputeService.assembleEvidencePacket(dispute.id, merchant.id);
          await stripeDisputeService.submitEvidence({
            stripeDisputeId: dispute.id,
            merchantId: merchant.id,
            evidence: packet.evidence,
            autoSubmit: true,
          });
        } catch (err: any) {
          logger.error({ err: err.message, disputeId: dispute.id }, 'Auto-submit failed');
        }
      }
      break;
    }

    case 'charge.dispute.updated': {
      await supabase
        .from('dispute_events')
        .update({
          status: mapDisputeStatus(dispute.status),
          raw_dispute_object: event.data.object,
        })
        .eq('stripe_dispute_id', dispute.id)
        .eq('merchant_id', merchant.id);
      break;
    }

    case 'charge.dispute.closed': {
      const outcome = dispute.status === 'won' ? 'won' : 'lost';
      await supabase
        .from('dispute_events')
        .update({
          status: mapDisputeStatus(dispute.status),
          outcome,
          outcome_at: new Date().toISOString(),
          raw_dispute_object: event.data.object,
        })
        .eq('stripe_dispute_id', dispute.id)
        .eq('merchant_id', merchant.id);

      if (outcome === 'won' && dispute.reason === 'fraudulent') {
        logger.info({ disputeId: dispute.id }, 'Won fraud dispute — card fingerprint should be blocked (Phase S4)');
      }
      break;
    }

    case 'charge.dispute.funds_withdrawn': {
      await supabase
        .from('dispute_events')
        .update({
          funds_withdrawn: true,
          funds_withdrawn_amount_cents: dispute.amount,
          raw_dispute_object: event.data.object,
        })
        .eq('stripe_dispute_id', dispute.id)
        .eq('merchant_id', merchant.id);
      break;
    }

    case 'charge.dispute.funds_reinstated': {
      await supabase
        .from('dispute_events')
        .update({
          funds_reinstated: true,
          funds_reinstated_amount_cents: dispute.amount,
          raw_dispute_object: event.data.object,
        })
        .eq('stripe_dispute_id', dispute.id)
        .eq('merchant_id', merchant.id);
      break;
    }

    default: {
      // Fallback for any other dispute event type
      await supabase
        .from('dispute_events')
        .update({
          status: mapDisputeStatus(dispute.status),
          raw_dispute_object: event.data.object,
        })
        .eq('stripe_dispute_id', dispute.id)
        .eq('merchant_id', merchant.id);
    }
  }
}

function mapDisputeStatus(stripeStatus: string): string {
  const map: Record<string, string> = {
    'warning_needs_response': 'needs_response',
    'warning_under_review': 'under_review',
    'warning_closed': 'warning_closed',
    'needs_response': 'needs_response',
    'under_review': 'under_review',
    'charge_refunded': 'charge_refunded',
    'won': 'won',
    'lost': 'lost',
  };
  return map[stripeStatus] || 'needs_response';
}

// ─── EFW handler (Phase S3) ─────────────────────────────

async function handleEfwEvent(event: any, merchant: any): Promise<void> {
  const efw = event.data.object;
  logger.info({ merchantId: merchant.id, efwId: efw.id }, 'EFW event received');

  await stripeEfwService.handleEfw(efw, merchant);
}

// ─── Subscription recurring billing handlers ────────────

/**
 * Stripe invoice.payment_succeeded — a subscription cycle payment landed.
 * Skip the initial invoice (billing_reason='subscription_create') since the
 * first payment is handled as a one-off charge in checkout.
 */
async function handleInvoicePaymentSucceeded(event: any, merchant: any): Promise<void> {
  const invoice = event.data.object;
  if (invoice.billing_reason !== 'subscription_cycle') {
    logger.debug({ invoiceId: invoice.id, reason: invoice.billing_reason }, 'Skipping non-cycle invoice');
    return;
  }

  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const supabase = getSupabase();

  // Look up enrollment by processor_subscription_id
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type')
    .eq('processor_subscription_id', subscriptionId)
    .single();

  if (!enrollment) {
    logger.warn({ subscriptionId, merchantId: merchant.id }, 'Invoice succeeded for unknown subscription — ignoring');
    return;
  }

  // Idempotency: check if we already logged this charge
  const chargeId = invoice.charge;
  if (chargeId) {
    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('processor_transaction_id', chargeId)
      .maybeSingle();
    if (existing) {
      logger.debug({ chargeId }, 'Invoice charge already processed — skipping duplicate');
      return;
    }
  }

  // Resolve offer for installment details
  let installmentFrequency = 'monthly';
  let offerName = '';
  if (enrollment.offer_id) {
    const { data: offer } = await supabase
      .from('offers_mirror')
      .select('offer_name, installment_frequency')
      .eq('id', enrollment.offer_id)
      .single();
    if (offer) {
      installmentFrequency = offer.installment_frequency || 'monthly';
      offerName = offer.offer_name || '';
    }
  }

  const amountCents = invoice.amount_paid || 0;

  const result = await handleRecurringPaymentSuccess({
    enrollment,
    processorType: 'stripe',
    transactionId: chargeId || invoice.id,
    amountCents,
    offerName,
    installmentFrequency,
    source: 'stripe_webhook',
  });

  logger.info({
    enrollmentId: enrollment.id,
    subscriptionId,
    chargeId,
    amountCents,
    newPaymentsMade: result.newPaymentsMade,
    isFinal: result.isFinal,
  }, 'Stripe subscription payment processed');
}

/**
 * Stripe invoice.payment_failed — a subscription payment failed.
 */
async function handleInvoicePaymentFailed(event: any, merchant: any): Promise<void> {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const supabase = getSupabase();
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, merchant_id, location_id, contact_id, offer_id')
    .eq('processor_subscription_id', subscriptionId)
    .single();

  if (!enrollment) {
    logger.warn({ subscriptionId }, 'Invoice failed for unknown subscription — ignoring');
    return;
  }

  const amountCents = invoice.amount_due || 0;
  const errorMessage = invoice.last_finalization_error?.message || 'Stripe subscription payment failed';

  await handleRecurringPaymentFailure({
    enrollment,
    processorType: 'stripe',
    amountCents,
    errorMessage,
    source: 'stripe_webhook',
  });

  logger.warn({ enrollmentId: enrollment.id, subscriptionId, amountCents }, 'Stripe subscription payment failed — dunning initiated');
}

/**
 * customer.subscription.deleted — Stripe auto-cancelled after cancel_at or explicit cancel.
 */
async function handleSubscriptionDeleted(event: any, merchant: any): Promise<void> {
  const subscription = event.data.object;
  const subscriptionId = subscription.id;

  const supabase = getSupabase();
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('processor_subscription_id', subscriptionId)
    .single();

  if (!enrollment) return;

  // If already completed, this is the expected auto-cancel after final payment
  if (enrollment.status === 'completed') {
    logger.info({ enrollmentId: enrollment.id, subscriptionId }, 'Subscription deleted after completion — expected');
    return;
  }

  // Otherwise log the cancellation event
  await supabase.from('payment_events').insert({
    merchant_id: merchant.id,
    location_id: merchant.location_id,
    contact_id: subscription.metadata?.contact_id || null,
    enrollment_id: enrollment.id,
    event_type: 'subscription_cancelled',
    processor: 'stripe',
    processor_subscription_id: subscriptionId,
    amount: 0,
    currency: 'usd',
    source: 'stripe_webhook',
  });

  logger.info({ enrollmentId: enrollment.id, subscriptionId }, 'Stripe subscription deleted');
}

/**
 * customer.subscription.updated — detect pause/resume state changes.
 */
async function handleSubscriptionUpdated(event: any, merchant: any): Promise<void> {
  const subscription = event.data.object;
  const subscriptionId = subscription.id;
  const pauseCollection = subscription.pause_collection;

  const supabase = getSupabase();
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('processor_subscription_id', subscriptionId)
    .single();

  if (!enrollment) return;

  // Detect pause/resume transitions
  const previousAttributes = event.data.previous_attributes || {};
  if (previousAttributes.pause_collection !== undefined) {
    if (pauseCollection) {
      logger.info({ enrollmentId: enrollment.id, subscriptionId }, 'Stripe subscription paused');
    } else {
      logger.info({ enrollmentId: enrollment.id, subscriptionId }, 'Stripe subscription resumed');
    }
  }
}
