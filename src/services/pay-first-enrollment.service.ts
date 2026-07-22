import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { offerRepository } from '../repositories/offer.repository';
import { paymentEventRepository } from '../repositories/paymentEvent.repository';
import { phase2EvidenceRepository } from '../repositories/phase2Evidence.repository';
import { offerService } from './offer.service';
import { merchantService } from './merchant.service';
import { triggerService } from './trigger.service';
import { resolveProcessor, createProcessorClient } from './processor.factory';
import { saveOrReusePaymentMethod } from './payment-methods.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { config } from '../config';
import { createPublicActionToken } from '../utils/public-action-token';
import type { ProcessorType } from '../types/processor.types';
import { dualPricingService } from './dual-pricing.service';
import { checkoutCartService } from './checkout-cart.service';
import { whopService } from './whop.service';
import { moneyOperationService } from './money-operation.service';
import { assertNewProcessorActivityAllowed } from './marketplace-entitlement.service';
import { deliverEnrollmentLink, type EnrollmentLinkDeliveryResult } from './enrollment-link-delivery.service';
import { formatMoney, getSelectedPlanReceiptPrice } from '../utils/offer-display';
import {
  SS_CONTACT_FIELDS,
  OFFER_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import { resolveWorkflowRefundPolicy, resolveWorkflowTermsUrl } from '../utils/workflow-offer-fields';

interface RecordPayFirstInput {
  locationId: string;
  offerId: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  amount: number;
  paymentType?: string;
  paymentSource: string;
  paymentMethod?: string;
  externalReference?: string;
  notes?: string;
  sendVia?: string[];
  recordedBy?: string;
}

interface ChargeManualSaleInput {
  locationId: string;
  offerId?: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  amount: number;
  paymentToken: string;
  paymentAttemptId: string;
  paymentType?: string;
  paymentMethod?: 'card' | 'ach';
  achSecCode?: 'WEB' | 'PPD' | 'CCD' | 'TEL';
  achAccountHolderType?: 'personal' | 'business';
  achAccountType?: 'checking' | 'savings';
  sendEnrollment?: boolean;
  sendVia?: string[];
  recordedBy?: string;
}

interface WhopManualSaleSessionInput {
  locationId: string;
  offerId: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  amount: number;
  paymentType?: string;
  sendEnrollment?: boolean;
  sendVia?: string[];
  recordedBy?: string;
}

interface FinalizeWhopManualSaleInput {
  locationId: string;
  enrollmentId: string;
  transactionId: string;
  amount: number;
  paymentType: string;
  sendEnrollment: boolean;
}

interface ManualSaleIssue {
  code: string;
  message: string;
  step: string;
}

function normalizePaymentType(input: unknown, offer: any): string {
  const raw = String(input || offer.payment_type || '').toLowerCase();
  if (raw === 'installments') return 'installment';
  if (raw === 'one_time' || raw === 'one-time' || raw === 'pif') return 'pif';
  if (raw === 'subscription') return 'subscription';
  return raw || 'pif';
}

function paymentsTotalFor(paymentType: string, offer: any): number | null {
  if (paymentType === 'subscription') return null;
  if (paymentType === 'installment') return Number(offer.num_payments || 1);
  return 1;
}

function splitName(firstName: string | undefined, lastName: string | undefined, email: string): { firstName: string; lastName: string } {
  if (firstName) return { firstName, lastName: lastName || '' };
  const local = email.split('@')[0] || 'Client';
  return { firstName: local, lastName: lastName || '' };
}

function computeNextBillingDate(installmentFrequency: string | null | undefined, from: Date = new Date()): string {
  const next = new Date(from);
  switch (installmentFrequency) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'bi_weekly':
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'annual': next.setFullYear(next.getFullYear() + 1); break;
    default: next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString().split('T')[0];
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

function dollarsToCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

function isRecurringPaymentType(paymentType: string): boolean {
  return ['installment', 'installments', 'subscription'].includes(String(paymentType || '').toLowerCase());
}

function errorMessage(err: any): string {
  return err?.message || err?.details || err?.hint || String(err || 'Unknown error');
}

function formatDate(value: Date = new Date()): string {
  return value.toISOString().split('T')[0];
}

function formatPaymentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === 'pif') return 'Paid in full';
  if (raw === 'installment' || raw === 'installments') return 'Installment';
  if (raw === 'subscription') return 'Subscription';
  if (raw === 'free') return 'Free';
  return raw.replace(/_/g, ' ');
}

function formatFrequency(value: unknown): string {
  const raw = String(value || '').trim();
  const labels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    bi_weekly: 'Bi-weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annual: 'Annual',
  };
  return labels[raw] || raw.replace(/_/g, ' ');
}

function merchantSupportEmail(merchant: any): string {
  return merchant?.support_email || merchant?.email || '';
}

function merchantBusinessName(merchant: any): string {
  return merchant?.dba_name || merchant?.business_name || '';
}

function paymentAttemptKey(parts: Array<string | number | null | undefined>): string {
  return crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part ?? '').trim().toLowerCase()).join('|'))
    .digest('hex');
}

function isUnknownStripeSubscriptionResult(err: any): boolean {
  return err?.processor === 'stripe' && err?.code === 'STRIPE_SUBSCRIPTION_RESULT_UNKNOWN';
}

async function fireManualSaleTrigger(
  locationId: string,
  triggerKey: Parameters<typeof triggerService.fireTrigger>[1],
  payload: Record<string, unknown>,
): Promise<{ sent: number; failed: number; error?: string }> {
  try {
    return await triggerService.fireTrigger(locationId, triggerKey, payload);
  } catch (err: any) {
    const error = err?.message || String(err);
    logger.error(
      { err: error, locationId, triggerKey },
      'Quick Manual Sale trigger failed after payment was recorded',
    );
    return { sent: 0, failed: 1, error };
  }
}

interface PaidEnrollmentUrlContext {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  paymentType?: string;
}

async function buildEnrollmentUrl(
  locationId: string,
  offerId: string,
  paidEnrollmentToken?: string,
  context?: PaidEnrollmentUrlContext,
): Promise<string> {
  let funnelBaseUrl = '';
  try {
    const mc = await merchantService.getFullConfig(locationId);
    funnelBaseUrl = mc.enrollmentFunnelUrl || '';
  } catch (err: any) {
    logger.warn(
      { err: errorMessage(err), locationId, offerId },
      'Failed to load merchant funnel URL for paid enrollment link',
    );
  }
  const link = offerService.generateEnrollmentLink(offerId, config.appUrl, 'full_enrollment', funnelBaseUrl);
  if (!paidEnrollmentToken) return link;
  const url = new URL(link);
  url.searchParams.set('paidEnrollmentToken', paidEnrollmentToken);
  url.searchParams.set('paidEnrollment', '1');
  if (context?.firstName) url.searchParams.set('firstName', context.firstName);
  if (context?.lastName) url.searchParams.set('lastName', context.lastName);
  if (context?.email) url.searchParams.set('email', context.email);
  if (context?.phone) url.searchParams.set('phone', context.phone);
  if (context?.paymentType) url.searchParams.set('paymentType', context.paymentType);
  return url.toString();
}

async function upsertContact(
  locationId: string,
  input: Pick<RecordPayFirstInput, 'contactId' | 'firstName' | 'lastName' | 'email' | 'phone'>,
): Promise<string> {
  if (input.contactId) return input.contactId;
  const api = await ghlApi(locationId);
  const name = splitName(input.firstName, input.lastName, input.email);
  const upsertRes = await api.post('/contacts/upsert', {
    firstName: name.firstName,
    lastName: name.lastName,
    email: input.email,
    phone: input.phone || undefined,
    locationId,
  });
  const contactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
  if (!contactId) throw new Error('GHL upsert returned no contact ID');
  return contactId;
}

export const payFirstEnrollmentService = {
  async getManualSaleConfig(locationId: string, offerId?: string) {
    const merchant = await merchantRepository.getByLocationId(locationId);
    let offer: any = null;
    if (offerId) {
      offer = await offerRepository.findById(offerId, locationId);
      if (!offer || !offer.active) throw new ValidationError('Offer not found or inactive');
      if ((offer.checkout_type || 'direct') === 'whop') {
        await assertNewProcessorActivityAllowed(locationId, 'whop');
        return {
          processorType: 'whop',
          merchantName: merchant.business_name || '',
          hostedCheckout: true,
        };
      }
    }

    const offerHint = offer
      ? { processor_override: offer.processor_override || null, nmi_processor_id: offer.nmi_processor_id || null }
      : undefined;
    const { config: procConfig } = await resolveProcessor(merchant.id, locationId, offerHint);
    await assertNewProcessorActivityAllowed(locationId, procConfig.processor_type);
    const response: Record<string, unknown> = {
      processorType: procConfig.processor_type,
      merchantName: merchant.business_name || '',
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
    } else if (procConfig.processor_type === 'stripe') {
      response.stripePublishableKey = config.stripe.publishableKey || procConfig.stripe_publishable_key || '';
      response.stripeAccountId = procConfig.stripe_user_id || '';
    }

    return response;
  },

  async createWhopManualSaleSession(input: WhopManualSaleSessionInput) {
    if (!input.locationId || !input.offerId || !input.email || !input.amount) {
      throw new ValidationError('locationId, offerId, email, and amount required');
    }

    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const offer = await offerRepository.findById(input.offerId, input.locationId);
    if (!offer || !offer.active) throw new ValidationError('Offer not found or inactive');
    if ((offer.checkout_type || 'direct') !== 'whop') {
      throw new ValidationError('Selected offer is not configured for Whop checkout');
    }
    await assertNewProcessorActivityAllowed(input.locationId, 'whop');

    const contactId = await upsertContact(input.locationId, input);
    const name = splitName(input.firstName, input.lastName, input.email);
    const contactName = [name.firstName, name.lastName].filter(Boolean).join(' ');
    const paymentType = normalizePaymentType(input.paymentType, offer);
    const paymentsTotal = paymentsTotalFor(paymentType, offer);
    const quote = await checkoutCartService.quoteOffer(offer, [], paymentType, 'card');
    if (quote.selectedAmountCents > 0 && quote.selectedAmountCents !== dollarsToCents(input.amount)) {
      throw new ValidationError('Payment amount does not match selected Whop offer');
    }

    const { data: pendingEnrollment, error: enrollmentError } = await getSupabase()
      .from('enrollments')
      .insert({
        location_id: input.locationId,
        merchant_id: merchant.id,
        contact_id: contactId,
        offer_id: offer.id,
        email: input.email,
        first_name: name.firstName || null,
        last_name: name.lastName || null,
        status: 'payment_processing',
        payment_amount: quote.selectedAmount,
        payment_type: paymentType,
        checkout_type: 'whop',
        processor_type: 'whop',
        initial_payment_status: 'processing',
        payments_made: 0,
        payments_total: paymentsTotal,
        billing_setup_status: isRecurringPaymentType(paymentType) ? 'pending' : 'ok',
        selected_checkout_items: quote.lineItems || [],
        enrolled_at: null,
      } as any)
      .select('id')
      .single();
    if (enrollmentError) throw enrollmentError;

    let session: Awaited<ReturnType<typeof whopService.createCheckoutSession>>;
    try {
      session = await whopService.createCheckoutSession({
        locationId: input.locationId,
        offer,
        enrollmentId: pendingEnrollment.id,
        contactId,
        contactEmail: input.email,
        contactName,
        contactPhone: input.phone || '',
        checkoutMode: 'quick_manual_sale',
        sendEnrollment: input.sendEnrollment !== false,
        quote,
      });
    } catch (err: any) {
      await getSupabase()
        .from('enrollments')
        .update({
          initial_payment_status: 'failed',
          billing_setup_status: 'failed',
          billing_setup_error: err?.message || 'Whop checkout session creation failed',
        })
        .eq('id', pendingEnrollment.id)
        .eq('location_id', input.locationId);
      throw err;
    }

    const { error: sessionSaveError } = await getSupabase()
      .from('enrollments')
      .update({
        whop_checkout_session_id: session.sessionId,
        whop_checkout_url: session.checkoutUrl || null,
      })
      .eq('id', pendingEnrollment.id)
      .eq('location_id', input.locationId);
    if (sessionSaveError) throw sessionSaveError;

    logger.info({
      locationId: input.locationId,
      offerId: input.offerId,
      contactId,
      enrollmentId: pendingEnrollment.id,
      sessionId: session.sessionId,
      recordedBy: input.recordedBy || 'merchant',
    }, 'Quick Manual Sale Whop checkout session created');

    return {
      success: true,
      processorType: 'whop',
      hostedCheckout: true,
      contactId,
      enrollmentId: pendingEnrollment.id,
      offerId: offer.id,
      amount: quote.selectedAmount,
      paymentType,
      ...session,
      message: session.checkoutUrl
        ? 'Whop checkout link created. Complete payment in the Whop checkout window.'
        : 'Whop checkout session created.',
    };
  },

  async getWhopManualSaleStatus(locationId: string, enrollmentId: string) {
    if (!locationId || !enrollmentId) {
      throw new ValidationError('locationId and enrollmentId required');
    }

    const { data: enrollment, error } = await getSupabase()
      .from('enrollments')
      .select([
        'id',
        'contact_id',
        'offer_id',
        'status',
        'initial_payment_status',
        'billing_setup_status',
        'billing_setup_error',
        'payment_transaction_id',
        'whop_checkout_session_id',
      ].join(','))
      .eq('id', enrollmentId)
      .eq('location_id', locationId)
      .eq('checkout_type', 'whop')
      .maybeSingle();
    if (error) throw error;
    if (!enrollment) throw new ValidationError('Whop manual-sale enrollment not found');

    const row = enrollment as any;
    const paymentStatus = String(row.initial_payment_status || 'processing');
    const enrollmentStatus = String(row.status || 'payment_processing');
    const confirmed = paymentStatus === 'succeeded'
      && ['paid_pending_enrollment', 'enrolled'].includes(enrollmentStatus);
    const failed = paymentStatus === 'failed';

    return {
      success: true,
      confirmed,
      failed,
      enrollmentId: row.id,
      contactId: row.contact_id,
      offerId: row.offer_id,
      enrollmentStatus,
      paymentStatus,
      billingSetupStatus: row.billing_setup_status || null,
      error: failed ? (row.billing_setup_error || 'Whop payment was not completed.') : null,
      transactionId: confirmed ? (row.payment_transaction_id || null) : null,
      checkoutSessionId: row.whop_checkout_session_id || null,
    };
  },

  async finalizeWhopManualSale(input: FinalizeWhopManualSaleInput) {
    const { data: enrollment, error: enrollmentError } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('id', input.enrollmentId)
      .eq('location_id', input.locationId)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!enrollment) throw new ValidationError('Whop manual-sale enrollment not found');

    const offer = enrollment.offer_id
      ? await offerRepository.findById(enrollment.offer_id, input.locationId)
      : null;
    if (!offer) throw new ValidationError('Whop manual-sale offer not found');

    if (enrollment.status === 'paid_pending_enrollment' && enrollment.initial_payment_status === 'succeeded') {
      return { success: true, alreadyFinalized: true, enrollmentId: enrollment.id };
    }

    const recordedAt = new Date().toISOString();
    const existingEvidence = await phase2EvidenceRepository.findByType(enrollment.id, 'enrollment_payment');
    const hasTransactionEvidence = existingEvidence.some((record: any) => (
      String(record?.data?.transaction_id || '') === input.transactionId
    ));
    if (!hasTransactionEvidence) {
      await phase2EvidenceRepository.create({
        location_id: input.locationId,
        contact_id: enrollment.contact_id,
        enrollment_id: enrollment.id,
        merchant_id: enrollment.merchant_id,
        evidence_type: 'enrollment_payment',
        data: {
          amount: input.amount,
          payment_type: input.paymentType,
          transaction_id: input.transactionId,
          source: 'quick_manual_sale',
          processor: 'whop',
          timestamp: recordedAt,
        },
      });
    }

    const { error: statusError } = await getSupabase()
      .from('enrollments')
      .update({
        status: 'paid_pending_enrollment',
        payment_amount: input.amount,
        payment_type: input.paymentType,
        payment_transaction_id: input.transactionId,
        initial_payment_status: 'succeeded',
        payments_made: 1,
        billing_setup_status: 'ok',
        billing_setup_error: null,
        enrolled_at: null,
      })
      .eq('id', enrollment.id)
      .eq('location_id', input.locationId);
    if (statusError) throw statusError;

    let enrollmentUrl = '';
    let enrollmentLinkDelivery: EnrollmentLinkDeliveryResult | undefined;
    if (input.sendEnrollment) {
      const paidToken = createPublicActionToken({
        action: 'paid_enrollment',
        locationId: input.locationId,
        contactId: enrollment.contact_id,
        enrollmentId: enrollment.id,
        ttlSeconds: 30 * 24 * 60 * 60,
      });
      enrollmentUrl = await buildEnrollmentUrl(input.locationId, enrollment.offer_id, paidToken, {
        firstName: enrollment.first_name || '',
        lastName: enrollment.last_name || '',
        email: enrollment.email || '',
        paymentType: input.paymentType,
      });
      enrollmentLinkDelivery = await deliverEnrollmentLink({
        locationId: input.locationId,
        contactId: enrollment.contact_id,
        enrollmentId: enrollment.id,
        offerId: enrollment.offer_id,
        offerName: offer.offer_name,
        enrollmentUrl,
        paymentStatus: 'paid_pending_enrollment',
        paymentSource: 'quick_manual_sale',
        paymentTiming: 'before_enrollment',
        enrollmentStatus: 'paid_pending_enrollment',
        sendWelcome: false,
        amount: input.amount,
        sendVia: ['email'],
        firstName: enrollment.first_name || '',
        lastName: enrollment.last_name || '',
        email: enrollment.email || '',
        sendDirectMessage: true,
      });
    }

    await fireManualSaleTrigger(input.locationId, 'ss_payment_received', {
      event_type: 'payment_received',
      contact_id: enrollment.contact_id,
      enrollment_id: enrollment.id,
      offer_id: enrollment.offer_id,
      offer_name: offer.offer_name,
      program_name: offer.offer_name,
      amount: input.amount,
      amount_display: `$${Number(input.amount).toFixed(2)}`,
      transaction_id: input.transactionId,
      payment_kind: input.paymentType,
      payment_source: 'quick_manual_sale',
      payment_timing: 'before_enrollment',
      enrollment_status: 'paid_pending_enrollment',
      receipt_only: true,
      send_receipt: true,
      send_welcome: false,
    });

    return {
      success: true,
      enrollmentId: enrollment.id,
      enrollmentUrl,
      enrollmentLinkDelivery,
      status: 'paid_pending_enrollment',
    };
  },

  async chargeCardAndCreatePaidEnrollment(input: ChargeManualSaleInput) {
    if (!input.locationId || !input.email || !input.amount || !input.paymentToken || !input.paymentAttemptId) {
      throw new ValidationError('locationId, email, amount, paymentToken, and paymentAttemptId required');
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(input.paymentAttemptId))) {
      throw new ValidationError('paymentAttemptId is invalid');
    }

    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const offer = input.offerId ? await offerRepository.findById(input.offerId, input.locationId) : null;
    if (input.offerId && (!offer || !offer.active)) throw new ValidationError('Offer not found or inactive');
    if (offer && (offer.checkout_type || 'direct') === 'whop') {
      throw new ValidationError('Whop offers cannot be charged from Quick Manual Sale. Use the Whop checkout link for this offer.');
    }

    const contactId = await upsertContact(input.locationId, input);
    const name = splitName(input.firstName, input.lastName, input.email);
    const customerName = [name.firstName, name.lastName].filter(Boolean).join(' ');
    const offerHint = offer
      ? { processor_override: (offer.processor_override || null) as ProcessorType | null, nmi_processor_id: offer.nmi_processor_id || null }
      : undefined;
    const { config: procConfig } = await resolveProcessor(merchant.id, input.locationId, offerHint);
    await assertNewProcessorActivityAllowed(input.locationId, procConfig.processor_type);
    const processor = createProcessorClient(procConfig);
    let dualQuote: Awaited<ReturnType<typeof dualPricingService.quoteOffer>> | null = null;
    if (offer) {
      dualQuote = await dualPricingService.quoteOffer(
        offer,
        input.paymentType,
        input.paymentMethod === 'ach' ? 'ach' : 'card',
      );
      if (dualQuote.selectedAmountCents > 0 && dualQuote.selectedAmountCents !== dollarsToCents(input.amount)) {
        throw new ValidationError('Payment amount does not match selected offer');
      }
    }
    const amountCents = dollarsToCents(input.amount);
    if (amountCents <= 0) throw new ValidationError('Amount must be greater than zero');

    const paymentType = offer ? normalizePaymentType(input.paymentType, offer) : 'manual_sale';
    const paymentsTotal = offer ? paymentsTotalFor(paymentType, offer) : null;
    const finiteBillingComplete = offer && paymentType !== 'subscription'
      && paymentsTotal != null
      && Number(paymentsTotal) <= 1;
    const recurringManualSale = Boolean(offer && isRecurringPaymentType(paymentType) && !finiteBillingComplete);
    const nextBillingDate = recurringManualSale ? computeNextBillingDate(offer?.installment_frequency) : null;
    const recordedAt = new Date().toISOString();
    const paymentMethod = input.paymentMethod === 'ach' ? 'ach' : 'card';
    if (paymentMethod === 'ach' && procConfig.processor_type !== 'nmi') {
      throw new ValidationError('Stripe bank transfer uses the secure bank-account manual-sale flow.');
    }
    const attemptKey = paymentAttemptKey([
      input.locationId,
      input.paymentAttemptId,
    ]);
    const moneyOperation = await moneyOperationService.begin({
      locationId: input.locationId,
      merchantId: merchant.id,
      operationType: 'manual_sale_charge',
      operationKey: attemptKey,
      request: {
        offerId: input.offerId || null,
        contactId,
        email: input.email,
        amountCents,
        paymentMethod,
        paymentType,
        paymentAttemptId: input.paymentAttemptId,
      },
    });
    if (moneyOperation.action === 'replay') {
      return moneyOperation.response as any;
    }
    if (moneyOperation.action === 'blocked') {
      throw new ValidationError(
        moneyOperation.operation.status === 'provider_accepted' || moneyOperation.operation.status === 'unknown'
          ? 'Payment was submitted and is awaiting reconciliation. Do not submit it again.'
          : 'Payment is already processing. Please wait.',
      );
    }
    let charge;
    try {
      await moneyOperationService.markProviderStarted({
        id: moneyOperation.operation.id,
        locationId: input.locationId,
        processorType: procConfig.processor_type,
      });
      charge = await processor.charge({
        amount: amountCents,
        currency: 'usd',
        paymentToken: input.paymentToken,
        paymentMethodType: paymentMethod,
        achSecCode: input.achSecCode === 'TEL' || input.achSecCode === 'PPD' || input.achSecCode === 'CCD'
          ? input.achSecCode
          : 'WEB',
        achAccountHolderType: input.achAccountHolderType === 'business' ? 'business' : 'personal',
        achAccountType: input.achAccountType === 'savings' ? 'savings' : 'checking',
        description: offer?.offer_name || 'Quick Manual Sale',
        metadata: {
          source: 'quick_manual_sale',
          scalesafe_offer_id: input.offerId || '',
          customer_email: input.email,
          contact_id: contactId,
          location_id: input.locationId,
        },
        shouldVault: true,
        customerEmail: input.email,
        customerName,
        idempotencyKey: `manual-sale-${attemptKey}`,
      });
    } catch (chargeErr: any) {
      await moneyOperationService.markUnknown({
        id: moneyOperation.operation.id,
        locationId: input.locationId,
        processorType: procConfig.processor_type,
        error: chargeErr.message || 'Processor result is unknown',
      });
      throw chargeErr;
    }

    if (!charge.success) {
      const failedResponse = {
        success: false,
        error: charge.errorMessage || 'Card charge failed',
        paymentAttemptStatus: charge.status === 'declined' ? 'declined' : 'failed',
      };
      await moneyOperationService.markRecorded({
        id: moneyOperation.operation.id,
        locationId: input.locationId,
        response: failedResponse,
        processorType: procConfig.processor_type,
        processorReference: charge.transactionId || charge.chargeId || null,
        providerCalled: true,
      });
      throw new ValidationError(charge.errorMessage || 'Card charge failed');
    }
    await moneyOperationService.markProviderAccepted({
      id: moneyOperation.operation.id,
      locationId: input.locationId,
      processorType: procConfig.processor_type,
      processorReference: charge.transactionId || charge.chargeId || null,
      response: {
        success: true,
        transactionId: charge.transactionId || charge.chargeId || null,
        paymentStatus: charge.status === 'processing' ? 'processing' : 'succeeded',
      },
      reconciliationPayload: {
        transactionId: charge.transactionId || charge.chargeId || null,
        chargeId: charge.chargeId || charge.transactionId || null,
        status: charge.status,
        vaultedCustomerId: charge.vaultedCustomerId || null,
        vaultedCardLastFour: charge.vaultedCardLastFour || null,
        vaultedCardBrand: charge.vaultedCardBrand || null,
        vaultedCardExpMonth: charge.vaultedCardExpMonth || null,
        vaultedCardExpYear: charge.vaultedCardExpYear || null,
      },
    });
    const paymentProcessing = charge.status === 'processing';
    const transactionId = charge.transactionId || charge.chargeId || '';
    const postChargeIssues: ManualSaleIssue[] = [];
    const logContext: Record<string, unknown> = {
      locationId: input.locationId,
      contactId,
      offerId: input.offerId || null,
      processor: procConfig.processor_type,
      transactionId,
    };

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
    } = {
      success: Boolean(charge.vaultedCustomerId),
      paymentMethodId: procConfig.processor_type === 'stripe' ? input.paymentToken : (charge.vaultedCustomerId || ''),
      customerId: charge.vaultedCustomerId || '',
      cardLastFour: charge.vaultedCardLastFour || (paymentMethod === 'ach' ? '' : '****'),
      cardBrand: charge.vaultedCardBrand || (paymentMethod === 'ach' ? 'bank' : 'unknown'),
      cardExpMonth: charge.vaultedCardExpMonth || 0,
      cardExpYear: charge.vaultedCardExpYear || 0,
      paymentMethodKind: paymentMethod,
      bankLastFour: charge.vaultedBankLastFour,
      bankAccountType: charge.vaultedBankAccountType,
      bankHolderType: charge.vaultedBankHolderType,
    };

    try {
      if (!charge.vaultedCustomerId) {
        saveResult = await processor.saveCard({
          paymentToken: input.paymentToken,
          paymentMethodType: paymentMethod,
          achSecCode: input.achSecCode === 'TEL' || input.achSecCode === 'PPD' || input.achSecCode === 'CCD'
            ? input.achSecCode
            : 'WEB',
          achAccountHolderType: input.achAccountHolderType === 'business' ? 'business' : 'personal',
          achAccountType: input.achAccountType === 'savings' ? 'savings' : 'checking',
          contactId,
          customerEmail: input.email,
          customerName,
        });
      }

      if (!saveResult.customerId || !saveResult.paymentMethodId) {
        throw new Error('Processor approved the charge but did not return a saved payment method reference.');
      }

      await saveOrReusePaymentMethod({
        merchantId: merchant.id,
        locationId: input.locationId,
        contactId,
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
    } catch (err: any) {
      const issue = {
        code: 'payment_method_recording_failed',
        message: `Payment was received, but ScaleSafe could not save the payment method: ${errorMessage(err)}`,
        step: 'save_payment_method',
      };
      postChargeIssues.push(issue);
      logger.error({ ...logContext, err: errorMessage(err), step: issue.step }, 'Quick Manual Sale post-charge step failed');
    }

    let enrollmentId: string | null = null;
    let enrollmentUrl = '';
    let processorSubscriptionId = '';
    let billingSetupIssue: { code: string; message: string } | null = null;
    let enrollmentLinkIssue: ManualSaleIssue | null = null;
    let enrollmentLinkDelivery: EnrollmentLinkDeliveryResult | undefined;
    const releaseAchOnSubmission = paymentProcessing
      && paymentMethod === 'ach'
      && offer?.ach_access_policy === 'after_submission';
    if (offer) {
      try {
        const { data: enrollment, error: enrollmentError } = await getSupabase()
          .from('enrollments')
          .insert({
            location_id: input.locationId,
            merchant_id: merchant.id,
            contact_id: contactId,
            offer_id: input.offerId,
            email: input.email,
            first_name: name.firstName || null,
            last_name: name.lastName || null,
            status: paymentProcessing ? 'payment_processing' : 'paid_pending_enrollment',
            payment_amount: input.amount,
            payment_type: paymentType,
            payment_transaction_id: transactionId,
            processor_type: procConfig.processor_type,
            initial_payment_status: paymentProcessing ? 'processing' : 'succeeded',
            initial_payment_method: paymentMethod,
            payments_made: 1,
            payments_total: paymentsTotal,
            next_billing_date: nextBillingDate,
            billing_setup_status: recurringManualSale ? 'pending' : 'ok',
            next_billing_date_source: recurringManualSale ? 'processor' : null,
            enrolled_at: null,
          } as any)
          .select('id')
          .single();
        if (enrollmentError) throw enrollmentError;
        const createdEnrollmentId = enrollment.id as string;
        enrollmentId = createdEnrollmentId;
        logContext.enrollmentId = enrollmentId;

        const paidToken = createPublicActionToken({
          action: 'paid_enrollment',
          locationId: input.locationId,
          contactId,
          enrollmentId: createdEnrollmentId,
          ttlSeconds: 30 * 24 * 60 * 60,
        });
        enrollmentUrl = await buildEnrollmentUrl(input.locationId, input.offerId!, paidToken, {
          firstName: name.firstName,
          lastName: name.lastName,
          email: input.email,
          phone: input.phone,
          paymentType,
        });

        if (releaseAchOnSubmission) {
          const { error: releaseError } = await getSupabase().from('enrollments').update({
            status: 'paid_pending_enrollment',
            billing_setup_status: recurringManualSale ? 'pending' : 'ok',
          }).eq('id', createdEnrollmentId).eq('location_id', input.locationId);
          if (releaseError) throw releaseError;
        }
      } catch (err: any) {
        const issue = {
          code: 'enrollment_recording_failed',
          message: `Payment was received, but ScaleSafe could not create the paid enrollment: ${errorMessage(err)}`,
          step: 'create_enrollment',
        };
        postChargeIssues.push(issue);
        logger.error({ ...logContext, err: errorMessage(err), step: issue.step }, 'Quick Manual Sale post-charge step failed');
      }

      if (enrollmentId && !paymentProcessing && recurringManualSale) {
        try {
          const recurringQuote = await dualPricingService.quoteOffer(offer, paymentType, paymentMethod);
          const subAmountCents = recurringQuote.selectedAmountCents;
          const remainingPayments = paymentType === 'subscription'
            ? 0
            : Math.max(0, Number(paymentsTotal || 0) - 1);

          if (!saveResult.customerId || !saveResult.paymentMethodId) {
            billingSetupIssue = {
              code: 'processor_payment_method_missing',
              message: 'Payment was received, but recurring billing setup could not start because the saved payment method was not available.',
            };
            await getSupabase().from('enrollments').update({
              billing_setup_status: 'failed',
              billing_setup_error: billingSetupIssue.message,
              next_billing_date: null,
            }).eq('id', enrollmentId).eq('location_id', input.locationId);
          } else if (subAmountCents > 0 && (paymentType === 'subscription' || remainingPayments > 0) && nextBillingDate) {
            const subResult = await processor.createSubscription({
              paymentMethodId: saveResult.paymentMethodId || saveResult.customerId,
              customerId: saveResult.customerId,
              planAmount: subAmountCents,
              interval: processorInterval(offer.installment_frequency),
              totalPayments: remainingPayments,
              startDate: nextBillingDate,
              description: offer.offer_name || 'ScaleSafe Recurring Plan',
              metadata: {
                enrollment_id: enrollmentId,
                offer_id: input.offerId || '',
                contact_id: contactId,
                location_id: input.locationId,
                payment_type: paymentType,
                payment_source: 'quick_manual_sale',
              },
              idempotencyKey: `manual-sale-subscription-${attemptKey}`,
            });

            if (subResult.success && subResult.subscriptionId) {
              processorSubscriptionId = subResult.subscriptionId;
              const { error: subSaveError } = await getSupabase()
                .from('enrollments')
                .update({
                  processor_subscription_id: subResult.subscriptionId,
                  processor_type: procConfig.processor_type,
                  billing_setup_status: 'ok',
                  billing_setup_error: null,
                  next_billing_date_source: 'processor',
                })
                .eq('id', enrollmentId)
                .eq('location_id', input.locationId);
              if (subSaveError) {
                billingSetupIssue = {
                  code: 'processor_subscription_save_failed',
                  message: subSaveError.message || 'The processor subscription was created, but ScaleSafe could not save the subscription ID.',
                };
                await getSupabase().from('enrollments').update({
                  billing_setup_status: 'needs_reconciliation',
                  billing_setup_error: billingSetupIssue.message,
                  next_billing_date: null,
                }).eq('id', enrollmentId).eq('location_id', input.locationId);
              }
            } else {
              billingSetupIssue = {
                code: 'processor_subscription_creation_failed',
                message: subResult.errorMessage || 'Payment was received, but recurring billing setup failed at the processor.',
              };
              await getSupabase().from('enrollments').update({
                billing_setup_status: 'failed',
                billing_setup_error: billingSetupIssue.message,
                next_billing_date: null,
              }).eq('id', enrollmentId).eq('location_id', input.locationId);
            }
          } else {
            billingSetupIssue = {
              code: 'processor_subscription_not_attempted',
              message: 'Payment was received, but recurring billing setup could not start because the recurring amount or next billing date was missing.',
            };
            await getSupabase().from('enrollments').update({
              billing_setup_status: 'failed',
              billing_setup_error: billingSetupIssue.message,
              next_billing_date: null,
            }).eq('id', enrollmentId).eq('location_id', input.locationId);
          }
        } catch (err: any) {
          const resultUnknown = isUnknownStripeSubscriptionResult(err);
          billingSetupIssue = {
            code: resultUnknown
              ? 'processor_subscription_result_unknown'
              : 'processor_subscription_creation_error',
            message: err?.message || 'Payment was received, but recurring billing setup failed.',
          };
          await getSupabase().from('enrollments').update({
            billing_setup_status: resultUnknown ? 'needs_reconciliation' : 'failed',
            billing_setup_error: billingSetupIssue.message,
            next_billing_date: null,
          }).eq('id', enrollmentId).eq('location_id', input.locationId);
          logger.error({ ...logContext, err: err?.message || String(err), enrollmentId }, 'Quick Manual Sale recurring setup failed');
        }
      }
    }

    try {
      await paymentEventRepository.createOrReuseByTransaction({
        merchant_id: merchant.id,
        location_id: input.locationId,
        contact_id: contactId,
        enrollment_id: enrollmentId || undefined,
        offer_id: input.offerId || null,
        event_type: 'sale',
        processor: procConfig.processor_type,
        processor_transaction_id: transactionId,
        processor_subscription_id: processorSubscriptionId || null,
        amount: input.amount,
        payment_number: 1,
        payments_total: paymentsTotal,
        payments_remaining: paymentsTotal == null ? undefined : Math.max(0, paymentsTotal - 1),
        source: 'quick_manual_sale',
        is_recurring: false,
        payment_status: paymentProcessing ? 'processing' : 'succeeded',
        payment_method_type: paymentMethod,
        selected_payment_method: paymentMethod,
        card_uplift_percent: dualQuote?.dualPricingEnabled && paymentMethod === 'card' ? dualQuote.cardUpliftPercent : 0,
        processor_deduction_percent: dualQuote?.dualPricingEnabled && paymentMethod === 'card' ? dualQuote.processorDeductionPercent : 0,
        line_items: offer && dualQuote && dualQuote.achAmountCents > 0
          ? [{
            type: 'base_offer',
            label: offer.offer_name || 'Program enrollment',
            amountCents: dualQuote.achAmountCents,
            amount: dualQuote.achAmountCents / 100,
          }]
          : undefined,
        raw_webhook_payload: {
          source: 'quick_manual_sale',
          processor: procConfig.processor_type,
          recordedAt,
          offerId: input.offerId || null,
          enrollmentId,
          sendEnrollment: input.sendEnrollment !== false,
          first_name: name.firstName || '',
          last_name: name.lastName || '',
        },
      });
    } catch (err: any) {
      const issue = {
        code: 'payment_event_recording_failed',
        message: `Payment was received, but ScaleSafe could not record the payment event: ${errorMessage(err)}`,
        step: 'record_payment_event',
      };
      postChargeIssues.push(issue);
      logger.error({ ...logContext, err: errorMessage(err), step: issue.step }, 'Quick Manual Sale post-charge step failed');
    }

    try {
      await phase2EvidenceRepository.create({
        location_id: input.locationId,
        contact_id: contactId,
        enrollment_id: enrollmentId || undefined,
        merchant_id: merchant.id,
        evidence_type: 'enrollment_payment',
        data: {
          amount: input.amount,
          payment_type: paymentType,
          transaction_id: transactionId,
          source: 'quick_manual_sale',
          processor: procConfig.processor_type,
          card_brand: saveResult.cardBrand,
          card_last_four: saveResult.cardLastFour,
          timestamp: recordedAt,
        },
      });
    } catch (err: any) {
      const issue = {
        code: 'evidence_recording_failed',
        message: `Payment was received, but ScaleSafe could not record evidence: ${errorMessage(err)}`,
        step: 'record_evidence',
      };
      postChargeIssues.push(issue);
      logger.error({ ...logContext, err: errorMessage(err), step: issue.step }, 'Quick Manual Sale post-charge step failed');
    }

    const enrollmentLinkRequested = Boolean(offer && input.sendEnrollment !== false);
    const enrollmentLinkEligible = !paymentProcessing || releaseAchOnSubmission;
    if (enrollmentLinkRequested && enrollmentLinkEligible && offer && enrollmentId && enrollmentUrl) {
      const enrollmentTriggerResult = await deliverEnrollmentLink({
        locationId: input.locationId,
        contactId,
        enrollmentId,
        offerId: input.offerId!,
        offerName: offer.offer_name,
        enrollmentUrl,
        paymentStatus: 'paid_pending_enrollment',
        paymentSource: 'quick_manual_sale',
        paymentTiming: 'before_enrollment',
        enrollmentStatus: 'paid_pending_enrollment',
        sendWelcome: false,
        amount: input.amount,
        sendVia: input.sendVia || ['email'],
        firstName: name.firstName || '',
        lastName: name.lastName || '',
        email: input.email,
        phone: input.phone || '',
        sendDirectMessage: true,
        extraPayload: {
          ach_payment_status: paymentProcessing ? 'processing' : 'settled',
          achPaymentStatus: paymentProcessing ? 'processing' : 'settled',
        },
      });
      enrollmentLinkDelivery = enrollmentTriggerResult;
      if (enrollmentTriggerResult.sent < 1) {
        enrollmentLinkIssue = {
          code: enrollmentTriggerResult.failed > 0 || enrollmentTriggerResult.triggerError
            ? 'enrollment_link_trigger_failed'
            : 'enrollment_link_trigger_missing',
          message: enrollmentTriggerResult.triggerError
            ? `Payment was received, but the enrollment link workflow failed: ${enrollmentTriggerResult.triggerError}`
            : 'Payment was received, but no active Send Enrollment Link workflow subscription accepted the trigger.',
          step: 'send_enrollment_link',
        };
        postChargeIssues.push(enrollmentLinkIssue);
        logger.error(
          { ...logContext, triggerResult: enrollmentTriggerResult, step: enrollmentLinkIssue.step },
          'Quick Manual Sale enrollment link trigger did not send',
        );
      }
      if (!enrollmentTriggerResult.contactFieldSynced || enrollmentTriggerResult.directMessageErrors?.length) {
        const detail = [
          enrollmentTriggerResult.contactFieldError ? `contact fields: ${enrollmentTriggerResult.contactFieldError}` : '',
          ...(enrollmentTriggerResult.directMessageErrors || []),
        ].filter(Boolean).join('; ');
        const issue = {
          code: 'enrollment_link_delivery_warning',
          message: `Payment was received and the enrollment link trigger fired, but direct enrollment-link delivery had a warning: ${detail}`,
          step: 'send_enrollment_link',
        };
        postChargeIssues.push(issue);
        logger.warn(
          { ...logContext, delivery: enrollmentTriggerResult, step: issue.step },
          'Quick Manual Sale enrollment link delivery completed with warnings',
        );
      }
    } else if (enrollmentLinkRequested && enrollmentLinkEligible) {
      enrollmentLinkIssue = {
        code: 'enrollment_link_not_ready',
        message: 'Payment was received, but ScaleSafe could not send the enrollment link because the paid enrollment link was not created.',
        step: 'send_enrollment_link',
      };
      postChargeIssues.push(enrollmentLinkIssue);
      logger.error(
        {
          ...logContext,
          hasOffer: Boolean(offer),
          hasEnrollmentId: Boolean(enrollmentId),
          hasEnrollmentUrl: Boolean(enrollmentUrl),
          sendEnrollment: input.sendEnrollment !== false,
          paymentProcessing,
          releaseAchOnSubmission,
          step: enrollmentLinkIssue.step,
        },
        'Quick Manual Sale enrollment link skipped after payment',
      );
    }

    if (!paymentProcessing || releaseAchOnSubmission) await fireManualSaleTrigger(input.locationId, 'ss_payment_received', {
      event_type: 'payment_received',
      location_id: input.locationId,
      locationId: input.locationId,
      contact_id: contactId,
      contactId,
      enrollment_id: enrollmentId || '',
      enrollmentId: enrollmentId || '',
      offer_id: input.offerId || '',
      offerId: input.offerId || '',
      program_name: offer?.offer_name || '',
      programName: offer?.offer_name || '',
      offer_name: offer?.offer_name || '',
      offerName: offer?.offer_name || '',
      amount: input.amount,
      amount_display: `$${Number(input.amount).toFixed(2)}`,
      amountDisplay: `$${Number(input.amount).toFixed(2)}`,
      transaction_id: transactionId,
      transactionId,
      payment_kind: offer ? paymentType : 'manual_sale',
      paymentKind: offer ? paymentType : 'manual_sale',
      payment_source: 'quick_manual_sale',
      paymentSource: 'quick_manual_sale',
      payment_timing: offer ? 'before_enrollment' : 'client_level',
      paymentTiming: offer ? 'before_enrollment' : 'client_level',
      enrollment_status: offer && enrollmentId ? 'paid_pending_enrollment' : 'paid_client_payment',
      enrollmentStatus: offer && enrollmentId ? 'paid_pending_enrollment' : 'paid_client_payment',
      receipt_only: true,
      receiptOnly: true,
      send_receipt: true,
      sendReceipt: true,
      send_welcome: false,
      sendWelcome: false,
      ach_payment_status: paymentProcessing ? 'processing' : 'settled',
      achPaymentStatus: paymentProcessing ? 'processing' : 'settled',
    });

    if (postChargeIssues.length > 0) {
      logger.warn({ ...logContext, issues: postChargeIssues }, 'Quick Manual Sale completed with post-charge issues');
    }

    const response = {
      success: true,
      contactId,
      enrollmentId,
      enrollmentUrl,
      status: paymentProcessing && !releaseAchOnSubmission ? 'payment_processing' : (offer && enrollmentId ? 'paid_pending_enrollment' : 'paid_client_payment'),
      paymentStatus: paymentProcessing ? 'processing' : 'succeeded',
      paymentMethod,
      transactionId,
      processorType: procConfig.processor_type,
      subscriptionId: processorSubscriptionId || undefined,
      billingIssue: billingSetupIssue || undefined,
      enrollmentLinkIssue: enrollmentLinkIssue || undefined,
      enrollmentLinkDelivery,
      recordingIssue: postChargeIssues[0] || undefined,
      recordingIssues: postChargeIssues.length ? postChargeIssues : undefined,
      cardLastFour: saveResult.cardLastFour,
      cardBrand: saveResult.cardBrand,
    };
    const criticalRecordingCodes = new Set([
      'payment_method_recording_failed',
      'enrollment_recording_failed',
      'processor_subscription_save_failed',
      'payment_event_recording_failed',
      'evidence_recording_failed',
    ]);
    const criticalBillingCodes = new Set([
      'processor_subscription_save_failed',
      'processor_subscription_result_unknown',
    ]);
    const hasCriticalRecordingIssue = postChargeIssues.some((issue) => criticalRecordingCodes.has(issue.code))
      || Boolean(billingSetupIssue && criticalBillingCodes.has(billingSetupIssue.code));
    if (hasCriticalRecordingIssue) {
      await moneyOperationService.markProviderAccepted({
        id: moneyOperation.operation.id,
        locationId: input.locationId,
        processorType: procConfig.processor_type,
        processorReference: transactionId,
        response,
        reconciliationPayload: {
          transactionId,
          enrollmentId,
          contactId,
          paymentType,
          paymentsTotal,
          paymentProcessing,
          processorSubscriptionId: processorSubscriptionId || null,
          nextBillingDate: nextBillingDate || null,
          clientResponse: response,
        },
      });
    } else {
      await moneyOperationService.markRecorded({
        id: moneyOperation.operation.id,
        locationId: input.locationId,
        response,
        processorType: procConfig.processor_type,
        processorReference: transactionId,
        providerCalled: true,
      });
    }
    return response;
  },

  async createStripeAchManualSaleIntent(input: Omit<ChargeManualSaleInput, 'paymentToken'>) {
    if (!input.locationId || !input.email || !input.amount || !input.paymentAttemptId) {
      throw new ValidationError('locationId, email, amount, and paymentAttemptId required');
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(input.paymentAttemptId))) {
      throw new ValidationError('paymentAttemptId is invalid');
    }

    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const offer = input.offerId ? await offerRepository.findById(input.offerId, input.locationId) : null;
    if (input.offerId && (!offer || !offer.active)) throw new ValidationError('Offer not found or inactive');

    const contactId = await upsertContact(input.locationId, input);
    const name = splitName(input.firstName, input.lastName, input.email);
    const customerName = [name.firstName, name.lastName].filter(Boolean).join(' ');
    const offerHint = offer
      ? { processor_override: (offer.processor_override || null) as ProcessorType | null, nmi_processor_id: offer.nmi_processor_id || null }
      : undefined;
    const { config: procConfig } = await resolveProcessor(merchant.id, input.locationId, offerHint);
    if (procConfig.processor_type !== 'stripe') {
      throw new ValidationError('This sale is not configured for Stripe ACH.');
    }
    await assertNewProcessorActivityAllowed(input.locationId, 'stripe');

    const amountCents = dollarsToCents(input.amount);
    if (amountCents <= 0) throw new ValidationError('Amount must be greater than zero');

    const paymentType = offer ? normalizePaymentType(input.paymentType, offer) : 'one_off';
    const paymentsTotal = offer ? paymentsTotalFor(paymentType, offer) : null;
    if (offer) {
      const quote = await dualPricingService.quoteOffer(
        offer,
        paymentType,
        'ach',
      );
      if (quote.selectedAmountCents > 0 && quote.selectedAmountCents !== amountCents) {
        throw new ValidationError('Payment amount does not match selected offer');
      }
    }

    const attemptKey = paymentAttemptKey([input.locationId, input.paymentAttemptId]);
    const moneyOperation = await moneyOperationService.begin({
      locationId: input.locationId,
      merchantId: merchant.id,
      operationType: 'manual_sale_ach_intent',
      operationKey: attemptKey,
      request: {
        offerId: input.offerId || null,
        contactId,
        email: input.email.trim().toLowerCase(),
        amountCents,
        paymentType,
        paymentAttemptId: input.paymentAttemptId,
      },
    });
    if (moneyOperation.action === 'replay') return moneyOperation.response as any;
    if (moneyOperation.action === 'blocked') {
      throw new ValidationError(
        moneyOperation.operation.status === 'provider_accepted' || moneyOperation.operation.status === 'unknown'
          ? 'Bank payment setup was submitted and is awaiting reconciliation. Do not submit it again.'
          : 'Bank payment setup is already processing. Please wait.',
      );
    }

    let providerCallStarted = false;
    let providerAccepted = false;
    try {

    let enrollmentId: string | null = null;
    if (offer) {
      const { data: enrollment, error: enrollmentError } = await getSupabase()
        .from('enrollments')
        .insert({
          location_id: input.locationId,
          merchant_id: merchant.id,
          contact_id: contactId,
          offer_id: input.offerId,
          email: input.email,
          first_name: name.firstName || null,
          last_name: name.lastName || null,
          status: 'payment_processing',
          payment_amount: input.amount,
          payment_type: paymentType,
          processor_type: 'stripe',
          initial_payment_status: 'processing',
          initial_payment_method: 'ach',
          payments_made: 1,
          payments_total: paymentsTotal,
          billing_setup_status: ['installment', 'subscription'].includes(paymentType) ? 'pending' : 'ok',
          next_billing_date: null,
          enrolled_at: null,
        } as any)
        .select('id')
        .single();
      if (enrollmentError) throw enrollmentError;
      enrollmentId = enrollment.id as string;
    }

    const stripeClient = createProcessorClient(procConfig) as any;
    await moneyOperationService.markProviderStarted({
      id: moneyOperation.operation.id,
      locationId: input.locationId,
      processorType: 'stripe',
    });
    providerCallStarted = true;
    const intent = await stripeClient.createAchPaymentIntent({
      amount: amountCents,
      currency: 'usd',
      customerEmail: input.email,
      customerName,
      description: offer?.offer_name || 'Quick Manual Sale',
      metadata: {
        scalesafe_ach: 'true',
        checkout_mode: 'quick_manual_sale',
        location_id: input.locationId,
        merchant_id: merchant.id,
        offer_id: input.offerId || '',
        scalesafe_offer_id: input.offerId || '',
        enrollment_id: enrollmentId || '',
        contact_id: contactId,
        customer_email: input.email,
        first_name: name.firstName || '',
        last_name: name.lastName || '',
        payment_choice: paymentType,
        payment_method: 'ach',
        send_enrollment: input.sendEnrollment === false ? 'false' : 'true',
      },
      setupFutureUsage: ['installment', 'subscription'].includes(paymentType),
      idempotencyKey: `manual-sale-ach-${attemptKey}`,
    });

    const response = {
      success: true,
      contactId,
      enrollmentId,
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      stripeAccountId: intent.stripeAccountId,
      stripePublishableKey: config.stripe.publishableKey,
    };
    await moneyOperationService.markProviderAccepted({
      id: moneyOperation.operation.id,
      locationId: input.locationId,
      processorType: 'stripe',
      processorReference: intent.paymentIntentId,
      response,
      reconciliationPayload: {
        enrollmentId,
        contactId,
        paymentIntentId: intent.paymentIntentId,
        clientResponse: response,
      },
    });
    providerAccepted = true;

    if (enrollmentId) {
      const { error: enrollmentUpdateError } = await getSupabase().from('enrollments').update({
        payment_transaction_id: intent.paymentIntentId,
      }).eq('id', enrollmentId).eq('location_id', input.locationId);
      if (enrollmentUpdateError) throw enrollmentUpdateError;
    }

    await moneyOperationService.markRecorded({
      id: moneyOperation.operation.id,
      locationId: input.locationId,
      response,
      processorType: 'stripe',
      processorReference: intent.paymentIntentId,
      providerCalled: true,
    });
    return response;
    } catch (err: any) {
      if (!providerAccepted) {
        if (providerCallStarted) {
          await moneyOperationService.markUnknown({
            id: moneyOperation.operation.id,
            locationId: input.locationId,
            processorType: 'stripe',
            error: err.message || 'Stripe ACH intent result is unknown',
          });
        } else {
          await moneyOperationService.markFailedBeforeProvider({
            id: moneyOperation.operation.id,
            locationId: input.locationId,
            error: err.message || 'Stripe ACH setup failed before processor call',
          });
        }
      }
      throw err;
    }
  },

  async recordPaymentAndSendEnrollment(input: RecordPayFirstInput) {
    if (!input.locationId || !input.offerId || !input.email || !input.amount) {
      throw new ValidationError('locationId, offerId, email, and amount required');
    }

    const offer = await offerRepository.findById(input.offerId, input.locationId);
    if (!offer || !offer.active) throw new ValidationError('Offer not found or inactive');
    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const contactId = await upsertContact(input.locationId, input);
    const paymentType = normalizePaymentType(input.paymentType, offer);
    const paymentsTotal = paymentsTotalFor(paymentType, offer);
    const transactionId = input.externalReference || `pay_first_${crypto.randomUUID()}`;
    const recordedAt = new Date().toISOString();

    const { data: existingPayment } = await getSupabase()
      .from('payment_events')
      .select('id, enrollment_id')
      .eq('location_id', input.locationId)
      .eq('processor_transaction_id', transactionId)
      .maybeSingle();
    if (existingPayment?.enrollment_id) {
      throw new ValidationError('This payment reference is already linked to an enrollment');
    }

    const { data: enrollment, error: enrollmentError } = await getSupabase()
      .from('enrollments')
      .insert({
        location_id: input.locationId,
        merchant_id: merchant.id,
        contact_id: contactId,
        offer_id: input.offerId,
        email: input.email,
        first_name: input.firstName || null,
        last_name: input.lastName || null,
        status: 'paid_pending_enrollment',
        payment_amount: input.amount,
        payment_type: paymentType,
        payment_transaction_id: transactionId,
        processor_type: input.paymentSource || 'external',
        payments_made: 1,
        payments_total: paymentsTotal,
        enrolled_at: null,
      } as any)
      .select('id')
      .single();
    if (enrollmentError) throw enrollmentError;

    await paymentEventRepository.create({
      location_id: input.locationId,
      contact_id: contactId,
      enrollment_id: enrollment.id,
      event_type: 'sale',
      processor: input.paymentSource || 'external',
      processor_transaction_id: transactionId,
      amount: input.amount,
      payment_number: 1,
      payments_total: paymentsTotal,
      payments_remaining: paymentsTotal == null ? undefined : Math.max(0, paymentsTotal - 1),
      source: 'pay_first_manual',
      is_recurring: false,
      external_payment_source: input.paymentSource || 'external',
      external_payment_reference: transactionId,
      external_payment_method: input.paymentMethod || null,
      recorded_by: input.recordedBy || null,
      recorded_at: recordedAt,
      raw_webhook_payload: {
        source: input.paymentSource,
        method: input.paymentMethod,
        notes: input.notes || '',
        recordedAt,
      },
    });

    await phase2EvidenceRepository.create({
      location_id: input.locationId,
      contact_id: contactId,
      enrollment_id: enrollment.id,
      evidence_type: 'enrollment_payment',
      data: {
        amount: input.amount,
        payment_type: paymentType,
        transaction_id: transactionId,
        source: input.paymentSource,
        payment_method: input.paymentMethod || '',
        notes: input.notes || '',
        timestamp: recordedAt,
      },
    });

    const paidToken = createPublicActionToken({
      action: 'paid_enrollment',
      locationId: input.locationId,
      contactId,
      enrollmentId: enrollment.id,
      ttlSeconds: 30 * 24 * 60 * 60,
    });
    const enrollmentUrl = await buildEnrollmentUrl(input.locationId, input.offerId, paidToken, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      paymentType,
    });
    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          'contact.ss_enrollment_link': enrollmentUrl,
          'contact.ss_current_offer_name': offer.offer_name,
          'contact.ss_enrollment_status': 'paid_pending_enrollment',
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Pay-first contact field sync failed');
    }

    await triggerService.fireTrigger(input.locationId, 'ss_send_enrollment_link', {
      event_type: 'send_enrollment_link',
      location_id: input.locationId,
      locationId: input.locationId,
      contact_id: contactId,
      contactId,
      enrollment_id: enrollment.id,
      enrollmentId: enrollment.id,
      offer_id: input.offerId,
      offerId: input.offerId,
      offer_name: offer.offer_name,
      offerName: offer.offer_name,
      program_name: offer.offer_name,
      programName: offer.offer_name,
      enrollment_url: enrollmentUrl,
      enrollmentUrl,
      payment_status: 'paid_pending_enrollment',
      paymentStatus: 'paid_pending_enrollment',
      payment_source: input.paymentSource || 'external',
      paymentSource: input.paymentSource || 'external',
      payment_timing: 'before_enrollment',
      paymentTiming: 'before_enrollment',
      enrollment_status: 'paid_pending_enrollment',
      enrollmentStatus: 'paid_pending_enrollment',
      send_welcome: false,
      sendWelcome: false,
      amount: input.amount,
      send_via: input.sendVia || ['email'],
      sendVia: input.sendVia || ['email'],
      first_name: input.firstName || '',
      firstName: input.firstName || '',
      last_name: input.lastName || '',
      lastName: input.lastName || '',
      email: input.email,
      phone: input.phone || '',
    });

    return {
      success: true,
      contactId,
      enrollmentId: enrollment.id,
      enrollmentUrl,
      status: 'paid_pending_enrollment',
      transactionId,
    };
  },

  async resendPaidEnrollmentLink(input: {
    locationId: string;
    enrollmentId: string;
    sendVia?: string[];
  }) {
    if (!input.locationId || !input.enrollmentId) {
      throw new ValidationError('locationId and enrollmentId required');
    }

    const { data: enrollment, error } = await getSupabase()
      .from('enrollments')
      .select('id, location_id, contact_id, offer_id, email, first_name, last_name, status, payment_amount, payment_type')
      .eq('id', input.enrollmentId)
      .eq('location_id', input.locationId)
      .maybeSingle();
    if (error) throw error;
    if (!enrollment) throw new ValidationError('Paid enrollment not found');
    if (enrollment.status !== 'paid_pending_enrollment') {
      throw new ValidationError('Enrollment is not waiting for paid enrollment signature');
    }
    if (!enrollment.offer_id || !enrollment.contact_id) {
      throw new ValidationError('Enrollment is missing offer or contact information');
    }

    const offer = await offerRepository.findById(enrollment.offer_id, input.locationId);
    if (!offer || !offer.active) throw new ValidationError('Offer not found or inactive');

    const paidToken = createPublicActionToken({
      action: 'paid_enrollment',
      locationId: input.locationId,
      contactId: enrollment.contact_id,
      enrollmentId: enrollment.id,
      ttlSeconds: 30 * 24 * 60 * 60,
    });
    const enrollmentUrl = await buildEnrollmentUrl(input.locationId, enrollment.offer_id, paidToken, {
      firstName: enrollment.first_name || '',
      lastName: enrollment.last_name || '',
      email: enrollment.email || '',
      paymentType: enrollment.payment_type || '',
    });

    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${enrollment.contact_id}`, {
        customField: {
          'contact.ss_enrollment_link': enrollmentUrl,
          'contact.ss_current_offer_name': offer.offer_name,
          'contact.ss_enrollment_status': 'paid_pending_enrollment',
        },
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), contactId: enrollment.contact_id, enrollmentId: enrollment.id },
        'Paid enrollment resend contact field sync failed',
      );
    }

    const result = await triggerService.fireTrigger(input.locationId, 'ss_send_enrollment_link', {
      event_type: 'send_enrollment_link',
      location_id: input.locationId,
      locationId: input.locationId,
      contact_id: enrollment.contact_id,
      contactId: enrollment.contact_id,
      enrollment_id: enrollment.id,
      enrollmentId: enrollment.id,
      offer_id: enrollment.offer_id,
      offerId: enrollment.offer_id,
      offer_name: offer.offer_name,
      offerName: offer.offer_name,
      program_name: offer.offer_name,
      programName: offer.offer_name,
      enrollment_url: enrollmentUrl,
      enrollmentUrl,
      payment_status: 'paid_pending_enrollment',
      paymentStatus: 'paid_pending_enrollment',
      payment_source: 'resend_paid_enrollment_link',
      paymentSource: 'resend_paid_enrollment_link',
      payment_timing: 'before_enrollment',
      paymentTiming: 'before_enrollment',
      enrollment_status: 'paid_pending_enrollment',
      enrollmentStatus: 'paid_pending_enrollment',
      send_welcome: false,
      sendWelcome: false,
      amount: enrollment.payment_amount || 0,
      send_via: input.sendVia || ['email'],
      sendVia: input.sendVia || ['email'],
      first_name: enrollment.first_name || '',
      firstName: enrollment.first_name || '',
      last_name: enrollment.last_name || '',
      lastName: enrollment.last_name || '',
      email: enrollment.email || '',
      phone: '',
    });

    return {
      success: result.sent > 0,
      sent: result.sent,
      failed: result.failed,
      enrollmentId: enrollment.id,
      enrollmentUrl,
      message: result.sent > 0
        ? 'Paid enrollment link sent.'
        : 'No active Send Enrollment Link workflow subscription accepted the trigger.',
    };
  },

  async finalizePaidPendingEnrollment(params: {
    enrollmentId: string;
    locationId: string;
    consentTimestamp: string;
    ipAddress: string;
    userAgent: string;
    deviceFingerprint: string;
    screenResolution: string;
    timezone: string;
    browserLanguage: string;
    tcVersionHash: string;
    digitalSignature: string;
    clausesAccepted: string[];
    scrollDepth: number;
  }) {
    const supabase = getSupabase();
    const { data: enrollment, error } = await supabase
      .from('enrollments')
      .select('*')
      .eq('id', params.enrollmentId)
      .eq('location_id', params.locationId)
      .eq('status', 'paid_pending_enrollment')
      .maybeSingle();
    if (error) throw error;
    if (!enrollment) return null;

    const sigParts = (params.digitalSignature || '').trim().split(/\s+/);
    const firstName = sigParts[0] || enrollment.first_name || '';
    const lastName = sigParts.slice(1).join(' ') || enrollment.last_name || '';
    const consentDevice = {
      userAgent: params.userAgent,
      deviceFingerprint: params.deviceFingerprint,
      screenResolution: params.screenResolution,
      timezone: params.timezone,
      browserLanguage: params.browserLanguage,
    };
    const offer = enrollment.offer_id ? await offerRepository.findById(enrollment.offer_id, params.locationId).catch(() => null) : null;
    const paymentType = normalizePaymentType(enrollment.payment_type, offer || {});
    const enrolledAt = new Date();
    const finiteBillingComplete = paymentType !== 'subscription'
      && enrollment.payments_total != null
      && Number(enrollment.payments_total) <= Number(enrollment.payments_made || 1);
    const nextBillingDate = ['installment', 'subscription'].includes(paymentType) && !finiteBillingComplete
      ? computeNextBillingDate(offer?.installment_frequency)
      : null;

    const { error: updateError } = await supabase
      .from('enrollments')
      .update({
        status: 'enrolled',
        consent_token: crypto.randomUUID(),
        consent_captured_at: params.consentTimestamp,
        consent_ip: params.ipAddress,
        consent_device: JSON.stringify(consentDevice),
        tc_version_hash: params.tcVersionHash,
        digital_signature: params.digitalSignature,
        clauses_accepted: (params.clausesAccepted || []).filter(Boolean),
        scroll_depth: params.scrollDepth,
        first_name: firstName,
        last_name: lastName,
        enrolled_at: enrolledAt.toISOString(),
        ...(nextBillingDate ? { next_billing_date: nextBillingDate } : { next_billing_date: null }),
        ...(finiteBillingComplete ? { billing_completed_at: enrolledAt.toISOString() } : {}),
      })
      .eq('id', params.enrollmentId);
    if (updateError) throw updateError;

    let processorSubscriptionId = enrollment.processor_subscription_id || '';
    let billingSetupIssue: { code: string; message: string } | null = null;
    if (offer && ['installment', 'subscription'].includes(paymentType) && nextBillingDate && !enrollment.processor_subscription_id) {
      billingSetupIssue = {
        code: 'recurring_setup_missing_after_paid_enrollment',
        message: 'Payment was received, but recurring billing was not linked to a processor subscription.',
      };
      await supabase
        .from('enrollments')
        .update({
          billing_setup_status: 'failed',
          billing_setup_error: billingSetupIssue.message,
          next_billing_date: null,
        })
        .eq('id', params.enrollmentId)
        .eq('location_id', params.locationId);
      logger.error({ enrollmentId: params.enrollmentId }, 'Paid pending recurring setup missing processor subscription');
    }

    await phase2EvidenceRepository.create({
      location_id: params.locationId,
      contact_id: enrollment.contact_id,
      enrollment_id: params.enrollmentId,
      merchant_id: enrollment.merchant_id || undefined,
      evidence_type: 'enrollment_consent',
      data: {
        signature_text: params.digitalSignature,
        tc_version_hash: params.tcVersionHash,
        consent_checkboxes: params.clausesAccepted || [],
        timestamp: params.consentTimestamp,
        contact_email: enrollment.email,
        contact_name: [firstName, lastName].filter(Boolean).join(' '),
        pay_first: true,
      },
      ip_address: params.ipAddress,
      device_info: JSON.stringify(consentDevice),
      browser_info: params.userAgent,
    });

    // Packet generation and chain verification must not wait on GHL workflow
    // retries. A stale trigger subscription can otherwise delay or strand the
    // core enrollment evidence that the paid-enrollment flow is meant to preserve.
    void (async () => {
      try {
        const { enrollmentPacketService } = require('./enrollment-packet.service');
        const pdfUrl = await enrollmentPacketService.generateAndStore(params.enrollmentId, params.locationId);
        logger.info(
          { enrollmentId: params.enrollmentId, packetStored: Boolean(pdfUrl) },
          'Paid pending enrollment packet generated',
        );
      } catch (packetErr: any) {
        logger.error(
          { err: packetErr?.message || String(packetErr), enrollmentId: params.enrollmentId },
          'Paid pending enrollment packet generation failed',
        );
      }

      try {
        const { data: paymentEvent, error: paymentEventError } = await supabase
          .from('payment_events')
          .select('id')
          .eq('location_id', params.locationId)
          .eq('enrollment_id', params.enrollmentId)
          .eq('event_type', 'sale')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (paymentEventError) throw paymentEventError;
        if (!paymentEvent?.id) {
          logger.warn(
            { enrollmentId: params.enrollmentId },
            'Paid pending enrollment evidence chain skipped because no sale event was found',
          );
          return;
        }

        const { evidenceChainService } = require('./evidence-chain.service');
        const chain = await evidenceChainService.verifyChain(paymentEvent.id, params.locationId);
        logger.info(
          {
            enrollmentId: params.enrollmentId,
            chainStrength: chain.chainStrength,
            complete: chain.complete,
            gapCount: chain.gaps?.length || 0,
          },
          'Paid pending enrollment evidence chain verified',
        );
      } catch (chainErr: any) {
        logger.warn(
          { err: chainErr?.message || String(chainErr), enrollmentId: params.enrollmentId },
          'Paid pending enrollment evidence chain verification failed',
        );
      }
    })().catch((err: any) => {
      logger.error(
        { err: err?.message || String(err), enrollmentId: params.enrollmentId },
        'Paid pending enrollment packet background task failed',
      );
    });

    void (async () => {
    let supportEmail = '';
    let businessName = '';
    try {
      const merchant = await merchantRepository.getByLocationId(params.locationId);
      supportEmail = merchantSupportEmail(merchant);
      businessName = merchantBusinessName(merchant);
      if (offer && enrollment.contact_id) {
        const customFields: Record<string, unknown> = {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled',
          [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: formatDate(enrolledAt),
        };
        const receiptPriceDisplay = formatMoney(getSelectedPlanReceiptPrice(offer, paymentType));
        const billingAmount = offer.installment_amount ?? offer.price;
        const billingAmountDisplay = formatMoney(billingAmount);
        const numPayments = enrollment.payments_total ?? offer.num_payments ?? '';
        const paymentsMade = Number(enrollment.payments_made || 1);
        const paymentsTotal = enrollment.payments_total == null ? null : Number(enrollment.payments_total);
        const paymentsRemaining = paymentsTotal == null ? '' : Math.max(0, paymentsTotal - paymentsMade);

        customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = businessName;
        customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name || '';
        customFields[OFFER_CONTACT_FIELDS.PRICE] = receiptPriceDisplay;
        customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = formatPaymentType(paymentType);
        customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = billingAmountDisplay;
        customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = formatFrequency(offer.installment_frequency);
        customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = numPayments;
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME] = offer.offer_name || '';
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PRICE_DISPLAY] = receiptPriceDisplay;
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.NUMBER_OF_PAYMENTS] = numPayments;
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL] = supportEmail;
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.TC_DOCUMENT_URL] = resolveWorkflowTermsUrl(offer, merchant);
        customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.REFUND_POLICY] = resolveWorkflowRefundPolicy(offer);
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT] = formatMoney(Number(enrollment.payment_amount || 0));
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE] = formatDate(enrolledAt);
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE] = paymentsMade;
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING] = paymentsRemaining;
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.SUCCESSFUL_PAYMENT_COUNT] = paymentsMade;
        customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID] = formatMoney(Number(enrollment.payment_amount || 0) * paymentsMade);

        const api = await ghlApi(params.locationId);
        await api.put(`/contacts/${enrollment.contact_id}`, { customField: customFields });
        if ((offer as any).pulse_cadence_enabled === true) {
          const pulseFrequencyDays = Math.min(365, Math.max(1, Number((offer as any).pulse_frequency_days || 30)));
          const nextPulseDue = new Date();
          nextPulseDue.setDate(nextPulseDue.getDate() + pulseFrequencyDays);
          await supabase
            .from('enrollments')
            .update({
              pulse_cadence_enabled: true,
              pulse_frequency_days: pulseFrequencyDays,
              next_pulse_due_at: nextPulseDue.toISOString(),
              last_pulse_sent_at: null,
            })
            .eq('id', params.enrollmentId)
            .eq('location_id', params.locationId);
        }
        logger.info(
          { enrollmentId: params.enrollmentId, contactId: enrollment.contact_id, offerId: enrollment.offer_id },
          'Paid pending enrollment workflow contact fields synced',
        );
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), enrollmentId: params.enrollmentId, contactId: enrollment.contact_id },
        'Paid pending enrollment workflow contact field sync failed',
      );
    }

    await triggerService.fireTrigger(params.locationId, 'enrollment_complete', {
      event_type: 'enrollment_complete',
      location_id: params.locationId,
      locationId: params.locationId,
      contact_id: enrollment.contact_id,
      contactId: enrollment.contact_id,
      contact_email: enrollment.email || '',
      contactEmail: enrollment.email || '',
      enrollment_id: params.enrollmentId,
      enrollmentId: params.enrollmentId,
      offer_id: enrollment.offer_id || '',
      offerId: enrollment.offer_id || '',
      program_name: offer?.offer_name || '',
      programName: offer?.offer_name || '',
      offer_name: offer?.offer_name || '',
      offerName: offer?.offer_name || '',
      amount: enrollment.payment_amount || 0,
      amount_display: formatMoney(Number(enrollment.payment_amount || 0)),
      amountDisplay: formatMoney(Number(enrollment.payment_amount || 0)),
      payment_type: paymentType,
      paymentType: paymentType,
      pay_first: true,
      payFirst: true,
      payment_already_received: true,
      paymentAlreadyReceived: true,
      send_receipt: false,
      sendReceipt: false,
      send_welcome: true,
      sendWelcome: true,
      access_ready: true,
      accessReady: true,
      processor_subscription_id: processorSubscriptionId,
      processorSubscriptionId,
      billing_setup_issue: billingSetupIssue,
      billingSetupIssue,
      support_email: supportEmail,
      supportEmail,
      business_name: businessName,
      businessName,
    });
    })().catch((err: any) => {
      logger.warn(
        { err: err?.message || String(err), enrollmentId: params.enrollmentId },
        'Paid pending enrollment background workflow failed',
      );
    });

    return {
      success: true,
      enrollmentId: params.enrollmentId,
      consentToken: null,
      paidPendingCompleted: true,
      freeOffer: true,
      processorSubscriptionId: processorSubscriptionId || null,
      billingSetupIssue,
    };
  },
};
