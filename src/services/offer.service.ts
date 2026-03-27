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
  refundWindowText?: string;
  tcUrl?: string;
  clauses?: Array<{ title: string; text: string }>;
  milestones?: Array<{ name: string; delivers: string; clientDoes: string }>;
}

/**
 * Extract an ID from a GHL API response, handling various response shapes.
 * GHL may return: { id }, { _id }, { product: { id } }, { data: { id } }, etc.
 */
function extractId(data: any, objectKey?: string): string {
  if (!data) return '';
  if (objectKey && data[objectKey]) {
    return data[objectKey]._id || data[objectKey].id || '';
  }
  return data._id || data.id || '';
}

export const offerService = {
  async create(input: CreateOfferInput): Promise<OfferRecord> {
    const { locationId } = input;

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

    // PIF price: create if payment type is one_time, OR if installments with a PIF discount
    if (input.paymentType === 'one_time' || (input.pifDiscountEnabled && input.pifPrice)) {
      const amount = input.paymentType === 'one_time'
        ? (input.price || 0)
        : (input.pifPrice || input.price || 0);
      const priceRes = await api.post(`/products/${ghlProductId}/price`, {
        name: `${input.offerName} - Pay in Full`,
        type: 'one_time',
        currency: 'USD',
        amount: Math.round(amount * 100), // cents
        locationId,
      });
      priceIds.one_time = extractId(priceRes.data, 'price');
      logger.info({ locationId, priceId: priceIds.one_time, amount }, 'GHL PIF price created');
    }

    // Recurring price: create for installment plans
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

    // 3. Build Supabase record with clause + milestone slots
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
      refund_window_text: input.refundWindowText,
      tc_url: input.tcUrl || null,
    };

    // Map clause slots (up to 11)
    if (input.clauses) {
      input.clauses.forEach((c, i) => {
        if (i < 11) {
          record[`clause_slot_${i + 1}_title`] = c.title;
          record[`clause_slot_${i + 1}_text`] = c.text;
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

    // 4. Save to Supabase
    const offer = await offerRepository.create(record as any);

    // 5. Sync to GHL Custom Object (best-effort)
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

    if (updates.offerName !== undefined) dbUpdates.offer_name = updates.offerName;
    if (updates.programDescription !== undefined) dbUpdates.program_description = updates.programDescription;
    if (updates.deliveryMethod !== undefined) dbUpdates.delivery_method = updates.deliveryMethod;
    if (updates.price !== undefined) dbUpdates.price = updates.price;
    if (updates.paymentType !== undefined) dbUpdates.payment_type = updates.paymentType;
    if (updates.installmentAmount !== undefined) dbUpdates.installment_amount = updates.installmentAmount;
    if (updates.installmentFrequency !== undefined) dbUpdates.installment_frequency = updates.installmentFrequency;
    if (updates.numPayments !== undefined) dbUpdates.num_payments = updates.numPayments;
    if (updates.pifPrice !== undefined) dbUpdates.pif_price = updates.pifPrice;
    if (updates.pifDiscountEnabled !== undefined) dbUpdates.pif_discount_enabled = updates.pifDiscountEnabled;
    if (updates.refundWindowText !== undefined) dbUpdates.refund_window_text = updates.refundWindowText;
    if (updates.tcUrl !== undefined) dbUpdates.tc_url = updates.tcUrl;

    if (updates.clauses) {
      updates.clauses.forEach((c, i) => {
        if (i < 11) {
          dbUpdates[`clause_slot_${i + 1}_title`] = c.title;
          dbUpdates[`clause_slot_${i + 1}_text`] = c.text;
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

    // Sync to GHL Custom Object (best-effort)
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

  /**
   * Sync offer data to GHL Custom Object for CRM visibility.
   */
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
      active: offer.active ? 'Yes' : 'No',
    };

    // Add clause slots
    for (let i = 1; i <= 11; i++) {
      const title = (offer as any)[`clause_slot_${i}_title`];
      const text = (offer as any)[`clause_slot_${i}_text`];
      if (title) fields[`clause_slot_${i}_title`] = title;
      if (text) fields[`clause_slot_${i}_text`] = text;
    }

    // Add milestones
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

  /**
   * Generate the enrollment funnel link for an offer.
   */
  generateEnrollmentLink(offerId: string, baseUrl: string): string {
    return `${baseUrl}/enrollment?offerId=${offerId}`;
  },
};
