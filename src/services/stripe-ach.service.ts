import { getSupabase } from '../clients/supabase.client';
import { offerRepository } from '../repositories/offer.repository';
import { phase2EnrollmentService } from './phase2Enrollment.service';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { createProcessorClient, resolveProcessor } from './processor.factory';
import { saveOrReusePaymentMethod } from './payment-methods.service';
import { dualPricingService } from './dual-pricing.service';
import { merchantService } from './merchant.service';
import { offerService } from './offer.service';
import { ghlApi } from '../clients/ghl.client';
import { createPublicActionToken } from '../utils/public-action-token';
import { config as appConfig } from '../config';

type MerchantLike = {
  id: string;
  location_id: string;
  processor_config_id?: string | null;
};

type AchAccessPolicy = 'after_settlement' | 'after_submission';
type RecurringSetupState = 'ready' | 'pending' | 'failed';

function centsToDollars(cents: number): number {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function stripeAchStatus(status: string): 'processing' | 'settled' | 'failed' {
  if (status === 'succeeded') return 'settled';
  if (status === 'processing' || status === 'requires_action' || status === 'requires_confirmation') {
    return 'processing';
  }
  return 'failed';
}

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

function paymentMethodId(paymentIntent: any): string {
  const pm = paymentIntent.payment_method;
  return typeof pm === 'string' ? pm : pm?.id || '';
}

function customerId(paymentIntent: any): string {
  const customer = paymentIntent.customer;
  return typeof customer === 'string' ? customer : customer?.id || '';
}

function bankDetails(paymentIntent: any): {
  bankLastFour?: string;
  bankAccountType?: string;
  bankHolderType?: string;
} {
  const pm = typeof paymentIntent.payment_method === 'object' ? paymentIntent.payment_method : null;
  const bank = pm?.us_bank_account || {};
  return {
    bankLastFour: bank.last4 || undefined,
    bankAccountType: bank.account_type || undefined,
    bankHolderType: bank.account_holder_type || undefined,
  };
}

async function saveStripeAchMethod(params: {
  merchant: MerchantLike;
  paymentIntent: any;
  contactId: string | null;
}): Promise<void> {
  const pmId = paymentMethodId(params.paymentIntent);
  const cusId = customerId(params.paymentIntent);
  if (!params.contactId || !pmId || !cusId) return;
  const bank = bankDetails(params.paymentIntent);
  await saveOrReusePaymentMethod({
    merchantId: params.merchant.id,
    locationId: params.merchant.location_id,
    contactId: params.contactId,
    processorType: 'stripe',
    processorConfigId: params.merchant.processor_config_id || null,
    paymentMethodKind: 'ach',
    customerId: cusId,
    paymentMethodId: pmId,
    cardLastFour: '',
    cardBrand: 'bank',
    cardExpMonth: 0,
    cardExpYear: 0,
    bankLastFour: bank.bankLastFour,
    bankAccountType: bank.bankAccountType,
    bankHolderType: bank.bankHolderType,
    makeDefault: true,
  });
}

async function claimRecurringSetup(params: {
  enrollmentId: string;
  locationId: string;
}): Promise<boolean> {
  const { data, error } = await getSupabase().from('enrollments').update({
    billing_setup_status: 'needs_reconciliation',
    billing_setup_error: 'Recurring billing setup is in progress or requires reconciliation.',
  })
    .eq('id', params.enrollmentId)
    .eq('location_id', params.locationId)
    .in('billing_setup_status', ['pending', 'ok'])
    .is('processor_subscription_id', null)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function setupRecurringAfterSettlement(params: {
  merchant: MerchantLike;
  enrollment: any;
  offerId: string | null;
  paymentType: string;
  paymentIntent: any;
}): Promise<RecurringSetupState> {
  const paymentType = normalizePaymentType(params.paymentType || params.enrollment.payment_type);
  if (!['installment', 'subscription'].includes(paymentType)) return 'ready';
  if (params.enrollment.processor_subscription_id) return 'ready';

  const pmId = paymentMethodId(params.paymentIntent);
  const cusId = customerId(params.paymentIntent);
  if (!pmId || !cusId) {
    await getSupabase().from('enrollments').update({
      status: 'billing_setup_failed',
      billing_setup_status: 'failed',
      billing_setup_error: 'Stripe ACH payment succeeded, but the saved bank payment method was not available for recurring setup.',
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'failed';
  }

  const offer = params.offerId
    ? await offerRepository.findById(params.offerId, params.merchant.location_id)
    : null;
  if (!offer) {
    await getSupabase().from('enrollments').update({
      status: 'billing_setup_failed',
      billing_setup_status: 'failed',
      billing_setup_error: 'Stripe ACH payment succeeded, but the offer was not found for recurring setup.',
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'failed';
  }

  const remainingPayments = paymentType === 'subscription'
    ? 0
    : Math.max(0, Number(params.enrollment.payments_total || 0) - 1);
  if (paymentType === 'installment' && remainingPayments <= 0) {
    await getSupabase().from('enrollments').update({
      billing_setup_status: 'ok',
      billing_completed_at: new Date().toISOString(),
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'ready';
  }

  const quote = await dualPricingService.quoteOffer(offer, paymentType, 'ach');
  const recurringAmountCents = quote.selectedAmountCents;
  if (recurringAmountCents <= 0) {
    await getSupabase().from('enrollments').update({
      status: 'billing_setup_failed',
      billing_setup_status: 'failed',
      billing_setup_error: 'Stripe ACH recurring setup failed because the recurring amount was not valid.',
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'failed';
  }

  const nextBillingDate = params.enrollment.next_billing_date
    || computeNextBillingDate(offer.installment_frequency);
  const processorConfigId = String(
    params.enrollment.processor_config_id || params.merchant.processor_config_id || '',
  ).trim();
  if (!processorConfigId) {
    throw new Error('Stripe ACH recurring setup is missing its processor configuration binding');
  }
  const { config } = await resolveProcessor(params.merchant.id, params.merchant.location_id, {
    processor_override: 'stripe',
    processor_config_id: processorConfigId,
    nmi_processor_id: null,
  });
  if (config.id !== processorConfigId) {
    throw new Error('Stripe ACH recurring setup resolved a different processor configuration');
  }
  const processor = createProcessorClient(config);
  const claimed = await claimRecurringSetup({
    enrollmentId: params.enrollment.id,
    locationId: params.merchant.location_id,
  });
  if (!claimed) {
    const { data: current, error } = await getSupabase().from('enrollments')
      .select('processor_subscription_id, billing_setup_status')
      .eq('id', params.enrollment.id)
      .eq('location_id', params.merchant.location_id)
      .maybeSingle();
    if (error) throw error;
    if (current?.processor_subscription_id) return 'ready';
    return current?.billing_setup_status === 'failed' ? 'failed' : 'pending';
  }

  let subResult;
  try {
    subResult = await processor.createSubscription({
      paymentMethodId: pmId,
      customerId: cusId,
      planAmount: recurringAmountCents,
      interval: processorInterval(offer.installment_frequency),
      totalPayments: remainingPayments,
      startDate: nextBillingDate,
      description: offer.offer_name || 'ScaleSafe ACH Recurring Plan',
      metadata: {
        enrollment_id: params.enrollment.id,
        offer_id: params.offerId || '',
        contact_id: params.enrollment.contact_id || '',
        location_id: params.merchant.location_id,
        payment_type: paymentType,
        payment_method_type: 'ach',
        processor_config_id: processorConfigId,
      },
      idempotencyKey: `stripe-ach-recurring-${params.enrollment.id}-${params.paymentIntent.id}`,
    });
  } catch (err: any) {
    await getSupabase().from('enrollments').update({
      billing_setup_status: 'needs_reconciliation',
      billing_setup_error: `Stripe ACH recurring setup result is unknown: ${err?.message || 'Stripe request failed'}`,
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'pending';
  }

  if (!subResult.success || !subResult.subscriptionId) {
    await getSupabase().from('enrollments').update({
      status: 'billing_setup_failed',
      billing_setup_status: 'failed',
      billing_setup_error: subResult.errorMessage || 'Stripe ACH recurring subscription creation failed.',
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'failed';
  }

  const { error: subSaveError } = await getSupabase().from('enrollments').update({
    processor_subscription_id: subResult.subscriptionId,
    processor_type: 'stripe',
    processor_config_id: processorConfigId,
    billing_setup_status: 'ok',
    billing_setup_error: null,
    next_billing_date_source: 'processor',
    ...(subResult.nextPaymentDate ? { next_billing_date: subResult.nextPaymentDate.split('T')[0] } : {}),
  }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
  if (subSaveError) {
    await getSupabase().from('enrollments').update({
      status: 'billing_setup_failed',
      billing_setup_status: 'needs_reconciliation',
      billing_setup_error: `Stripe ACH subscription ${subResult.subscriptionId} was created but could not be saved: ${subSaveError.message}`,
      next_billing_date: null,
    }).eq('id', params.enrollment.id).eq('location_id', params.merchant.location_id);
    return 'pending';
  }
  return 'ready';
}

async function fireStripeAchReceipt(params: {
  locationId: string;
  contactId: string;
  enrollmentId?: string | null;
  offerId?: string | null;
  offerName?: string;
  amount: number;
  transactionId: string;
  paymentKind: string;
  paymentTiming: string;
  lineItems?: any[];
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
    processor: 'stripe',
    source: 'stripe_ach_settlement',
    payment_source: 'stripe_ach_settlement',
    paymentSource: 'stripe_ach_settlement',
    payment_timing: params.paymentTiming,
    paymentTiming: params.paymentTiming,
    amount: params.amount,
    amount_display: `$${params.amount.toFixed(2)}`,
    amountDisplay: `$${params.amount.toFixed(2)}`,
    line_items: params.lineItems || [],
    lineItems: params.lineItems || [],
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
  });
}

async function offerName(locationId: string, offerId?: string | null): Promise<string> {
  if (!offerId) return '';
  try {
    const offer = await offerRepository.findById(offerId, locationId);
    return offer?.offer_name || '';
  } catch {
    return '';
  }
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
  } catch {}
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

async function resolveAchAccessPolicy(locationId: string, offerId?: string | null): Promise<AchAccessPolicy> {
  if (!offerId) return 'after_settlement';
  try {
    const offer = await offerRepository.findById(offerId, locationId);
    return (offer as any)?.ach_access_policy === 'after_submission'
      ? 'after_submission'
      : 'after_settlement';
  } catch {
    return 'after_settlement';
  }
}

function stripeAchPaymentSource(paymentStatus: 'processing' | 'settled' | 'failed'): string {
  return paymentStatus === 'processing' ? 'stripe_ach_submission' : 'stripe_ach_settlement';
}

function parseLineItems(value: unknown): any[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const stripeAchService = {
  async recordPaymentIntentState(params: {
    merchant: MerchantLike;
    paymentIntent: any;
    source: string;
  }): Promise<{
    paymentStatus: 'processing' | 'settled' | 'failed';
    paymentEventId?: string;
    enrollmentId?: string | null;
  }> {
    const { merchant, paymentIntent, source } = params;
    const metadata = paymentIntent.metadata || {};
    if (metadata.scalesafe_ach !== 'true') {
      return { paymentStatus: stripeAchStatus(paymentIntent.status) };
    }

    const locationId = String(metadata.location_id || merchant.location_id || '');
    if (!locationId || locationId !== merchant.location_id) {
      throw new Error('Stripe ACH location mismatch');
    }
    const processorConfigId = String(
      merchant.processor_config_id || metadata.processor_config_id || '',
    ).trim();
    if (!processorConfigId) throw new Error('Stripe ACH payment is missing its processor configuration binding');
    if (metadata.processor_config_id && metadata.processor_config_id !== processorConfigId) {
      throw new Error('Stripe ACH processor configuration mismatch');
    }
    merchant.processor_config_id = processorConfigId;

    const transactionId = String(paymentIntent.id || '');
    if (!transactionId) throw new Error('Stripe ACH payment_intent missing id');

    const supabase = getSupabase();
    const paymentStatus = stripeAchStatus(paymentIntent.status);
    const now = new Date().toISOString();
    const amount = centsToDollars(paymentIntent.amount || 0);
    const lineItems = parseLineItems(metadata.line_items);
    const offerId = String(metadata.offer_id || metadata.scalesafe_offer_id || '') || null;
    const consentToken = String(metadata.consent_token || '') || null;
    const achAccessPolicy = await resolveAchAccessPolicy(locationId, offerId);
    const releaseOnSubmission = paymentStatus === 'processing' && achAccessPolicy === 'after_submission';
    let enrollmentId = String(metadata.enrollment_id || '') || null;
    let contactId = String(metadata.contact_id || '') || null;
    let customerEmail = String(metadata.customer_email || metadata.email || '') || null;
    let paymentType = normalizePaymentType(metadata.payment_choice || metadata.payment_type || 'pif');

    if (consentToken && !enrollmentId) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, contact_id, email, payment_type, processor_config_id')
        .eq('location_id', locationId)
        .eq('consent_token', consentToken)
        .maybeSingle();
      if (enrollment) {
        if (enrollment.processor_config_id && enrollment.processor_config_id !== processorConfigId) {
          throw new Error('Stripe ACH consent enrollment is bound to a different processor configuration');
        }
        enrollmentId = enrollment.id;
        contactId = contactId || enrollment.contact_id || null;
        customerEmail = customerEmail || enrollment.email || null;
        paymentType = normalizePaymentType(paymentType || enrollment.payment_type || 'pif');
      }
    }

    const { data: existing } = await supabase
      .from('payment_events')
      .select('id, enrollment_id, contact_id')
      .eq('location_id', locationId)
      .eq('processor', 'stripe')
      .eq('processor_config_id', processorConfigId)
      .eq('processor_transaction_id', transactionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const updatePayload: Record<string, unknown> = {
      payment_status: paymentStatus,
      raw_webhook_payload: paymentIntent,
      ...(lineItems.length ? { line_items: lineItems } : {}),
      ...(paymentStatus === 'settled' ? { settled_at: now } : {}),
      ...(paymentStatus === 'failed' ? {
        returned_at: now,
        return_reason: paymentIntent.last_payment_error?.message || paymentIntent.cancellation_reason || 'Stripe ACH payment failed',
      } : {}),
    };

    let paymentEventId = existing?.id as string | undefined;
    if (paymentEventId) {
      const { error } = await supabase
        .from('payment_events')
        .update(updatePayload)
        .eq('id', paymentEventId)
        .eq('location_id', locationId)
        .eq('processor_config_id', processorConfigId);
      if (error) throw error;
      enrollmentId = enrollmentId || existing?.enrollment_id || null;
      contactId = contactId || existing?.contact_id || null;
    } else {
      const { data: inserted, error } = await supabase
        .from('payment_events')
        .insert({
          merchant_id: merchant.id,
          location_id: locationId,
          contact_id: contactId || '',
          enrollment_id: enrollmentId,
          offer_id: offerId,
          event_type: paymentStatus === 'failed' ? 'payment_failed' : 'sale',
          processor: 'stripe',
          processor_config_id: processorConfigId,
          processor_transaction_id: transactionId,
          amount,
          currency: String(paymentIntent.currency || 'usd').toLowerCase(),
          payment_method_type: 'ach',
          selected_payment_method: 'ach',
          payment_status: paymentStatus,
          customer_email: customerEmail,
          consent_token: consentToken,
          source,
          is_recurring: false,
          line_items: lineItems,
          raw_webhook_payload: paymentIntent,
          ...(paymentStatus === 'settled' ? { settled_at: now } : {}),
          ...(paymentStatus === 'failed' ? {
            returned_at: now,
            return_reason: paymentIntent.last_payment_error?.message || paymentIntent.cancellation_reason || 'Stripe ACH payment failed',
          } : {}),
        })
        .select('id')
        .single();
      if (error) throw error;
      paymentEventId = inserted?.id;
    }

    if (enrollmentId) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, location_id, contact_id, email, status, payment_type, payments_total, offer_id, processor_subscription_id, processor_config_id, next_billing_date')
        .eq('id', enrollmentId)
        .eq('location_id', locationId)
        .maybeSingle();

      if (enrollment) {
        if (enrollment.processor_config_id && enrollment.processor_config_id !== processorConfigId) {
          throw new Error('Stripe ACH enrollment is bound to a different processor configuration');
        }
        const checkoutMode = String(metadata.checkout_mode || '');
        const enrollmentStatus = String(enrollment.status || '');
        const paymentTypeForEnrollment = normalizePaymentType(enrollment.payment_type || paymentType);
        const recurringEnrollment = isRecurringPaymentType(paymentTypeForEnrollment);

        await saveStripeAchMethod({
          merchant,
          paymentIntent,
          contactId: enrollment.contact_id || contactId || null,
        });

        await supabase.from('enrollments').update({
          initial_payment_status: paymentStatus,
          initial_payment_method: 'ach',
          processor_type: 'stripe',
          processor_config_id: processorConfigId,
          initial_payment_settled_at: paymentStatus === 'settled' ? now : null,
          initial_payment_returned_at: paymentStatus === 'failed' ? now : null,
          initial_payment_return_reason: paymentStatus === 'failed'
            ? paymentIntent.last_payment_error?.message || paymentIntent.cancellation_reason || 'Stripe ACH payment failed'
            : null,
          ...(paymentStatus === 'processing' ? {
            status: 'payment_processing',
            payment_amount: amount,
            payment_type: paymentType,
            payment_transaction_id: transactionId,
            ...(recurringEnrollment ? { next_billing_date: null } : {}),
          } : {}),
          ...(paymentStatus === 'failed' ? { status: 'payment_returned' } : {}),
        } as any).eq('id', enrollmentId).eq('location_id', locationId);

        const shouldReleaseQuickManualSale =
          checkoutMode === 'quick_manual_sale'
          && (paymentStatus === 'settled' || releaseOnSubmission)
          && enrollmentStatus === 'payment_processing';

        if (shouldReleaseQuickManualSale) {
          const offer = enrollment.offer_id
            ? await offerRepository.findById(enrollment.offer_id, locationId)
            : null;
          const enrollmentUrl = offer && enrollment.contact_id
            ? await buildPaidEnrollmentUrl({
              locationId,
              offerId: enrollment.offer_id,
              contactId: enrollment.contact_id,
              enrollmentId,
            })
            : '';

          await supabase.from('enrollments').update({
            status: 'paid_pending_enrollment',
            initial_payment_status: paymentStatus,
            initial_payment_settled_at: paymentStatus === 'settled' ? now : null,
          } as any).eq('id', enrollmentId).eq('location_id', locationId);

          if (offer && enrollment.contact_id && metadata.send_enrollment !== 'false') {
            try {
              const api = await ghlApi(locationId);
              await api.put(`/contacts/${enrollment.contact_id}`, {
                customField: {
                  'contact.ss_enrollment_link': enrollmentUrl,
                  'contact.ss_current_offer_name': offer.offer_name,
                  'contact.ss_enrollment_status': 'paid_pending_enrollment',
                },
              });
            } catch (err: any) {
              logger.warn({ err: err.message, contactId: enrollment.contact_id }, 'Stripe ACH quick manual sale contact field sync failed');
            }

            await triggerService.fireTrigger(locationId, 'ss_send_enrollment_link', {
              event_type: 'send_enrollment_link',
              location_id: locationId,
              locationId,
              contact_id: enrollment.contact_id,
              contactId: enrollment.contact_id,
              enrollment_id: enrollmentId,
              enrollmentId,
              offer_id: enrollment.offer_id || '',
              offerId: enrollment.offer_id || '',
              offer_name: offer.offer_name,
              offerName: offer.offer_name,
              program_name: offer.offer_name,
              programName: offer.offer_name,
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
              ach_access_policy: achAccessPolicy,
              achAccessPolicy,
              ach_payment_status: paymentStatus,
              achPaymentStatus: paymentStatus,
              amount,
              line_items: lineItems,
              lineItems,
              first_name: metadata.first_name || '',
              firstName: metadata.first_name || '',
              last_name: metadata.last_name || '',
              lastName: metadata.last_name || '',
              email: customerEmail || '',
            });
          }

          await triggerService.fireTrigger(locationId, 'ss_payment_received', {
            event_type: 'payment_received',
            location_id: locationId,
            locationId,
            contact_id: enrollment.contact_id || contactId || '',
            contactId: enrollment.contact_id || contactId || '',
            enrollment_id: enrollmentId,
            enrollmentId,
            offer_id: enrollment.offer_id || '',
            offerId: enrollment.offer_id || '',
            program_name: offer?.offer_name || '',
            programName: offer?.offer_name || '',
            offer_name: offer?.offer_name || '',
            offerName: offer?.offer_name || '',
            amount,
            amount_display: `$${amount.toFixed(2)}`,
            amountDisplay: `$${amount.toFixed(2)}`,
            line_items: lineItems,
            lineItems,
            transaction_id: transactionId,
            transactionId,
            payment_kind: enrollment.payment_type || paymentType,
            paymentKind: enrollment.payment_type || paymentType,
            payment_source: 'quick_manual_sale',
            paymentSource: 'quick_manual_sale',
            payment_timing: offer ? 'before_enrollment' : 'client_level',
            paymentTiming: offer ? 'before_enrollment' : 'client_level',
            enrollment_status: offer ? 'paid_pending_enrollment' : 'paid_client_payment',
            enrollmentStatus: offer ? 'paid_pending_enrollment' : 'paid_client_payment',
            receipt_only: true,
            receiptOnly: true,
            send_receipt: true,
            sendReceipt: true,
            send_welcome: false,
            sendWelcome: false,
            ach_access_policy: achAccessPolicy,
            achAccessPolicy,
            ach_payment_status: paymentStatus,
            achPaymentStatus: paymentStatus,
          });
        }

        if (paymentStatus === 'settled' && recurringEnrollment && !enrollment.processor_subscription_id) {
          const recurringState = await setupRecurringAfterSettlement({
            merchant,
            enrollment,
            offerId: enrollment.offer_id || offerId,
            paymentType: paymentTypeForEnrollment,
            paymentIntent,
          });
          if (recurringState !== 'ready') {
            if (achAccessPolicy === 'after_settlement' && ['payment_processing', 'consent_captured'].includes(enrollmentStatus)) {
              const name = await offerName(locationId, enrollment.offer_id || offerId);
              await fireStripeAchReceipt({
                locationId,
                contactId: enrollment.contact_id || contactId || '',
                enrollmentId,
                offerId: enrollment.offer_id || offerId,
                offerName: name,
                amount,
                transactionId,
                paymentKind: paymentTypeForEnrollment,
                paymentTiming: 'during_enrollment',
                lineItems,
              });
            }
            return { paymentStatus, paymentEventId, enrollmentId };
          }
        }

        const shouldCompleteEnrollment =
          checkoutMode !== 'quick_manual_sale'
          && (paymentStatus === 'settled' || releaseOnSubmission)
          && ['device_captured', 'payment_processing', 'consent_captured'].includes(enrollmentStatus);

        if (shouldCompleteEnrollment) {
          await phase2EnrollmentService.completeEnrollment({
            enrollmentId,
            locationId,
            contactId: enrollment.contact_id || contactId || '',
            contactEmail: customerEmail || enrollment.email || '',
            paymentAmount: amount,
            paymentType: paymentTypeForEnrollment || 'pif',
            transactionId,
            paymentsTotal: enrollment.payments_total || null,
            processorType: 'stripe',
            paymentSource: stripeAchPaymentSource(paymentStatus),
            skipPaymentEvent: true,
          });
        }
      }
    } else if (paymentStatus === 'settled' && contactId) {
      const name = await offerName(locationId, offerId);
      await triggerService.fireTrigger(locationId, 'ss_payment_received', {
        event_type: 'payment_received',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        offer_id: offerId || '',
        offerId: offerId || '',
        program_name: name,
        programName: name,
        offer_name: name,
        offerName: name,
        processor: 'stripe',
        source: 'stripe_ach_settlement',
        payment_source: 'stripe_ach_settlement',
        paymentSource: 'stripe_ach_settlement',
        payment_timing: 'settlement',
        paymentTiming: 'settlement',
        amount,
        amount_display: `$${amount.toFixed(2)}`,
        amountDisplay: `$${amount.toFixed(2)}`,
        line_items: lineItems,
        lineItems,
        transaction_id: transactionId,
        transactionId,
        payment_kind: metadata.payment_kind || metadata.payment_choice || 'manual_sale',
        paymentKind: metadata.payment_kind || metadata.payment_choice || 'manual_sale',
        receipt_only: true,
        receiptOnly: true,
        send_receipt: true,
        sendReceipt: true,
        send_welcome: false,
        sendWelcome: false,
      });
    }

    logger.info({
      paymentIntentId: transactionId,
      paymentStatus,
      enrollmentId,
      contactId,
      source,
    }, 'Stripe ACH payment intent state recorded');

    return { paymentStatus, paymentEventId, enrollmentId };
  },
};
