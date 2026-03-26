import { evidenceService } from './evidence.service';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';
import { ghlApi } from '../clients/ghl.client';

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
        reason_code: data.declineReason || data.failureReason,
        retry_scheduled: data.retryScheduled || false,
        attempt_count: data.attemptCount || 1,
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
      'subscription.paused': 'paused',
      'subscription.resumed': 'resumed',
      'subscription.cancelled': 'cancelled',
    };
    const action = actionMap[eventType] || eventType;

    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE,
      locationId, contactId, 'ghl_webhook',
      {
        action,
        change_date: new Date().toISOString(),
        reason: data.reason,
        who_initiated: data.initiatedBy || 'merchant',
      },
    );

    // Update enrollment status
    const statusMap: Record<string, string> = {
      paused: 'paused',
      resumed: 'active',
      cancelled: 'cancelled',
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
  async getUndisputedPayments(locationId: string, contactId: string): Promise<any[]> {
    const { getSupabase } = await import('../clients/supabase.client');
    const supabase = getSupabase();

    const { data: payments, error } = await supabase
      .from('evidence_payment_confirmation')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return payments || [];
  },
};
