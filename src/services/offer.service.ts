import { ghlApi } from '../clients/ghl.client';
import { offerRepository, OfferRecord } from '../repositories/offer.repository';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

interface CreateOfferInput {
  locationId: string;
  offerName: string;
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
  pulseCadenceEnabled?: boolean;
  pulseFrequencyDays?: number;
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

function isOfferConstraintError(err: any): boolean {
  return err?.code === '23514'
    && String(err?.message || '').includes('offers_mirror_installment_frequency_check');
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

function stripCompatibilityFields(record: Record<string, unknown>, err: any): Record<string, unknown> {
  let next = record;
  if (isMissingPulseCadenceColumnError(err)) next = stripPulseCadenceFields(next);
  if (isMissingTrackingColumnError(err)) next = stripTrackingFields(next);
  return next;
}

function isDailyGhlRecurringPriceError(err: any): boolean {
  const message = String(err?.message || err?.response?.data?.message || '');
  const details = JSON.stringify(err?.response?.data || err?.data || {});
  return message.toLowerCase().includes('ghl api error')
    || details.toLowerCase().includes('interval')
    || details.toLowerCase().includes('recurring');
}

export const offerService = {
  async create(input: CreateOfferInput): Promise<OfferRecord> {
    const { locationId } = input;

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
      refund_policy_type: input.refundPolicyType || null,
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
      if (isMissingPulseCadenceColumnError(err) || isMissingTrackingColumnError(err)) {
        logger.warn({ locationId, err: err?.message }, 'Offer create retried without optional offer fields; apply latest migrations');
        try {
          offer = await offerRepository.create(stripCompatibilityFields(record, err) as any);
        } catch (retryErr: any) {
          if (isOfferConstraintError(retryErr)) {
            logger.warn({ locationId, installmentFrequency: input.installmentFrequency }, 'Offer create retry rejected by installment frequency constraint');
            throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    logger.info({ offerId: offer.id, ghlProductId, locationId }, 'Offer created');
    return offer;
  },

  async update(offerId: string, updates: Partial<CreateOfferInput>): Promise<OfferRecord> {
    const existing = await offerRepository.getById(offerId);
    const dbUpdates: Record<string, unknown> = {};

    // Auto-calculate installment amount
    const effectivePrice = updates.price ?? existing.price;
    const effectiveNumPayments = updates.numPayments ?? existing.num_payments;
    const effectivePaymentType = updates.paymentType ?? existing.payment_type;

    if (effectivePaymentType === 'installments') {
      const calcAmount = calcInstallmentAmount(effectivePrice as number, effectiveNumPayments as number);
      if (calcAmount) dbUpdates.installment_amount = calcAmount;
    }

    if ((updates as any).active !== undefined) dbUpdates.active = (updates as any).active;
    if (updates.offerName !== undefined) dbUpdates.offer_name = updates.offerName;
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
    if (updates.refundPolicyType !== undefined) dbUpdates.refund_policy_type = updates.refundPolicyType;
    if (updates.refundPolicyDays !== undefined) dbUpdates.refund_policy_days = updates.refundPolicyDays;
    if (updates.tcUrl !== undefined) dbUpdates.tc_url = updates.tcUrl || null;
    if (updates.checkoutMode !== undefined) dbUpdates.checkout_mode = updates.checkoutMode;
    if (updates.quickCheckoutConsentText !== undefined) dbUpdates.quick_checkout_consent_text = updates.quickCheckoutConsentText || null;
    if (updates.quickCheckoutShowDescription !== undefined) dbUpdates.quick_checkout_show_description = updates.quickCheckoutShowDescription;
    if (updates.quickCheckoutShowRefundPolicy !== undefined) dbUpdates.quick_checkout_show_refund_policy = updates.quickCheckoutShowRefundPolicy;
    if (updates.processorOverride !== undefined) dbUpdates.processor_override = updates.processorOverride || null;
    if (updates.nmiProcessorId !== undefined) dbUpdates.nmi_processor_id = updates.nmiProcessorId || null;
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
      offer = await offerRepository.update(offerId, dbUpdates as any);
    } catch (err: any) {
      if (isOfferConstraintError(err)) {
        logger.warn({ offerId, installmentFrequency: updates.installmentFrequency }, 'Offer update rejected by installment frequency constraint');
        throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
      }
      if (isMissingPulseCadenceColumnError(err) || isMissingTrackingColumnError(err)) {
        logger.warn({ offerId, err: err?.message }, 'Offer update retried without optional offer fields; apply latest migrations');
        try {
          offer = await offerRepository.update(offerId, stripCompatibilityFields(dbUpdates, err) as any);
        } catch (retryErr: any) {
          if (isOfferConstraintError(retryErr)) {
            logger.warn({ offerId, installmentFrequency: updates.installmentFrequency }, 'Offer update retry rejected by installment frequency constraint');
            throw new ValidationError('Unsupported installment frequency. Apply the latest daily billing test migration, then try again.');
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
    return offer;
  },

  async getById(offerId: string): Promise<OfferRecord> {
    return offerRepository.getById(offerId);
  },

  async listByLocation(locationId: string): Promise<OfferRecord[]> {
    return offerRepository.listByLocation(locationId);
  },

  async delete(offerId: string): Promise<void> {
    return offerRepository.delete(offerId);
  },

  generateEnrollmentLink(offerId: string, appBaseUrl: string, checkoutMode?: string, funnelBaseUrl?: string): string {
    if (checkoutMode === 'quick_checkout') {
      // Quick checkout is hosted on Railway, not the GHL funnel
      return `${appBaseUrl}/quick-checkout?offerId=${offerId}`;
    }
    // Full enrollment funnel lives in GHL — use the merchant's funnel domain
    if (funnelBaseUrl) {
      const cleanUrl = funnelBaseUrl.replace(/\/+$/, '');
      return `${cleanUrl}/welcome?offerId=${offerId}`;
    }
    // Fallback to app URL if no funnel URL configured
    return `${appBaseUrl}/enrollment?offerId=${offerId}`;
  },

  async cloneOffer(offerId: string, locationId: string): Promise<OfferRecord> {
    const source = await offerRepository.getById(offerId);

    // Verify ownership
    if (source.location_id !== locationId) {
      throw new Error('Offer not found');
    }

    // Copy all fields except IDs and metadata
    const clone: Record<string, unknown> = {};
    const skipKeys = new Set([
      'id', 'ghl_product_id', 'ghl_price_ids', 'ghl_custom_object_id',
      'created_at', 'updated_at', 'redirect_slug',
    ]);

    for (const [key, value] of Object.entries(source)) {
      if (!skipKeys.has(key)) {
        clone[key] = value;
      }
    }

    clone.offer_name = `${source.offer_name} (Copy)`;
    clone.ghl_product_id = null;
    clone.ghl_price_ids = {};
    clone.ghl_custom_object_id = null;
    clone.active = false;

    const newOffer = await offerRepository.create(clone as any);
    logger.info({ sourceId: offerId, cloneId: newOffer.id, locationId }, 'Offer cloned');
    return newOffer;
  },
};

export { compileTcHtml, calcInstallmentAmount, buildRefundText };
