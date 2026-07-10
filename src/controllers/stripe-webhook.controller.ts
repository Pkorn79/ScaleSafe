import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { stripeEvidenceVaultService } from '../services/stripe-evidence-vault.service';
import { stripeDisputeService } from '../services/stripe-dispute.service';
import { stripeEfwService } from '../services/stripe-efw.service';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { decrypt } from '../services/processor-config.service';
import { stripeAchService } from '../services/stripe-ach.service';

const Stripe = require('stripe');

function getStripe(): any {
  return new Stripe(config.stripe.secretKey);
}

type StripeProcessorConfig = {
  id: string;
  merchant_id: string;
  location_id: string;
  stripe_user_id: string | null;
  stripe_webhook_secret_encrypted: string | null;
};

async function resolveStripeWebhookConfig(req: Request): Promise<{
  secret: string | null;
  processorConfig: StripeProcessorConfig | null;
  error?: string;
}> {
  const locationId = req.params.locationId;

  if (!locationId) {
    return {
      secret: config.stripe.webhookSecret || null,
      processorConfig: null,
      error: config.stripe.webhookSecret ? undefined : 'Missing Stripe webhook secret',
    };
  }

  const { data, error } = await getSupabase()
    .from('processor_configs')
    .select('id, merchant_id, location_id, stripe_user_id, stripe_webhook_secret_encrypted')
    .eq('location_id', locationId)
    .eq('processor_type', 'stripe')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, locationId }, 'Stripe webhook config lookup failed');
    return { secret: null, processorConfig: null, error: 'Stripe webhook config lookup failed' };
  }

  if (!data) {
    return { secret: null, processorConfig: null, error: 'Stripe webhook config not found' };
  }

  if (!data.stripe_webhook_secret_encrypted) {
    return { secret: null, processorConfig: data, error: 'Stripe webhook signing secret not configured' };
  }

  try {
    return {
      secret: decrypt(data.stripe_webhook_secret_encrypted),
      processorConfig: data,
    };
  } catch (err: any) {
    logger.error({ err: err.message, locationId }, 'Stripe webhook signing secret decrypt failed');
    return { secret: null, processorConfig: data, error: 'Stripe webhook signing secret decrypt failed' };
  }
}

/**
 * POST /webhooks/stripe
 * Unified webhook receiver for ALL Stripe events from ALL connected merchants.
 * Uses express.raw() — req.body is a Buffer, not parsed JSON.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) {
    res.status(400).json({ error: 'Missing Stripe signature' });
    return;
  }

  const resolved = await resolveStripeWebhookConfig(req);
  if (!resolved.secret) {
    logger.warn({ locationId: req.params.locationId, reason: resolved.error }, 'Stripe webhook rejected before signature verification');
    res.status(400).json({ error: resolved.error || 'Stripe webhook not configured' });
    return;
  }

  let event: any;
  try {
    const stripe = getStripe();
    // Use rawBody (Buffer) preserved by captureRawBody middleware for signature verification
    const rawBody = (req as any).rawBody || req.body;
    event = stripe.webhooks.constructEvent(rawBody, sig, resolved.secret);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Webhook signature verification failed');
    res.status(400).json({ error: 'Webhook signature verification failed' });
    return;
  }

  if (
    resolved.processorConfig?.stripe_user_id
    && event.account
    && event.account !== resolved.processorConfig.stripe_user_id
  ) {
    logger.warn({
      locationId: resolved.processorConfig.location_id,
      expectedAccount: resolved.processorConfig.stripe_user_id,
      eventAccount: event.account,
    }, 'Stripe webhook account mismatch');
    res.status(400).json({ error: 'Stripe account mismatch' });
    return;
  }

  // Identify merchant from connected account
  const stripeAccountId = event.account;
  if (!stripeAccountId && !resolved.processorConfig) {
    // Platform-level event, not connected account
    res.status(200).json({ received: true });
    return;
  }

  const supabase = getSupabase();
  const merchantQuery = supabase.from('merchants').select('*');
  const { data: merchant } = resolved.processorConfig
    ? await merchantQuery
      .eq('id', resolved.processorConfig.merchant_id)
      .eq('location_id', resolved.processorConfig.location_id)
      .single()
    : await merchantQuery
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
    // #4: return 5xx so Stripe retries instead of silently losing a failed write (a missed
    // recurring increment or an unpersisted dispute). Safe to retry — recurring recording is
    // idempotent (payment_events unique constraint + record_recurring_payment dedup).
    logger.error({ err: err.message, eventType: event.type, merchantId: merchant.id }, 'Webhook handler error — returning 500 so Stripe retries');
    res.status(500).json({ received: false, error: 'handler_failed' });
    return;
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

    case 'payment_intent.processing':
      await handlePaymentProcessing(event, merchant);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailure(event, merchant);
      break;

    case 'setup_intent.succeeded':
    case 'setup_intent.setup_failed':
      logger.info({ merchantId: merchant.id, eventType: event.type, setupIntentId: event.data.object?.id }, 'Stripe setup intent webhook received');
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
  if (event.type === 'payment_intent.succeeded' && obj.metadata?.scalesafe_ach === 'true') {
    await stripeAchService.recordPaymentIntentState({
      merchant,
      paymentIntent: obj,
      source: 'stripe_ach_webhook',
    });
    return;
  }

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

async function handlePaymentProcessing(event: any, merchant: any): Promise<void> {
  const pi = event.data.object;
  if (pi.metadata?.scalesafe_ach === 'true') {
    await stripeAchService.recordPaymentIntentState({
      merchant,
      paymentIntent: pi,
      source: 'stripe_ach_webhook',
    });
  }
}

async function handlePaymentFailure(event: any, merchant: any): Promise<void> {
  const pi = event.data.object;
  if (pi.metadata?.scalesafe_ach === 'true') {
    await stripeAchService.recordPaymentIntentState({
      merchant,
      paymentIntent: pi,
      source: 'stripe_ach_webhook',
    });
    return;
  }
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
      // Upsert the raw dispute record. #4: a failed persist must NOT be swallowed — throw so the
      // handler returns 500 and Stripe retries, otherwise the auto-submit deadline is silently
      // missed and the merchant loses the dispute by default.
      const { error: disputeUpsertError } = await supabase
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
      if (disputeUpsertError) {
        throw new Error(`Failed to persist dispute ${dispute.id}: ${disputeUpsertError.message}`);
      }

      if (dispute.payment_intent) {
        const paymentIntentId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
        if (paymentIntentId) {
          const { data: achPayment } = await supabase
            .from('payment_events')
            .select('id, enrollment_id')
            .eq('location_id', merchant.location_id)
            .eq('processor', 'stripe')
            .eq('processor_transaction_id', paymentIntentId)
            .eq('selected_payment_method', 'ach')
            .maybeSingle();
          if (achPayment?.id) {
            const now = new Date().toISOString();
            await supabase.from('payment_events').update({
              payment_status: 'late_return',
              returned_at: now,
              return_reason: dispute.reason || 'Stripe ACH dispute/late return',
            }).eq('id', achPayment.id);
            if (achPayment.enrollment_id) {
              await supabase.from('enrollments').update({
                status: 'payment_returned',
                initial_payment_status: 'late_return',
                initial_payment_returned_at: now,
                initial_payment_return_reason: dispute.reason || 'Stripe ACH dispute/late return',
              }).eq('id', achPayment.enrollment_id).eq('location_id', merchant.location_id);
            }
          }
        }
      }

      // Triage the dispute
      const result = await stripeDisputeService.triageDispute(dispute, merchant);

      // Auto-PREPARE a defense packet (never auto-submit — evidence only goes
      // to Stripe through the reviewed packet's Mark Submitted flow, which
      // enforces the scope/fallback-letter/idempotency gates). Disputes that
      // arrive already resolved (e.g. RDR/Ethoca auto-refunded, or closed)
      // need no defense — preparing one would just confuse the queue.
      const terminalStatuses = ['won', 'lost', 'charge_refunded', 'warning_closed'];
      if (terminalStatuses.includes(dispute.status)) {
        logger.info({ disputeId: dispute.id, status: dispute.status }, 'Dispute arrived already resolved — skipping defense auto-prepare');
        break;
      }
      try {
        const { defenseService } = require('../services/defense.service');
        await defenseService.prepareForStripeDispute({ merchant, stripeDispute: dispute });
      } catch (err: any) {
        logger.error({ err: err.message, disputeId: dispute.id, score: result?.score }, 'Auto-prepare defense packet failed');
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
 * Derive the next billing date (YYYY-MM-DD) from a Stripe subscription-cycle invoice.
 * The last line's period.end is the end of the cycle this invoice covers, i.e. when the
 * next invoice fires. Returns null when absent so the caller falls back to an estimate.
 */
export function stripeInvoiceNextBillingDate(invoice: any): string | null {
  const lines = invoice?.lines?.data;
  const end = Array.isArray(lines) && lines.length
    ? lines[lines.length - 1]?.period?.end
    : undefined;
  if (end === undefined || end === null || !Number.isFinite(Number(end))) return null;
  return new Date(Number(end) * 1000).toISOString().split('T')[0];
}

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
    .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
    .eq('processor_subscription_id', subscriptionId)
    .eq('location_id', merchant.location_id)
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
      .eq('location_id', merchant.location_id)
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
      .eq('location_id', merchant.location_id)
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
    // Processor truth: the cycle end on the invoice is the next billing date.
    nextBillingDate: stripeInvoiceNextBillingDate(invoice),
    rawPayload: { invoiceId: invoice.id, subscriptionId, chargeId },
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
    .select('id, merchant_id, location_id, contact_id, offer_id, processor_subscription_id')
    .eq('processor_subscription_id', subscriptionId)
    .eq('location_id', merchant.location_id)
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
    .select('id, status, payments_made, payments_total, payment_type, billing_completed_at')
    .eq('processor_subscription_id', subscriptionId)
    .eq('location_id', merchant.location_id)
    .single();

  if (!enrollment) return;

  // Stripe finite installments may auto-delete the subscription after the paid-off cycle.
  const paidOffFiniteInstallment = enrollment.payment_type !== 'subscription'
    && enrollment.payments_total != null
    && (enrollment.payments_made || 0) >= enrollment.payments_total;

  if (enrollment.billing_completed_at || paidOffFiniteInstallment) {
    logger.info({ enrollmentId: enrollment.id, subscriptionId }, 'Stripe subscription deleted after billing completion; expected cleanup');
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
    .eq('location_id', merchant.location_id)
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
