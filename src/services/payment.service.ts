import { evidenceService } from './evidence.service';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';
import { ghlApi } from '../clients/ghl.client';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

/**
 * Payment service — OBSERVE ONLY.
 * ScaleSafe never processes payments. It listens to GHL payment webhooks
 * and logs everything as evidence. GHL + merchant's processor handle billing.
 */
export const paymentService = {
  /**
   * Route a GHL payment event to the correct evidence handler.
   */
  async handlePaymentEvent(
    eventType: string,
    locationId: string,
    contactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case 'charge.succeeded':
      case 'InvoicePaymentReceived':
        await this.logSuccessfulPayment(locationId, contactId, data);
        break;

      case 'charge.failed':
      case 'InvoicePaymentFailed':
        await this.logFailedPayment(locationId, contactId, data);
        break;

      case 'refund.created':
      case 'RefundCreated':
        await this.logRefund(locationId, contactId, data);
        break;

      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.cancelled':
        await this.logSubscriptionChange(locationId, contactId, eventType, data);
        break;

      default:
        logger.info({ eventType, locationId }, 'Unhandled payment event type, logging as custom');
        await evidenceService.logEvidence(
          EVIDENCE_TYPES.CUSTOM_EVENT,
          locationId, contactId, 'ghl_payment',
          { event_type: eventType, event_timestamp: new Date().toISOString(), metadata: data },
        );
    }
  },

  async logSuccessfulPayment(
    locationId: string,
    contactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
      locationId, contactId, 'ghl_webhook',
      {
        amount: data.amount,
        payment_date: data.paymentDate || new Date().toISOString(),
        ghl_transaction_id: data.transactionId,
        running_total: data.runningTotal,
        payments_remaining: data.paymentsRemaining,
        payment_number: data.paymentNumber,
        payment_method: data.paymentMethod,
        enrollment_id: data.enrollmentId || null,
        raw_payload: data,
        ...buildDefenseEvidenceFields({
          summary: `Payment of $${Number(data.amount || 0).toFixed(2)} recorded${data.paymentNumber ? ` as payment #${data.paymentNumber}` : ''}${data.transactionId ? `, transaction ${data.transactionId}` : ''}.`,
          title: data.paymentNumber ? `Payment #${data.paymentNumber}` : 'Payment Confirmation',
          proofRole: 'payment_history',
          relevance: {
            tags: ['fraud', 'authorization', 'services_not_provided', 'credit_not_processed'],
            priority: 'high',
            confidence: 'strong',
          },
          metadata: {
            actor: 'processor',
            service: { enrollmentId: String(data.enrollmentId || '') || null },
            transaction: {
              processor: String(data.processor || data.processorType || 'ghl'),
              transactionId: String(data.transactionId || '') || null,
              amount: data.amount as any,
              currency: String(data.currency || 'USD'),
              paymentSequence: data.paymentNumber as any,
            },
            source: { system: 'ghl_webhook', rawEventType: 'payment_success' },
          },
        }),
      },
    );

    logger.info({ contactId, amount: data.amount, locationId }, 'Recurring payment logged');
  },

  async logFailedPayment(
    locationId: string,
    contactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.FAILED_PAYMENT,
      locationId, contactId, 'ghl_webhook',
      {
        amount: data.amount,
        failure_date: new Date().toISOString(),
        decline_reason: data.declineReason || data.failureReason,
        decline_code: data.declineCode || data.reasonCode,
        retry_scheduled: data.retryScheduled || false,
        retry_date: data.retryDate,
        attempt_count: data.attemptCount || 1,
        enrollment_id: data.enrollmentId || null,
        raw_payload: data,
        ...buildDefenseEvidenceFields({
          summary: `Payment attempt for $${Number(data.amount || 0).toFixed(2)} failed. Reason: ${data.declineReason || data.failureReason || data.declineCode || 'not provided'}. Attempt count: ${data.attemptCount || 1}.`,
          title: 'Failed Payment Attempt',
          proofRole: 'dunning',
          relevance: {
            tags: ['credit_not_processed', 'cancelled_recurring'],
            priority: 'medium',
            confidence: 'moderate',
          },
          metadata: {
            actor: 'processor',
            service: { enrollmentId: String(data.enrollmentId || '') || null },
            transaction: {
              processor: String(data.processor || data.processorType || 'ghl'),
              transactionId: String(data.transactionId || '') || null,
              amount: data.amount as any,
              currency: String(data.currency || 'USD'),
            },
            source: { system: 'ghl_webhook', rawEventType: 'payment_failed' },
          },
        }),
      },
    );

    // Update enrollment status if repeated failures
    const attemptCount = (data.attemptCount as number) || 1;
    if (attemptCount >= 2) {
      try {
        const api = await ghlApi(locationId);
        await api.put(`/contacts/${contactId}`, {
          customField: {
            [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'past_due',
          },
        });
      } catch (err) {
        logger.warn({ err, contactId }, 'Failed to update enrollment status to past_due');
      }
    }

    logger.info({ contactId, amount: data.amount, attemptCount, locationId }, 'Failed payment logged');
  },

  async logRefund(
    locationId: string,
    contactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.REFUND_ACTIVITY,
      locationId, contactId, 'ghl_webhook',
      {
        amount: data.amount,
        refund_date: new Date().toISOString(),
        refund_type: data.refundType || 'full',
        reason: data.reason,
        initiated_by: data.initiatedBy || 'merchant',
        ghl_transaction_id: data.transactionId || data.ghlTransactionId,
        enrollment_id: data.enrollmentId || null,
        raw_payload: data,
        ...buildDefenseEvidenceFields({
          summary: `${data.refundType || 'Full'} refund of $${Number(data.amount || 0).toFixed(2)} recorded. Reason: ${data.reason || 'not specified'}.`,
          title: `${data.refundType || 'Full'} Refund`,
          proofRole: 'refund',
          relevance: {
            tags: ['credit_not_processed', 'cancelled_recurring'],
            priority: 'critical',
            confidence: 'strong',
          },
          metadata: {
            actor: String(data.initiatedBy || 'merchant') as any,
            service: { enrollmentId: String(data.enrollmentId || '') || null },
            transaction: {
              processor: String(data.processor || data.processorType || 'ghl'),
              transactionId: String(data.transactionId || data.ghlTransactionId || '') || null,
              amount: data.amount as any,
              currency: String(data.currency || 'USD'),
            },
            source: { system: 'ghl_webhook', rawEventType: 'refund_created' },
          },
        }),
      },
    );

    logger.info({ contactId, amount: data.amount, locationId }, 'Refund logged');
  },

  async logSubscriptionChange(
    locationId: string,
    contactId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const actionMap: Record<string, string> = {
      'subscription.paused': 'pause',
      'subscription.resumed': 'resume',
      'subscription.cancelled': 'cancel',
    };
    const action = actionMap[eventType] || eventType;

    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE,
      locationId, contactId, 'ghl_webhook',
      {
        action,
        change_date: new Date().toISOString(),
        reason: data.reason,
        initiated_by: data.initiatedBy || 'merchant',
        previous_status: data.previousStatus,
        new_status: data.newStatus || action,
        enrollment_id: data.enrollmentId || null,
        raw_payload: data,
        ...buildDefenseEvidenceFields({
          summary: `Subscription ${action} recorded. Initiated by ${data.initiatedBy || 'merchant'}. Reason: ${data.reason || 'not specified'}.`,
          title: `Subscription ${action}`,
          proofRole: action === 'cancel' ? 'cancellation' : 'billing_update',
          relevance: {
            tags: ['cancelled_recurring', 'credit_not_processed'],
            priority: action === 'cancel' ? 'high' : 'medium',
            confidence: 'moderate',
          },
          metadata: {
            actor: String(data.initiatedBy || 'merchant') as any,
            service: { enrollmentId: String(data.enrollmentId || '') || null },
            transaction: {
              processor: String(data.processor || data.processorType || 'ghl'),
              subscriptionId: String(data.subscriptionId || data.processorSubscriptionId || '') || null,
            },
            source: { system: 'ghl_webhook', rawEventType: eventType },
          },
        }),
      },
    );

    // Update enrollment status
    const statusMap: Record<string, string> = {
      pause: 'paused',
      resume: 'active',
      cancel: 'cancelled',
    };

    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: statusMap[action] || action,
        },
      });
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to update enrollment status on subscription change');
    }

    logger.info({ contactId, action, locationId }, 'Subscription change logged');
  },

  /**
   * Get all undisputed payments for a contact (used in defense compilation).
   */
  /**
   * Prior undisputed transactions for the "prior payment / relationship" section.
   * When an enrollmentId is supplied, same-enrollment payments are returned first so
   * the defense letter leads with charges tied to the disputed program; payments from
   * other enrollments follow only as secondary relationship evidence. Without an
   * enrollmentId, behavior is unchanged (all contact payments, oldest first).
   */
  async getUndisputedPayments(
    locationId: string,
    contactId: string,
    enrollmentId?: string,
    exclude?: {
      paymentEventId?: string | null;
      processorTransactionId?: string | null;
      onOrAfter?: string | null;
    },
  ): Promise<any[]> {
    const { getSupabase } = await import('../clients/supabase.client');
    const supabase = getSupabase();

    const { data: payments, error } = await supabase
      .from('evidence_payment_confirmation')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    const cutoff = exclude?.onOrAfter ? new Date(exclude.onOrAfter).getTime() : Number.NaN;
    const rows = (payments || []).filter((payment: any) => {
      const metadata = payment.defense_metadata || {};
      const raw = payment.raw_payload || {};
      const linkedPaymentEventId = payment.payment_event_id
        || metadata.transaction?.paymentEventId
        || raw.payment_event_id
        || raw.paymentEventId;
      if (exclude?.paymentEventId && linkedPaymentEventId === exclude.paymentEventId) return false;

      const processorTransactionId = payment.ghl_transaction_id
        || payment.source_record_id
        || metadata.transaction?.transactionId
        || raw.processor_transaction_id
        || raw.transaction_id;
      if (exclude?.processorTransactionId && processorTransactionId === exclude.processorTransactionId) return false;

      if (Number.isFinite(cutoff)) {
        const paymentTime = new Date(payment.payment_date || payment.created_at || 0).getTime();
        if (!Number.isFinite(paymentTime) || paymentTime >= cutoff) return false;
      }
      return true;
    });
    if (!enrollmentId) return rows;

    // Same-enrollment first (primary), everything else after (secondary relationship evidence).
    const sameEnrollment = rows.filter((p: any) => p.enrollment_id === enrollmentId);
    const otherEnrollment = rows.filter((p: any) => p.enrollment_id !== enrollmentId);
    return [...sameEnrollment, ...otherEnrollment];
  },
};
