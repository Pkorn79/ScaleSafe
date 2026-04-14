import { enrollmentRepository, EnrollmentRecord } from '../repositories/enrollment.repository';
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

    // 1. Update enrollment to 'enrolled'
    await enrollmentRepository.updateStatus(params.enrollmentId, 'enrolled', {
      payment_amount: params.paymentAmount,
      payment_type: params.paymentType,
      payment_transaction_id: params.transactionId,
      payments_made: 1,
      payments_total: params.paymentsTotal,
      enrolled_at: new Date().toISOString(),
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

    // 6. Fire enrollment_complete trigger (non-blocking)
    try {
      await triggerService.fireTrigger(params.locationId, 'enrollment_complete', {
        contact_id: resolvedContactId,
        offer_id: enrollment.offer_id,
        offer_name: offerName,
        amount: params.paymentAmount,
        payment_type: params.paymentType,
        bump_1_accepted: false,
        bump_2_accepted: false,
      });
    } catch (triggerErr: any) {
      logger.warn({ err: triggerErr.message, enrollmentId: params.enrollmentId }, 'Trigger fire failed — continuing enrollment');
    }

    // 7. Update GHL contact fields + create pipeline opportunity
    if (params.locationId && resolvedContactId) {
      try {
        const api = await ghlApi(params.locationId);
        const merchant = await merchantRepository.getByLocationId(params.locationId);
        const contactId = resolvedContactId;

        // Update SS contact fields
        const customFields: Record<string, unknown> = {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled',
          [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
        };

        // Copy offer fields to contact
        if (enrollment.offer_id) {
          try {
            const offer = await offerRepository.getById(enrollment.offer_id);
            customFields[OFFER_CONTACT_FIELDS.BUSINESS_NAME] = merchant.business_name || '';
            customFields[OFFER_CONTACT_FIELDS.OFFER_NAME] = offer.offer_name;
            customFields[OFFER_CONTACT_FIELDS.PRICE] = offer.price;
            customFields[OFFER_CONTACT_FIELDS.PAYMENT_TYPE] = offer.payment_type;
            customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT] = offer.installment_amount;
            customFields[OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY] = offer.installment_frequency;
            customFields[OFFER_CONTACT_FIELDS.NUM_PAYMENTS] = offer.num_payments;
          } catch {
            // Offer fields are nice-to-have
          }
        }

        await api.put(`/contacts/${contactId}`, { customField: customFields });

        // Create pipeline opportunity
        const pipelineId = (merchant.config as any)?.milestones_pipeline_id || (merchant.config as any)?.pipelineId;
        const stageId = (merchant.config as any)?.enrolled_stage_id;
        if (pipelineId) {
          await api.post('/opportunities/', {
            locationId: params.locationId,
            contactId,
            pipelineId,
            stageId: stageId || '',
            name: `${offerName || 'Program'} — Enrollment`,
            monetaryValue: params.paymentAmount,
          });
        }

        logger.info({ contactId }, 'GHL contact updated + opportunity created');
      } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack, enrollmentId: params.enrollmentId, email: params.contactEmail, contactId: params.contactId }, 'GHL sync after enrollment failed (non-blocking)');
      }
    }

    // 8. Generate enrollment packet PDF (non-blocking)
    logger.info({ enrollmentId: params.enrollmentId, locationId: params.locationId }, 'PACKET: Starting auto-generation');
    try {
      const { enrollmentPacketService } = require('./enrollment-packet.service');
      const pdfUrl = await enrollmentPacketService.generateAndStore(params.enrollmentId, params.locationId);
      logger.info({ enrollmentId: params.enrollmentId, pdfUrl }, 'PACKET: Auto-generation succeeded');
    } catch (pdfErr: any) {
      logger.error({ err: pdfErr.message, stack: pdfErr.stack, code: (pdfErr as any).statusCode || (pdfErr as any).code, enrollmentId: params.enrollmentId, locationId: params.locationId }, 'PACKET: Auto-generation FAILED');
    }

    // 9. Verify evidence chain (non-blocking)
    try {
      const { evidenceChainService } = require('./evidence-chain.service');
      // Find the payment event we just created
      const { getSupabase: getSb } = require('../clients/supabase.client');
      const { data: pe } = await getSb().from('payment_events')
        .select('id').eq('enrollment_id', params.enrollmentId).eq('event_type', 'sale')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (pe) {
        const chain = await evidenceChainService.verifyChain(pe.id);
        logger.info({ enrollmentId: params.enrollmentId, chainStrength: chain.chainStrength, complete: chain.complete, gaps: chain.gaps }, 'Evidence chain verified');
      }
    } catch (chainErr: any) {
      logger.warn({ err: chainErr.message, enrollmentId: params.enrollmentId }, 'Evidence chain verification failed (non-blocking)');
    }

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: resolvedContactId, locationId: params.locationId },
      'Enrollment completed',
    );
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

    // Increment payments_made
    await enrollmentRepository.incrementPaymentsMade(params.enrollmentId);

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

    // Fire trigger with enriched payload
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);
    const runningTotal = (enrollment.payments_made) * params.amount;
    let offerName = '';
    if (enrollment.offer_id) {
      try { offerName = (await offerRepository.getById(enrollment.offer_id)).offer_name; } catch {}
    }
    const merchant = await merchantRepository.getByLocationId(params.locationId);
    await triggerService.fireTrigger(params.locationId, 'ss_payment_received', {
      contact_id: params.contactId,
      amount: params.amount,
      transaction_id: params.transactionId,
      payments_remaining: params.paymentsRemaining,
      payments_made: enrollment.payments_made,
      payments_total: enrollment.payments_total,
      running_total: runningTotal,
      offer_name: offerName,
      merchant_name: merchant.business_name || '',
      is_final_payment: enrollment.payments_total ? enrollment.payments_made >= enrollment.payments_total : false,
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
        await triggerService.fireTrigger(params.locationId, 'ss_program_completed', {
          contact_id: params.contactId,
          offer_id: enrollment.offer_id || '',
          offer_name: offerName,
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
      card_update_link: cardUpdateLink,
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
