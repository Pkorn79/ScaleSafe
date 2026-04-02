import { ghlApi } from '../clients/ghl.client';
import { offerRepository, OfferRecord } from '../repositories/offer.repository';
import { logger } from '../utils/logger';

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
  tcUrl?: string;
  // 11 clause slots: slots 1-9 = standard clauses, 10-11 = custom clauses
  clauses?: Array<{ title: string; text: string }>;
  milestones?: Array<{ name: string; delivers: string; clientDoes: string }>;
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
      const intervalMap: Record<string, string> = { weekly: 'week', bi_weekly: 'week', monthly: 'month' };
      const intervalCountMap: Record<string, number> = { weekly: 1, bi_weekly: 2, monthly: 1 };
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
      tc_url: input.tcUrl || null,
      compiled_tc_html: compiledHtml,
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

    // Auto-calculate installment amount
    const effectivePrice = updates.price ?? existing.price;
    const effectiveNumPayments = updates.numPayments ?? existing.num_payments;
    const effectivePaymentType = updates.paymentType ?? existing.payment_type;

    if (effectivePaymentType === 'installments') {
      const calcAmount = calcInstallmentAmount(effectivePrice as number, effectiveNumPayments as number);
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
    if (updates.tcUrl !== undefined) dbUpdates.tc_url = updates.tcUrl || null;

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

export { compileTcHtml, calcInstallmentAmount, buildRefundText };
