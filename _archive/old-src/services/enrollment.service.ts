/**
 * enrollment.service.ts — Client Enrollment Orchestration
 *
 * Manages the 3-step enrollment flow:
 * 1. prepare()       — Fetch offer, populate contact fields (replaces S4/S5)
 * 2. processCharge() — Process payment via accept.blue, create recurring schedule
 *                      if installments, store AB customer mapping (replaces S6)
 * 3. handlePostPayment() — Create pipeline opportunity, log enrollment evidence,
 *                          set initial payment fields (replaces S7 enrollment route)
 *
 * The flow from the client's perspective:
 *   Page 2 (Offer Review)  → calls prepare() or getForEnrollment()
 *   Page 3 (T&C Consent)   → consent data captured client-side
 *   Page 4 (Payment)       → calls processCharge() with card token + consent data
 *   accept.blue webhook    → triggers handlePostPayment() asynchronously
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore, findByLocationId } from '../repositories/merchant.repository';
import {
  createAcceptBlueClient,
  createCharge,
  createCustomer,
  createRecurringSchedule,
} from '../clients/acceptblue.client';
import * as customerMapRepo from '../repositories/customer-map.repository';
import * as evidenceService from './evidence.service';
import * as tcService from './tc.service';
import {
  OFFER_ID, OFFER_PROGRAM_NAME, OFFER_PAYMENT_TYPE, OFFER_PAYMENT_AMOUNT,
  OFFER_INSTALLMENT_AMOUNT, OFFER_INSTALLMENT_FREQUENCY, OFFER_NUMBER_OF_PAYMENTS,
  OFFER_PRICE_DISPLAY, OFFER_COMPILED_TC_HTML, OFFER_BUSINESS_NAME, OFFER_SUPPORT_EMAIL,
  SS_PAYMENT_STATUS, SS_SUBSCRIPTION_START, SS_BILLING_FREQUENCY,
  SS_TOTAL_CONTRACT_VALUE, SS_TOTAL_SCHEDULED, SS_PAYMENTS_REMAINING,
  SS_NEXT_PAYMENT_DATE, SS_PAYMENTS_MADE, SS_TOTAL_PAID,
  SS_TC_ACCEPTED, SS_TC_ACCEPTED_DATE, SS_TC_IP_ADDRESS,
  SS_TC_USER_AGENT, SS_TC_CLAUSES_ACCEPTED, SS_CONSENT_VERSION,
  OFFER_MILESTONE_FIELDS,
} from '../constants/ghl-contact-fields';
import { logger } from '../utils/logger';
import { BadRequestError, ExternalServiceError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/** Payment request from the enrollment page (Page 4). */
export interface ChargeRequest {
  locationId: string;
  contactId: string;
  offerId: string;
  paymentType: 'One-Time' | 'Installments';
  amount: number;
  card?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvv2?: string;
  sourceToken?: string; // accept.blue hosted tokenization token
  billingInfo?: Record<string, unknown>;
  consent: tcService.ConsentData;
  clientIp: string;
}

/** Result of a successful charge. */
export interface ChargeResult {
  success: boolean;
  transactionId: number;
  referenceNumber: string;
  authCode: string;
  amount: number;
  abCustomerId?: number;
}

/**
 * Step 1: Prepare enrollment.
 * Fetches the offer data and populates the contact's Offer- prefix fields in GHL.
 * Called when a client views Page 2 (Offer Review) of the enrollment funnel.
 */
export async function prepare(
  locationId: string,
  contactId: string,
  offerId: string
): Promise<Record<string, unknown>> {
  const offerService = await import('./offer.service');
  const offer = await offerService.get(locationId, offerId);
  const properties = (offer as any).properties || offer;

  // Build contact field updates from offer data
  const fieldUpdates: Record<string, unknown> = {
    [OFFER_ID.key]: offerId,
    [OFFER_PROGRAM_NAME.key]: properties.program_name,
    [OFFER_PAYMENT_TYPE.key]: properties.payment_type,
    [OFFER_PAYMENT_AMOUNT.key]: String(properties.price),
    [OFFER_INSTALLMENT_AMOUNT.key]: String(properties.installment_amount || ''),
    [OFFER_INSTALLMENT_FREQUENCY.key]: properties.installment_frequency || '',
    [OFFER_NUMBER_OF_PAYMENTS.key]: String(properties.number_of_payments || ''),
    [OFFER_PRICE_DISPLAY.key]: properties.price_display,
    [OFFER_COMPILED_TC_HTML.key]: properties.compiled_tc_html,
  };

  // Copy milestone data to contact
  const milestoneKeys = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  for (let i = 0; i < milestoneKeys.length; i++) {
    const mk = milestoneKeys[i];
    const fieldDef = OFFER_MILESTONE_FIELDS[i];
    if (properties[`${mk}_name`]) {
      fieldUpdates[fieldDef.name.key] = properties[`${mk}_name`];
      fieldUpdates[fieldDef.delivers.key] = properties[`${mk}_delivers`] || '';
      fieldUpdates[fieldDef.clientDoes.key] = properties[`${mk}_client_does`] || '';
    }
  }

  // Update the contact in GHL
  const client = await ghlClient.getAuthenticatedClient(locationId);
  await client.put(
    `/contacts/${contactId}`,
    { customFields: fieldUpdates },
    { headers: { Version: '2021-07-28' } }
  );

  logger.info({ locationId, contactId, offerId }, 'Enrollment prepared — contact fields populated');
  return offer;
}

/**
 * Step 2: Process the payment.
 * Charges the client via accept.blue. If installments, creates a recurring schedule.
 * Stores the AB customer mapping for future recurring payment lookups.
 */
export async function processCharge(req: ChargeRequest): Promise<ChargeResult> {
  const { locationId, contactId, offerId, paymentType, amount, consent, clientIp } = req;

  // Validate consent
  tcService.validateConsent(consent);

  // Get merchant's accept.blue API key
  const merchant = await findByLocationId(locationId);
  if (!merchant?.ab_api_key) {
    throw new ExternalServiceError('accept.blue', 'Merchant has no accept.blue API key configured');
  }

  const abClient = createAcceptBlueClient(merchant.ab_api_key);

  // Build charge request
  const chargeData: Record<string, unknown> = {
    amount,
    capture: true,
    save_card: paymentType === 'Installments', // Save card for recurring
    transaction_details: {
      invoice_number: offerId, // Used by S7 to identify enrollment vs recurring
      client_ip: clientIp,
    },
    transaction_flags: {
      is_installment: paymentType === 'Installments',
    },
  };

  // Card data (either raw card or tokenized)
  if (req.sourceToken) {
    (chargeData as any).source = req.sourceToken;
  } else if (req.card) {
    chargeData.card = req.card;
    chargeData.expiry_month = req.expiryMonth;
    chargeData.expiry_year = req.expiryYear;
    chargeData.cvv2 = req.cvv2;
  } else {
    throw new BadRequestError('Payment requires either a card token or card details');
  }

  if (req.billingInfo) {
    chargeData.billing_info = req.billingInfo;
  }

  // Process the charge
  const chargeResult = await createCharge(abClient, chargeData);

  if (chargeResult.status !== 'Approved') {
    throw new ExternalServiceError(
      'accept.blue',
      `Charge ${chargeResult.status}: ${chargeResult.status_details?.error_message || 'declined'}`
    );
  }

  const abCustomerId = chargeResult.transaction?.customer?.customer_id;

  // If installments, create a recurring schedule
  if (paymentType === 'Installments' && abCustomerId && req.amount) {
    try {
      const offerService = await import('./offer.service');
      const offer = await offerService.get(locationId, offerId);
      const props = (offer as any).properties || offer;

      await createRecurringSchedule(abClient, abCustomerId, {
        amount: props.installment_amount || amount,
        frequency: mapFrequency(props.installment_frequency),
        num_left: (props.number_of_payments || 1) - 1, // First payment already made
        title: `${props.program_name} - Installments`,
      });

      logger.info({ abCustomerId, locationId }, 'Recurring schedule created in accept.blue');
    } catch (err) {
      logger.error({ err, abCustomerId }, 'Failed to create recurring schedule');
      // Don't throw — the charge succeeded, schedule can be created manually
    }
  }

  // Store AB customer mapping for recurring payment lookups
  if (abCustomerId) {
    await customerMapRepo.create({
      ab_customer_id: String(abCustomerId),
      contact_id: contactId,
      location_id: locationId,
      offer_id: offerId,
      program_name: null, // Will be populated from offer
      payment_type: paymentType,
      installment_amount: req.amount,
      installment_frequency: null,
    });
  }

  // Log enrollment evidence (consent + payment)
  await evidenceService.logEnrollment(locationId, contactId, {
    offer_id: offerId,
    payment_type: paymentType,
    amount,
    transaction_id: chargeResult.transaction?.id,
    reference_number: chargeResult.reference_number,
    tc_accepted: consent.tc_accepted,
    tc_accepted_date: consent.tc_accepted_date,
    tc_ip_address: consent.tc_ip_address,
    tc_user_agent: consent.tc_user_agent,
    clauses_accepted: consent.clauses_accepted,
  });

  // Update consent fields on the contact
  const consentFields: Record<string, unknown> = {
    [SS_TC_ACCEPTED.key]: 'Yes',
    [SS_TC_ACCEPTED_DATE.key]: consent.tc_accepted_date,
    [SS_TC_IP_ADDRESS.key]: consent.tc_ip_address,
    [SS_TC_USER_AGENT.key]: consent.tc_user_agent,
    [SS_TC_CLAUSES_ACCEPTED.key]: consent.clauses_accepted,
    [SS_PAYMENT_STATUS.key]: 'Current',
    [SS_SUBSCRIPTION_START.key]: new Date().toISOString().split('T')[0],
    [SS_PAYMENTS_MADE.key]: 1,
    [SS_TOTAL_PAID.key]: amount,
  };

  if (consent.consent_version) {
    consentFields[SS_CONSENT_VERSION.key] = consent.consent_version;
  }

  const client = await ghlClient.getAuthenticatedClient(locationId);
  await client.put(
    `/contacts/${contactId}`,
    { customFields: consentFields },
    { headers: { Version: '2021-07-28' } }
  );

  logger.info(
    { locationId, contactId, offerId, amount, abCustomerId },
    'Enrollment charge processed successfully'
  );

  return {
    success: true,
    transactionId: chargeResult.transaction?.id,
    referenceNumber: chargeResult.reference_number,
    authCode: chargeResult.auth_code,
    amount: chargeResult.auth_amount,
    abCustomerId,
  };
}

/**
 * Step 3: Post-payment handler (called by accept.blue webhook for enrollment).
 * Creates the pipeline opportunity and sets initial payment tracking fields.
 */
export async function handlePostEnrollment(
  locationId: string,
  contactId: string,
  offerId: string,
  amount: number
): Promise<void> {
  const client = await ghlClient.getAuthenticatedClient(locationId);

  // Create opportunity in Client Milestones pipeline
  try {
    await client.post(
      '/opportunities/',
      {
        contactId,
        locationId,
        name: `Enrollment - ${offerId}`,
        pipelineId: 'client_milestones', // TODO: resolve actual pipeline ID
        stageId: 'new_client',           // TODO: resolve actual stage ID
        status: 'open',
        monetaryValue: amount,
      },
      { headers: { Version: '2021-07-28' } }
    );
    logger.info({ locationId, contactId }, 'Pipeline opportunity created');
  } catch (err) {
    logger.error({ err, locationId, contactId }, 'Failed to create pipeline opportunity');
  }
}

/** Maps our frequency names to accept.blue's expected values. */
function mapFrequency(frequency: string | undefined): string {
  switch (frequency?.toLowerCase()) {
    case 'weekly': return 'weekly';
    case 'bi-weekly': return 'biweekly';
    case 'monthly': return 'monthly';
    default: return 'monthly';
  }
}
