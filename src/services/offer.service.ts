import { ghlApi } from '../clients/ghl.client';
import { offerRepository, OfferRecord } from '../repositories/offer.repository';
import { logger } from '../utils/logger';
import { STANDARD_CLAUSES } from '../constants/standard-clauses';

interface CreateOfferInput {
  locationId: string;
  offerName: string;
  programDescription?: string;
  deliveryMethod?: string;
  price?: number;
  paymentType?: 'one_time' | 'installments';
  installmentAmount?: number;
  installmentFrequency?: 'weekly' | 'bi_weekly' | 'monthly';
  numPayments?: number;
  pifPrice?: number;
  pifDiscountEnabled?: boolean;
  programDurationValue?: number;
  programDurationUnit?: 'weeks' | 'months';
  refundPolicyType?: 'no_refunds' | 'full_refund' | 'prorated' | 'custom';
  refundPolicyDays?: number;
  refundWindowText?: string;
  tcClauseOverrides?: Record<string, boolean>;
  customClause1Title?: string;
  customClause1Text?: string;
  customClause2Title?: string;
  customClause2Text?: string;
  milestones?: Array<{ name: string; delivers: string; clientDoes: string }>;
  // Merchant config passed from controller for T&C compilation
  merchantTcClauseToggles?: Record<string, boolean>;
  merchantCustomClause1Title?: string;
  merchantCustomClause1Text?: string;
  merchantCustomClause2Title?: string;
  merchantCustomClause2Text?: string;
  merchantTcHasOwn?: boolean;
  merchantTcDocumentUrl?: string;
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
 * Returns the input installmentAmount if price or numPayments not available.
 */
function calcInstallmentAmount(price?: number, numPayments?: number, fallback?: number): number | undefined {
  if (price && numPayments && numPayments > 0) {
    return Math.round((price / numPayments) * 100) / 100;
  }
  return fallback;
}

/**
 * Compile the final T&C HTML for a specific offer.
 * Merges merchant-level T&C defaults with per-offer overrides.
 */
function compileOfferTcHtml(input: CreateOfferInput): string {
  // If merchant has own T&C document, just link to it
  if (input.merchantTcHasOwn && input.merchantTcDocumentUrl) {
    return `<p>Terms & Conditions: <a href="${escapeHtml(input.merchantTcDocumentUrl)}" target="_blank">${escapeHtml(input.merchantTcDocumentUrl)}</a></p>`;
  }

  const merchantToggles = input.merchantTcClauseToggles || {};
  const offerOverrides = input.tcClauseOverrides || {};

  // Merge: offer overrides take precedence over merchant defaults
  const finalToggles: Record<string, boolean> = { ...merchantToggles, ...offerOverrides };

  const clauses: string[] = [];

  for (const clause of STANDARD_CLAUSES) {
    if (finalToggles[clause.key]) {
      clauses.push(`<li>${escapeHtml(clause.text)}</li>`);
    }
  }

  // Custom clauses: per-offer overrides > merchant defaults
  const cc1Title = input.customClause1Title || input.merchantCustomClause1Title || '';
  const cc1Text = input.customClause1Text || input.merchantCustomClause1Text || '';
  const cc2Title = input.customClause2Title || input.merchantCustomClause2Title || '';
  const cc2Text = input.customClause2Text || input.merchantCustomClause2Text || '';

  if (cc1Title && cc1Text) {
    clauses.push(`<li><strong>${escapeHtml(cc1Title)}:</strong> ${escapeHtml(cc1Text)}</li>`);
  }
  if (cc2Title && cc2Text) {
    clauses.push(`<li><strong>${escapeHtml(cc2Title)}:</strong> ${escapeHtml(cc2Text)}</li>`);
  }

  if (clauses.length === 0) return '';

  return `<p><strong>Terms & Conditions</strong></p>\n<p>By proceeding, you acknowledge and agree to the following:</p>\n<ol>\n${clauses.join('\n')}\n</ol>`;
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

export const offerService = {
  async create(input: CreateOfferInput): Promise<OfferRecord> {
    const { locationId } = input;

    // Auto-calculate installment amount
    if (input.paymentType === 'installments') {
      input.installmentAmount = calcInstallmentAmount(input.price, input.numPayments, input.installmentAmount);
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

    // 2. Create GHL Prices on the product
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
      logger.info({ locationId, priceId: priceIds.one_time, amount }, 'GHL PIF price created');
    }

    if (input.paymentType === 'installments' && input.installmentAmount && input.numPayments) {
      const intervalMap: Record<string, string> = {
        weekly: 'week', bi_weekly: 'week', monthly: 'month',
      };
      const intervalCountMap: Record<string, number> = {
        weekly: 1, bi_weekly: 2, monthly: 1,
      };
      const freq = input.installmentFrequency || 'monthly';

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
      logger.info({ locationId, priceId: priceIds.recurring }, 'GHL recurring price created');
    }

    // 3. Compile T&C HTML for this offer
    const compiledTcHtml = compileOfferTcHtml(input);

    // 4. Build refund text
    const refundText = buildRefundText(input.refundPolicyType, input.refundPolicyDays, input.refundWindowText);

    // 5. Build Supabase record
    const record: Record<string, unknown> = {
      location_id: locationId,
      ghl_product_id: ghlProductId,
      ghl_price_ids: priceIds,
      offer_name: input.offerName,
      program_description: input.programDescription,
      delivery_method: input.deliveryMethod,
      price: input.price,
      payment_type: input.paymentType,
      installment_amount: input.installmentAmount,
      installment_frequency: input.installmentFrequency,
      num_payments: input.numPayments,
      pif_price: input.pifPrice,
      pif_discount_enabled: input.pifDiscountEnabled || false,
      program_duration_value: input.programDurationValue || null,
      program_duration_unit: input.programDurationUnit || null,
      refund_policy_type: input.refundPolicyType || null,
      refund_policy_days: input.refundPolicyDays || null,
      refund_window_text: refundText,
      tc_clause_overrides: input.tcClauseOverrides || {},
      compiled_tc_html: compiledTcHtml,
    };

    // Map clause slots (populate from final compiled clauses for CO sync)
    const merchantToggles = input.merchantTcClauseToggles || {};
    const offerOverrides = input.tcClauseOverrides || {};
    const finalToggles = { ...merchantToggles, ...offerOverrides };
    let slotIndex = 0;
    for (const clause of STANDARD_CLAUSES) {
      if (finalToggles[clause.key] && slotIndex < 9) {
        record[`clause_slot_${slotIndex + 1}_title`] = clause.label.replace(' (recommended)', '');
        record[`clause_slot_${slotIndex + 1}_text`] = clause.text;
        slotIndex++;
      }
    }
    // Custom clauses in slots 10-11
    const cc1Title = input.customClause1Title || input.merchantCustomClause1Title || '';
    const cc1Text = input.customClause1Text || input.merchantCustomClause1Text || '';
    const cc2Title = input.customClause2Title || input.merchantCustomClause2Title || '';
    const cc2Text = input.customClause2Text || input.merchantCustomClause2Text || '';
    if (cc1Title) { record.clause_slot_10_title = cc1Title; record.clause_slot_10_text = cc1Text; }
    if (cc2Title) { record.clause_slot_11_title = cc2Title; record.clause_slot_11_text = cc2Text; }

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
    const offer = await offerRepository.create(record as any);

    // 7. Sync to GHL Custom Object (best-effort)
    try {
      await this.syncToGHLCustomObject(locationId, offer);
    } catch (err) {
      logger.warn({ err, offerId: offer.id }, 'Failed to sync offer to GHL Custom Object');
    }

    logger.info({ offerId: offer.id, ghlProductId, locationId }, 'Offer created');
    return offer;
  },

  async update(offerId: string, updates: Partial<CreateOfferInput>): Promise<OfferRecord> {
    const existing = await offerRepository.getById(offerId);
    const dbUpdates: Record<string, unknown> = {};

    // Auto-calculate installment amount on update
    const effectivePrice = updates.price ?? existing.price;
    const effectiveNumPayments = updates.numPayments ?? existing.num_payments;
    const effectivePaymentType = updates.paymentType ?? existing.payment_type;

    if (effectivePaymentType === 'installments') {
      const calcAmount = calcInstallmentAmount(
        effectivePrice as number,
        effectiveNumPayments as number,
      );
      if (calcAmount) dbUpdates.installment_amount = calcAmount;
    }

    if (updates.offerName !== undefined) dbUpdates.offer_name = updates.offerName;
    if (updates.programDescription !== undefined) dbUpdates.program_description = updates.programDescription;
    if (updates.deliveryMethod !== undefined) dbUpdates.delivery_method = updates.deliveryMethod;
    if (updates.price !== undefined) dbUpdates.price = updates.price;
    if (updates.paymentType !== undefined) dbUpdates.payment_type = updates.paymentType;
    if (updates.installmentFrequency !== undefined) dbUpdates.installment_frequency = updates.installmentFrequency;
    if (updates.numPayments !== undefined) dbUpdates.num_payments = updates.numPayments;
    if (updates.pifPrice !== undefined) dbUpdates.pif_price = updates.pifPrice;
    if (updates.pifDiscountEnabled !== undefined) dbUpdates.pif_discount_enabled = updates.pifDiscountEnabled;
    if (updates.programDurationValue !== undefined) dbUpdates.program_duration_value = updates.programDurationValue;
    if (updates.programDurationUnit !== undefined) dbUpdates.program_duration_unit = updates.programDurationUnit;
    if (updates.refundPolicyType !== undefined) dbUpdates.refund_policy_type = updates.refundPolicyType;
    if (updates.refundPolicyDays !== undefined) dbUpdates.refund_policy_days = updates.refundPolicyDays;
    if (updates.tcClauseOverrides !== undefined) dbUpdates.tc_clause_overrides = updates.tcClauseOverrides;

    // Build refund text from structured fields
    if (updates.refundPolicyType !== undefined) {
      dbUpdates.refund_window_text = buildRefundText(
        updates.refundPolicyType,
        updates.refundPolicyDays ?? existing.refund_policy_days ?? undefined,
        updates.refundWindowText,
      );
    } else if (updates.refundWindowText !== undefined) {
      dbUpdates.refund_window_text = updates.refundWindowText;
    }

    // Recompile T&C HTML if clause overrides changed
    if (updates.tcClauseOverrides !== undefined || updates.customClause1Title !== undefined || updates.customClause2Title !== undefined) {
      dbUpdates.compiled_tc_html = compileOfferTcHtml({ ...updates, locationId: existing.location_id } as any);
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

    const offer = await offerRepository.update(offerId, dbUpdates as any);

    try {
      await this.syncToGHLCustomObject(existing.location_id, offer);
    } catch (err) {
      logger.warn({ err, offerId }, 'Failed to sync offer update to GHL Custom Object');
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

  async syncToGHLCustomObject(locationId: string, offer: OfferRecord): Promise<void> {
    const api = await ghlApi(locationId);
    const fields: Record<string, unknown> = {
      program_name: offer.offer_name,
      price: offer.price,
      payment_type: offer.payment_type === 'one_time' ? 'One-Time' : 'Installments',
      installment_amount: offer.installment_amount,
      number_of_payments: offer.num_payments,
      pif_price: offer.pif_price,
      program_description: offer.program_description,
      delivery_method: offer.delivery_method,
      compiled_tc_html: offer.compiled_tc_html,
      refund_window_text: offer.refund_window_text,
      active: offer.active ? 'Yes' : 'No',
    };

    for (let i = 1; i <= 11; i++) {
      const title = (offer as any)[`clause_slot_${i}_title`];
      const text = (offer as any)[`clause_slot_${i}_text`];
      if (title) fields[`clause_slot_${i}_title`] = title;
      if (text) fields[`clause_slot_${i}_text`] = text;
    }

    for (let i = 1; i <= 8; i++) {
      const name = (offer as any)[`m${i}_name`];
      const delivers = (offer as any)[`m${i}_delivers`];
      const clientDoes = (offer as any)[`m${i}_client_does`];
      if (name) fields[`m${i}_name`] = name;
      if (delivers) fields[`m${i}_delivers`] = delivers;
      if (clientDoes) fields[`m${i}_client_does`] = clientDoes;
    }

    if (offer.ghl_custom_object_id) {
      await api.put(`/custom-objects/offers/records/${offer.ghl_custom_object_id}`, fields);
    } else {
      const res = await api.post('/custom-objects/offers/records', fields);
      const coId = res.data.record?.id || res.data.id;
      await offerRepository.update(offer.id, { ghl_custom_object_id: coId } as any);
    }
  },

  generateEnrollmentLink(offerId: string, baseUrl: string): string {
    return `${baseUrl}/enrollment?offerId=${offerId}`;
  },
};

export { compileOfferTcHtml, calcInstallmentAmount, buildRefundText };
