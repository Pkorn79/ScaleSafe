import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { sha256 } from '../utils/crypto';
import { ValidationError } from '../utils/errors';
import { SS_CONTACT_FIELDS, OFFER_CONTACT_FIELDS, OFFER_CLAUSE_FIELDS, OFFER_MILESTONE_FIELDS } from '../constants/ghl-fields';

interface PrepEnrollmentInput {
  locationId: string;
  offerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  ip?: string;
  deviceFingerprint?: string;
  userAgent?: string;
}

interface CaptureConsentInput {
  locationId: string;
  contactId: string;
  offerId: string;
  consentTimestamp: string;
  ip: string;
  deviceFingerprint: string;
  browser: string;
  userAgent: string;
  tcHtml: string;
}

interface PaymentWebhookInput {
  locationId: string;
  contactId: string;
  offerId: string;
  ghlOrderId: string;
  ghlTransactionId: string;
  paymentAmount: number;
  paymentMethod: string;
}

export const enrollmentService = {
  /**
   * Page 1: Create or update GHL contact, capture device info.
   */
  async prepEnrollment(input: PrepEnrollmentInput) {
    const api = await ghlApi(input.locationId);

    // Search for existing contact by email
    const searchRes = await api.get('/contacts/search/duplicate', {
      params: { locationId: input.locationId, email: input.email },
    });

    let contactId: string;
    const contactData: Record<string, unknown> = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      locationId: input.locationId,
    };

    if (searchRes.data.contact?.id) {
      contactId = searchRes.data.contact.id;
      await api.put(`/contacts/${contactId}`, contactData);
    } else {
      const createRes = await api.post('/contacts/', contactData);
      contactId = createRes.data.contact?.id || createRes.data.id;
    }

    logger.info({ contactId, locationId: input.locationId }, 'Enrollment prep complete');

    return {
      contactId,
      offerId: input.offerId,
      locationId: input.locationId,
    };
  },

  /**
   * Page 2: Fetch offer details for display.
   */
  async getOfferForEnrollment(offerId: string) {
    const offer = await offerRepository.getById(offerId);
    return {
      id: offer.id,
      name: offer.offer_name,
      description: offer.program_description,
      deliveryMethod: offer.delivery_method,
      price: offer.price,
      paymentType: offer.payment_type,
      installmentAmount: offer.installment_amount,
      installmentFrequency: offer.installment_frequency,
      numPayments: offer.num_payments,
      pifPrice: offer.pif_price,
      pifDiscountEnabled: offer.pif_discount_enabled,
      refundPolicy: offer.refund_window_text,
      milestones: Array.from({ length: 8 }, (_, i) => {
        const name = (offer as any)[`m${i + 1}_name`];
        return name ? {
          number: i + 1,
          name,
          delivers: (offer as any)[`m${i + 1}_delivers`],
          clientDoes: (offer as any)[`m${i + 1}_client_does`],
        } : null;
      }).filter(Boolean),
      clauses: Array.from({ length: 11 }, (_, i) => {
        const title = (offer as any)[`clause_slot_${i + 1}_title`];
        return title ? {
          slot: i + 1,
          title,
          text: (offer as any)[`clause_slot_${i + 1}_text`],
        } : null;
      }).filter(Boolean),
      compiledTcHtml: offer.compiled_tc_html,
    };
  },

  /**
   * Page 3: Capture T&C consent with full forensics.
   */
  async captureConsent(input: CaptureConsentInput) {
    const tcHash = sha256(input.tcHtml);

    // Log consent as evidence
    const { error } = await getSupabase()
      .from('evidence_consent')
      .insert({
        location_id: input.locationId,
        contact_id: input.contactId,
        offer_id: input.offerId,
        consent_timestamp: input.consentTimestamp,
        ip_address: input.ip,
        device_fingerprint: input.deviceFingerprint,
        browser: input.browser,
        user_agent: input.userAgent,
        tc_hash: tcHash,
        source: 'enrollment_funnel',
      });

    if (error) throw error;

    logger.info({ contactId: input.contactId, offerId: input.offerId }, 'Consent captured');

    return { tcHash, consentTimestamp: input.consentTimestamp };
  },

  /**
   * Post-payment: GHL fires webhook after successful Page 4 payment.
   * Completes enrollment: copies offer to contact, creates pipeline opportunity,
   * generates enrollment packet, logs payment evidence.
   */
  async handlePaymentWebhook(input: PaymentWebhookInput) {
    const { locationId, contactId, offerId } = input;
    const offer = await offerRepository.getById(offerId);
    const merchant = await merchantRepository.getByLocationId(locationId);
    const api = await ghlApi(locationId);

    // 1. Update SS contact fields
    const customFields: Record<string, unknown> = {
      [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'active',
      [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
    };

    // 2. Copy offer fields to contact (written once)
    customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = merchant.business_name || '';
    customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name;
    customFields[OFFER_CONTACT_FIELDS.PRICE] = offer.price;
    customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = offer.payment_type;
    customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = offer.installment_amount;
    customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = offer.installment_frequency;
    customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = offer.num_payments;

    // Copy clause slots
    for (let i = 0; i < 11; i++) {
      const title = (offer as any)[`clause_slot_${i + 1}_title`];
      const text = (offer as any)[`clause_slot_${i + 1}_text`];
      if (title) {
        customFields[OFFER_CLAUSE_FIELDS[i].title] = title;
        customFields[OFFER_CLAUSE_FIELDS[i].text] = text;
      }
    }

    // Copy milestones
    for (let i = 0; i < 8; i++) {
      const name = (offer as any)[`m${i + 1}_name`];
      if (name) {
        customFields[OFFER_MILESTONE_FIELDS[i].name] = name;
        customFields[OFFER_MILESTONE_FIELDS[i].description] = (offer as any)[`m${i + 1}_delivers`];
      }
    }

    await api.put(`/contacts/${contactId}`, { customField: customFields });

    // 3. Create pipeline opportunity
    await api.post('/opportunities/', {
      locationId,
      contactId,
      pipelineId: merchant.config.milestones_pipeline_id || '',
      stageId: merchant.config.enrolled_stage_id || '',
      name: `${offer.offer_name} — Enrollment`,
      monetaryValue: offer.price,
    });

    // 4. Log enrollment payment evidence
    await getSupabase().from('evidence_enrollment_payment').insert({
      location_id: locationId,
      contact_id: contactId,
      offer_id: offerId,
      ghl_order_id: input.ghlOrderId,
      ghl_transaction_id: input.ghlTransactionId,
      amount: input.paymentAmount,
      payment_method: input.paymentMethod,
      source: 'ghl_webhook',
    });

    // 5. Create enrollment packet record (PDF generation handled separately)
    const consentRecord = await getSupabase()
      .from('evidence_consent')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('offer_id', offerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    await getSupabase().from('enrollment_packets').insert({
      location_id: locationId,
      contact_id: contactId,
      offer_id: offerId,
      consent_timestamp: consentRecord.data?.consent_timestamp || new Date().toISOString(),
      consent_ip: consentRecord.data?.ip_address,
      consent_device: consentRecord.data?.device_fingerprint,
      consent_browser: consentRecord.data?.browser,
      tc_hash: consentRecord.data?.tc_hash,
      tc_html_snapshot: offer.compiled_tc_html,
      ghl_order_id: input.ghlOrderId,
      ghl_transaction_id: input.ghlTransactionId,
      payment_amount: input.paymentAmount,
      payment_method: input.paymentMethod,
    });

    // 6. Map customer for future payment tracking
    await getSupabase().from('payment_customer_map').insert({
      customer_id: input.ghlOrderId,
      contact_id: contactId,
      location_id: locationId,
      offer_id: offerId,
      program_name: offer.offer_name,
      payment_type: offer.payment_type,
      processor: 'ghl',
    });

    logger.info({ contactId, offerId, locationId }, 'Enrollment completed');

    return { contactId, offerId, status: 'enrolled' };
  },
};
