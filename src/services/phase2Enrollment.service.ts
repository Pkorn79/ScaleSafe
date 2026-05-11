import { enrollmentRepository, EnrollmentRecord } from '../repositories/enrollment.repository';
import { phase2EvidenceRepository, EvidenceRecord } from '../repositories/phase2Evidence.repository';
import { paymentEventRepository, PaymentEventRecord } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { ghlApi } from '../clients/ghl.client';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';
import { createPublicActionToken } from '../utils/public-action-token';
import {
  SS_CONTACT_FIELDS,
  OFFER_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import { STANDARD_CLAUSES } from '../constants/standard-clauses';

// GHL CHECKBOX field_value for the single-option "Yes" Click-Wrap fields. Pulled to a
// const so the manual E2E verification step (see CHANGELOG 2026-04-26) can swap in
// `['Yes']` or `true` if GHL silently no-ops on plain string. Read-back data on
// existing single-option checkbox fields stores them as the bare option label.
const CLICK_WRAP_CHECKED_VALUE = 'Yes';

function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value);
}

function formatDate(value: Date = new Date()): string {
  return value.toISOString().split('T')[0];
}

function formatPaymentType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === 'pif') return 'Paid in full';
  if (raw === 'installment' || raw === 'installments') return 'Installment';
  if (raw === 'subscription') return 'Subscription';
  if (raw === 'free') return 'Free';
  return raw.replace(/_/g, ' ');
}

function formatFrequency(value: unknown): string {
  const raw = String(value || '').trim();
  const labels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    bi_weekly: 'Bi-weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annual: 'Annual',
  };
  return labels[raw] || raw.replace(/_/g, ' ');
}

function merchantSupportEmail(merchant: any): string {
  return merchant?.support_email || merchant?.email || '';
}

function applyPaymentContactFields(
  customFields: Record<string, unknown>,
  amount: number,
  paymentsMade: number | null | undefined,
  paymentsTotal: number | null | undefined,
  transactionDate = new Date(),
): void {
  const made = Number(paymentsMade || 0);
  const total = paymentsTotal == null ? null : Number(paymentsTotal);
  const remaining = total == null ? '' : Math.max(0, total - made);
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT] = formatMoney(amount);
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE] = formatDate(transactionDate);
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE] = made;
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING] = remaining;
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.SUCCESSFUL_PAYMENT_COUNT] = made;
  customFields[WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID] = formatMoney(amount * made);
}

function applyOfferContactFields(
  customFields: Record<string, unknown>,
  offer: any,
  merchant: any,
): void {
  const businessName = merchant?.dba_name || merchant?.business_name || '';
  const priceDisplay = formatMoney(offer.price);
  const billingAmount = offer.installment_amount ?? offer.price;
  const billingAmountDisplay = formatMoney(billingAmount);
  const paymentTypeDisplay = formatPaymentType(offer.payment_type);
  const frequencyDisplay = formatFrequency(offer.installment_frequency);
  const numPayments = offer.num_payments ?? '';

  customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = businessName;
  customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name || '';
  customFields[OFFER_CONTACT_FIELDS.PRICE] = priceDisplay;
  customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = paymentTypeDisplay;
  customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = billingAmountDisplay;
  customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = frequencyDisplay;
  customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = numPayments;
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME] = offer.offer_name || '';
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PRICE_DISPLAY] = priceDisplay;
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.NUMBER_OF_PAYMENTS] = numPayments;
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL] = merchantSupportEmail(merchant);
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.TC_DOCUMENT_URL] = merchant?.tc_document_url || '';
  customFields[WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.REFUND_POLICY] = offer.refund_policy || offer.refund_terms || '';
}

interface CompleteEnrollmentParams {
  enrollmentId: string;
  locationId: string;
  contactId: string;
  contactEmail?: string;
  paymentAmount: number;
  paymentType: string;
  transactionId: string;
  paymentsTotal: number | null;
  processorType?: string;
}

export interface EnrollmentWithEvidence {
  enrollment: EnrollmentRecord;
  evidence: EvidenceRecord[];
  paymentEvents: PaymentEventRecord[];
}

export const phase2EnrollmentService = {
  async completeEnrollment(params: CompleteEnrollmentParams): Promise<void> {
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);

    // Backfill merchant_id if it was null at consent capture time.
    // consent.service.ts can write merchant_id=null when findByLocationId returns null
    // (e.g., merchant not yet provisioned or transient lookup failure). At completion time
    // the merchant MUST exist — the upstream charge succeeded, which means
    // ProcessorFactory found a processor_config keyed off this merchant's location.
    // Without this backfill, downstream payment_events inserts for recurring charges
    // hit the merchant_id NOT NULL constraint and silently fail.
    let backfillMerchantId: string | undefined;
    if (!enrollment.merchant_id) {
      try {
        const merchant = await merchantRepository.findByLocationId(params.locationId);
        if (merchant) {
          backfillMerchantId = merchant.id;
          logger.info(
            { enrollmentId: params.enrollmentId, locationId: params.locationId, merchantId: merchant.id },
            'completeEnrollment: backfilling merchant_id on consent-captured enrollment',
          );
        } else {
          logger.error(
            { enrollmentId: params.enrollmentId, locationId: params.locationId },
            'completeEnrollment: merchant lookup returned null at completion time — recurring payment_events inserts will fail NOT NULL on merchant_id',
          );
        }
      } catch (mErr: any) {
        logger.error({ err: mErr.message, enrollmentId: params.enrollmentId }, 'completeEnrollment: merchant backfill lookup threw');
      }
    }

    // Fetch offer for trigger payload and contact-field sync.
    let offerName = '';
    let enrollmentOffer: any = null;
    if (enrollment.offer_id) {
      try {
        enrollmentOffer = await offerRepository.getById(enrollment.offer_id);
        offerName = enrollmentOffer.offer_name;
      } catch {
        logger.warn({ offerId: enrollment.offer_id }, 'Could not fetch offer for trigger payload');
      }
    }

    // 1. Update enrollment to 'enrolled' + set next_billing_date for installments/subscriptions
    const enrolledAt = new Date();
    let nextBilling: string | null = null;
    if (['installment', 'installments', 'subscription'].includes(params.paymentType)) {
      // Get frequency from offer
      try {
        if (enrollment.offer_id) {
          const ofr = await offerRepository.findById(enrollment.offer_id);
          if (ofr) {
            const freq = ofr.installment_frequency || 'monthly';
            const next = new Date(enrolledAt);
            if (freq === 'daily') next.setDate(next.getDate() + 1);
            else if (freq === 'weekly') next.setDate(next.getDate() + 7);
            else if (freq === 'bi_weekly') next.setDate(next.getDate() + 14);
            else if (freq === 'quarterly') next.setMonth(next.getMonth() + 3);
            else if (freq === 'annual') next.setFullYear(next.getFullYear() + 1);
            else next.setMonth(next.getMonth() + 1); // monthly default
            nextBilling = next.toISOString().split('T')[0];
          }
        }
      } catch { /* non-blocking */ }
    }
    const finiteBillingComplete = params.paymentType !== 'subscription'
      && params.paymentsTotal != null
      && params.paymentsTotal <= 1;
    if (finiteBillingComplete) {
      nextBilling = null;
    }
    await enrollmentRepository.updateStatus(params.enrollmentId, 'enrolled', {
      payment_amount: params.paymentAmount,
      payment_type: params.paymentType,
      payment_transaction_id: params.transactionId,
      processor_type: params.processorType || null,
      payments_made: 1,
      payments_total: params.paymentsTotal,
      ...(finiteBillingComplete ? { billing_completed_at: enrolledAt.toISOString() } : {}),
      enrolled_at: enrolledAt.toISOString(),
      ...(nextBilling ? { next_billing_date: nextBilling } : {}),
      ...(backfillMerchantId ? { merchant_id: backfillMerchantId } : {}),
    } as any);

    // 2. Resolve GHL contact FIRST — evidence and payment records need the contactId
    let resolvedContactId = params.contactId;
    if (params.locationId) {
      try {
        const api = await ghlApi(params.locationId);

        // Find or create GHL contact if we don't have one
        const email = params.contactEmail || (enrollment as any).email || '';
        if (!resolvedContactId && email) {
          // Name priority: enrollment first_name/last_name → digital_signature parse → email prefix
          let firstName = (enrollment as any).first_name || '';
          let lastName = (enrollment as any).last_name || '';
          if (!firstName && (enrollment as any).digital_signature) {
            const sigParts = ((enrollment as any).digital_signature as string).trim().split(/\s+/);
            firstName = sigParts[0] || '';
            lastName = sigParts.slice(1).join(' ') || '';
          }
          if (!firstName) {
            firstName = email.split('@')[0] || 'Client';
          }

          const upsertRes = await api.post('/contacts/upsert', {
            firstName,
            lastName,
            email,
            locationId: params.locationId,
          });
          resolvedContactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
          if (resolvedContactId) {
            await enrollmentRepository.updateStatus(params.enrollmentId, 'enrolled', {
              contact_id: resolvedContactId,
            } as any);
            logger.info({ resolvedContactId, firstName, lastName, enrollmentId: params.enrollmentId }, 'GHL contact resolved before evidence insert');
          }
        }
      } catch (ghlErr: any) {
        logger.error({ err: ghlErr.message, stack: ghlErr.stack, enrollmentId: params.enrollmentId }, 'GHL contact resolution failed — evidence will use empty contactId');
      }
    }

    // 3-5. Log consent evidence, payment evidence, and payment event — all in parallel
    if (params.locationId && resolvedContactId) {
      try {
        const api = await ghlApi(params.locationId);
        const merchant = await merchantRepository.getByLocationId(params.locationId);
        const customFields: Record<string, unknown> = {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled',
          [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
        };
        if (enrollmentOffer) {
          applyOfferContactFields(customFields, enrollmentOffer, merchant);
        }
        applyPaymentContactFields(customFields, params.paymentAmount, 1, params.paymentsTotal, enrolledAt);
        await api.put(`/contacts/${resolvedContactId}`, { customField: customFields });
        logger.info({ contactId: resolvedContactId, enrollmentId: params.enrollmentId }, 'GHL contact fields synced before workflow triggers');
      } catch (ghlSyncErr: any) {
        logger.error({ err: ghlSyncErr.message, enrollmentId: params.enrollmentId }, 'GHL contact field sync before workflow triggers failed');
      }
    }

    await Promise.allSettled([
      phase2EvidenceRepository.create({
        location_id: params.locationId,
        contact_id: resolvedContactId,
        enrollment_id: params.enrollmentId,
        evidence_type: 'consent',
        data: {
          digital_signature: (enrollment as any).digital_signature || '',
          clauses_accepted: (enrollment as any).clauses_accepted || [],
          scroll_depth: (enrollment as any).scroll_depth || 0,
          ip_address: (enrollment as any).consent_ip || '',
          consent_captured_at: (enrollment as any).consent_captured_at || '',
        },
        ip_address: (enrollment as any).consent_ip || '',
        device_info: (enrollment as any).consent_device || '',
      }),
      phase2EvidenceRepository.create({
        location_id: params.locationId,
        contact_id: resolvedContactId,
        enrollment_id: params.enrollmentId,
        evidence_type: 'enrollment_payment',
        data: {
          amount: params.paymentAmount,
          payment_type: params.paymentType,
          transaction_id: params.transactionId,
          payments_total: params.paymentsTotal,
          timestamp: new Date().toISOString(),
        },
      }),
      paymentEventRepository.create({
        location_id: params.locationId,
        contact_id: resolvedContactId,
        enrollment_id: params.enrollmentId,
        event_type: 'payment_success',
        processor: params.processorType || 'ghl',
        processor_transaction_id: params.transactionId,
        amount: params.paymentAmount,
        payment_number: 1,
        payments_remaining: params.paymentsTotal ? params.paymentsTotal - 1 : undefined,
        source: 'checkout',
        is_recurring: false,
      }),
    ]).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const labels = ['Consent evidence', 'Payment evidence', 'Payment event'];
          logger.error({ err: (r.reason as any)?.message, enrollmentId: params.enrollmentId }, `${labels[i]} insert failed`);
        }
      });
    });

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: resolvedContactId, locationId: params.locationId },
      'Enrollment completed (critical path done — background work queued)',
    );

    // ─── FIRE-AND-FORGET: Steps 6-9 run in background after function returns ───
    // These are important but NOT on the checkout critical path. Trigger firing,
    // GHL field updates, opportunity creation, PDF generation, and evidence chain
    // verification all run asynchronously so the checkout response is fast (~5-7s
    // instead of ~12s).
    const bgEnrollmentId = params.enrollmentId;
    const bgLocationId = params.locationId;
    const bgContactId = resolvedContactId;
    const bgOfferId = enrollment.offer_id;
    const bgPaymentAmount = params.paymentAmount;
    const bgPaymentType = params.paymentType;

    Promise.resolve().then(async () => {
      // 6. Fire enrollment_complete trigger
      try {
        await triggerService.fireTrigger(bgLocationId, 'enrollment_complete', {
          event_type: 'enrollment_complete',
          location_id: bgLocationId,
          locationId: bgLocationId,
          contact_id: bgContactId,
          contactId: bgContactId,
          contact_email: params.contactEmail || (enrollment as any).email || '',
          contactEmail: params.contactEmail || (enrollment as any).email || '',
          enrollment_id: bgEnrollmentId,
          enrollmentId: bgEnrollmentId,
          offer_id: bgOfferId,
          offerId: bgOfferId,
          offer_name: offerName,
          offerName,
          amount: bgPaymentAmount,
          payment_type: bgPaymentType,
          paymentType: bgPaymentType,
          bump_1_accepted: false,
          bump_2_accepted: false,
        });
      } catch (triggerErr: any) {
        logger.warn({ err: triggerErr.message, enrollmentId: bgEnrollmentId }, 'BG: trigger fire failed');
      }

      // 7. Update GHL contact fields and initialize app-owned pulse cadence.
      if (bgLocationId && bgContactId) {
        try {
          const api = await ghlApi(bgLocationId);
          const merchant = await merchantRepository.getByLocationId(bgLocationId);
          let pulseCadenceEnabled = false;
          let pulseFrequencyDays = 30;

          const customFields: Record<string, unknown> = {
            [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled',
            [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
          };
          if (bgOfferId) {
            try {
              const offer = await offerRepository.getById(bgOfferId);
              applyOfferContactFields(customFields, offer, merchant);
              applyPaymentContactFields(customFields, bgPaymentAmount, 1, params.paymentsTotal, enrolledAt);
              pulseCadenceEnabled = (offer as any).checkout_mode !== 'quick_checkout' && offer.pulse_cadence_enabled !== false;
              pulseFrequencyDays = Math.min(365, Math.max(1, Number(offer.pulse_frequency_days || 30)));
            } catch {}
          }

          // Mirror Supabase enrollment.clauses_accepted into the per-clause
          // "Click-Wrap: X" CHECKBOX contact fields (snapshot fixtures, written
          // by stable fieldKey). Custom-clause keys silently skip via STANDARD_CLAUSES.find.
          try {
            const { getSupabase } = require('../clients/supabase.client');
            const { data: enrollmentRow } = await getSupabase()
              .from('enrollments')
              .select('clauses_accepted')
              .eq('id', bgEnrollmentId)
              .maybeSingle();
            const accepted: string[] = (enrollmentRow?.clauses_accepted as string[] | null) || [];
            const clickWrapFieldsSet: string[] = [];
            for (const clauseKey of accepted) {
              const clause = STANDARD_CLAUSES.find((c) => c.key === clauseKey);
              if (clause?.ghlFieldKey) {
                customFields[clause.ghlFieldKey] = CLICK_WRAP_CHECKED_VALUE;
                clickWrapFieldsSet.push(clause.ghlFieldKey);
              }
            }
            if (clickWrapFieldsSet.length > 0) {
              logger.debug(
                { enrollmentId: bgEnrollmentId, clickWrapFieldsSet },
                'BG: click-wrap clause fields queued for GHL',
              );
            }
          } catch (clauseErr: any) {
            logger.warn(
              { err: clauseErr.message, enrollmentId: bgEnrollmentId },
              'BG: click-wrap clause resolution failed',
            );
          }

          await api.put(`/contacts/${bgContactId}`, { customField: customFields });
          if (pulseCadenceEnabled) {
            const nextPulseDue = new Date();
            nextPulseDue.setDate(nextPulseDue.getDate() + pulseFrequencyDays);
            const { getSupabase } = require('../clients/supabase.client');
            await getSupabase()
              .from('enrollments')
              .update({
                pulse_cadence_enabled: true,
                pulse_frequency_days: pulseFrequencyDays,
                next_pulse_due_at: nextPulseDue.toISOString(),
                last_pulse_sent_at: null,
              })
              .eq('id', bgEnrollmentId);
          }

          logger.info({ contactId: bgContactId, pulseCadenceEnabled, pulseFrequencyDays }, 'BG: GHL contact updated');
        } catch (err: any) {
          logger.error({ err: err.message, enrollmentId: bgEnrollmentId }, 'BG: GHL sync after enrollment failed');
        }
      }

      // 8. Generate enrollment packet PDF
      try {
        const { enrollmentPacketService } = require('./enrollment-packet.service');
        const pdfUrl = await enrollmentPacketService.generateAndStore(bgEnrollmentId, bgLocationId);
        logger.info({ enrollmentId: bgEnrollmentId, pdfUrl }, 'BG: PACKET auto-generation succeeded');
      } catch (pdfErr: any) {
        logger.error({ err: pdfErr.message, enrollmentId: bgEnrollmentId }, 'BG: PACKET auto-generation FAILED');
      }

      // 9. Verify evidence chain
      try {
        const { evidenceChainService } = require('./evidence-chain.service');
        const { getSupabase: getSb } = require('../clients/supabase.client');
        const { data: pe } = await getSb().from('payment_events')
          .select('id').eq('enrollment_id', bgEnrollmentId).eq('event_type', 'sale')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (pe) {
          const chain = await evidenceChainService.verifyChain(pe.id);
          logger.info({ enrollmentId: bgEnrollmentId, chainStrength: chain.chainStrength, complete: chain.complete }, 'BG: Evidence chain verified');
        }
      } catch (chainErr: any) {
        logger.warn({ err: chainErr.message, enrollmentId: bgEnrollmentId }, 'BG: Evidence chain verification failed');
      }
    }).catch((bgErr: any) => {
      logger.error({ err: bgErr.message, enrollmentId: bgEnrollmentId }, 'BG: post-enrollment background work failed');
    });
  },

  async handleRecurringPayment(params: {
    locationId: string;
    contactId: string;
    enrollmentId: string;
    amount: number;
    transactionId: string;
    paymentNumber?: number;
    paymentsRemaining?: number;
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    // Create payment_event
    await paymentEventRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      enrollment_id: params.enrollmentId,
      event_type: 'payment_success',
      processor: 'ghl',
      processor_transaction_id: params.transactionId,
      amount: params.amount,
      payment_number: params.paymentNumber,
      payments_remaining: params.paymentsRemaining,
      raw_webhook_payload: params.rawPayload,
    });

    // Increment payments_made + advance or finish billing.
    await enrollmentRepository.incrementPaymentsMade(params.enrollmentId);
    try {
      const enr = await enrollmentRepository.getById(params.enrollmentId);
      if (enr.offer_id) {
        const ofr = await offerRepository.findById(enr.offer_id);
        if (ofr) {
          const isFinalInstallment = enr.payment_type !== 'subscription'
            && enr.payments_total != null
            && enr.payments_made >= enr.payments_total;
          const updates: Record<string, unknown> = {};
          if (isFinalInstallment) {
            updates.next_billing_date = null;
            updates.billing_completed_at = new Date().toISOString();
          } else {
            const freq = ofr.installment_frequency || 'monthly';
            const next = new Date();
            if (freq === 'daily') next.setDate(next.getDate() + 1);
            else if (freq === 'weekly') next.setDate(next.getDate() + 7);
            else if (freq === 'bi_weekly') next.setDate(next.getDate() + 14);
            else if (freq === 'quarterly') next.setMonth(next.getMonth() + 3);
            else if (freq === 'annual') next.setFullYear(next.getFullYear() + 1);
            else next.setMonth(next.getMonth() + 1);
            updates.next_billing_date = next.toISOString().split('T')[0];
          }
          await enrollmentRepository.updateStatus(params.enrollmentId, enr.status, updates as any);
        }
      }
    } catch { /* non-blocking */ }

    // Log evidence
    await phase2EvidenceRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      enrollment_id: params.enrollmentId,
      evidence_type: 'payment_received',
      data: {
        amount: params.amount,
        transaction_id: params.transactionId,
        payment_number: params.paymentNumber,
        payments_remaining: params.paymentsRemaining,
        timestamp: new Date().toISOString(),
      },
    });

    // Fire trigger — flat doc contract: contact_id, amount, transaction_id, payments_remaining, running_total, payment_kind
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);
    const runningTotal = (enrollment.payments_made) * params.amount;
    const paymentKind: 'installment' | 'subscription' = enrollment.payment_type === 'subscription' ? 'subscription' : 'installment';
    try {
      const api = await ghlApi(params.locationId);
      const paymentFields: Record<string, unknown> = {};
      applyPaymentContactFields(paymentFields, params.amount, enrollment.payments_made, enrollment.payments_total);
      await api.put(`/contacts/${params.contactId}`, { customField: paymentFields });
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Recurring payment contact field sync failed');
    }
    await triggerService.fireTrigger(params.locationId, 'ss_payment_received', {
      event_type: 'payment_received',
      location_id: params.locationId,
      locationId: params.locationId,
      contact_id: params.contactId,
      contactId: params.contactId,
      enrollment_id: params.enrollmentId,
      enrollmentId: params.enrollmentId,
      amount: params.amount,
      transaction_id: params.transactionId,
      transactionId: params.transactionId,
      payments_remaining: params.paymentsRemaining,
      paymentsRemaining: params.paymentsRemaining,
      running_total: runningTotal,
      runningTotal,
      payment_kind: paymentKind,
      paymentKind,
    });

    // Final installment billing marker.
    if (enrollment.payment_type !== 'subscription' && enrollment.payments_total && enrollment.payments_made >= enrollment.payments_total) {
      logger.info({ enrollmentId: params.enrollmentId, paymentsMade: enrollment.payments_made, paymentsTotal: enrollment.payments_total }, 'Recurring payment: billing complete; program remains active');
    }

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: params.contactId, amount: params.amount },
      'Recurring payment processed',
    );
  },

  async handleFailedPayment(params: {
    locationId: string;
    contactId: string;
    enrollmentId: string | null;
    amount: number;
    transactionId?: string;
    failureReason?: string;
    attemptCount?: number;
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    await paymentEventRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      enrollment_id: params.enrollmentId,
      event_type: 'payment_failed',
      processor: 'ghl',
      processor_transaction_id: params.transactionId,
      amount: params.amount,
      failure_reason: params.failureReason,
      attempt_count: params.attemptCount || 1,
      raw_webhook_payload: params.rawPayload,
    });

    if (params.enrollmentId) {
      await phase2EvidenceRepository.create({
        location_id: params.locationId,
        contact_id: params.contactId,
        enrollment_id: params.enrollmentId,
        evidence_type: 'payment_failed',
        data: {
          amount: params.amount,
          failure_reason: params.failureReason,
          attempt_count: params.attemptCount || 1,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Build enriched payload for GHL workflow
    const { config: appConfig } = require('../config');
    const baseUrl = appConfig.appUrl;
    const actionToken = createPublicActionToken({
      action: 'payment_update',
      contactId: params.contactId,
      locationId: params.locationId,
    });
    const cardUpdateLink = `${baseUrl}/payment-update?actionToken=${encodeURIComponent(actionToken)}`;

    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'past_due',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.FAILED_PAYMENT_COUNT]: params.attemptCount || 1,
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_FAILED_PAYMENT_DATE]: formatDate(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(params.amount),
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Failed payment contact field sync failed');
    }

    await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
      contact_id: params.contactId,
      amount: params.amount,
      failure_reason: params.failureReason || 'unknown',
      attempt_count: params.attemptCount || 1,
      next_retry_date: 'none',
    });

    // Initiate dunning for recurring payment failures
    if (params.enrollmentId) {
      try {
        const { paymentLifecycleService } = require('./payment-lifecycle.service');
        const merchant = await merchantRepository.getByLocationId(params.locationId);
        // Get the payment event ID we just created (most recent for this enrollment)
        const { getSupabase } = require('../clients/supabase.client');
        const { data: pe } = await getSupabase().from('payment_events')
          .select('id').eq('enrollment_id', params.enrollmentId).eq('event_type', 'payment_failed')
          .order('created_at', { ascending: false }).limit(1).single();
        if (pe) {
          await paymentLifecycleService.initiateDunning({
            merchantId: merchant.id,
            locationId: params.locationId,
            contactId: params.contactId,
            offerId: '',
            paymentEventId: pe.id,
            failureReason: params.failureReason || 'unknown',
            failureCode: '',
            amountCents: Math.round((params.amount || 0) * 100),
            attemptCount: params.attemptCount || 1,
          });
        }
      } catch (dunningErr: any) {
        logger.warn({ err: dunningErr.message, enrollmentId: params.enrollmentId }, 'Dunning initiation failed (non-blocking)');
      }
    }

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: params.contactId, amount: params.amount },
      'Failed payment logged',
    );
  },

  async handleRefund(params: {
    locationId: string;
    contactId: string;
    enrollmentId: string | null;
    amount: number;
    transactionId?: string;
    reason?: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    await paymentEventRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      enrollment_id: params.enrollmentId,
      event_type: 'refund',
      processor: 'ghl',
      processor_transaction_id: params.transactionId,
      amount: params.amount,
      raw_webhook_payload: params.rawPayload,
    });

    if (params.enrollmentId) {
      await phase2EvidenceRepository.create({
        location_id: params.locationId,
        contact_id: params.contactId,
        enrollment_id: params.enrollmentId,
        evidence_type: 'refund_processed',
        data: {
          amount: params.amount,
          reason: params.reason,
          transaction_id: params.transactionId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: {
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_AMOUNT]: formatMoney(params.amount),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_DATE]: formatDate(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_TRANSACTION_ID]: params.transactionId || '',
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Refund contact field sync failed');
    }

    await triggerService.fireTrigger(params.locationId, 'ss_refund_processed', {
      contact_id: params.contactId,
      amount: params.amount,
      refund_type: 'full',
      reason: params.reason || '',
    });

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: params.contactId, amount: params.amount },
      'Refund processed',
    );
  },

  async getEnrollmentDetails(
    enrollmentId: string,
    locationId: string,
  ): Promise<EnrollmentWithEvidence> {
    const enrollment = await enrollmentRepository.getById(enrollmentId);
    if (enrollment.location_id !== locationId) {
      throw new NotFoundError(`Enrollment ${enrollmentId}`);
    }

    const [evidence, paymentEvents] = await Promise.all([
      phase2EvidenceRepository.findByEnrollment(enrollmentId),
      paymentEventRepository.findByEnrollment(enrollmentId),
    ]);

    return { enrollment, evidence, paymentEvents };
  },
};
