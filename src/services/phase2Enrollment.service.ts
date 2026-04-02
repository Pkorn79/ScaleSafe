import { enrollmentRepository, EnrollmentRecord } from '../repositories/enrollment.repository';
import { phase2EvidenceRepository, EvidenceRecord } from '../repositories/phase2Evidence.repository';
import { paymentEventRepository, PaymentEventRecord } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

interface CompleteEnrollmentParams {
  enrollmentId: string;
  locationId: string;
  contactId: string;
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

    // 2. Log enrollment_payment evidence
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

    // 3. Create payment_event record
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

    // 4. Fire enrollment_complete trigger
    await triggerService.fireTrigger(params.locationId, 'enrollment_complete', {
      contact_id: params.contactId,
      offer_id: enrollment.offer_id,
      offer_name: offerName,
      amount: params.paymentAmount,
      payment_type: params.paymentType,
      bump_1_accepted: false,
      bump_2_accepted: false,
    });

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
