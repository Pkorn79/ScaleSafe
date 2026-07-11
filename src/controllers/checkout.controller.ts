import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentProviderService } from '../services/payment-provider.service';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { config } from '../config';
import { logger } from '../utils/logger';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { triggerService } from '../services/trigger.service';
import { ghlApi } from '../clients/ghl.client';
import { saveOrReusePaymentMethod } from '../services/payment-methods.service';
import { OfferRecord } from '../repositories/offer.repository';
import { whopService } from '../services/whop.service';
import { stripeAchService } from '../services/stripe-ach.service';
import { checkoutCartService, CheckoutCartQuote } from '../services/checkout-cart.service';
import { turnstileService } from '../services/turnstile.service';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import crypto from 'crypto';
import { evidenceEnrollmentContextService } from '../services/evidence-enrollment-context.service';

/** Compute next_billing_date from an offer's installment_frequency (matches phase2Enrollment.completeEnrollment). */
function computeNextBillingDate(installmentFrequency: string | null | undefined, from: Date = new Date()): string {
  const next = new Date(from);
  switch (installmentFrequency) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'bi_weekly': next.setDate(next.getDate() + 14); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'annual': next.setFullYear(next.getFullYear() + 1); break;
    default: next.setMonth(next.getMonth() + 1); // monthly default
  }
  return next.toISOString().split('T')[0];
}

/** Normalize payment choice from checkout page ('installments' → 'installment', default 'pif') */
function normalizePaymentType(choice?: string): string {
  if (!choice) return 'pif';
  if (choice === 'installments') return 'installment';
  return choice;
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

function getClientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

function moneyDisplayFromCents(amountCents: number): string {
  return `$${(Number(amountCents || 0) / 100).toFixed(2)}`;
}

function turnstileConfigForOffer(offer?: OfferRecord | null): Record<string, unknown> {
  const requirement = turnstileService.requirementForOffer(offer);
  return {
    turnstileRequired: requirement.required,
    turnstileSiteKey: requirement.siteKey,
  };
}

async function fireCheckoutPaymentFailedTrigger(params: {
  locationId: string;
  contactId: string;
  enrollmentId?: string | null;
  offerId?: string | null;
  programName?: string | null;
  amountCents: number;
  failureReason?: string | null;
  transactionId?: string | null;
  paymentSource: string;
}): Promise<void> {
  if (!params.contactId) {
    logger.warn(
      { locationId: params.locationId, offerId: params.offerId, transactionId: params.transactionId },
      'Payment failed but no contact id was available for the failed-payment workflow',
    );
    return;
  }

  try {
    const amountDisplay = moneyDisplayFromCents(params.amountCents);
    await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
      event_type: 'payment_failed',
      location_id: params.locationId,
      locationId: params.locationId,
      contact_id: params.contactId,
      contactId: params.contactId,
      enrollment_id: params.enrollmentId || '',
      enrollmentId: params.enrollmentId || '',
      offer_id: params.offerId || '',
      offerId: params.offerId || '',
      program_name: params.programName || '',
      programName: params.programName || '',
      amount: Number((params.amountCents / 100).toFixed(2)),
      amount_display: amountDisplay,
      amountDisplay,
      failure_reason: params.failureReason || 'Payment failed',
      failureReason: params.failureReason || 'Payment failed',
      attempt_count: 1,
      attemptCount: 1,
      next_retry_date: 'none',
      nextRetryDate: 'none',
      dunning_stage: 'initial',
      dunningStage: 'initial',
      payment_source: params.paymentSource,
      paymentSource: params.paymentSource,
      transaction_id: params.transactionId || '',
      transactionId: params.transactionId || '',
    });
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), contactId: params.contactId, locationId: params.locationId },
      'Failed-payment workflow trigger failed',
    );
  }
}

const inFlightCheckoutPayments = new Set<string>();

function paymentAttemptKey(parts: Array<string | number | null | undefined>): string {
  return crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '').trim().toLowerCase()).join('|'))
    .digest('hex');
}

function claimPaymentAttempt(key: string): boolean {
  if (inFlightCheckoutPayments.has(key)) return false;
  inFlightCheckoutPayments.add(key);
  return true;
}

function releasePaymentAttempt(key: string): void {
  if (key) inFlightCheckoutPayments.delete(key);
}

export async function getCheckoutQuote(req: Request, res: Response): Promise<void> {
  try {
    const offerId = String(req.query.offerId || '');
    if (!offerId) {
      res.status(400).json({ error: 'Missing offerId' });
      return;
    }

    const offer = await offerRepository.findById(offerId);
    if (!offer || !offer.active) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }

    const consentToken = String(req.query.consentToken || '');
    const selectedAddonIds = consentToken
      ? await checkoutCartService.selectedAddonIdsForConsent(consentToken)
      : String(req.query.selectedAddonIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    const quote = await checkoutCartService.quoteOffer(
      offer,
      selectedAddonIds,
      req.query.paymentChoice || 'pif',
      req.query.paymentMethod === 'ach' ? 'ach' : 'card',
    );
    res.json(quote);
  } catch (err: any) {
    logger.error({ err: err.message, offerId: req.query.offerId }, 'Checkout quote failed');
    res.status(500).json({ error: err.message || 'Unable to calculate checkout amount' });
  }
}

export async function createStripeAchPaymentIntent(req: Request, res: Response): Promise<void> {
  try {
    const {
      offerId, amount, currency, consentToken, contactId, contactEmail, contactName,
      paymentChoice, checkoutMode, publishableKey, selectedAddonIds, evidenceContextToken,
    } = req.body || {};
    if (!offerId || !amount || !contactEmail || !contactName) {
      res.status(400).json({ success: false, error: 'offerId, amount, contactName, and contactEmail are required' });
      return;
    }

    const offer = await offerRepository.findById(String(offerId));
    if (!offer || !offer.active) {
      res.status(404).json({ success: false, error: 'Offer not found' });
      return;
    }
    if ((offer as any).checkout_type === 'whop') {
      res.status(400).json({ success: false, error: 'This offer uses Whop checkout.' });
      return;
    }
    await turnstileService.verifyForOffer(req, offer);

    const normalizedCurrency = String(currency || 'usd').toLowerCase();
    if (normalizedCurrency !== 'usd') {
      res.status(400).json({ success: false, error: 'Invalid currency' });
      return;
    }

    const normalizedChoice = normalizePaymentType(String(paymentChoice || 'pif'));
    const isRecurringPaymentType = ['installment', 'installments', 'subscription'].includes(normalizedChoice);

    const submittedAmount = Number(amount);
    if (!Number.isFinite(submittedAmount) || submittedAmount <= 0 || submittedAmount > 99999999) {
      res.status(400).json({ success: false, error: 'Invalid amount' });
      return;
    }

    const cartSelectedAddonIds = consentToken
      ? await checkoutCartService.selectedAddonIdsForConsent(String(consentToken))
      : checkoutCartService.normalizeAddonIds(selectedAddonIds);
    const quote = await checkoutCartService.quoteOffer(offer, cartSelectedAddonIds, normalizedChoice, 'ach');
    if (quote.selectedAmountCents > 0 && quote.selectedAmountCents !== submittedAmount) {
      logger.warn({
        offerId: offer.id,
        submittedAmount,
        expectedAmount: quote.selectedAmountCents,
      }, 'Rejected Stripe ACH amount mismatch');
      res.status(400).json({ success: false, error: 'Payment amount does not match selected offer' });
      return;
    }

    const merchantRow = await merchantRepository.findByLocationId(offer.location_id);
    if (!merchantRow) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    if (publishableKey) {
      const publicMerchant = await paymentProviderService.getMerchantByPublishableKey(String(publishableKey));
      if (!publicMerchant || publicMerchant.locationId !== offer.location_id) {
        res.status(401).json({ success: false, error: 'Merchant verification failed' });
        return;
      }
    }

    let consentEnrollmentId = '';
    if (consentToken) {
      const { data: enrollment } = await getSupabase()
        .from('enrollments')
        .select('id, location_id')
        .eq('consent_token', consentToken)
        .eq('location_id', offer.location_id)
        .maybeSingle();
      if (!enrollment) {
        res.status(400).json({ success: false, error: 'Consent verification failed. Please complete the enrollment process.' });
        return;
      }
      consentEnrollmentId = enrollment.id;
    }

    let contextEnrollmentId = '';
    let evidenceContextId = '';
    let resolvedContextContactId = String(contactId || '');
    if (evidenceContextToken) {
      const context = await evidenceEnrollmentContextService.claimForCheckout({
        token: String(evidenceContextToken),
        offerId: offer.id,
        email: String(contactEmail),
      });
      if (context.locationId !== offer.location_id || (consentEnrollmentId && context.enrollmentId !== consentEnrollmentId)) {
        res.status(400).json({ success: false, error: 'Evidence enrollment context does not match this checkout' });
        return;
      }
      contextEnrollmentId = context.enrollmentId;
      evidenceContextId = context.contextId;
      if (!consentToken && !resolvedContextContactId) {
        resolvedContextContactId = await resolveQuickCheckoutContact({
          locationId: offer.location_id,
          email: String(contactEmail),
          name: String(contactName),
        });
      }
    }

    const { config: procConfig } = await resolveProcessor(merchantRow.id, offer.location_id, {
      processor_override: ((offer as any).processor_override || null) as 'nmi' | 'stripe' | null,
      nmi_processor_id: (offer as any).nmi_processor_id || null,
    });
    if (procConfig.processor_type !== 'stripe') {
      res.status(400).json({ success: false, error: 'This offer is not configured for Stripe ACH.' });
      return;
    }

    const stripeClient = createProcessorClient(procConfig) as any;
    const nameParts = String(contactName || '').trim().split(/\s+/);
    const intent = await stripeClient.createAchPaymentIntent({
      amount: submittedAmount,
      currency: normalizedCurrency,
      customerEmail: String(contactEmail),
      customerName: String(contactName),
      description: offer.offer_name || 'ScaleSafe ACH Payment',
      metadata: {
        scalesafe_ach: 'true',
        checkout_mode: String(checkoutMode || 'checkout'),
        location_id: offer.location_id,
        merchant_id: merchantRow.id,
        offer_id: offer.id,
        scalesafe_offer_id: offer.id,
        selected_addon_ids: cartSelectedAddonIds.join(','),
        line_items: JSON.stringify(quote.lineItems),
        consent_token: String(consentToken || ''),
        enrollment_id: contextEnrollmentId || consentEnrollmentId || '',
        evidence_context_id: evidenceContextId,
        contact_id: String(contactId || ''),
        customer_email: String(contactEmail),
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' '),
        payment_choice: normalizedChoice,
        payment_method: 'ach',
      },
      setupFutureUsage: isRecurringPaymentType,
    });

    if (contextEnrollmentId && resolvedContextContactId) {
      const { error: contextContactError } = await getSupabase().from('enrollments').update({
        contact_id: resolvedContextContactId,
        email: String(contactEmail).trim().toLowerCase(),
      }).eq('id', contextEnrollmentId).eq('location_id', offer.location_id);
      if (contextContactError) {
        logger.error({ err: contextContactError.message, contextEnrollmentId }, 'Stripe ACH context contact binding failed after intent creation');
      }
    }

    res.json({
      success: true,
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      status: intent.status,
      stripeAccountId: intent.stripeAccountId,
      stripePublishableKey: config.stripe.publishableKey,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Stripe ACH payment intent creation failed');
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Stripe ACH setup failed' });
  }
}

export async function finalizeStripeAchPayment(req: Request, res: Response): Promise<void> {
  try {
    const { offerId, paymentIntentId } = req.body || {};
    if (!offerId || !paymentIntentId) {
      res.status(400).json({ success: false, error: 'offerId and paymentIntentId are required' });
      return;
    }

    const offer = await offerRepository.findById(String(offerId));
    if (!offer || !offer.active) {
      res.status(404).json({ success: false, error: 'Offer not found' });
      return;
    }
    const merchantRow = await merchantRepository.findByLocationId(offer.location_id);
    if (!merchantRow) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const { config: procConfig } = await resolveProcessor(merchantRow.id, offer.location_id, {
      processor_override: ((offer as any).processor_override || null) as 'nmi' | 'stripe' | null,
      nmi_processor_id: (offer as any).nmi_processor_id || null,
    });
    if (procConfig.processor_type !== 'stripe') {
      res.status(400).json({ success: false, error: 'This offer is not configured for Stripe ACH.' });
      return;
    }

    const stripeClient = createProcessorClient(procConfig) as any;
    const paymentIntent = await stripeClient.retrievePaymentIntent(String(paymentIntentId));
    if (String(paymentIntent.metadata?.offer_id || '') !== String(offerId)) {
      res.status(400).json({ success: false, error: 'Stripe ACH payment does not match this offer' });
      return;
    }

    const result = await stripeAchService.recordPaymentIntentState({
      merchant: merchantRow,
      paymentIntent,
      source: 'stripe_ach_checkout',
    });

    res.json({
      success: result.paymentStatus !== 'failed',
      paymentStatus: result.paymentStatus,
      requiresVerification: paymentIntent.status === 'requires_action',
      verificationUrl: paymentIntent.next_action?.verify_with_microdeposits?.hosted_verification_url || undefined,
      chargeId: paymentIntent.id,
      paymentIntentId: paymentIntent.id,
      error: result.paymentStatus === 'failed'
        ? paymentIntent.last_payment_error?.message || 'Stripe ACH payment failed'
        : undefined,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Stripe ACH payment finalization failed');
    res.status(500).json({ success: false, error: err.message || 'Stripe ACH finalization failed' });
  }
}

type BillingSetupIssue = {
  code: string;
  message: string;
};

// ─── GET /api/checkout/config ────────────────────────────────

export async function getCheckoutConfig(req: Request, res: Response): Promise<void> {
  const publishableKey = req.query.publishableKey as string;
  if (!publishableKey) {
    res.status(400).json({ error: 'Missing publishableKey' });
    return;
  }

  const merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const supabase = getSupabase();
  const { data: merchantRow } = await supabase
    .from('merchants')
    .select('business_name, default_processor')
    .eq('id', merchant.merchantId)
    .single();

  // Resolve processor using the same logic as charge-time (respects merchant default)
  try {
    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId);

    const response: Record<string, any> = {
      processorType: procConfig.processor_type,
      merchantName: merchantRow?.business_name || '',
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key;
    } else if (procConfig.processor_type === 'stripe') {
      response.stripeAccountId = procConfig.stripe_user_id;
      response.stripePublishableKey = config.stripe.publishableKey;
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
    return;
  }
}

// ─── GET /api/checkout/config-by-offer/:offerId ─────────────

export async function getCheckoutConfigByOffer(req: Request, res: Response): Promise<void> {
  const { offerId } = req.params;
  if (!offerId) {
    res.status(400).json({ error: 'Missing offerId' });
    return;
  }

  const offer = await offerRepository.findById(offerId);
  if (!offer || !offer.active) {
    res.status(404).json({ error: 'Offer not found' });
    return;
  }

  const merchant = await merchantRepository.findByLocationId(offer.location_id);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  if ((offer as any).checkout_type === 'whop') {
    res.json({
      checkoutType: 'whop',
      processorType: 'whop',
      merchantName: merchant.business_name || '',
      publishableKey: merchant.provider_publishable_key || '',
      whopPlanId: (offer as any).whop_plan_id || '',
      whopSyncStatus: (offer as any).whop_sync_status || '',
      ...turnstileConfigForOffer(offer),
    });
    return;
  }

  // Resolve processor using the same logic as charge-time (respects offer override + merchant default)
  try {
    const offerHint = {
      processor_override: (offer as any).processor_override || null,
      nmi_processor_id: (offer as any).nmi_processor_id || null,
    };
    const { config: procConfig } = await resolveProcessor(merchant.id, offer.location_id, offerHint);

    const response: Record<string, any> = {
      offerId: offer.id,
      processorType: procConfig.processor_type,
      merchantName: merchant.business_name || '',
      publishableKey: merchant.provider_publishable_key || '',
      ...turnstileConfigForOffer(offer),
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
    } else if (procConfig.processor_type === 'stripe') {
      response.stripePublishableKey = config.stripe.publishableKey || procConfig.stripe_publishable_key || '';
      response.stripeAccountId = procConfig.stripe_user_id || '';
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
    return;
  }
}

// ─── GET /api/checkout/config-by-product/:ghlProductId ─────────
// Used by the GHL Custom Payment Provider iframe which only has the GHL product ID
// (from postMessage productDetails[0]._id), not the ScaleSafe offer ID.

export async function getCheckoutConfigByProduct(req: Request, res: Response): Promise<void> {
  const { ghlProductId } = req.params;
  if (!ghlProductId) {
    res.status(400).json({ error: 'Missing ghlProductId' });
    return;
  }

  const supabase = getSupabase();
  const { data: offer } = await supabase
    .from('offers_mirror')
    .select('*')
    .eq('ghl_product_id', ghlProductId)
    .eq('active', true)
    .maybeSingle();

  if (!offer) {
    // No matching offer — fall back to merchant default (non-fatal)
    logger.info({ ghlProductId }, 'config-by-product: no offer found for GHL product ID — falling back to merchant default');
    res.status(404).json({ error: 'Offer not found for product' });
    return;
  }

  const merchant = await merchantRepository.findByLocationId(offer.location_id);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  if ((offer as any).checkout_type === 'whop') {
    res.json({
      checkoutType: 'whop',
      processorType: 'whop',
      merchantName: merchant.business_name || '',
      whopPlanId: offer.whop_plan_id || '',
      whopSyncStatus: offer.whop_sync_status || '',
      ...turnstileConfigForOffer(offer as any),
    });
    return;
  }

  try {
    const offerHint = {
      processor_override: offer.processor_override || null,
      nmi_processor_id: offer.nmi_processor_id || null,
    };
    const { config: procConfig } = await resolveProcessor(merchant.id, offer.location_id, offerHint);

    logger.info({
      ghlProductId,
      offerId: offer.id,
      offerName: offer.offer_name,
      processorOverride: offer.processor_override,
      resolvedProcessor: procConfig.processor_type,
    }, 'config-by-product: resolved processor for GHL product');

    const response: Record<string, any> = {
      offerId: offer.id,
      processorType: procConfig.processor_type,
      merchantName: merchant.business_name || '',
      ...turnstileConfigForOffer(offer as any),
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
    } else if (procConfig.processor_type === 'stripe') {
      response.stripePublishableKey = config.stripe.publishableKey || procConfig.stripe_publishable_key || '';
      response.stripeAccountId = procConfig.stripe_user_id || '';
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
  }
}

// ─── POST /api/checkout/process-payment ──────────────────────

export async function processPayment(req: Request, res: Response): Promise<void> {
  const {
    publishableKey, paymentToken, amount, currency,
    contactId, contactEmail, contactName,
    orderId, transactionId, subscriptionId,
    offerId, ghlProductId, consentToken, saveCard,
    deviceFingerprint, browserInfo,
    productDetails, requestThreeDSecure, selectedAddonIds,
    evidenceContextToken,
  } = req.body;

  if (!paymentToken || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: paymentToken and amount are required' });
    return;
  }

  if (!publishableKey && !offerId) {
    res.status(400).json({ success: false, error: 'Either publishableKey or offerId is required' });
    return;
  }

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > 99999999) {
    res.status(400).json({ success: false, error: 'Invalid amount: must be a positive integer number of cents (max $999,999.99)' });
    return;
  }

  const normalizedCurrency = String(currency || 'usd').toLowerCase();
  if (normalizedCurrency !== 'usd') {
    res.status(400).json({ success: false, error: 'Invalid currency' });
    return;
  }

  if (typeof paymentToken !== 'string' || paymentToken.length < 3) {
    res.status(400).json({ success: false, error: 'Invalid payment token' });
    return;
  }

  // Resolve merchant by publishableKey or by offerId
  let merchant: { merchantId: string; locationId: string } | null = null;
  let resolvedOffer: OfferRecord | null = null;
  if (publishableKey) {
    merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  }
  if (!merchant && offerId) {
    const offer = await offerRepository.findById(offerId);
    if (offer) {
      resolvedOffer = offer;
      const m = await merchantRepository.findByLocationId(offer.location_id);
      if (m) {
        merchant = { merchantId: m.id, locationId: m.location_id };
      }
    }
  }
  if (!merchant) {
    res.status(401).json({ success: false, error: 'Merchant not found' });
    return;
  }

  if (offerId) {
    const scopedOffer = resolvedOffer?.location_id === merchant.locationId
      ? resolvedOffer
      : await offerRepository.findById(offerId, merchant.locationId);
    if (!scopedOffer || !scopedOffer.active) {
      res.status(404).json({ success: false, error: 'Offer not found' });
      return;
    }
    resolvedOffer = scopedOffer;
    if ((resolvedOffer as any).checkout_type === 'whop') {
      res.status(400).json({
        success: false,
        error: 'This offer uses Whop checkout. Use the Whop embedded checkout session endpoint instead of direct card processing.',
      });
      return;
    }
  }

  const clientIp = getClientIp(req);
  const supabase = getSupabase();

  // Verify consent token if present
  let consentEnrollmentId = '';
  if (consentToken) {
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, status')
      .eq('consent_token', consentToken)
      .eq('location_id', merchant.locationId)
      .single();

    if (!enrollment) {
      res.status(400).json({ success: false, error: 'Consent verification failed. Please complete the enrollment process.' });
      return;
    }
    consentEnrollmentId = enrollment.id;
  }

  let contextEnrollmentId = '';
  let evidenceContextId = '';
  if (evidenceContextToken) {
    if (!resolvedOffer || !offerId) {
      res.status(400).json({ success: false, error: 'Evidence enrollment checkout requires a ScaleSafe offer' });
      return;
    }
    try {
      const context = await evidenceEnrollmentContextService.claimForCheckout({
        token: String(evidenceContextToken),
        offerId: String(offerId),
        email: String(contactEmail || ''),
      });
      if (context.locationId !== merchant.locationId || (consentEnrollmentId && context.enrollmentId !== consentEnrollmentId)) {
        res.status(400).json({ success: false, error: 'Evidence enrollment context does not match this checkout' });
        return;
      }
      contextEnrollmentId = context.enrollmentId;
      evidenceContextId = context.contextId;
    } catch (contextErr: any) {
      res.status(400).json({ success: false, error: contextErr.message || 'Evidence enrollment context is invalid' });
      return;
    }
  }

  let claimedPaymentAttemptKey = '';
  let cartQuote: CheckoutCartQuote | null = null;
  try {
    // Resolve offer hint for per-offer processor override
    let offerHint: { processor_override: 'nmi' | 'stripe' | null; nmi_processor_id: string | null } | undefined;
    if (offerId) {
      const ofr = resolvedOffer;
      resolvedOffer = ofr || resolvedOffer;
      if (ofr?.processor_override) {
        offerHint = { processor_override: ofr.processor_override as 'nmi' | 'stripe', nmi_processor_id: ofr.nmi_processor_id || null };
      }
    } else if (ghlProductId) {
      const { data: ofr } = await supabase.from('offers_mirror')
        .select('*')
        .eq('ghl_product_id', ghlProductId)
        .eq('location_id', merchant.locationId)
        .eq('active', true)
        .maybeSingle();
      resolvedOffer = ofr || null;
      if (ofr?.processor_override) {
        offerHint = { processor_override: ofr.processor_override as 'nmi' | 'stripe', nmi_processor_id: ofr.nmi_processor_id || null };
      }
    }

    if ((resolvedOffer as any)?.checkout_type === 'whop') {
      res.status(400).json({
        success: false,
        error: 'This offer uses Whop checkout. Use the Whop embedded checkout session endpoint instead of direct card processing.',
      });
      return;
    }
    await turnstileService.verifyForOffer(req, resolvedOffer);

    const paymentMethod = req.body.paymentMethod === 'ach' ? 'ach' : 'card';
    if (resolvedOffer) {
      const cartSelectedAddonIds = consentToken
        ? await checkoutCartService.selectedAddonIdsForConsent(String(consentToken))
        : checkoutCartService.normalizeAddonIds(selectedAddonIds);
      cartQuote = await checkoutCartService.quoteOffer(resolvedOffer, cartSelectedAddonIds, req.body.paymentChoice, paymentMethod);
      if (cartQuote.selectedAmountCents > 0 && cartQuote.selectedAmountCents !== amount) {
        logger.warn({
          offerId: resolvedOffer.id,
          submittedAmount: amount,
          expectedAmount: cartQuote.selectedAmountCents,
          paymentMethod,
        }, 'Rejected checkout amount mismatch');
        res.status(400).json({ success: false, error: 'Payment amount does not match selected offer' });
        return;
      }
    }

    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId, offerHint);
    const processor = createProcessorClient(procConfig);

    logger.info({
      offerId: offerId || null,
      ghlProductId: ghlProductId || null,
      processorOverride: offerHint?.processor_override || null,
      resolvedProcessor: procConfig.processor_type,
    }, 'processPayment: processor resolved');

    // Determine recurring status BEFORE charge — NMI needs to vault atomically during charge
    // Vault during charge for BOTH processors:
    // - NMI: tokens are single-use, must vault atomically (customer_vault=add_customer)
    // - Stripe: setup_future_usage='off_session' saves card for recurring
    const isRecurringPaymentType = ['installments', 'installment', 'subscription']
      .includes(String(req.body.paymentChoice || '').toLowerCase());
    if (paymentMethod === 'ach' && procConfig.processor_type !== 'nmi') {
      res.status(400).json({
        success: false,
        error: 'Stripe bank transfer uses the secure bank-account checkout flow. Please restart checkout and choose Bank Transfer.',
      });
      return;
    }
    const shouldVaultDuringCharge = !!contactEmail
      && (saveCard === true || isRecurringPaymentType);

    const checkoutAttemptKey = paymentAttemptKey([
      merchant.locationId,
      offerId || ghlProductId || '',
      consentToken || '',
      evidenceContextId || '',
      contactId || contactEmail || '',
      paymentToken,
      amount,
      paymentMethod,
      req.body.paymentChoice || '',
    ]);
    if (await idempotencyRepository.isDuplicate(checkoutAttemptKey, 'checkout_payment', merchant.locationId)) {
      res.status(409).json({ success: false, error: 'Payment is already processing. Please wait.' });
      return;
    }
    if (!claimPaymentAttempt(checkoutAttemptKey)) {
      res.status(409).json({ success: false, error: 'Payment is already processing. Please wait.' });
      return;
    }
    claimedPaymentAttemptKey = checkoutAttemptKey;

    const result = await processor.charge({
      amount,
      currency: normalizedCurrency,
      paymentToken,
      paymentMethodType: paymentMethod,
      achSecCode: req.body.achSecCode === 'TEL' || req.body.achSecCode === 'PPD' || req.body.achSecCode === 'CCD'
        ? req.body.achSecCode
        : 'WEB',
      achAccountHolderType: req.body.achAccountHolderType === 'business' ? 'business' : 'personal',
      achAccountType: req.body.achAccountType === 'savings' ? 'savings' : 'checking',
      description: productDetails?.[0]?.name || 'ScaleSafe Payment',
      metadata: {
        scalesafe_offer_id: offerId || '',
        selected_addon_ids: (cartQuote?.lineItems || []).filter((item) => item.addonId).map((item) => item.addonId).join(','),
        line_items: cartQuote ? JSON.stringify(cartQuote.lineItems) : '',
        consent_token: consentToken || '',
        enrollment_id: contextEnrollmentId || consentEnrollmentId || '',
        evidence_context_id: evidenceContextId,
        ghl_transaction_id: transactionId || '',
        ghl_order_id: orderId || '',
        customer_email: contactEmail || '',
        customer_ip: clientIp,
        terms_accepted: consentToken ? 'true' : '',
        terms_accepted_at: consentToken ? new Date().toISOString() : '',
        ce30_eligible: consentToken ? 'true' : 'false',
        first_name: contactName?.split(' ')[0] || '',
        last_name: contactName?.split(' ').slice(1).join(' ') || '',
        email: contactEmail || '',
        ip_address: clientIp,
      },
      statementDescriptorSuffix: productDetails?.[0]?.name?.substring(0, 22),
      requestThreeDSecure,
      shouldVault: shouldVaultDuringCharge,
      customerEmail: shouldVaultDuringCharge ? contactEmail : undefined,
      customerName: shouldVaultDuringCharge ? contactName : undefined,
    });

    const paymentSettled = result.success && result.status !== 'processing';
    const paymentProcessing = result.success && result.status === 'processing';
    const shouldSaveCard = result.success && !!contactEmail
      && (saveCard === true || isRecurringPaymentType);

    // Card persistence is deferred until AFTER the consent-token / quick-pay
    // contactId resolution blocks below — on the consent-token funnel path,
    // the bare `contactId` from req.body is empty until phase2EnrollmentService
    // (or the GHL upsert fallback) resolves it. We track the resolved value in
    // `finalContactId` and run the save-card block once at the end.
    let finalContactId = contactId || '';
    let finalEnrollmentId = contextEnrollmentId;
    let recurringSubscriptionId = '';
    let billingSetupIssue: BillingSetupIssue | null = null;

    // Create transaction mapping
    if (transactionId || orderId) {
      await supabase.from('transaction_mappings').insert({
        merchant_id: merchant.merchantId,
        location_id: merchant.locationId,
        ghl_transaction_id: transactionId || null,
        ghl_subscription_id: subscriptionId || null,
        ghl_order_id: orderId || null,
        processor_transaction_id: result.transactionId,
        processor_charge_id: result.chargeId || result.transactionId,
        processor_type: procConfig.processor_type,
        contact_id: contactId,
      });
    }

    // Log payment event
    const enrollmentLookup = consentToken
      ? await supabase.from('enrollments').select('id, offer_id, contact_id').eq('consent_token', consentToken).single()
      : contextEnrollmentId
        ? await supabase.from('enrollments').select('id, offer_id, contact_id').eq('id', contextEnrollmentId).eq('location_id', merchant.locationId).single()
        : null;

    await supabase.from('payment_events').insert({
      merchant_id: merchant.merchantId,
      location_id: merchant.locationId,
      contact_id: contactId || '',
      enrollment_id: enrollmentLookup?.data?.id || null,
      offer_id: enrollmentLookup?.data?.offer_id || offerId || null,
      event_type: result.success ? 'sale' : 'payment_failed',
      processor: procConfig.processor_type,
      processor_transaction_id: result.transactionId,
      amount: amount / 100, // store in dollars in DB
      currency: (currency || 'usd').toLowerCase(),
      payment_method_type: paymentMethod,
      selected_payment_method: paymentMethod,
      payment_status: paymentProcessing ? 'processing' : (result.success ? 'succeeded' : 'failed'),
      customer_email: contactEmail || null,
      consent_token: consentToken || null,
      failure_reason: result.errorMessage || null,
      ip_address: clientIp,
      device_info: deviceFingerprint || null,
      browser_info: browserInfo || null,
      source: 'checkout',
      is_recurring: false,
      line_items: cartQuote?.lineItems || [],
    });

    if (!result.success) {
      const failedContactId = contactId
        || enrollmentLookup?.data?.contact_id
        || (contactEmail ? await findExistingContactIdByEmail(merchant.locationId, contactEmail) : '');
      await fireCheckoutPaymentFailedTrigger({
        locationId: merchant.locationId,
        contactId: failedContactId,
        enrollmentId: enrollmentLookup?.data?.id || null,
        offerId: enrollmentLookup?.data?.offer_id || offerId || null,
        programName: productDetails?.[0]?.name || '',
        amountCents: amount,
        failureReason: result.errorMessage || null,
        transactionId: result.transactionId || result.chargeId || null,
        paymentSource: 'checkout',
      });
    }

    // ─── Complete enrollment + create GHL records ──────
    logger.info({ hasConsent: !!consentToken, paymentSuccess: result.success, paymentProcessing }, 'POST-PAYMENT: checking enrollment completion eligibility');
    if (paymentProcessing && consentToken) {
      try {
        const { data: processingEnrollment } = await supabase.from('enrollments')
          .update({
            status: 'payment_processing',
            payment_amount: amount / 100,
            payment_type: normalizePaymentType(req.body.paymentChoice),
            payment_transaction_id: result.transactionId || result.chargeId || '',
            processor_type: procConfig.processor_type,
            initial_payment_status: 'processing',
            initial_payment_method: paymentMethod,
            billing_setup_status: isRecurringPaymentType ? 'pending' : 'ok',
            ...(isRecurringPaymentType ? { next_billing_date: null } : {}),
          } as any)
          .eq('consent_token', consentToken)
          .eq('location_id', merchant.locationId)
          .select('id, contact_id')
          .maybeSingle();
        if (processingEnrollment?.id) {
          finalEnrollmentId = processingEnrollment.id;
          if (processingEnrollment.contact_id) finalContactId = processingEnrollment.contact_id;
        }
      } catch (markErr: any) {
        logger.warn({ err: markErr.message, consentToken }, 'ACH processing status update failed');
      }
    }
    if (paymentSettled && consentToken) {
      try {
        const { data: enrollment, error: enrollLookupErr } = await supabase
          .from('enrollments')
          .select('*')
          .eq('consent_token', consentToken)
          .single();

        if (enrollment) {
          const enrollEmail = (enrollment as any).email || '';
          const enrollContactId = (enrollment as any).contact_id || '';
          finalEnrollmentId = enrollment.id;
          logger.info({ enrollmentId: enrollment.id, hasEmail: !!enrollEmail, contactId: enrollContactId, status: (enrollment as any).status, paymentChoice: req.body.paymentChoice }, 'POST-PAYMENT: enrollment found');

          // Resolve payment type and installment count
          const resolvedPaymentType = normalizePaymentType(req.body.paymentChoice);
          let paymentsTotal: number | null = null;
          if (resolvedPaymentType === 'installment' && (enrollment as any).offer_id) {
            const { data: offerRow } = await supabase
              .from('offers_mirror').select('num_payments').eq('id', (enrollment as any).offer_id).single();
            paymentsTotal = offerRow?.num_payments || null;
          }

          // 1. Complete enrollment in Supabase (status, evidence, triggers)
          await phase2EnrollmentService.completeEnrollment({
            enrollmentId: enrollment.id,
            locationId: (enrollment as any).location_id || merchant.locationId,
            contactId: enrollContactId || contactId || '',
            contactEmail: contactEmail || enrollEmail,
            paymentAmount: amount / 100,
            paymentType: resolvedPaymentType,
            transactionId: result.transactionId || result.chargeId || '',
            paymentsTotal,
            processorType: procConfig.processor_type,
          });

          // Re-query enrollment to get the contactId that completeEnrollment resolved.
          const { data: updatedEnrollment } = await supabase
            .from('enrollments')
            .select('contact_id')
            .eq('id', enrollment.id)
            .single();
          let resolvedContactId = updatedEnrollment?.contact_id || contactId || '';

          // FALLBACK: If completeEnrollment didn't save a contactId, do it here directly
          if (!resolvedContactId) {
            const clientEmail = contactEmail || enrollEmail;
            if (clientEmail) {
              try {
                const locId = (enrollment as any).location_id || merchant.locationId;
                const api = await ghlApi(locId);
                // Name priority: enrollment first_name → digital_signature → contactName → email prefix
                let fallbackFirstName = (enrollment as any).first_name || '';
                let fallbackLastName = (enrollment as any).last_name || '';
                if (!fallbackFirstName && (enrollment as any).digital_signature) {
                  const sigParts = ((enrollment as any).digital_signature as string).trim().split(/\s+/);
                  fallbackFirstName = sigParts[0] || '';
                  fallbackLastName = sigParts.slice(1).join(' ') || '';
                }
                if (!fallbackFirstName) {
                  fallbackFirstName = contactName || clientEmail.split('@')[0] || 'Client';
                }
                const upsertRes = await api.post('/contacts/upsert', {
                  firstName: fallbackFirstName,
                  lastName: fallbackLastName,
                  email: clientEmail,
                  locationId: locId,
                });
                resolvedContactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
                logger.info({ resolvedContactId, hasEmail: !!clientEmail }, 'POST-PAYMENT FALLBACK: GHL contact upserted');
                if (resolvedContactId) {
                  await supabase.from('enrollments')
                    .update({ contact_id: resolvedContactId })
                    .eq('id', enrollment.id);
                }
              } catch (fallbackErr: any) {
                logger.error({ err: fallbackErr.message, stack: fallbackErr.stack }, 'POST-PAYMENT FALLBACK: GHL upsert failed');
              }
            }
          }
          logger.info({ resolvedContactId, enrollmentId: enrollment.id }, 'POST-PAYMENT: final contactId');
          if (resolvedContactId) finalContactId = resolvedContactId;

          // Backfill contactId on payment_events that were inserted before GHL upsert
          if (resolvedContactId) {
            await supabase.from('payment_events')
              .update({ contact_id: resolvedContactId })
              .eq('consent_token', consentToken)
              .eq('contact_id', '');
          }

          // Insert payment_customer_map with the resolved contactId
          try {
            await supabase.from('payment_customer_map').insert({
              customer_id: result.chargeId || result.transactionId || '',
              contact_id: resolvedContactId,
              location_id: merchant.locationId,
              offer_id: offerId || (enrollment as any).offer_id || '',
              program_name: productDetails?.[0]?.name || '',
              payment_type: normalizePaymentType(req.body.paymentChoice),
              processor: procConfig.processor_type,
            });
          } catch (mapErr: any) {
            logger.warn({ err: mapErr.message }, 'Failed to insert payment_customer_map');
          }
        } else {
          logger.warn({ hasConsent: !!consentToken, lookupError: enrollLookupErr?.message }, 'POST-PAYMENT: NO enrollment found for consent token');
        }
      } catch (enrollErr: any) {
        logger.error({ err: enrollErr.message, stack: enrollErr.stack, hasConsent: !!consentToken }, 'POST-PAYMENT: completeEnrollment failed — payment still succeeded');
      }
    }

    // For payments WITHOUT consent token: upsert GHL contact from customer fields
    if ((paymentSettled || paymentProcessing) && !consentToken) {
      const quickPayEmail = contactEmail || req.body.contactEmail || '';
      const quickPayName = contactName || req.body.contactName || '';
      const quickPayPhone = req.body.contactPhone || '';
      let resolvedQuickPayContact = contactId || '';
      if (quickPayEmail && !resolvedQuickPayContact) {
        try {
          const existingContactId = await findExistingContactIdByEmail(merchant.locationId, quickPayEmail);
          if (existingContactId) {
            resolvedQuickPayContact = existingContactId;
            finalContactId = existingContactId;
            logger.info(
              { contactId: resolvedQuickPayContact, hasEmail: !!quickPayEmail },
              'Quick Pay: existing contact reused from prior enrollment',
            );
          }
        } catch (lookupErr: any) {
          logger.warn({ err: lookupErr.message }, 'Quick Pay: existing contact lookup failed');
        }
      }

      if (quickPayEmail && !resolvedQuickPayContact) {
        try {
          const api = await ghlApi(merchant.locationId);
          const nameParts = quickPayName.split(' ');
          const upsertRes = await api.post('/contacts/upsert', {
            firstName: nameParts[0] || quickPayEmail.split('@')[0] || 'Client',
            lastName: nameParts.slice(1).join(' ') || '',
            email: quickPayEmail,
            phone: quickPayPhone,
            locationId: merchant.locationId,
          });
          resolvedQuickPayContact = upsertRes.data.contact?.id || upsertRes.data.id || '';
          if (resolvedQuickPayContact) finalContactId = resolvedQuickPayContact;
          logger.info({ contactId: resolvedQuickPayContact, hasEmail: !!quickPayEmail }, 'Quick Pay: GHL contact upserted');

          // Set engagement status baseline for new contacts (gated on merchant toggle).
          if (resolvedQuickPayContact) {
            try {
              const merchantRow = await merchantRepository.findByLocationId(merchant.locationId);
              if ((merchantRow as any)?.engagement_enabled ?? true) {
                await api.put(`/contacts/${resolvedQuickPayContact}`, {
                  customField: { 'contact.ss_engagement_status': 'Active' },
                });
              }
            } catch {}
          }

          // Backfill payment_events with resolved contactId
          if (resolvedQuickPayContact) {
            await supabase.from('payment_events')
              .update({ contact_id: resolvedQuickPayContact })
              .eq('processor_transaction_id', result.transactionId)
              .eq('contact_id', '');
          }
        } catch (upsertErr: any) {
          logger.warn({ err: upsertErr.message }, 'Quick Pay: GHL contact upsert failed — payment still succeeded');
        }
      }

      // Backfill payment_events with any contactId resolved through existing enrollment or GHL upsert.
      if (resolvedQuickPayContact) {
        try {
          await supabase.from('payment_events')
            .update({ contact_id: resolvedQuickPayContact })
            .eq('processor_transaction_id', result.transactionId)
            .eq('contact_id', '');
        } catch (backfillErr: any) {
          logger.warn(
            { err: backfillErr.message, transactionId: result.transactionId },
            'Quick Pay: payment event contact backfill failed - non-blocking',
          );
        }
      }

      // ─── Quick Pay enrollment + receipt ──────────────────────────
      // For installment/subscription Quick Pay offers, create a synthetic enrollment
      // row so the payment-reminder job and processor subscription setup can key off it.
      let quickPayEnrollmentId: string | null = contextEnrollmentId || null;
      let quickPayPaymentKind: 'one_off' | 'installment' | 'subscription' = 'one_off';
      let quickPayPaymentsTotal: number | null = null;
      let quickPayPaymentsRemaining = 0;

      if (offerId) {
        try {
          const offer = resolvedOffer || await offerRepository.findById(offerId, merchant.locationId);
          const offerPaymentType = (offer as any)?.payment_type || 'one_time';
          const isRecurringQuickPay = offerPaymentType === 'installment'
            || offerPaymentType === 'installments'
            || offerPaymentType === 'subscription';
          if (isRecurringQuickPay || contextEnrollmentId) {
            if (isRecurringQuickPay) {
            quickPayPaymentKind = offerPaymentType === 'subscription' ? 'subscription' : 'installment';
            quickPayPaymentsTotal = offerPaymentType === 'subscription' ? null : ((offer as any)?.num_payments || null);
            quickPayPaymentsRemaining = quickPayPaymentsTotal ? Math.max(0, quickPayPaymentsTotal - 1) : 0;
            }

            if (resolvedQuickPayContact) {
              if (contextEnrollmentId) {
                const contextPaymentType = isRecurringQuickPay
                  ? quickPayPaymentKind
                  : normalizePaymentType(String(req.body.paymentChoice || offerPaymentType || 'pif'));
                const contextBillingComplete = quickPayPaymentKind === 'one_off'
                  || (quickPayPaymentKind === 'installment' && quickPayPaymentsTotal != null && quickPayPaymentsTotal <= 1);
                const contextNextBilling = contextBillingComplete
                  ? null
                  : computeNextBillingDate((offer as any)?.installment_frequency);
                const contextEnrolledAt = new Date().toISOString();
                const { error: contextEnrollmentError } = await supabase
                  .from('enrollments')
                  .update({
                    merchant_id: merchant.merchantId,
                    contact_id: resolvedQuickPayContact,
                    offer_id: offerId,
                    email: quickPayEmail || null,
                    status: paymentProcessing ? 'payment_processing' : 'enrolled',
                    payment_amount: amount / 100,
                    payment_type: contextPaymentType,
                    payment_transaction_id: result.transactionId,
                    processor_type: procConfig.processor_type,
                    initial_payment_status: paymentProcessing ? 'processing' : 'succeeded',
                    initial_payment_method: paymentMethod,
                    payments_made: paymentProcessing ? 0 : 1,
                    payments_total: quickPayPaymentsTotal,
                    next_billing_date: contextNextBilling,
                    billing_setup_status: contextBillingComplete ? 'ok' : 'pending',
                    ...(contextBillingComplete ? { billing_completed_at: contextEnrolledAt } : {}),
                    enrolled_at: paymentProcessing ? null : contextEnrolledAt,
                    selected_checkout_items: cartQuote?.lineItems || [],
                  } as any)
                  .eq('id', contextEnrollmentId)
                  .eq('location_id', merchant.locationId)
                  .eq('offer_id', offerId);
                if (contextEnrollmentError) throw contextEnrollmentError;
                quickPayEnrollmentId = contextEnrollmentId;
                await supabase.from('payment_events')
                  .update({ enrollment_id: contextEnrollmentId, contact_id: resolvedQuickPayContact })
                  .eq('processor_transaction_id', result.transactionId)
                  .eq('location_id', merchant.locationId);
              } else {
              // Idempotency: skip if an enrollment already exists for this transaction.
              const { data: existingEnr } = await supabase
                .from('enrollments')
                .select('id')
                .eq('payment_transaction_id', result.transactionId)
                .maybeSingle();

              if (existingEnr?.id) {
                quickPayEnrollmentId = existingEnr.id;
              } else {
                const quickPayBillingComplete = quickPayPaymentKind === 'installment'
                  && quickPayPaymentsTotal != null
                  && quickPayPaymentsTotal <= 1;
                const nextBilling = quickPayBillingComplete
                  ? null
                  : computeNextBillingDate((offer as any)?.installment_frequency);
                const enrolledAt = new Date().toISOString();
                const { data: insertedEnr, error: enrInsertErr } = await supabase
                  .from('enrollments')
                  .insert({
                    location_id: merchant.locationId,
                    merchant_id: merchant.merchantId,
                    contact_id: resolvedQuickPayContact,
                    offer_id: offerId,
                    email: quickPayEmail || null,
                    status: paymentProcessing ? 'payment_processing' : 'enrolled',
                    payment_amount: amount / 100,
                    payment_type: quickPayPaymentKind,
                    payment_transaction_id: result.transactionId,
                    processor_type: procConfig.processor_type,
                    initial_payment_status: paymentProcessing ? 'processing' : 'succeeded',
                    initial_payment_method: paymentMethod,
                    payments_made: 1,
                    payments_total: quickPayPaymentsTotal,
                    next_billing_date: nextBilling,
                    // Batch H: a recurring enrollment starts 'pending' until its processor
                    // subscription is confirmed; a single-payment installment is already 'ok'.
                    billing_setup_status: quickPayBillingComplete ? 'ok' : 'pending',
                    ...(quickPayBillingComplete ? { billing_completed_at: enrolledAt } : {}),
                    enrolled_at: enrolledAt,
                  } as any)
                  .select('id')
                  .single();
                if (enrInsertErr) {
                  logger.warn({ err: enrInsertErr.message, offerId, contactId: resolvedQuickPayContact }, 'Quick Pay: enrollment insert failed — recurring billing will not run');
                } else {
                  quickPayEnrollmentId = insertedEnr?.id || null;
                  // Backfill enrollment_id on the payment_events row inserted earlier.
                  if (quickPayEnrollmentId) {
                    await supabase.from('payment_events')
                      .update({ enrollment_id: quickPayEnrollmentId })
                      .eq('processor_transaction_id', result.transactionId);
                  }
                  logger.info({ enrollmentId: quickPayEnrollmentId, contactId: resolvedQuickPayContact, offerId, paymentKind: quickPayPaymentKind, nextBilling }, 'Quick Pay: synthetic enrollment created for recurring billing');
                }
              }
              }
            } else {
              logger.warn({ offerId }, 'Quick Pay: installment/subscription offer but no resolvable contactId — skipping enrollment creation');
            }
          }
        } catch (offerErr: any) {
          logger.warn({ err: offerErr.message, offerId }, 'Quick Pay: offer lookup failed — defaulting to one-off receipt');
        }
      }

      // Insert payment_customer_map
      if (quickPayEnrollmentId) finalEnrollmentId = quickPayEnrollmentId;
      if (offerId) {
        try {
          await supabase.from('payment_customer_map').insert({
            customer_id: result.chargeId || result.transactionId || '',
            contact_id: resolvedQuickPayContact || '',
            location_id: merchant.locationId,
            offer_id: offerId,
            program_name: productDetails?.[0]?.name || '',
            payment_type: normalizePaymentType(req.body.paymentChoice),
            processor: procConfig.processor_type,
          });
        } catch (mapErr: any) {
          logger.warn({ err: mapErr.message }, 'Failed to insert payment_customer_map — non-blocking');
        }
      }

      // Fire Quick Pay receipt — ss_payment_received with payment_kind so the
      // PMG Recurring Payment Receipt workflow can branch on one-off vs installment copy.
      if (paymentSettled && resolvedQuickPayContact) {
        try {
          await triggerService.fireTrigger(merchant.locationId, 'ss_payment_received', {
            event_type: 'payment_received',
            location_id: merchant.locationId,
            locationId: merchant.locationId,
            contact_id: resolvedQuickPayContact,
            contactId: resolvedQuickPayContact,
            program_name: productDetails?.[0]?.name || '',
            programName: productDetails?.[0]?.name || '',
            offer_name: productDetails?.[0]?.name || '',
            offerName: productDetails?.[0]?.name || '',
            amount: amount / 100,
            amount_display: `$${Number(amount / 100).toFixed(2)}`,
            amountDisplay: `$${Number(amount / 100).toFixed(2)}`,
            line_items: cartQuote?.lineItems || [],
            lineItems: cartQuote?.lineItems || [],
            transaction_id: result.transactionId,
            transactionId: result.transactionId,
            enrollment_id: finalEnrollmentId || '',
            enrollmentId: finalEnrollmentId || '',
            offer_id: offerId || '',
            offerId: offerId || '',
            processor: procConfig.processor_type,
            source: 'quick_checkout',
            payment_source: 'quick_checkout',
            paymentSource: 'quick_checkout',
            payment_timing: quickPayEnrollmentId ? 'quick_enrollment' : 'client_level',
            paymentTiming: quickPayEnrollmentId ? 'quick_enrollment' : 'client_level',
            payments_remaining: quickPayPaymentsRemaining,
            paymentsRemaining: quickPayPaymentsRemaining,
            running_total: amount / 100,
            runningTotal: amount / 100,
            payment_kind: quickPayPaymentKind,
            paymentKind: quickPayPaymentKind,
            receipt_only: true,
            receiptOnly: true,
            send_receipt: true,
            sendReceipt: true,
            send_welcome: false,
            sendWelcome: false,
          });
        } catch (trigErr: any) {
          logger.warn({ err: trigErr.message, contactId: resolvedQuickPayContact }, 'Quick Pay: ss_payment_received trigger fire failed (non-fatal)');
        }
      }
    }

    // Persist card before creating a processor-level recurring subscription.
    // Runs after contactId resolution so payment_methods and processor metadata
    // attach to the same client/enrollment record.
    if (shouldSaveCard) {
      if (!finalContactId) {
        billingSetupIssue = {
          code: 'missing_contact_for_recurring_setup',
          message: 'Payment was received, but recurring billing setup could not complete because the contact was not resolved.',
        };
        logger.warn({ contactEmail }, 'CARD-SAVE: skipped - could not resolve contactId for recurring payment');
      } else {
        try {
          let saveResult: {
            success: boolean;
            paymentMethodId: string;
            customerId: string;
            cardLastFour: string;
            cardBrand: string;
            cardExpMonth: number;
            cardExpYear: number;
            paymentMethodKind?: 'card' | 'ach';
            bankLastFour?: string;
            bankAccountType?: string;
            bankHolderType?: string;
          };

          if (result.vaultedCustomerId) {
            // Atomic vault succeeded during charge — no separate saveCard needed
            // NMI: customerId = vaultId, paymentMethodId = vaultId (same value)
            // Stripe: customerId = cus_xxx, paymentMethodId = pm_xxx (the original token)
            saveResult = {
              success: true,
              paymentMethodId: procConfig.processor_type === 'stripe' ? paymentToken : result.vaultedCustomerId,
              customerId: result.vaultedCustomerId,
              cardLastFour: result.vaultedCardLastFour || '****',
              cardBrand: result.vaultedCardBrand || 'unknown',
              cardExpMonth: result.vaultedCardExpMonth || 0,
              cardExpYear: result.vaultedCardExpYear || 0,
              paymentMethodKind: paymentMethod,
              bankLastFour: result.vaultedBankLastFour,
              bankAccountType: result.vaultedBankAccountType,
              bankHolderType: result.vaultedBankHolderType,
            };
            logger.info({ customerId: result.vaultedCustomerId, processor: procConfig.processor_type, contactId: finalContactId }, 'CARD-SAVE: using vault from atomic charge');
          } else {
            // Fallback — separate saveCard call
            saveResult = await processor.saveCard({
              paymentToken,
              contactId: finalContactId,
              customerEmail: contactEmail,
              customerName: contactName,
            });
          }

          await saveOrReusePaymentMethod({
            merchantId: merchant.merchantId,
            locationId: merchant.locationId,
            contactId: finalContactId,
            processorType: procConfig.processor_type,
            paymentMethodKind: paymentMethod,
            customerId: saveResult.customerId,
            paymentMethodId: saveResult.paymentMethodId,
            cardLastFour: saveResult.cardLastFour,
            cardBrand: saveResult.cardBrand,
            cardExpMonth: saveResult.cardExpMonth,
            cardExpYear: saveResult.cardExpYear,
            bankLastFour: saveResult.bankLastFour,
            bankAccountType: saveResult.bankAccountType,
            bankHolderType: saveResult.bankHolderType,
            makeDefault: true,
          });

          logger.info({
            contactId: finalContactId,
            processor: procConfig.processor_type,
            paymentChoice: req.body.paymentChoice,
            recurring: isRecurringPaymentType,
            cardLastFour: saveResult.cardLastFour,
            cardBrand: saveResult.cardBrand,
            cardExpMonth: saveResult.cardExpMonth,
            cardExpYear: saveResult.cardExpYear,
          }, 'CARD-SAVE: payment method persisted for recurring billing');

          // Create the processor-level subscription before responding. Recurring
          // checkout is not complete unless the processor subscription ID is saved.
          if (isRecurringPaymentType && finalEnrollmentId) {
            try {
              const { data: enrForSub } = await supabase
                .from('enrollments')
                .select('id, offer_id, payment_type, payments_total, next_billing_date')
                .eq('id', finalEnrollmentId)
                .single();

              if (!enrForSub?.offer_id || !enrForSub.next_billing_date) {
                billingSetupIssue = {
                  code: 'missing_enrollment_schedule_for_recurring_setup',
                  message: 'Payment was received, but recurring billing setup could not complete because the enrollment schedule was incomplete.',
                };
              } else {
                const { data: subOffer } = await supabase
                  .from('offers_mirror')
                  .select('id, location_id, offer_name, price, payment_type, installment_amount, installment_frequency, dual_pricing_enabled, ach_enabled, ach_access_policy')
                  .eq('id', enrForSub.offer_id)
                  .single();

                if (!subOffer) {
                  billingSetupIssue = {
                    code: 'missing_offer_for_recurring_setup',
                    message: 'Payment was received, but recurring billing setup could not complete because the offer was not found.',
                  };
                } else {
                  const recurringPaymentType = String(enrForSub.payment_type || subOffer.payment_type || '').toLowerCase();
                  const recurringQuote = await checkoutCartService.quoteOffer(subOffer as any, [], recurringPaymentType, paymentMethod);
                  const subAmountCents = recurringQuote.futureRecurringSelectedAmountCents || recurringQuote.selectedAmountCents;
                  const freq = (subOffer.installment_frequency || 'monthly').toLowerCase();
                  const subInterval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' =
                    freq === 'daily' ? 'daily' :
                    freq === 'weekly' ? 'weekly' :
                    freq === 'bi_weekly' || freq === 'biweekly' ? 'biweekly' :
                    freq === 'quarterly' ? 'quarterly' :
                    freq === 'annual' ? 'annual' : 'monthly';

                  const remainingPayments = recurringPaymentType === 'subscription'
                    ? 0
                    : Math.max(0, (enrForSub.payments_total || 0) - 1);

                  if (subAmountCents > 0 && (recurringPaymentType === 'subscription' || remainingPayments > 0)) {
                    const subResult = await processor.createSubscription({
                      paymentMethodId: saveResult.paymentMethodId || saveResult.customerId,
                      customerId: saveResult.customerId,
                      planAmount: subAmountCents,
                      interval: subInterval,
                      totalPayments: remainingPayments,
                      startDate: enrForSub.next_billing_date,
                      description: subOffer.offer_name || 'ScaleSafe Installment',
                      metadata: {
                        enrollment_id: finalEnrollmentId,
                        offer_id: enrForSub.offer_id,
                        contact_id: finalContactId,
                        location_id: merchant.locationId,
                        payment_type: recurringPaymentType,
                      },
                    });

                    if (subResult.success && subResult.subscriptionId) {
                      recurringSubscriptionId = subResult.subscriptionId;
                      const { error: subSaveErr } = await supabase.from('enrollments')
                        .update({ processor_subscription_id: subResult.subscriptionId, processor_type: procConfig.processor_type })
                        .eq('id', finalEnrollmentId);
                      if (subSaveErr) {
                        billingSetupIssue = {
                          code: 'processor_subscription_save_failed',
                          message: subSaveErr.message || 'The processor subscription was created, but ScaleSafe could not save the subscription ID.',
                        };
                        logger.error({
                          enrollmentId: finalEnrollmentId,
                          subscriptionId: subResult.subscriptionId,
                          err: subSaveErr.message,
                        }, 'Processor subscription ID save failed during checkout');
                      } else {
                        logger.info({
                          enrollmentId: finalEnrollmentId,
                          subscriptionId: subResult.subscriptionId,
                          processor: procConfig.processor_type,
                          interval: subInterval,
                          remainingPayments,
                          recurringPaymentType,
                        }, 'Processor recurring subscription created during checkout');
                      }
                    } else {
                      billingSetupIssue = {
                        code: 'processor_subscription_creation_failed',
                        message: subResult.errorMessage || 'Payment was received, but recurring billing setup failed at the processor.',
                      };
                      logger.error({
                        enrollmentId: finalEnrollmentId,
                        error: subResult.errorMessage,
                      }, 'Processor subscription creation failed during checkout');
                    }
                  }
                }
              }
            } catch (subErr: any) {
              billingSetupIssue = {
                code: 'processor_subscription_creation_error',
                message: subErr.message || 'Payment was received, but recurring billing setup failed.',
              };
              logger.error({
                err: subErr.message,
                enrollmentId: finalEnrollmentId,
              }, 'Processor subscription creation threw during checkout');
            }
          } else if (isRecurringPaymentType && !finalEnrollmentId) {
            billingSetupIssue = {
              code: 'missing_enrollment_for_recurring_setup',
              message: 'Payment was received, but recurring billing setup could not complete because the enrollment was not saved.',
            };
          }
        } catch (err: any) {
          billingSetupIssue = {
            code: 'card_save_failed_for_recurring_setup',
            message: err.message || 'Payment was received, but the payment method could not be saved for recurring billing.',
          };
          logger.warn({
            err: err.message,
            contactId: finalContactId,
            paymentChoice: req.body.paymentChoice,
          }, 'CARD-SAVE: failed - payment still succeeded but recurring billing will not run');
        }
      }
    } else if (result.success && isRecurringPaymentType) {
      billingSetupIssue = {
        code: 'card_not_saved_for_recurring_setup',
        message: 'Payment was received, but the payment method was not saved for recurring billing.',
      };
    }

    // Batch H: persist the billing-setup outcome on the enrollment so a recurring enrollment
    // whose processor subscription did not complete STOPS looking healthy. No fallback billing —
    // a failed setup is surfaced (status + nulled schedule) for the merchant to repair.
    if (isRecurringPaymentType && finalEnrollmentId) {
      try {
        if (billingSetupIssue) {
          // The processor subscription was created but its ID could not be saved -> the
          // processor WILL bill; flag for reconciliation rather than as a dead enrollment.
          const needsReconciliation = billingSetupIssue.code === 'processor_subscription_save_failed';
          await supabase.from('enrollments').update({
            billing_setup_status: needsReconciliation ? 'needs_reconciliation' : 'failed',
            billing_setup_error: billingSetupIssue.message || billingSetupIssue.code,
            next_billing_date: null, // stop reminders / active views treating it as scheduled
          }).eq('id', finalEnrollmentId).eq('location_id', merchant.locationId);
        } else if (recurringSubscriptionId) {
          await supabase.from('enrollments').update({
            billing_setup_status: 'ok',
            next_billing_date_source: 'processor',
          }).eq('id', finalEnrollmentId).eq('location_id', merchant.locationId);
        }
      } catch (markErr: any) {
        logger.warn({ err: markErr.message, enrollmentId: finalEnrollmentId }, 'Failed to persist billing_setup_status (non-fatal)');
      }
    }

    // Flag payment without consent (do NOT block — just warn)
    if (paymentSettled && !consentToken && !evidenceContextToken && offerId) {
      logger.warn({
        event: 'payment_without_consent',
        merchantId: merchant.merchantId,
        locationId: merchant.locationId,
        contactId: contactId || '',
        offerId,
      }, 'Payment completed without consent token');
    }

    // Structured payment event log
    logger.info({
      event: 'payment_processed',
      merchantId: merchant.merchantId,
      locationId: merchant.locationId,
      processor: procConfig.processor_type,
      amount,
      currency: (currency || 'usd').toLowerCase(),
      success: result.success,
      chargeId: result.chargeId || result.transactionId,
      hasConsent: !!consentToken,
      timestamp: new Date().toISOString(),
    }, result.success ? 'Payment succeeded' : 'Payment failed');

    res.json({
      success: result.success,
      chargeId: result.chargeId || result.transactionId,
      paymentStatus: paymentProcessing ? 'processing' : (result.success ? 'succeeded' : 'failed'),
      paymentMethod,
      subscriptionId: recurringSubscriptionId || undefined,
      billingIssue: billingSetupIssue || undefined,
      error: result.errorMessage,
      threeDSecureUrl: result.threeDSecureUrl,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack, merchantId: merchant.merchantId }, 'Checkout payment failed');
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Payment processing error' });
  } finally {
    releasePaymentAttempt(claimedPaymentAttemptKey);
  }
}

// ─── POST /api/checkout/whop/session ─────────────────────────────────────────

async function resolveQuickCheckoutContact(params: {
  locationId: string;
  email: string;
  name?: string;
  phone?: string;
  explicitContactId?: string;
}): Promise<string> {
  if (params.explicitContactId) return params.explicitContactId;
  const email = String(params.email || '').trim().toLowerCase();
  if (!email) return '';

  const existingContactId = await findExistingContactIdByEmail(params.locationId, email);
  if (existingContactId) return existingContactId;

  const api = await ghlApi(params.locationId);
  const nameParts = String(params.name || '').trim().split(/\s+/).filter(Boolean);
  const upsertRes = await api.post('/contacts/upsert', {
    firstName: nameParts[0] || email.split('@')[0] || 'Client',
    lastName: nameParts.slice(1).join(' ') || '',
    email,
    phone: params.phone || undefined,
    locationId: params.locationId,
  });
  return upsertRes.data.contact?.id || upsertRes.data.id || '';
}

export async function createWhopCheckoutSession(req: Request, res: Response): Promise<void> {
  try {
    const { offerId, consentToken, contactId, contactEmail, contactName, contactPhone, checkoutMode, paymentChoice, selectedAddonIds, evidenceContextToken } = req.body || {};
    if (!offerId) {
      res.status(400).json({ success: false, error: 'offerId required' });
      return;
    }

    const offer = await offerRepository.findById(String(offerId));
    if (!offer || !offer.active) {
      res.status(404).json({ success: false, error: 'Offer not found' });
      return;
    }
    if ((offer as any).checkout_type !== 'whop') {
      res.status(400).json({ success: false, error: 'Offer is not configured for Whop checkout' });
      return;
    }
    await turnstileService.verifyForOffer(req, offer);

    const supabase = getSupabase();
    let enrollmentId = '';
    let resolvedContactId = typeof contactId === 'string' ? contactId : '';
    let resolvedEmail = typeof contactEmail === 'string' ? contactEmail : '';
    let resolvedName = typeof contactName === 'string' ? contactName : '';
    let resolvedPhone = typeof contactPhone === 'string' ? contactPhone : '';
    if (consentToken) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, location_id, contact_id, email, first_name, last_name, status')
        .eq('consent_token', consentToken)
        .eq('location_id', offer.location_id)
        .maybeSingle();
      if (!enrollment) {
        res.status(400).json({ success: false, error: 'Consent verification failed. Please complete enrollment before payment.' });
        return;
      }
      enrollmentId = enrollment.id;
      resolvedContactId = enrollment.contact_id || resolvedContactId;
      resolvedEmail = enrollment.email || resolvedEmail;
      resolvedName = [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ') || resolvedName;
    } else if (resolvedEmail) {
      try {
        resolvedContactId = await resolveQuickCheckoutContact({
          locationId: offer.location_id,
          email: resolvedEmail,
          name: resolvedName,
          phone: resolvedPhone,
          explicitContactId: resolvedContactId,
        });
      } catch (contactErr: any) {
        logger.warn({ err: contactErr.message, offerId, hasEmail: !!resolvedEmail }, 'Whop quick checkout contact resolution failed');
      }
    }

    if (evidenceContextToken) {
      const context = await evidenceEnrollmentContextService.claimForCheckout({
        token: String(evidenceContextToken),
        offerId: offer.id,
        email: resolvedEmail,
      });
      if (context.locationId !== offer.location_id || (enrollmentId && context.enrollmentId !== enrollmentId)) {
        res.status(400).json({ success: false, error: 'Evidence enrollment context does not match this checkout' });
        return;
      }
      enrollmentId = context.enrollmentId;
      if (!resolvedContactId && resolvedEmail) {
        resolvedContactId = await resolveQuickCheckoutContact({
          locationId: offer.location_id,
          email: resolvedEmail,
          name: resolvedName,
          phone: resolvedPhone,
        });
      }
    }

    const normalizedChoice = normalizePaymentType(String(paymentChoice || offer.payment_type || 'pif'));
    const cartSelectedAddonIds = consentToken
      ? await checkoutCartService.selectedAddonIdsForConsent(String(consentToken))
      : checkoutCartService.normalizeAddonIds(selectedAddonIds);
    const quote = await checkoutCartService.quoteOffer(offer, cartSelectedAddonIds, normalizedChoice, 'card');

    const session = await whopService.createCheckoutSession({
      locationId: offer.location_id,
      offer,
      enrollmentId,
      contactId: resolvedContactId,
      contactEmail: resolvedEmail,
      contactName: resolvedName,
      contactPhone: resolvedPhone,
      consentToken: consentToken || '',
      checkoutMode: checkoutMode === 'quick_checkout' ? 'quick_checkout' : 'full_enrollment',
      quote,
    });

    if (enrollmentId) {
      await supabase
        .from('enrollments')
        .update({
          checkout_type: 'whop',
          processor_type: 'whop',
          whop_checkout_session_id: session.sessionId,
          whop_checkout_url: session.checkoutUrl || null,
          selected_checkout_items: quote.lineItems || [],
          ...(evidenceContextToken && resolvedContactId ? {
            contact_id: resolvedContactId,
            email: resolvedEmail.trim().toLowerCase(),
          } : {}),
        } as any)
        .eq('id', enrollmentId)
        .eq('location_id', offer.location_id);
    }

    res.json({ success: true, ...session });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Whop checkout session creation failed');
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to create Whop checkout session' });
  }
}

// ─── POST /api/checkout/save-card ────────────────────────────

export async function saveCard(req: Request, res: Response): Promise<void> {
  const { publishableKey, paymentToken, contactId, contactEmail, contactName } = req.body;

  if (!publishableKey || !paymentToken || !contactEmail) {
    res.status(400).json({ success: false, error: 'Missing required fields: publishableKey, paymentToken, and contactEmail are required' });
    return;
  }

  if (typeof contactEmail !== 'string' || !contactEmail.includes('@')) {
    res.status(400).json({ success: false, error: 'Invalid email address' });
    return;
  }

  const merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  if (!merchant) {
    res.status(401).json({ success: false, error: 'Invalid publishable key' });
    return;
  }

  try {
    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId);
    const processor = createProcessorClient(procConfig);

    const result = await processor.saveCard({
      paymentToken,
      contactId: contactId || '',
      customerEmail: contactEmail,
      customerName: contactName,
    });

    // Store/reuse in payment_methods
    const supabase = getSupabase();
    await saveOrReusePaymentMethod({
      merchantId: merchant.merchantId,
      locationId: merchant.locationId,
      contactId,
      processorType: procConfig.processor_type,
      customerId: result.customerId,
      paymentMethodId: result.paymentMethodId,
      cardLastFour: result.cardLastFour,
      cardBrand: result.cardBrand,
      cardExpMonth: result.cardExpMonth,
      cardExpYear: result.cardExpYear,
      makeDefault: true,
    });

    res.json({
      success: true,
      paymentMethodId: result.paymentMethodId,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Save card failed');
    res.status(500).json({ success: false, error: 'Failed to save card' });
  }
}
