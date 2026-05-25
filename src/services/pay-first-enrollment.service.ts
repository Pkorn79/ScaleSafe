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
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { config } from '../config';

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

async function buildEnrollmentUrl(locationId: string, offerId: string): Promise<string> {
  let funnelBaseUrl = '';
  try {
    const mc = await merchantService.getFullConfig(locationId);
    funnelBaseUrl = mc.enrollmentFunnelUrl || '';
  } catch {}
  return offerService.generateEnrollmentLink(offerId, config.appUrl, 'full_enrollment', funnelBaseUrl);
}

async function upsertContact(locationId: string, input: RecordPayFirstInput): Promise<string> {
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
        enrolled_at: new Date().toISOString(),
      })
      .eq('id', params.enrollmentId);
    if (updateError) throw updateError;

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

    const offer = enrollment.offer_id ? await offerRepository.findById(enrollment.offer_id, params.locationId).catch(() => null) : null;
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
      payment_type: enrollment.payment_type || '',
      paymentType: enrollment.payment_type || '',
      pay_first: true,
      payFirst: true,
    });

    return {
      success: true,
      enrollmentId: params.enrollmentId,
      consentToken: null,
      paidPendingCompleted: true,
      freeOffer: true,
    };
  },
};
