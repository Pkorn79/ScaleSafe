import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { sha256 } from '../utils/crypto';
import { ValidationError } from '../utils/errors';
import { formatMoney, getSelectedPlanReceiptPrice } from '../utils/offer-display';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { verifyPublicActionToken } from '../utils/public-action-token';
import { dualPricingService } from './dual-pricing.service';
import { checkoutCartService } from './checkout-cart.service';
import {
  SS_CONTACT_FIELDS,
  OFFER_CONTACT_FIELDS,
  OFFER_CLAUSE_FIELDS,
  OFFER_MILESTONE_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import crypto from 'crypto';

function formatDate(value: Date = new Date()): string {
  return value.toISOString().split('T')[0];
}

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

// ─── Funnel widget inputs ──────────────────────────────────────

interface DeviceCaptureInput {
  offerId: string;
  email: string;
  paidEnrollmentToken?: string;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string;
  screenResolution: string;
  timezone: string;
  browserLanguage: string;
}

interface FunnelConsentInput {
  offerId: string;
  email: string;
  paidEnrollmentToken?: string;
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
  selectedAddonIds?: string[];
}

interface PaidEnrollmentContextInput {
  offerId: string;
  paidEnrollmentToken: string;
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
  async getPaidEnrollmentContext(input: PaidEnrollmentContextInput) {
    if (!input.offerId || !input.paidEnrollmentToken) {
      throw new ValidationError('offerId and paidEnrollmentToken required');
    }

    const token = verifyPublicActionToken(input.paidEnrollmentToken, 'paid_enrollment');
    const supabase = getSupabase();
    const { data: enrollment, error } = await supabase
      .from('enrollments')
      .select('id, location_id, contact_id, offer_id, email, first_name, last_name, status, payment_amount, payment_type, processor_type, processor_subscription_id, payments_made, payments_total')
      .eq('id', token.enrollmentId || '')
      .eq('location_id', token.locationId)
      .eq('contact_id', token.contactId)
      .eq('offer_id', input.offerId)
      .eq('status', 'paid_pending_enrollment')
      .maybeSingle();

    if (error) throw error;
    if (!enrollment) throw new ValidationError('Paid enrollment link is invalid or expired');

    const offer = await offerRepository.findById(enrollment.offer_id, enrollment.location_id);
    if (!offer || !offer.active) throw new ValidationError('Offer not found or inactive');

    return {
      success: true,
      paidEnrollment: true,
      paymentAlreadyReceived: true,
      enrollmentId: enrollment.id,
      offerId: enrollment.offer_id,
      offerName: offer.offer_name,
      locationId: enrollment.location_id,
      contactId: enrollment.contact_id,
      firstName: enrollment.first_name || '',
      lastName: enrollment.last_name || '',
      fullName: [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' '),
      email: enrollment.email || '',
      phone: '',
      status: enrollment.status,
      paymentAmount: Number(enrollment.payment_amount || 0),
      paymentType: enrollment.payment_type || offer.payment_type,
      processorType: enrollment.processor_type || '',
      processorSubscriptionId: enrollment.processor_subscription_id || '',
      paymentsMade: enrollment.payments_made ?? null,
      paymentsTotal: enrollment.payments_total ?? null,
    };
  },
  // ─── Funnel Widget Endpoints ───────────────────────────────────

  /**
   * Page 1 Widget: Capture device/browser evidence for an enrollment.
   * Creates or updates an enrollments record with device_evidence JSONB.
   */
  async captureDevice(input: DeviceCaptureInput) {
    const supabase = getSupabase();

    // Verify offer exists and is active
    const offer = await offerRepository.findById(input.offerId);
    if (!offer || !offer.active) {
      throw new ValidationError('Offer not found or inactive');
    }

    const deviceEvidence = {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceFingerprint: input.deviceFingerprint,
      screenResolution: input.screenResolution,
      timezone: input.timezone,
      browserLanguage: input.browserLanguage,
      capturedAt: new Date().toISOString(),
    };

    let paidEnrollmentId = '';
    if (input.paidEnrollmentToken) {
      const token = verifyPublicActionToken(input.paidEnrollmentToken, 'paid_enrollment');
      const { data: paidEnrollment, error: paidError } = await supabase
        .from('enrollments')
        .select('id, offer_id, location_id, status')
        .eq('id', token.enrollmentId || '')
        .eq('location_id', token.locationId)
        .eq('offer_id', input.offerId)
        .eq('status', 'paid_pending_enrollment')
        .maybeSingle();
      if (paidError) throw paidError;
      if (!paidEnrollment) throw new ValidationError('Paid enrollment link is invalid or expired');
      paidEnrollmentId = paidEnrollment.id;
    }

    // Check for existing record by email + offerId, including pay-first records.
    const existingQuery = supabase
      .from('enrollments')
      .select('id, status');
    const { data: existing } = paidEnrollmentId
      ? await existingQuery.eq('id', paidEnrollmentId).maybeSingle()
      : await existingQuery
        .eq('email', input.email)
        .eq('offer_id', input.offerId)
        .in('status', ['device_captured', 'pending', 'paid_pending_enrollment'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('enrollments')
        .update({ device_evidence: deviceEvidence })
        .eq('id', existing.id);
      if (error) throw error;

      logger.info({ enrollmentId: existing.id, offerId: input.offerId }, 'Device evidence updated');
      return { success: true, enrollmentId: existing.id };
    }

    // Create new record
    const { data: created, error } = await supabase
      .from('enrollments')
      .insert({
        location_id: offer.location_id,
        offer_id: input.offerId,
        email: input.email,
        status: 'device_captured',
        device_evidence: deviceEvidence,
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info({ enrollmentId: created.id, offerId: input.offerId }, 'Device evidence captured');
    return { success: true, enrollmentId: created.id };
  },

  /**
   * Public offer endpoint: Return enrollment-relevant offer details.
   * No internal IDs exposed.
   */
  async getPublicOffer(offerId: string) {
    const offer = await offerRepository.findById(offerId);
    if (!offer || !offer.active) {
      return null;
    }

    // Get merchant info
    const merchant = await merchantRepository.findByLocationId(offer.location_id);
    const dualPricingControl = await dualPricingService.getActiveControl(offer.location_id);
    const checkoutAddons = await checkoutCartService.listAddons(offer.id, offer.location_id, true);

    // Build milestones array (skip nulls)
    const milestones = [];
    for (let i = 1; i <= 8; i++) {
      const name = (offer as any)[`m${i}_name`];
      if (name) {
        milestones.push({
          name,
          delivers: (offer as any)[`m${i}_delivers`] || '',
          clientDoes: (offer as any)[`m${i}_client_does`] || '',
        });
      }
    }

    // Build clauses array (skip nulls)
    const clauses = [];
    for (let i = 1; i <= 11; i++) {
      const title = (offer as any)[`clause_slot_${i}_title`];
      if (title) {
        clauses.push({
          id: `clause_${i}`,
          title,
          text: (offer as any)[`clause_slot_${i}_text`] || '',
        });
      }
    }

    return {
      offerId: offer.id,
      locationId: offer.location_id,
      programName: offer.offer_name,
      programDescription: offer.program_description || '',
      price: offer.price,
      paymentType: offer.payment_type,
      installmentAmount: offer.installment_amount,
      installmentFrequency: offer.installment_frequency,
      installmentCount: offer.num_payments,
      pifPrice: offer.pif_price,
      pifDiscountEnabled: offer.pif_discount_enabled,
      dualPricingEnabled: Boolean((offer as any).dual_pricing_enabled && (offer as any).ach_enabled && dualPricingControl),
      achEnabled: Boolean((offer as any).ach_enabled),
      dualPricing: dualPricingControl && (offer as any).dual_pricing_enabled && (offer as any).ach_enabled ? {
        cardUpliftPercent: Number(dualPricingControl.card_uplift_percent || 0),
        processorDeductionPercent: Number(dualPricingControl.processor_deduction_percent || 0),
        achAccessPolicy: (offer as any).ach_access_policy || 'after_settlement',
      } : null,
      checkoutType: (offer as any).checkout_type || 'direct',
      whopPlanId: (offer as any).whop_plan_id || null,
      whopSyncStatus: (offer as any).whop_sync_status || null,
      botProtectionPolicy: (offer as any).bot_protection_policy || 'default',
      deliveryMethod: offer.delivery_method || '',
      programDurationValue: (offer as any).program_duration_value || null,
      programDurationUnit: (offer as any).program_duration_unit || '',
      refundWindowText: offer.refund_window_text || '',
      milestones,
      compiledTcHtml: offer.compiled_tc_html || '',
      tcUrl: (offer as any).tc_url || null,
      quickCheckoutConsentText: (offer as any).quick_checkout_consent_text || null,
      clauses,
      merchantName: merchant?.business_name || '',
      merchantSupportEmail: merchant?.support_email || '',
      merchantLogoUrl: merchant?.logo_url || null,
      checkoutAddons: checkoutAddons.map((addon) => ({
        id: addon.id,
        kind: addon.kind,
        title: addon.title,
        description: addon.description || '',
        price: addon.price,
      })),
    };
  },

  /**
   * Page 3 Widget: Capture T&C consent with full forensics.
   * Generates a consent_token that links consent to payment on Page 4.
   */
  async captureFunnelConsent(input: FunnelConsentInput) {
    const supabase = getSupabase();

    // Verify offer exists
    const offer = await offerRepository.findById(input.offerId);
    if (!offer || !offer.active) {
      throw new ValidationError('Offer not found or inactive');
    }

    const consentToken = crypto.randomUUID();
    const consentDevice = {
      userAgent: input.userAgent,
      deviceFingerprint: input.deviceFingerprint,
      screenResolution: input.screenResolution,
      timezone: input.timezone,
      browserLanguage: input.browserLanguage,
    };

    let paidEnrollmentId = '';
    let paidEnrollmentEmail = '';
    if (input.paidEnrollmentToken) {
      const token = verifyPublicActionToken(input.paidEnrollmentToken, 'paid_enrollment');
      const { data: paidEnrollment, error: paidError } = await supabase
        .from('enrollments')
        .select('id, offer_id, location_id, status, email')
        .eq('id', token.enrollmentId || '')
        .eq('location_id', token.locationId)
        .eq('offer_id', input.offerId)
        .eq('status', 'paid_pending_enrollment')
        .maybeSingle();
      if (paidError) throw paidError;
      if (!paidEnrollment) throw new ValidationError('Paid enrollment link is invalid or expired');
      paidEnrollmentId = paidEnrollment.id;
      paidEnrollmentEmail = paidEnrollment.email || '';
    }
    const effectiveEmail = input.email || paidEnrollmentEmail;

    // Find existing enrollment (created by device-capture on Page 1)
    const { data: existingRows } = paidEnrollmentId
      ? await supabase
        .from('enrollments')
        .select('id, status')
        .eq('id', paidEnrollmentId)
        .limit(1)
      : await supabase
        .from('enrollments')
        .select('id, status')
        .eq('email', effectiveEmail)
        .eq('offer_id', input.offerId)
        .in('status', ['device_captured', 'pending', 'paid_pending_enrollment'])
        .order('created_at', { ascending: false })
        .limit(5);
    const existing = (existingRows || []).find((row: any) => row.status === 'paid_pending_enrollment')
      || (existingRows || [])[0]
      || null;

    // Parse first/last name from digital signature (e.g., "Susan Katz" → "Susan", "Katz")
    const sigParts = (input.digitalSignature || '').trim().split(/\s+/);
    const firstName = sigParts[0] || '';
    const lastName = sigParts.slice(1).join(' ') || '';
    const cartQuote = await checkoutCartService.quoteOffer(
      offer,
      input.selectedAddonIds || [],
      'pif',
      'card',
    );
    const selectedCheckoutItems = checkoutCartService.lineItemsToSelectedCheckoutItems(cartQuote.lineItems);

    if (existing && (existing as any).status === 'paid_pending_enrollment') {
      const { payFirstEnrollmentService } = await import('./pay-first-enrollment.service');
      const finalized = await payFirstEnrollmentService.finalizePaidPendingEnrollment({
        enrollmentId: existing.id,
        locationId: offer.location_id,
        consentTimestamp: input.consentTimestamp,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        deviceFingerprint: input.deviceFingerprint,
        screenResolution: input.screenResolution,
        timezone: input.timezone,
        browserLanguage: input.browserLanguage,
        tcVersionHash: input.tcVersionHash,
        digitalSignature: input.digitalSignature,
        clausesAccepted: input.clausesAccepted,
        scrollDepth: input.scrollDepth,
      });
      if (finalized) return finalized;
    }

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('enrollments')
        .update({
          status: 'consent_captured',
          consent_token: consentToken,
          consent_captured_at: input.consentTimestamp,
          consent_ip: input.ipAddress,
          consent_device: JSON.stringify(consentDevice),
          tc_version_hash: input.tcVersionHash,
          digital_signature: input.digitalSignature,
          clauses_accepted: (input.clausesAccepted || []).filter(Boolean),
          scroll_depth: input.scrollDepth,
          first_name: firstName,
          last_name: lastName,
          selected_checkout_items: selectedCheckoutItems,
        })
        .eq('id', existing.id);

      if (error) throw error;

      logger.info({ enrollmentId: existing.id, offerId: input.offerId }, 'Funnel consent captured (updated)');

      // Free offer: complete enrollment immediately (skip checkout)
      const isFreeOffer = (!offer.price || Number(offer.price) === 0) && cartQuote.addonAmountCents === 0;
      if (isFreeOffer) {
        try {
          const { phase2EnrollmentService } = require('./phase2Enrollment.service');
          await phase2EnrollmentService.completeEnrollment({
            enrollmentId: existing.id,
            locationId: offer.location_id,
            contactId: (existing as any).contact_id || '',
            contactEmail: effectiveEmail,
            paymentAmount: 0,
            paymentType: 'free',
            transactionId: 'free_enrollment',
            paymentsTotal: null,
          });
          logger.info({ enrollmentId: existing.id }, 'Free offer: enrollment completed (no checkout)');
        } catch (freeErr: any) {
          logger.error({ err: freeErr.message, enrollmentId: existing.id }, 'Free offer completion failed');
        }
      }

      return { success: true, consentToken, enrollmentId: existing.id, freeOffer: isFreeOffer };
    }

    // No prior device capture — create new record
    const { data: created, error } = await supabase
      .from('enrollments')
      .insert({
        location_id: offer.location_id,
        offer_id: input.offerId,
        email: effectiveEmail,
        status: 'consent_captured',
        consent_token: consentToken,
        consent_captured_at: input.consentTimestamp,
        consent_ip: input.ipAddress,
        consent_device: JSON.stringify(consentDevice),
        tc_version_hash: input.tcVersionHash,
        digital_signature: input.digitalSignature,
        clauses_accepted: (input.clausesAccepted || []).filter(Boolean),
        scroll_depth: input.scrollDepth,
        first_name: firstName,
        last_name: lastName,
        selected_checkout_items: selectedCheckoutItems,
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info({ enrollmentId: created.id, offerId: input.offerId }, 'Funnel consent captured (new)');

    // Free offer: complete enrollment immediately (skip checkout)
    const isFreeOffer = (!offer.price || Number(offer.price) === 0) && cartQuote.addonAmountCents === 0;
    if (isFreeOffer) {
      try {
        const { phase2EnrollmentService } = require('./phase2Enrollment.service');
        await phase2EnrollmentService.completeEnrollment({
          enrollmentId: created.id,
          locationId: offer.location_id,
          contactId: '',
          contactEmail: effectiveEmail,
          paymentAmount: 0,
          paymentType: 'free',
          transactionId: 'free_enrollment',
          paymentsTotal: null,
        });
        logger.info({ enrollmentId: created.id }, 'Free offer: enrollment completed (no checkout)');
      } catch (freeErr: any) {
        logger.error({ err: freeErr.message, enrollmentId: created.id }, 'Free offer completion failed');
      }
    }

    return { success: true, consentToken, enrollmentId: created.id, freeOffer: isFreeOffer };
  },

  // ─── Original Enrollment Methods ──────────────────────────────

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
      dualPricingEnabled: Boolean((offer as any).dual_pricing_enabled),
      achEnabled: Boolean((offer as any).ach_enabled),
      achAccessPolicy: (offer as any).ach_access_policy || 'after_settlement',
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

    // Resolve enrollment + contact info for enriched evidence row
    let enrollmentId: string | null = null;
    let contactName = '';
    let contactEmail = '';
    try {
      const supabase = getSupabase();
      const { data: enr } = await supabase
        .from('enrollments')
        .select('id, email, first_name, last_name')
        .eq('location_id', input.locationId)
        .eq('contact_id', input.contactId)
        .eq('offer_id', input.offerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (enr) {
        enrollmentId = enr.id;
        contactName = [enr.first_name, enr.last_name].filter(Boolean).join(' ');
        contactEmail = enr.email || '';
      }
    } catch {}

    const fmtTs = new Date(input.consentTimestamp).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    // Log consent as evidence (enriched for defense letter quality)
    const { error } = await getSupabase()
      .from('evidence_consent')
      .insert({
        location_id: input.locationId,
        contact_id: input.contactId,
        offer_id: input.offerId,
        enrollment_id: enrollmentId,
        consent_timestamp: input.consentTimestamp,
        ip_address: input.ip,
        device_fingerprint: input.deviceFingerprint,
        browser: input.browser,
        user_agent: input.userAgent,
        tc_hash: tcHash,
        tc_version: 'v1',
        consent_method: 'checkbox',
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        raw_payload: {
          locationId: input.locationId, contactId: input.contactId, offerId: input.offerId,
          consentTimestamp: input.consentTimestamp, ip: input.ip, deviceFingerprint: input.deviceFingerprint,
          browser: input.browser, userAgent: input.userAgent, tcHash,
        },
        description: `${contactName || 'Client'}${contactEmail ? ` (${contactEmail})` : ''} accepted Terms & Conditions on ${fmtTs} from IP ${input.ip || 'unknown'} (${input.browser || 'unknown browser'}). Consent captured via checkbox. T&C hash: ${tcHash.slice(0, 12)}...`,
        ...buildDefenseEvidenceFields({
          summary: `${contactName || 'Client'}${contactEmail ? ` (${contactEmail})` : ''} accepted Terms & Conditions on ${fmtTs} from IP ${input.ip || 'unknown'} using ${input.browser || 'unknown browser'}. T&C hash: ${tcHash}.`,
          title: 'Terms & Conditions Acceptance',
          proofRole: 'terms_acceptance',
          relevance: {
            tags: ['authorization', 'fraud', 'not_as_described', 'credit_not_processed', 'cancelled_recurring'],
            priority: 'critical',
            confidence: 'strong',
          },
          enrollmentId,
          metadata: {
            actor: 'client',
            customerIdentity: {
              name: contactName || null,
              email: contactEmail || null,
              ipAddress: input.ip || null,
              deviceFingerprint: input.deviceFingerprint || null,
              browser: input.browser || null,
            },
            service: { enrollmentId, offerId: input.offerId },
            policy: {
              policyType: 'terms',
              policyVersion: 'v1',
              policyHash: tcHash,
              acceptedAt: input.consentTimestamp,
            },
            source: { system: 'enrollment_funnel', rawEventType: 'terms_consent' },
          },
        }),
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
    const offer = await offerRepository.getById(offerId, locationId);
    const merchant = await merchantRepository.getByLocationId(locationId);
    const api = await ghlApi(locationId);

    // 1. Update SS contact fields
    const customFields: Record<string, unknown> = {
      [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'active',
      [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
    };

    // 2. Copy offer fields to contact (written once)
    const businessName = merchant.dba_name || merchant.business_name || '';
    const supportEmail = merchant.support_email || (merchant as any).email || '';
    const receiptPriceDisplay = formatMoney(getSelectedPlanReceiptPrice(offer, offer.payment_type));
    const billingAmountDisplay = formatMoney((offer as any).installment_amount ?? offer.price);
    const numPayments = offer.num_payments ?? '';

    customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = businessName;
    customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name;
    customFields[OFFER_CONTACT_FIELDS.PRICE] = receiptPriceDisplay;
    customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = offer.payment_type;
    customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = billingAmountDisplay;
    customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = offer.installment_frequency;
    customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = numPayments;
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME] = offer.offer_name;
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PRICE_DISPLAY] = receiptPriceDisplay;
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.NUMBER_OF_PAYMENTS] = numPayments;
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL] = supportEmail;
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.TC_DOCUMENT_URL] = (merchant as any).tc_document_url || '';
    customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.REFUND_POLICY] = (offer as any).refund_policy || (offer as any).refund_terms || '';
    customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT] = billingAmountDisplay;
    customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE] = formatDate();
    customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE] = 1;
    customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING] = offer.num_payments ? Math.max(0, Number(offer.num_payments) - 1) : '';

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

    // 4. Log enrollment payment evidence (enriched for defense letter quality)
    // Resolve enrollment for linkage
    let payEnrollmentId: string | null = null;
    let payContactName = '';
    let payContactEmail = '';
    try {
      const { data: enr } = await getSupabase()
        .from('enrollments')
        .select('id, email, first_name, last_name')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('offer_id', offerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (enr) {
        payEnrollmentId = enr.id;
        payContactName = [enr.first_name, enr.last_name].filter(Boolean).join(' ');
        payContactEmail = enr.email || '';
      }
    } catch {}

    const payTimestamp = new Date().toISOString();
    const fmtPayDate = new Date(payTimestamp).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    await getSupabase().from('evidence_enrollment_payment').insert({
      location_id: locationId,
      contact_id: contactId,
      offer_id: offerId,
      enrollment_id: payEnrollmentId,
      ghl_order_id: input.ghlOrderId,
      ghl_transaction_id: input.ghlTransactionId,
      amount: input.paymentAmount,
      currency: 'USD',
      payment_method: input.paymentMethod,
      payment_timestamp: payTimestamp,
      processor_ref: input.ghlTransactionId || null,
      contact_name: payContactName || null,
      contact_email: payContactEmail || null,
      raw_payload: {
        ghlOrderId: input.ghlOrderId, ghlTransactionId: input.ghlTransactionId,
        paymentAmount: input.paymentAmount, paymentMethod: input.paymentMethod,
      },
      description: `Enrollment payment of $${Number(input.paymentAmount || 0).toFixed(2)} USD processed ${fmtPayDate} via ${input.paymentMethod || 'card'}. Transaction: ${input.ghlTransactionId || 'n/a'}. Program: ${offer.offer_name}.`,
      ...buildDefenseEvidenceFields({
        summary: `Initial enrollment payment of $${Number(input.paymentAmount || 0).toFixed(2)} USD for ${offer.offer_name} processed ${fmtPayDate} via ${input.paymentMethod || 'card'}. Transaction: ${input.ghlTransactionId || 'n/a'}.`,
        title: 'Initial Enrollment Payment',
        proofRole: 'payment_history',
        relevance: {
          tags: ['authorization', 'fraud', 'services_not_provided', 'credit_not_processed'],
          priority: 'critical',
          confidence: 'strong',
        },
        enrollmentId: payEnrollmentId,
        metadata: {
          actor: 'processor',
          customerIdentity: { name: payContactName || null, email: payContactEmail || null },
          service: { enrollmentId: payEnrollmentId, offerId, offerName: offer.offer_name },
          transaction: {
            processor: 'ghl',
            transactionId: input.ghlTransactionId || null,
            amount: input.paymentAmount as any,
            currency: 'USD',
            paymentSequence: 1,
          },
          source: { system: 'ghl_webhook', recordId: input.ghlTransactionId || input.ghlOrderId || null, rawEventType: 'enrollment_payment' },
        },
      }),
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
