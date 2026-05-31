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
import { findSavedCardForProcessor, saveOrReusePaymentMethod } from './payment-methods.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { config } from '../config';
import { createPublicActionToken } from '../utils/public-action-token';
import type { ProcessorType } from '../types/processor.types';
import { dualPricingService } from './dual-pricing.service';

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
  paymentType?: string;
  paymentMethod?: 'card' | 'ach';
  achSecCode?: 'WEB' | 'PPD' | 'CCD' | 'TEL';
  achAccountHolderType?: 'personal' | 'business';
  achAccountType?: 'checking' | 'savings';
  sendEnrollment?: boolean;
  sendVia?: string[];
  recordedBy?: string;
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

async function buildEnrollmentUrl(locationId: string, offerId: string, paidEnrollmentToken?: string): Promise<string> {
  let funnelBaseUrl = '';
  try {
    const mc = await merchantService.getFullConfig(locationId);
    funnelBaseUrl = mc.enrollmentFunnelUrl || '';
  } catch {}
  const link = offerService.generateEnrollmentLink(offerId, config.appUrl, 'full_enrollment', funnelBaseUrl);
  if (!paidEnrollmentToken) return link;
  const url = new URL(link);
  url.searchParams.set('paidEnrollmentToken', paidEnrollmentToken);
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
    }

    const offerHint = offer
      ? { processor_override: offer.processor_override || null, nmi_processor_id: offer.nmi_processor_id || null }
      : undefined;
    const { config: procConfig } = await resolveProcessor(merchant.id, locationId, offerHint);
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

  async chargeCardAndCreatePaidEnrollment(input: ChargeManualSaleInput) {
    if (!input.locationId || !input.email || !input.amount || !input.paymentToken) {
      throw new ValidationError('locationId, email, amount, and paymentToken required');
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
    const processor = createProcessorClient(procConfig);
    if (offer) {
      const quote = await dualPricingService.quoteOffer(
        offer,
        input.paymentType,
        input.paymentMethod === 'ach' ? 'ach' : 'card',
      );
      if (quote.selectedAmountCents > 0 && quote.selectedAmountCents !== dollarsToCents(input.amount)) {
        throw new ValidationError('Payment amount does not match selected offer');
      }
    }
    const amountCents = dollarsToCents(input.amount);
    if (amountCents <= 0) throw new ValidationError('Amount must be greater than zero');

    const paymentType = offer ? normalizePaymentType(input.paymentType, offer) : 'one_off';
    const paymentsTotal = offer ? paymentsTotalFor(paymentType, offer) : null;
    const recordedAt = new Date().toISOString();
    const paymentMethod = input.paymentMethod === 'ach' ? 'ach' : 'card';
    if (paymentMethod === 'ach' && procConfig.processor_type !== 'nmi') {
      throw new ValidationError('Bank transfer is currently available only for NMI offers.');
    }
    if (paymentMethod === 'ach' && ['installment', 'installments', 'subscription'].includes(paymentType)) {
      throw new ValidationError('Bank-transfer installments and subscriptions require settlement-gated recurring setup and are not enabled yet.');
    }

    const charge = await processor.charge({
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
    });

    if (!charge.success) {
      throw new ValidationError(charge.errorMessage || 'Card charge failed');
    }
    const paymentProcessing = charge.status === 'processing';

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

    if (charge.vaultedCustomerId) {
      saveResult = {
        success: true,
        paymentMethodId: procConfig.processor_type === 'stripe' ? input.paymentToken : charge.vaultedCustomerId,
        customerId: charge.vaultedCustomerId,
        cardLastFour: charge.vaultedCardLastFour || '****',
        cardBrand: charge.vaultedCardBrand || 'unknown',
        cardExpMonth: charge.vaultedCardExpMonth || 0,
        cardExpYear: charge.vaultedCardExpYear || 0,
        paymentMethodKind: paymentMethod,
        bankLastFour: charge.vaultedBankLastFour,
        bankAccountType: charge.vaultedBankAccountType,
        bankHolderType: charge.vaultedBankHolderType,
      };
    } else {
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

    let enrollmentId: string | null = null;
    let enrollmentUrl = '';
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
          status: paymentProcessing ? 'payment_processing' : 'paid_pending_enrollment',
          payment_amount: input.amount,
          payment_type: paymentType,
          payment_transaction_id: charge.transactionId || charge.chargeId || '',
          processor_type: procConfig.processor_type,
          initial_payment_status: paymentProcessing ? 'processing' : 'succeeded',
          initial_payment_method: paymentMethod,
          payments_made: 1,
          payments_total: paymentsTotal,
          enrolled_at: null,
        } as any)
        .select('id')
        .single();
      if (enrollmentError) throw enrollmentError;
      const createdEnrollmentId = enrollment.id as string;
      enrollmentId = createdEnrollmentId;

      const paidToken = createPublicActionToken({
        action: 'paid_enrollment',
        locationId: input.locationId,
        contactId,
        enrollmentId: createdEnrollmentId,
        ttlSeconds: 30 * 24 * 60 * 60,
      });
      enrollmentUrl = await buildEnrollmentUrl(input.locationId, input.offerId!, paidToken);
    }

    await paymentEventRepository.create({
      merchant_id: merchant.id,
      location_id: input.locationId,
      contact_id: contactId,
      enrollment_id: enrollmentId || undefined,
      event_type: 'sale',
      processor: procConfig.processor_type,
      processor_transaction_id: charge.transactionId || charge.chargeId || '',
      amount: input.amount,
      payment_number: 1,
      payments_total: paymentsTotal,
      payments_remaining: paymentsTotal == null ? undefined : Math.max(0, paymentsTotal - 1),
      source: 'quick_manual_sale',
      is_recurring: false,
      payment_status: paymentProcessing ? 'processing' : 'succeeded',
      payment_method_type: paymentMethod,
      selected_payment_method: paymentMethod,
      raw_webhook_payload: {
        source: 'quick_manual_sale',
        processor: procConfig.processor_type,
        recordedAt,
        offerId: input.offerId || null,
      },
    });

    await phase2EvidenceRepository.create({
      location_id: input.locationId,
      contact_id: contactId,
      enrollment_id: enrollmentId || undefined,
      merchant_id: merchant.id,
      evidence_type: 'enrollment_payment',
      data: {
        amount: input.amount,
        payment_type: paymentType,
        transaction_id: charge.transactionId || charge.chargeId || '',
        source: 'quick_manual_sale',
        processor: procConfig.processor_type,
        card_brand: saveResult.cardBrand,
        card_last_four: saveResult.cardLastFour,
        timestamp: recordedAt,
      },
    });

    if (!paymentProcessing && offer && input.sendEnrollment !== false) {
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
        logger.warn({ err: err.message, contactId }, 'Quick manual sale contact field sync failed');
      }

      await triggerService.fireTrigger(input.locationId, 'ss_send_enrollment_link', {
        event_type: 'send_enrollment_link',
        location_id: input.locationId,
        locationId: input.locationId,
        contact_id: contactId,
        contactId,
        enrollment_id: enrollmentId,
        enrollmentId,
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
        payment_source: 'quick_manual_sale',
        paymentSource: 'quick_manual_sale',
        payment_timing: 'before_enrollment',
        paymentTiming: 'before_enrollment',
        enrollment_status: 'paid_pending_enrollment',
        enrollmentStatus: 'paid_pending_enrollment',
        send_welcome: false,
        sendWelcome: false,
        amount: input.amount,
        send_via: input.sendVia || ['email'],
        sendVia: input.sendVia || ['email'],
        first_name: name.firstName || '',
        firstName: name.firstName || '',
        last_name: name.lastName || '',
        lastName: name.lastName || '',
        email: input.email,
        phone: input.phone || '',
      });
    }

    if (!paymentProcessing) await triggerService.fireTrigger(input.locationId, 'ss_payment_received', {
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
      transaction_id: charge.transactionId || charge.chargeId || '',
      transactionId: charge.transactionId || charge.chargeId || '',
      payment_kind: offer ? paymentType : 'manual_sale',
      paymentKind: offer ? paymentType : 'manual_sale',
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
    });

    return {
      success: true,
      contactId,
      enrollmentId,
      enrollmentUrl,
      status: paymentProcessing ? 'payment_processing' : (offer ? 'paid_pending_enrollment' : 'paid_client_payment'),
      paymentStatus: paymentProcessing ? 'processing' : 'succeeded',
      paymentMethod,
      transactionId: charge.transactionId || charge.chargeId || '',
      processorType: procConfig.processor_type,
      cardLastFour: saveResult.cardLastFour,
      cardBrand: saveResult.cardBrand,
    };
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

    const enrollmentUrl = await buildEnrollmentUrl(input.locationId, input.offerId);
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

    let processorSubscriptionId = '';
    let billingSetupIssue: { code: string; message: string } | null = null;
    if (offer && ['installment', 'subscription'].includes(paymentType) && nextBillingDate) {
      try {
        const processorType = String(enrollment.processor_type || '').toLowerCase() as ProcessorType;
        if (processorType !== 'nmi' && processorType !== 'stripe') {
          throw new Error('Missing processor for paid pending enrollment');
        }
        const card = await findSavedCardForProcessor(params.locationId, enrollment.contact_id, processorType);
        if (!card) throw new Error('No saved card found for recurring setup');
        const { config: procConfig } = await resolveProcessor(enrollment.merchant_id, params.locationId, {
          processor_override: processorType,
          nmi_processor_id: offer.nmi_processor_id || null,
        });
        const processor = createProcessorClient(procConfig);
        const recurringAmount = paymentType === 'subscription'
          ? Number(offer.price || offer.installment_amount || 0)
          : Number(offer.installment_amount || offer.price || 0);
        const remainingPayments = paymentType === 'subscription'
          ? 0
          : Math.max(0, Number(enrollment.payments_total || 0) - Number(enrollment.payments_made || 1));

        if (recurringAmount > 0 && (paymentType === 'subscription' || remainingPayments > 0)) {
          const subResult = await processor.createSubscription({
            paymentMethodId: card.stripe_payment_method_id || card.nmi_customer_vault_id,
            customerId: card.stripe_customer_id || card.nmi_customer_vault_id,
            planAmount: dollarsToCents(recurringAmount),
            interval: processorInterval(offer.installment_frequency),
            totalPayments: remainingPayments,
            startDate: nextBillingDate,
            description: offer.offer_name || 'ScaleSafe Recurring Plan',
            metadata: {
              enrollment_id: params.enrollmentId,
              offer_id: enrollment.offer_id || '',
              contact_id: enrollment.contact_id || '',
              location_id: params.locationId,
              payment_type: paymentType,
            },
          });
          if (subResult.success && subResult.subscriptionId) {
            processorSubscriptionId = subResult.subscriptionId;
            const { error: subSaveError } = await supabase
              .from('enrollments')
              .update({ processor_subscription_id: subResult.subscriptionId, processor_type: procConfig.processor_type })
              .eq('id', params.enrollmentId)
              .eq('location_id', params.locationId);
            if (subSaveError) throw subSaveError;
          } else {
            throw new Error(subResult.errorMessage || 'Processor subscription creation failed');
          }
        }
      } catch (err: any) {
        billingSetupIssue = {
          code: 'recurring_setup_failed_after_paid_enrollment',
          message: err?.message || 'Recurring billing setup failed after enrollment consent.',
        };
        logger.error({ err: err?.message || String(err), enrollmentId: params.enrollmentId }, 'Paid pending recurring setup failed');
      }
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
