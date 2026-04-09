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

    // 2. Log enrollment_payment evidence (non-blocking — table may not exist yet)
    try {
      await phase2EvidenceRepository.create({
        location_id: params.locationId,
        contact_id: params.contactId,
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
      logger.warn({ err: evidenceErr.message, enrollmentId: params.enrollmentId }, 'Evidence insert failed (table may not exist) — continuing enrollment');
    }

    // 3. Create payment_event record (non-blocking — may already exist from checkout controller)
    try {
      await paymentEventRepository.create({
        location_id: params.locationId,
        contact_id: params.contactId,
        enrollment_id: params.enrollmentId,
        event_type: 'payment_success',
        processor: 'ghl',
        processor_transaction_id: params.transactionId,
        amount: params.paymentAmount,
        payment_number: 1,
        payments_remaining: params.paymentsTotal ? params.paymentsTotal - 1 : undefined,
      });
    } catch (paymentErr: any) {
      logger.warn({ err: paymentErr.message, enrollmentId: params.enrollmentId }, 'Payment event insert failed — continuing enrollment');
    }

    // 4. Fire enrollment_complete trigger (non-blocking)
    try {
      await triggerService.fireTrigger(params.locationId, 'enrollment_complete', {
        contact_id: params.contactId,
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

    // 5. Update GHL contact fields + create pipeline opportunity
    if (params.locationId) {
      try {
        const api = await ghlApi(params.locationId);
        const merchant = await merchantRepository.getByLocationId(params.locationId);

        // Find or create GHL contact
        let contactId = params.contactId;
        const email = params.contactEmail || (enrollment as any).email || '';
        if (!contactId && email) {
          const upsertRes = await api.post('/contacts/upsert', {
            firstName: email.split('@')[0] || 'Client',
            email,
            locationId: params.locationId,
          });
          contactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
          // Update enrollment record with the resolved contactId
          if (contactId) {
            await enrollmentRepository.updateStatus(params.enrollmentId, 'enrolled', {
              contact_id: contactId,
            } as any);
          }
        }

        if (!contactId) {
          logger.warn({ enrollmentId: params.enrollmentId }, 'No contactId or email — skipping GHL sync');
          return;
        }

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

    logger.info(
      { enrollmentId: params.enrollmentId, contactId: params.contactId, locationId: params.locationId },
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

    // Fire trigger
    const enrollment = await enrollmentRepository.getById(params.enrollmentId);
    await triggerService.fireTrigger(params.locationId, 'ss_payment_received', {
      contact_id: params.contactId,
      amount: params.amount,
      transaction_id: params.transactionId,
      payments_remaining: params.paymentsRemaining,
      running_total: (enrollment.payments_made) * params.amount,
    });

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

    await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
      contact_id: params.contactId,
      amount: params.amount,
      failure_reason: params.failureReason || 'unknown',
      attempt_count: params.attemptCount || 1,
    });

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
