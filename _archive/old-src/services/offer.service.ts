/**
 * offer.service.ts — Offer Management Service
 *
 * Handles CRUD operations for coaching program offers stored in GHL Custom Objects.
 * Each offer defines: program name, price, payment terms, up to 8 milestones,
 * 11 T&C clause slots, delivery method, and refund policy.
 *
 * When an offer is created or updated, the T&C clauses are compiled into HTML
 * via tc.service and stored on the offer as compiled_tc_html.
 *
 * Replaces Make.com S3 (Offer Creation).
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import { OFFER_OBJECT_KEY, OFFER, OFFER_MILESTONES, OFFER_CLAUSE_SLOTS } from '../constants/ghl-offer-fields';
import * as tcService from './tc.service';
import { logger } from '../utils/logger';
import { NotFoundError, BadRequestError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/** Offer data as used by the app (normalized from GHL's flat field structure). */
export interface OfferData {
  programName: string;
  programDescription?: string;
  price: number;
  paymentType: 'One-Time' | 'Installments';
  installmentAmount?: number;
  installmentFrequency?: 'Weekly' | 'Bi-Weekly' | 'Monthly';
  numberOfPayments?: number;
  pifPrice?: number;
  pifDiscountEnabled?: boolean;
  deliveryMethod?: string;
  redirectSlug?: string;
  refundWindowText?: string;
  active?: boolean;
  milestones: Array<{
    name: string;
    delivers: string;
    clientDoes: string;
  }>;
  clauseSlots: Array<{
    title: string | null;
    text: string | null;
  }>;
}

/**
 * Creates a new offer in GHL Custom Objects.
 * Compiles T&C clauses into HTML before saving.
 */
export async function create(
  locationId: string,
  merchantName: string,
  offerData: OfferData
): Promise<Record<string, unknown>> {
  if (!offerData.programName) {
    throw new BadRequestError('Offer must have a program name');
  }

  // Compile T&C clauses into HTML
  const compiledTcHtml = tcService.compileClausesHtml(
    offerData.clauseSlots,
    offerData.programName,
    merchantName
  );

  // Build the flat field map for GHL Custom Objects API
  const fields = buildOfferFields(offerData, compiledTcHtml);

  const client = await ghlClient.getAuthenticatedClient(locationId);
  const response = await client.post(
    `/custom-objects/${OFFER_OBJECT_KEY}/records`,
    { properties: fields },
    { headers: { Version: '2021-07-28' } }
  );

  logger.info(
    { locationId, programName: offerData.programName },
    'Offer created in GHL'
  );

  return response.data;
}

/** Gets a single offer by its record ID. */
export async function get(
  locationId: string,
  offerId: string
): Promise<Record<string, unknown>> {
  const client = await ghlClient.getAuthenticatedClient(locationId);

  try {
    const response = await client.get(
      `/custom-objects/${OFFER_OBJECT_KEY}/records/${offerId}`,
      { headers: { Version: '2021-07-28' } }
    );
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new NotFoundError(`Offer not found: ${offerId}`);
    }
    throw error;
  }
}

/** Lists all offers for a location. */
export async function list(locationId: string): Promise<Record<string, unknown>[]> {
  const client = await ghlClient.getAuthenticatedClient(locationId);
  const response = await client.get(
    `/custom-objects/${OFFER_OBJECT_KEY}/records`,
    {
      headers: { Version: '2021-07-28' },
      params: { locationId },
    }
  );

  return response.data?.records || response.data || [];
}

/**
 * Updates an existing offer. Recompiles T&C HTML if clauses changed.
 */
export async function update(
  locationId: string,
  offerId: string,
  merchantName: string,
  offerData: Partial<OfferData>
): Promise<Record<string, unknown>> {
  // If clauses are being updated, recompile the HTML
  let compiledTcHtml: string | undefined;
  if (offerData.clauseSlots) {
    compiledTcHtml = tcService.compileClausesHtml(
      offerData.clauseSlots,
      offerData.programName || 'Program',
      merchantName
    );
  }

  const fields = buildOfferFields(offerData, compiledTcHtml);

  const client = await ghlClient.getAuthenticatedClient(locationId);
  const response = await client.patch(
    `/custom-objects/${OFFER_OBJECT_KEY}/records/${offerId}`,
    { properties: fields },
    { headers: { Version: '2021-07-28' } }
  );

  logger.info({ locationId, offerId }, 'Offer updated in GHL');
  return response.data;
}

/**
 * Gets an offer formatted for the enrollment page (Page 2).
 * Returns the offer data with compiled T&C HTML, milestones, and pricing.
 */
export async function getForEnrollment(
  locationId: string,
  offerId: string
): Promise<Record<string, unknown>> {
  const offer = await get(locationId, offerId);
  return offer;
}

/**
 * Converts our normalized OfferData into GHL's flat field key → value map.
 */
function buildOfferFields(
  data: Partial<OfferData>,
  compiledTcHtml?: string
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (data.programName !== undefined) fields[OFFER.PROGRAM_NAME] = data.programName;
  if (data.programDescription !== undefined) fields[OFFER.PROGRAM_DESCRIPTION] = data.programDescription;
  if (data.price !== undefined) fields[OFFER.PRICE] = data.price;
  if (data.paymentType !== undefined) fields[OFFER.PAYMENT_TYPE] = data.paymentType;
  if (data.installmentAmount !== undefined) fields[OFFER.INSTALLMENT_AMOUNT] = data.installmentAmount;
  if (data.installmentFrequency !== undefined) fields[OFFER.INSTALLMENT_FREQUENCY] = data.installmentFrequency;
  if (data.numberOfPayments !== undefined) fields[OFFER.NUMBER_OF_PAYMENTS] = data.numberOfPayments;
  if (data.pifPrice !== undefined) fields[OFFER.PIF_PRICE] = data.pifPrice;
  if (data.pifDiscountEnabled !== undefined) fields[OFFER.PIF_DISCOUNT_ENABLED] = data.pifDiscountEnabled ? 'Yes' : 'No';
  if (data.deliveryMethod !== undefined) fields[OFFER.DELIVERY_METHOD] = data.deliveryMethod;
  if (data.redirectSlug !== undefined) fields[OFFER.REDIRECT_SLUG] = data.redirectSlug;
  if (data.refundWindowText !== undefined) fields[OFFER.REFUND_WINDOW_TEXT] = data.refundWindowText;
  if (data.active !== undefined) fields[OFFER.ACTIVE] = data.active ? 'Yes' : 'No';
  if (compiledTcHtml !== undefined) fields[OFFER.COMPILED_TC_HTML] = compiledTcHtml;

  // Milestones (up to 8)
  if (data.milestones) {
    for (let i = 0; i < Math.min(data.milestones.length, 8); i++) {
      const m = data.milestones[i];
      const fieldDef = OFFER_MILESTONES[i];
      if (m.name) fields[fieldDef.name] = m.name;
      if (m.delivers) fields[fieldDef.delivers] = m.delivers;
      if (m.clientDoes) fields[fieldDef.clientDoes] = m.clientDoes;
    }
  }

  // T&C Clause Slots (up to 11)
  if (data.clauseSlots) {
    for (let i = 0; i < Math.min(data.clauseSlots.length, 11); i++) {
      const c = data.clauseSlots[i];
      const slotDef = OFFER_CLAUSE_SLOTS[i];
      fields[slotDef.title] = c.title || '';
      fields[slotDef.text] = c.text || '';
    }
  }

  // Set creation date and price display
  if (data.programName && data.price !== undefined) {
    fields[OFFER.OFFER_CREATED_DATE] = new Date().toISOString().split('T')[0];
    if (data.paymentType === 'Installments' && data.installmentAmount && data.numberOfPayments) {
      fields[OFFER.PRICE_DISPLAY] = `${data.numberOfPayments} payments of $${data.installmentAmount}`;
    } else {
      fields[OFFER.PRICE_DISPLAY] = `$${data.price}`;
    }
  }

  return fields;
}
