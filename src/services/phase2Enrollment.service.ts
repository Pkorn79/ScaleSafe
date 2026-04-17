import { enrollmentRepository, EnrollmentRecord } from '../repositories/enrollment.repository';
import { evidenceRepository } from '../repositories/evidence.repository';
import { phase2EvidenceRepository, EvidenceRecord } from '../repositories/phase2Evidence.repository';
import { paymentEventRepository, PaymentEventRecord } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { ghlApi } from '../clients/ghl.client';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';
import { SS_CONTACT_FIELDS, OFFER_CONTACT_FIELDS } from '../constants/ghl-fields';

interface CompleteEnrollmentParams {
  enrollmentId: string;
  locationId: string;
  contactId: string;
  contactEmail?: string;
  paymentAmount: number;
  paymentType: string;
  transactionId: string;
  paymentsTotal: number | null;
}

export interface EnrollmentWithEvidence {
  enrollment: EnrollmentRecord;
  evidence: EvidenceRecord[];
  paymentEvents: PaymentEventRecord[];
}

export const phase2EnrollmentService = {
  async completeEnrollment(params: CompleteEnrollmentParams): Promise<void> {
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);

    // Fetch offer name for trigger payload
    let offerName = '';
    if (enrollment.offer_id) {
      try {
        const offer = await offerRepository.getById(enrollment.offer_id);
        offerName = offer.offer_name;
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
            if (freq === 'weekly') next.setDate(next.getDate() + 7);
            else if (freq === 'bi_weekly') next.setDate(next.getDate() + 14);
            else next.setMonth(next.getMonth() + 1); // monthly default
            nextBilling = next.toISOString().split('T')[0];
          }
        }
      } catch { /* non-blocking */ }
    }
    await enrollmentRepository.updateStatus(params.enrollmentId, 'enrolled', {
      payment_amount: params.paymentAmount,
      payment_type: params.paymentType,
      payment_transaction_id: params.transactionId,
      payments_made: 1,
      payments_total: params.paymentsTotal,
      enrolled_at: enrolledAt.toISOString(),
      ...(nextBilling ? { next_billing_date: nextBilling } : {}),
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

    // 3. Log consent evidence (non-blocking — uses resolved contactId)
    try {
      await phase2EvidenceRepository.create({
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
      });
    } catch (consentErr: any) {
      logger.error({ err: consentErr.message, stack: consentErr.stack, enrollmentId: params.enrollmentId, contactId: resolvedContactId }, 'Consent evidence insert failed');
    }

    // 4. Log enrollment_payment evidence (non-blocking — uses resolved contactId)
    try {
      await phase2EvidenceRepository.create({
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
      });
    } catch (evidenceErr: any) {
      logger.error({ err: evidenceErr.message, stack: evidenceErr.stack, enrollmentId: params.enrollmentId, contactId: resolvedContactId }, 'Payment evidence insert failed');
    }

    // 5. Create payment_event record (non-blocking — uses resolved contactId)
    try {
      await paymentEventRepository.create({
        location_id: params.locationId,
        contact_id: resolvedContactId,
        enrollment_id: params.enrollmentId,
        event_type: 'payment_success',
        processor: 'ghl',
        processor_transaction_id: params.transactionId,
        amount: params.paymentAmount,
        payment_number: 1,
        payments_remaining: params.paymentsTotal ? params.paymentsTotal - 1 : undefined,
      });
    } catch (paymentErr: any) {
      logger.error({ err: paymentErr.message, stack: paymentErr.stack, enrollmentId: params.enrollmentId, contactId: resolvedContactId }, 'Payment event insert failed');
    }

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
          contact_id: bgContactId,
          offer_id: bgOfferId,
          offer_name: offerName,
          amount: bgPaymentAmount,
          payment_type: bgPaymentType,
          bump_1_accepted: false,
          bump_2_accepted: false,
        });
      } catch (triggerErr: any) {
        logger.warn({ err: triggerErr.message, enrollmentId: bgEnrollmentId }, 'BG: trigger fire failed');
      }

      // 7. Update GHL contact fields + create pipeline opportunity
      if (bgLocationId && bgContactId) {
        try {
          const api = await ghlApi(bgLocationId);
          const merchant = await merchantRepository.getByLocationId(bgLocationId);

          const customFields: Record<string, unknown> = {
            [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled',
            [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
          };

          if (bgOfferId) {
            try {
              const offer = await offerRepository.getById(bgOfferId);
              customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = merchant.business_name || '';
              customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name;
              customFields[OFFER_CONTACT_FIELDS.PRICE] = offer.price;
              customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = offer.payment_type;
              customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = offer.installment_amount;
              customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = offer.installment_frequency;
              customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = offer.num_payments;
            } catch {}
          }

          await api.put(`/contacts/${bgContactId}`, { customField: customFields });

          const pipelineId = (merchant.config as any)?.milestones_pipeline_id || (merchant.config as any)?.pipelineId;
          const stageId = (merchant.config as any)?.enrolled_stage_id;
          if (pipelineId) {
            await api.post('/opportunities/', {
              locationId: bgLocationId,
              contactId: bgContactId,
              pipelineId,
              stageId: stageId || '',
              name: `${offerName || 'Program'} — Enrollment`,
              monetaryValue: bgPaymentAmount,
            });
          }

          logger.info({ contactId: bgContactId }, 'BG: GHL contact updated + opportunity created');
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

    // Increment payments_made + advance next_billing_date
    await enrollmentRepository.incrementPaymentsMade(params.enrollmentId);
    try {
      const enr = await enrollmentRepository.getById(params.enrollmentId);
      if (enr.offer_id) {
        const ofr = await offerRepository.findById(enr.offer_id);
        if (ofr) {
          const freq = ofr.installment_frequency || 'monthly';
          const next = new Date();
          if (freq === 'weekly') next.setDate(next.getDate() + 7);
          else if (freq === 'bi_weekly') next.setDate(next.getDate() + 14);
          else next.setMonth(next.getMonth() + 1);
          await enrollmentRepository.updateStatus(params.enrollmentId, enr.status, {
            next_billing_date: next.toISOString().split('T')[0],
          } as any);
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

    // Fire trigger — flat doc contract: contact_id, amount, transaction_id, payments_remaining, running_total
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);
    const runningTotal = (enrollment.payments_made) * params.amount;
    await triggerService.fireTrigger(params.locationId, 'ss_payment_received', {
      contact_id: params.contactId,
      amount: params.amount,
      transaction_id: params.transactionId,
      payments_remaining: params.paymentsRemaining,
      running_total: runningTotal,
    });

    // Final installment detection — all payments complete
    if (enrollment.payments_total && enrollment.payments_made >= enrollment.payments_total) {
      try {
        // Update enrollment to completed
        await enrollmentRepository.updateStatus(params.enrollmentId, 'completed', {
          completed_at: new Date().toISOString(),
        } as any);

        // Log completion evidence
        await phase2EvidenceRepository.create({
          location_id: params.locationId,
          contact_id: params.contactId,
          enrollment_id: params.enrollmentId,
          evidence_type: 'custom_event',
          data: {
            event_type: 'program_completed',
            total_payments: enrollment.payments_total,
            total_amount: runningTotal,
            completion_date: new Date().toISOString(),
          },
        });

        // Fire program completed trigger
        let offerName = '';
        if (enrollment.offer_id) {
          try {
            const offer = await offerRepository.getById(enrollment.offer_id);
            offerName = offer.offer_name;
          } catch { /* non-blocking */ }
        }
        // Get evidence counts for session/milestone totals
        let totalSessions = 0;
        let totalMilestones = 0;
        try {
          const counts = await evidenceRepository.getCounts(params.locationId, params.contactId);
          totalSessions = (counts['session_delivery'] || 0) + (counts['external_session'] || 0);
          totalMilestones = (counts['milestone_completion'] || 0) + (counts['milestone_signoff'] || 0);
        } catch {}

        await triggerService.fireTrigger(params.locationId, 'ss_program_completed', {
          contact_id: params.contactId,
          offer_id: enrollment.offer_id || '',
          offer_name: offerName,
          total_sessions: totalSessions,
          total_milestones: totalMilestones,
          total_payments: enrollment.payments_total,
          total_amount: runningTotal,
          enrollment_date: enrollment.enrolled_at || '',
          completion_date: new Date().toISOString(),
        });

        // Update GHL contact status
        try {
          const api = await ghlApi(params.locationId);
          await api.put(`/contacts/${params.contactId}`, {
            customField: { 'contact.ss_enrollment_status': 'completed' },
          });
        } catch { /* non-blocking */ }

        logger.info({ enrollmentId: params.enrollmentId, paymentsMade: enrollment.payments_made, paymentsTotal: enrollment.payments_total }, 'Final installment — program completed');
      } catch (completionErr: any) {
        logger.error({ err: completionErr.message, enrollmentId: params.enrollmentId }, 'Program completion handling failed (non-blocking)');
      }
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
    const baseUrl = appConfig.appUrl || 'https://scalesafe-production.up.railway.app';
    const cardUpdateLink = `${baseUrl}/payment-update?contactId=${encodeURIComponent(params.contactId)}&locationId=${encodeURIComponent(params.locationId)}`;

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
