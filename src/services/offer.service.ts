import { ghlApi } from '../clients/ghl.client';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { offerRepository, OfferRecord } from '../repositories/offer.repository';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { whopService } from './whop.service';
import { checkoutCartService, CheckoutAddonInput } from './checkout-cart.service';

interface CreateOfferInput {
  locationId: string;
  active?: boolean;
  offerName: string;
  internalName?: string;
  trackingId?: string;
  programDescription?: string;
  deliveryMethod?: string;
  price?: number;
  paymentType?: 'one_time' | 'installments' | 'subscription';
  installmentAmount?: number;
  installmentFrequency?: 'daily' | 'weekly' | 'bi_weekly' | 'monthly' | 'quarterly' | 'annual';
  numPayments?: number;
  pifPrice?: number;
  pifDiscountEnabled?: boolean;
  programDurationValue?: number;
  programDurationUnit?: 'weeks' | 'months';
  autoCompleteOnDurationEnd?: boolean;
  refundPolicyType?: 'no_refunds' | 'full_refund' | 'prorated' | 'custom';
  refundPolicyDays?: number;
  refundWindowText?: string;
  tcUrl?: string;
  // 11 clause slots: slots 1-9 = standard clauses, 10-11 = custom clauses
  clauses?: Array<{ title: string; text: string }>;
  milestones?: Array<{ name: string; delivers: string; clientDoes: string }>;
  // Light checkout mode (Phase J)
  checkoutMode?: 'full_enrollment' | 'quick_checkout';
  quickCheckoutConsentText?: string;
  quickCheckoutShowDescription?: boolean;
  quickCheckoutShowRefundPolicy?: boolean;
  // Per-offer processor selection
  processorOverride?: 'nmi' | 'stripe' | null;
  nmiProcessorId?: string | null;
  checkoutType?: 'direct' | 'whop';
  dualPricingEnabled?: boolean;
  achEnabled?: boolean;
  achAccessPolicy?: 'after_settlement' | 'after_submission';
  botProtectionPolicy?: 'default' | 'off' | 'required';
  pulseCadenceEnabled?: boolean;
  pulseFrequencyDays?: number;
  checkoutAddons?: CheckoutAddonInput[];
}

function extractId(data: any, objectKey?: string): string {
  if (!data) return '';
  if (objectKey && data[objectKey]) {
    return data[objectKey]._id || data[objectKey].id || '';
  }
  return data._id || data.id || '';
}

/**
 * Auto-calculate installment amount from price and numPayments.
 */
function calcInstallmentAmount(price?: number, numPayments?: number, fallback?: number): number | undefined {
  if (price && numPayments && numPayments > 0) {
    return Math.round((price / numPayments) * 100) / 100;
  }
  return fallback;
}

/**
 * Compile T&C HTML from the clause slots on the offer.
 * Takes the 11 clause slots and builds an ordered list of active clauses.
 */
function compileTcHtml(clauses: Array<{ title: string; text: string }>, tcUrl?: string): string {
  const sections: string[] = [];

  // If merchant has their own T&C, include the link
  if (tcUrl) {
    sections.push(`<p>Full Terms & Conditions: <a href="${escapeHtml(tcUrl)}" target="_blank">${escapeHtml(tcUrl)}</a></p>`);
  }

  // Always include active clickwrap clauses
  const items: string[] = [];
  for (const c of clauses) {
    if (c.title && c.text) {
      items.push(`<li>${escapeHtml(c.text)}</li>`);
    }
  }
  if (items.length > 0) {
    sections.push(`<p><strong>By proceeding, you acknowledge and agree to the following:</strong></p>\n<ol>\n${items.join('\n')}\n</ol>`);
  }

  return sections.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build refund_window_text from the structured refund policy fields.
 */
function buildRefundText(type?: string, days?: number, customText?: string): string {
  switch (type) {
    case 'no_refunds': return 'No refunds.';
    case 'full_refund': return `Full refund within ${days || 0} days of purchase.`;
    case 'prorated': return 'Prorated refund based on services delivered.';
    case 'custom': return customText || '';
    default: return customText || '';
  }
}

function normalizePulseFrequency(days?: number): number {
  const parsed = Number(days || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeEnrollmentFunnelBaseUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname && pathname !== '/' ? pathname : ''}`;
  } catch {
    return '';
  }
}

function isOfferConstraintError(err: any): boolean {
  return err?.code === '23514'
    && String(err?.message || '').includes('offers_mirror_installment_frequency_check');
}

function isRefundPolicyConstraintError(err: any): boolean {
  return err?.code === '23514'
    && String(err?.message || '').includes('offers_mirror_refund_policy_type_check');
}

function isMissingPulseCadenceColumnError(err: any): boolean {
  const message = String(err?.message || '');
  return err?.code === '42703'
    && (message.includes('pulse_cadence_enabled') || message.includes('pulse_frequency_days'));
}

function isMissingTrackingColumnError(err: any): boolean {
  const message = String(err?.message || '');
  return (err?.code === '42703' || err?.code === 'PGRST204')
    && message.includes('tracking_id');
}

function isMissingDualPricingColumnError(err: any): boolean {
  const message = String(err?.message || '');
  return (err?.code === '42703' || err?.code === 'PGRST204')
    && (
      message.includes('dual_pricing_enabled')
      || message.includes('ach_enabled')
      || message.includes('dual_pricing_control_id')
      || message.includes('ach_access_policy')
    );
}

function isMissingCheckoutChannelColumnError(err: any): boolean {
  const message = String(err?.message || '');
  return (err?.code === '42703' || err?.code === 'PGRST204')
    && (
      message.includes('checkout_type')
      || message.includes('whop_product_id')
      || message.includes('whop_plan_id')
      || message.includes('whop_sync_status')
      || message.includes('whop_sync_error')
      || message.includes('whop_last_synced_at')
    );
}

function isMissingBotProtectionColumnError(err: any): boolean {
  const message = String(err?.message || '');
  return (err?.code === '42703' || err?.code === 'PGRST204')
    && message.includes('bot_protection_policy');
}

function stripPulseCadenceFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.pulse_cadence_enabled;
  delete next.pulse_frequency_days;
  return next;
}

function stripTrackingFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.tracking_id;
  return next;
}

function stripDualPricingFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.dual_pricing_enabled;
  delete next.ach_enabled;
  delete next.ach_access_policy;
  return next;
}

function stripCheckoutChannelFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.checkout_type;
  delete next.whop_product_id;
  delete next.whop_plan_id;
  delete next.whop_sync_status;
  delete next.whop_sync_error;
  delete next.whop_last_synced_at;
  return next;
}

function stripBotProtectionFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.bot_protection_policy;
  return next;
}

function stripCompatibilityFields(record: Record<string, unknown>, err: any): Record<string, unknown> {
  let next = record;
  if (isMissingPulseCadenceColumnError(err)) next = stripPulseCadenceFields(next);
  if (isMissingTrackingColumnError(err)) next = stripTrackingFields(next);
  if (isMissingDualPricingColumnError(err)) next = stripDualPricingFields(next);
  if (isMissingCheckoutChannelColumnError(err)) next = stripCheckoutChannelFields(next);
  if (isMissingBotProtectionColumnError(err)) next = stripBotProtectionFields(next);
  return next;
}

function normalizeBotProtectionPolicy(value: unknown): 'default' | 'off' | 'required' {
  return value === 'off' || value === 'required' ? value : 'default';
}

function isDailyGhlRecurringPriceError(err: any): boolean {
  const message = String(err?.message || err?.response?.data?.message || '');
  const details = JSON.stringify(err?.response?.data || err?.data || {});
  return message.toLowerCase().includes('ghl api error')
    || details.toLowerCase().includes('interval')
    || details.toLowerCase().includes('recurring');
}

export const offerService = {
  async withCheckoutAddons<T extends OfferRecord | OfferRecord[]>(offerOrOffers: T): Promise<T> {
    const offers = Array.isArray(offerOrOffers) ? offerOrOffers : [offerOrOffers];
    await Promise.all(offers.map(async (offer: any) => {
      offer.checkout_addons = await checkoutCartService.listAddons(offer.id, offer.location_id, false);
      offer.checkoutAddons = offer.checkout_addons;
    }));
    return offerOrOffers;
  },

  async create(input: CreateOfferInput): Promise<OfferRecord> {
    const { locationId } = input;
    const customerFacingName = input.offerName?.trim();
    if (!customerFacingName) {
      throw new ValidationError('Client-facing program name is required.');
    }
    input.offerName = customerFacingName;
    const internalName = input.internalName?.trim() || customerFacingName;

    // Auto-calculate installment amount
    if (input.paymentType === 'installments') {
      input.installmentAmount = calcInstallmentAmount(input.price, input.numPayments, input.installmentAmount);
    } else if (input.paymentType === 'subscription' && input.installmentAmount === undefined) {
      input.installmentAmount = input.price;
    }

    // 1. Create GHL Product
    const api = await ghlApi(locationId);
    const productRes = await api.post('/products/', {
      name: input.offerName,
      locationId,
      productType: 'DIGITAL',
      description: input.programDescription || '',
    });
    const ghlProductId = extractId(productRes.data, 'product');
    logger.info({ locationId, ghlProductId, responseKeys: Object.keys(productRes.data) }, 'GHL Product created');

    if (!ghlProductId) {
      throw new Error(`GHL Product creation returned no ID. Response: ${JSON.stringify(productRes.data).slice(0, 200)}`);
    }

    // 2. Create GHL Prices
    const priceIds: Record<string, string> = {};

    if (input.paymentType === 'one_time' || (input.pifDiscountEnabled && input.pifPrice)) {
      const amount = input.paymentType === 'one_time'
        ? (input.price || 0)
        : (input.pifPrice || input.price || 0);
      const priceRes = await api.post(`/products/${ghlProductId}/price`, {
        name: `${input.offerName} - Pay in Full`,
        type: 'one_time',
        currency: 'USD',
        amount: Math.round(amount * 100),
        locationId,
      });
      priceIds.one_time = extractId(priceRes.data, 'price');
    }

    if (input.paymentType === 'installments' && input.installmentAmount && input.numPayments) {
      const intervalMap: Record<string, string> = {
        daily: 'day',
        weekly: 'week',
        bi_weekly: 'week',
        monthly: 'month',
        quarterly: 'month',
        annual: 'year',
      };
      const intervalCountMap: Record<string, number> = {
        daily: 1,
        weekly: 1,
        bi_weekly: 2,
        monthly: 1,
        quarterly: 3,
        annual: 1,
      };
      const freq = input.installmentFrequency || 'monthly';

      try {
        const priceRes = await api.post(`/products/${ghlProductId}/price`, {
          name: `${input.offerName} - Installments`,
          type: 'recurring',
          currency: 'USD',
          amount: Math.round(input.installmentAmount * 100),
          locationId,
          recurring: {
            interval: intervalMap[freq],
            intervalCount: intervalCountMap[freq],
            totalCycles: input.numPayments,
          },
        });
        priceIds.recurring = extractId(priceRes.data, 'price');
      } catch (err: any) {
        if (freq === 'daily' && isDailyGhlRecurringPriceError(err)) {
          logger.warn(
            { locationId, ghlProductId, offerName: input.offerName, err: err?.message },
            'Skipping GHL recurring price for daily test offer; ScaleSafe checkout uses the offer record',
          );
        } else {
          throw err;
        }
      }
    }

    // 3. Compile T&C HTML
    const clauses = input.clauses || [];
    const compiledHtml = compileTcHtml(clauses, input.tcUrl);

    // 4. Build refund text
    const refundText = buildRefundText(input.refundPolicyType, input.refundPolicyDays, input.refundWindowText);

    // 5. Build Supabase record
    const record: Record<string, unknown> = {
      location_id: locationId,
      ghl_product_id: ghlProductId,
      ghl_price_ids: priceIds,
      offer_name: input.offerName,
      internal_name: internalName,
      tracking_id: input.trackingId?.trim() || null,
      program_description: input.programDescription,
      delivery_method: input.deliveryMethod,
      price: input.price,
      payment_type: input.paymentType || null,
      installment_amount: input.installmentAmount,
      installment_frequency: input.installmentFrequency || null,
      num_payments: input.numPayments,
      pif_price: input.pifPrice,
      pif_discount_enabled: input.pifDiscountEnabled || false,
      program_duration_value: input.programDurationValue || null,
      program_duration_unit: input.programDurationUnit || null,
      auto_complete_on_duration_end: input.autoCompleteOnDurationEnd ?? false,
      refund_policy_type: normalizeNullableText(input.refundPolicyType),
      refund_policy_days: input.refundPolicyDays || null,
      refund_window_text: refundText,
      tc_url: input.tcUrl || null,
      compiled_tc_html: compiledHtml,
      checkout_mode: input.checkoutMode || 'full_enrollment',
      quick_checkout_consent_text: input.quickCheckoutConsentText || null,
      quick_checkout_show_description: input.quickCheckoutShowDescription ?? true,
      quick_checkout_show_refund_policy: input.quickCheckoutShowRefundPolicy ?? true,
      processor_override: input.processorOverride || null,
      nmi_processor_id: input.nmiProcessorId || null,
      checkout_type: input.checkoutType || 'direct',
      dual_pricing_enabled: input.dualPricingEnabled === true,
      ach_enabled: input.achEnabled === true,
      ach_access_policy: input.achAccessPolicy || 'after_settlement',
      bot_protection_policy: normalizeBotProtectionPolicy(input.botProtectionPolicy),
      pulse_cadence_enabled: input.pulseCadenceEnabled ?? (input.checkoutMode !== 'quick_checkout'),
      pulse_frequency_days: normalizePulseFrequency(input.pulseFrequencyDays),
    };

    // Map clause slots 1-11 directly
    if (clauses.length > 0) {
      clauses.forEach((c, i) => {
        if (i < 11) {
          record[`clause_slot_${i + 1}_title`] = c.title || null;
          record[`clause_slot_${i + 1}_text`] = c.text || null;
        }
      });
    }

    // Map milestones (up to 8)
    if (input.milestones) {
      input.milestones.forEach((m, i) => {
        if (i < 8) {
          record[`m${i + 1}_name`] = m.name;
          record[`m${i + 1}_delivers`] = m.delivers;
          record[`m${i + 1}_client_does`] = m.clientDoes;
        }
      });
    }

    // 6. Save to Supabase
    let offer: OfferRecord;
    try {
      offer = await offerRepository.create(record as any);
    } catch (err: any) {
      if (isOfferConstraintError(err)) {
        logger.warn({ locationId, installmentFrequency: input.installmentFrequency }, 'Offer create rejected by installment frequency constraint');
        throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
      }
      if (isRefundPolicyConstraintError(err)) {
        throw new ValidationError('Refund policy is invalid. Choose a refund policy or leave it blank.');
      }
      if (
        isMissingPulseCadenceColumnError(err)
        || isMissingTrackingColumnError(err)
        || isMissingDualPricingColumnError(err)
        || isMissingCheckoutChannelColumnError(err)
        || isMissingBotProtectionColumnError(err)
      ) {
        if ((input.checkoutType || 'direct') === 'whop' && isMissingCheckoutChannelColumnError(err)) {
          throw new ValidationError('Whop checkout columns are not ready. Apply migration 071_whop_checkout_channel.sql, then try again.');
        }
        logger.warn({ locationId, err: err?.message }, 'Offer create retried without optional offer fields; apply latest migrations');
        try {
          offer = await offerRepository.create(stripCompatibilityFields(record, err) as any);
        } catch (retryErr: any) {
          if (isOfferConstraintError(retryErr)) {
            logger.warn({ locationId, installmentFrequency: input.installmentFrequency }, 'Offer create retry rejected by installment frequency constraint');
            throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
          }
          if (isRefundPolicyConstraintError(retryErr)) {
            throw new ValidationError('Refund policy is invalid. Choose a refund policy or leave it blank.');
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    logger.info({ offerId: offer.id, ghlProductId, locationId }, 'Offer created');
    if (input.checkoutAddons !== undefined) {
      await checkoutCartService.replaceOfferAddons(locationId, offer.id, input.checkoutAddons);
    }
    if ((input.checkoutType || 'direct') === 'whop') {
      offer = await whopService.syncOffer(locationId, offer);
      logger.info({ offerId: offer.id, whopProductId: offer.whop_product_id, whopPlanId: offer.whop_plan_id }, 'Whop offer synced');
    }
    return this.withCheckoutAddons(offer);
  },

  async update(offerId: string, locationId: string, updates: Partial<CreateOfferInput>): Promise<OfferRecord> {
    const existing = await offerRepository.getById(offerId, locationId);
    const dbUpdates: Record<string, unknown> = {};

    // Auto-calculate installment amount
    const effectivePrice = updates.price ?? existing.price;
    const effectiveNumPayments = updates.numPayments ?? existing.num_payments;
    const effectivePaymentType = updates.paymentType ?? existing.payment_type;

    if (effectivePaymentType === 'installments') {
      const calcAmount = calcInstallmentAmount(effectivePrice as number, effectiveNumPayments as number);
      if (calcAmount) dbUpdates.installment_amount = calcAmount;
    }

    if (updates.active !== undefined) dbUpdates.active = updates.active;
    if (updates.offerName !== undefined) {
      const customerFacingName = updates.offerName.trim();
      if (!customerFacingName) {
        throw new ValidationError('Client-facing program name is required.');
      }
      dbUpdates.offer_name = customerFacingName;
    }
    if (updates.internalName !== undefined) {
      dbUpdates.internal_name = updates.internalName.trim()
        || String(dbUpdates.offer_name || existing.offer_name).trim();
    }
    if (updates.trackingId !== undefined) dbUpdates.tracking_id = updates.trackingId?.trim() || null;
    if (updates.programDescription !== undefined) dbUpdates.program_description = updates.programDescription;
    if (updates.deliveryMethod !== undefined) dbUpdates.delivery_method = updates.deliveryMethod;
    if (updates.price !== undefined) dbUpdates.price = updates.price;
    if (updates.paymentType !== undefined) dbUpdates.payment_type = updates.paymentType || null;
    if (updates.installmentFrequency !== undefined) dbUpdates.installment_frequency = updates.installmentFrequency || null;
    if (effectivePaymentType === 'subscription') {
      if (updates.installmentAmount !== undefined) {
        dbUpdates.installment_amount = updates.installmentAmount;
      } else if (updates.price !== undefined && !existing.installment_amount) {
        dbUpdates.installment_amount = updates.price;
      }
    }
    if (updates.numPayments !== undefined) dbUpdates.num_payments = updates.numPayments;
    if (updates.pifPrice !== undefined) dbUpdates.pif_price = updates.pifPrice;
    if (updates.pifDiscountEnabled !== undefined) dbUpdates.pif_discount_enabled = updates.pifDiscountEnabled;
    if (updates.programDurationValue !== undefined) dbUpdates.program_duration_value = updates.programDurationValue;
    if (updates.programDurationUnit !== undefined) dbUpdates.program_duration_unit = updates.programDurationUnit;
    if (updates.autoCompleteOnDurationEnd !== undefined) dbUpdates.auto_complete_on_duration_end = updates.autoCompleteOnDurationEnd;
    if (updates.refundPolicyType !== undefined) dbUpdates.refund_policy_type = normalizeNullableText(updates.refundPolicyType);
    if (updates.refundPolicyDays !== undefined) dbUpdates.refund_policy_days = updates.refundPolicyDays;
    if (updates.tcUrl !== undefined) dbUpdates.tc_url = updates.tcUrl || null;
    if (updates.checkoutMode !== undefined) dbUpdates.checkout_mode = updates.checkoutMode;
    if (updates.quickCheckoutConsentText !== undefined) dbUpdates.quick_checkout_consent_text = updates.quickCheckoutConsentText || null;
    if (updates.quickCheckoutShowDescription !== undefined) dbUpdates.quick_checkout_show_description = updates.quickCheckoutShowDescription;
    if (updates.quickCheckoutShowRefundPolicy !== undefined) dbUpdates.quick_checkout_show_refund_policy = updates.quickCheckoutShowRefundPolicy;
    if (updates.processorOverride !== undefined) dbUpdates.processor_override = updates.processorOverride || null;
    if (updates.nmiProcessorId !== undefined) dbUpdates.nmi_processor_id = updates.nmiProcessorId || null;
    if (updates.checkoutType !== undefined) {
      dbUpdates.checkout_type = updates.checkoutType || 'direct';
      if (updates.checkoutType === 'whop') {
        dbUpdates.processor_override = null;
        dbUpdates.nmi_processor_id = null;
        dbUpdates.dual_pricing_enabled = false;
        dbUpdates.ach_enabled = false;
      }
    }
    if (updates.dualPricingEnabled !== undefined) dbUpdates.dual_pricing_enabled = updates.dualPricingEnabled === true;
    if (updates.achEnabled !== undefined) dbUpdates.ach_enabled = updates.achEnabled === true;
    if (updates.achAccessPolicy !== undefined) dbUpdates.ach_access_policy = updates.achAccessPolicy || 'after_settlement';
    if (updates.botProtectionPolicy !== undefined) dbUpdates.bot_protection_policy = normalizeBotProtectionPolicy(updates.botProtectionPolicy);
    if (updates.pulseCadenceEnabled !== undefined) dbUpdates.pulse_cadence_enabled = updates.pulseCadenceEnabled;
    if (updates.pulseFrequencyDays !== undefined) dbUpdates.pulse_frequency_days = normalizePulseFrequency(updates.pulseFrequencyDays);

    // Refund text
    if (updates.refundPolicyType !== undefined) {
      dbUpdates.refund_window_text = buildRefundText(
        updates.refundPolicyType,
        updates.refundPolicyDays ?? existing.refund_policy_days ?? undefined,
        updates.refundWindowText,
      );
    } else if (updates.refundWindowText !== undefined) {
      dbUpdates.refund_window_text = updates.refundWindowText;
    }

    // Clause slots + compiled HTML
    if (updates.clauses) {
      const compiledHtml = compileTcHtml(updates.clauses, updates.tcUrl ?? (existing as any).tc_url);
      dbUpdates.compiled_tc_html = compiledHtml;

      updates.clauses.forEach((c, i) => {
        if (i < 11) {
          dbUpdates[`clause_slot_${i + 1}_title`] = c.title || null;
          dbUpdates[`clause_slot_${i + 1}_text`] = c.text || null;
        }
      });
    }

    if (updates.milestones) {
      updates.milestones.forEach((m, i) => {
        if (i < 8) {
          dbUpdates[`m${i + 1}_name`] = m.name;
          dbUpdates[`m${i + 1}_delivers`] = m.delivers;
          dbUpdates[`m${i + 1}_client_does`] = m.clientDoes;
        }
      });
    }

    let offer: OfferRecord;
    try {
      offer = await offerRepository.update(offerId, dbUpdates as any, locationId);
    } catch (err: any) {
      const updateContext = {
        offerId,
        locationId,
        checkoutMode: updates.checkoutMode,
        checkoutType: updates.checkoutType,
        processorOverride: updates.processorOverride,
        nmiProcessorId: updates.nmiProcessorId,
        dualPricingEnabled: updates.dualPricingEnabled,
        achEnabled: updates.achEnabled,
        achAccessPolicy: updates.achAccessPolicy,
        errorMessage: err?.message,
        errorCode: err?.code,
        errorDetails: err?.details,
        errorHint: err?.hint,
        dbColumns: Object.keys(dbUpdates),
      };
      logger.error(updateContext, 'Offer update failed');
      if (isOfferConstraintError(err)) {
        logger.warn({ offerId, installmentFrequency: updates.installmentFrequency }, 'Offer update rejected by installment frequency constraint');
        throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
      }
      if (isRefundPolicyConstraintError(err)) {
        throw new ValidationError('Refund policy is invalid. Choose a refund policy or leave it blank.');
      }
      if (
        isMissingPulseCadenceColumnError(err)
        || isMissingTrackingColumnError(err)
        || isMissingDualPricingColumnError(err)
        || isMissingCheckoutChannelColumnError(err)
        || isMissingBotProtectionColumnError(err)
      ) {
        if ((updates.checkoutType || 'direct') === 'whop' && isMissingCheckoutChannelColumnError(err)) {
          throw new ValidationError('Whop checkout columns are not ready. Apply migration 071_whop_checkout_channel.sql, then try again.');
        }
        logger.warn(updateContext, 'Offer update retried without optional offer fields; apply latest migrations');
        try {
          offer = await offerRepository.update(offerId, stripCompatibilityFields(dbUpdates, err) as any, locationId);
        } catch (retryErr: any) {
          logger.error({
            ...updateContext,
            retryErrorMessage: retryErr?.message,
            retryErrorCode: retryErr?.code,
            retryErrorDetails: retryErr?.details,
            retryErrorHint: retryErr?.hint,
          }, 'Offer update compatibility retry failed');
          if (isOfferConstraintError(retryErr)) {
            logger.warn({ offerId, installmentFrequency: updates.installmentFrequency }, 'Offer update retry rejected by installment frequency constraint');
            throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
          }
          if (isRefundPolicyConstraintError(retryErr)) {
            throw new ValidationError('Refund policy is invalid. Choose a refund policy or leave it blank.');
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
    const effectiveCheckoutType = (updates.checkoutType || (offer as any).checkout_type || 'direct') as 'direct' | 'whop';
    if (updates.active === false || updates.pulseCadenceEnabled === false) {
      const disabledEnrollments = await enrollmentRepository.disablePulseCadenceForOffer(locationId, offer.id);
      logger.info(
        { offerId: offer.id, locationId, disabledEnrollments },
        updates.active === false
          ? 'Offer archived; active enrollment pulse cadences disabled'
          : 'Offer pulse cadence disabled; active enrollment pulse cadences disabled',
      );
    }
    if (updates.checkoutAddons !== undefined) {
      await checkoutCartService.replaceOfferAddons(locationId, offer.id, updates.checkoutAddons);
    }
    if (effectiveCheckoutType === 'whop') {
      offer = await whopService.syncOffer(locationId, offer);
      logger.info({ offerId: offer.id, whopProductId: offer.whop_product_id, whopPlanId: offer.whop_plan_id }, 'Whop offer synced after update');
    }
    return this.withCheckoutAddons(offer);
  },

  async getById(offerId: string, locationId?: string): Promise<OfferRecord> {
    return this.withCheckoutAddons(await offerRepository.getById(offerId, locationId));
  },

  async listByLocation(locationId: string): Promise<OfferRecord[]> {
    return this.withCheckoutAddons(await offerRepository.listByLocation(locationId));
  },

  async delete(offerId: string, locationId: string): Promise<void> {
    return offerRepository.delete(offerId, locationId);
  },

  generateEnrollmentLink(offerId: string, appBaseUrl: string, checkoutMode?: string, funnelBaseUrl?: string): string {
    if (checkoutMode === 'quick_checkout') {
      // Quick checkout is hosted on Railway, not the GHL funnel
      return `${appBaseUrl}/quick-checkout?offerId=${offerId}`;
    }
    // Full enrollment funnel lives in GHL — use the merchant's funnel domain
    if (funnelBaseUrl) {
      const cleanUrl = normalizeEnrollmentFunnelBaseUrl(funnelBaseUrl) || funnelBaseUrl.replace(/\/+$/, '');
      return `${cleanUrl}/welcome?offerId=${offerId}`;
    }
    // Fallback to app URL if no funnel URL configured
    return `${appBaseUrl}/enrollment?offerId=${offerId}`;
  },

  async cloneOffer(offerId: string, locationId: string): Promise<OfferRecord> {
    const source = await offerRepository.getById(offerId, locationId);

    // Keep an explicit ownership check even though the repository is scoped.
    // Unit mocks and future data-access changes should not be able to bypass it.
    if (source.location_id !== locationId) {
      throw new Error('Offer not found');
    }

    // Copy all fields except IDs and metadata
    const clone: Record<string, unknown> = {};
    const skipKeys = new Set([
      'id', 'ghl_product_id', 'ghl_price_ids', 'ghl_custom_object_id',
      'created_at', 'updated_at', 'redirect_slug',
      // UI/enrichment-only fields are not columns on offers_mirror.
      'checkout_addons', 'checkoutAddons',
      // #13: processor-side Whop resource IDs must NOT be shared — copying them makes editing
      // the clone mutate the SOURCE's live Whop product/plan and bills clone checkouts against
      // the wrong plan. The clone provisions its own on first sync.
      'whop_product_id', 'whop_plan_id', 'whop_sync_status', 'whop_sync_error', 'whop_last_synced_at',
      // #31: tracking_id must be unique per offer or tracking-id reports conflate the two.
      'tracking_id',
    ]);

    for (const [key, value] of Object.entries(source)) {
      if (!skipKeys.has(key)) {
        clone[key] = value;
      }
    }

    clone.offer_name = source.offer_name;
    clone.internal_name = `${source.internal_name || source.offer_name} (Copy)`;
    clone.ghl_product_id = null;
    clone.ghl_price_ids = {};
    clone.ghl_custom_object_id = null;
    clone.whop_product_id = null;
    clone.whop_plan_id = null;
    clone.whop_sync_status = null;
    clone.tracking_id = null;
    clone.active = false;

    let newOffer: OfferRecord;
    try {
      newOffer = await offerRepository.create(clone as any);
    } catch (err: any) {
      if (isMissingCheckoutChannelColumnError(err)) {
        const strippedClone = stripCheckoutChannelFields(clone);
        try {
          newOffer = await offerRepository.create(strippedClone as any);
        } catch (retryErr: any) {
          logger.error({
            err: retryErr?.message || String(retryErr),
            originalErr: err?.message || String(err),
            code: retryErr?.code,
            details: retryErr?.details,
            hint: retryErr?.hint,
            sourceId: offerId,
            locationId,
            cloneKeys: Object.keys(strippedClone).sort(),
          }, 'Offer clone create retry without checkout-channel fields failed');
          throw new ValidationError(`Offer clone failed: ${retryErr?.message || 'database write failed'}`);
        }
      } else {
        logger.error({
          err: err?.message || String(err),
          code: err?.code,
          details: err?.details,
          hint: err?.hint,
          sourceId: offerId,
          locationId,
          cloneKeys: Object.keys(clone).sort(),
        }, 'Offer clone create failed');
        throw new ValidationError(`Offer clone failed: ${err?.message || 'database write failed'}`);
      }
    }
    const sourceAddons = Array.isArray((source as any).checkoutAddons)
      ? (source as any).checkoutAddons
      : Array.isArray((source as any).checkout_addons)
        ? (source as any).checkout_addons
        : await checkoutCartService.listAddons(source.id, source.location_id, false);
    if (sourceAddons.length > 0) {
      try {
        await checkoutCartService.replaceOfferAddons(locationId, newOffer.id, sourceAddons.map((addon: any, index: number) => ({
          kind: addon.kind,
          title: addon.title,
          description: addon.description || null,
          price: Number(addon.price || 0),
          active: addon.active !== false,
          sortOrder: Number.isFinite(Number(addon.sortOrder ?? addon.sort_order)) ? Number(addon.sortOrder ?? addon.sort_order) : index,
        })));
      } catch (err: any) {
        logger.error({
          err: err?.message || String(err),
          sourceId: offerId,
          cloneId: newOffer.id,
          locationId,
          addonCount: sourceAddons.length,
        }, 'Offer clone add-on copy failed');
        throw err;
      }
    }
    logger.info({ sourceId: offerId, cloneId: newOffer.id, locationId }, 'Offer cloned');
    return this.withCheckoutAddons(newOffer);
  },
};

export { compileTcHtml, calcInstallmentAmount, buildRefundText };
