import { Request, Response, NextFunction } from 'express';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { evidenceService } from '../services/evidence.service';
import { enrollmentService } from '../services/enrollment.service';
import { paymentService } from '../services/payment.service';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { EVIDENCE_TYPES } from '../constants/evidence-types';

export const webhookController = {
  /**
   * POST /webhooks/ghl/payment
   * GHL payment webhooks: order created, subscription charged, payment failed, refund.
   * ScaleSafe OBSERVES only — never processes payments.
   */
  async ghlPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, locationId, contactId, offerId, data } = req.body;
      if (!type || !locationId || !contactId) {
        throw new ValidationError('type, locationId, contactId required');
      }

      // Idempotency check
      const eventId = data?.orderId || data?.transactionId || `${type}_${contactId}_${Date.now()}`;
      if (await idempotencyRepository.isDuplicate(eventId, 'ghl_payment', locationId)) {
        res.json({ status: 'duplicate', eventId });
        return;
      }

      switch (type) {
        case 'order.completed':
        case 'OrderCreate':
          // Enrollment payment — complete the enrollment flow
          await enrollmentService.handlePaymentWebhook({
            locationId,
            contactId,
            offerId: offerId || data?.offerId || '',
            ghlOrderId: data?.orderId || '',
            ghlTransactionId: data?.transactionId || '',
            paymentAmount: data?.amount || 0,
            paymentMethod: data?.paymentMethod || 'card',
          });
          break;

        case 'subscription.charged':
        case 'InvoicePaymentReceived':
          await paymentService.logSuccessfulPayment(locationId, contactId, data || {});
          break;

        case 'payment.failed':
        case 'InvoicePaymentFailed':
          await paymentService.logFailedPayment(locationId, contactId, data || {});
          // Fire Payment Failed trigger
          notificationService.firePaymentFailed(locationId, contactId, {
            amount: data?.amount || 0,
            failureReason: data?.declineReason || data?.failureReason || 'unknown',
            attemptCount: data?.attemptCount || 1,
          });
          break;

        case 'refund.processed':
        case 'RefundCreated':
          await paymentService.logRefund(locationId, contactId, data || {});
          break;

        case 'subscription.paused':
        case 'subscription.resumed':
        case 'subscription.cancelled':
          await paymentService.logSubscriptionChange(locationId, contactId, type, data || {});
          break;

        default:
          // Try the generic payment handler for unknown types
          await evidenceService.logEvidence(
            EVIDENCE_TYPES.CUSTOM_EVENT,
            locationId, contactId, 'ghl_payment',
            {
              event_type: type,
              event_timestamp: new Date().toISOString(),
              metadata: data,
            },
          );
      }

      res.json({ status: 'ok', eventId });
    } catch (err) { next(err); }
  },

  /**
   * POST /webhooks/ghl/forms
   * GHL form submission + workflow webhooks (SYS2-07 through SYS2-11, WF-01, WF-02).
   */
  async ghlForms(req: Request, res: Response, next: NextFunction) {
    try {
      const { formId, locationId, contactId, data } = req.body;
      if (!formId || !locationId || !contactId) {
        throw new ValidationError('formId, locationId, contactId required');
      }

      const eventId = `form_${formId}_${contactId}_${Date.now()}`;
      if (await idempotencyRepository.isDuplicate(eventId, 'ghl_form', locationId)) {
        res.json({ status: 'duplicate', eventId });
        return;
      }

      const evidenceType = await evidenceService.handleFormSubmission(
        formId, locationId, contactId, data || {},
      );

      res.json({ status: 'ok', eventId, evidenceType });
    } catch (err) { next(err); }
  },

  /**
   * POST /webhooks/external
   * External platform webhooks (Calendly, Zoom, Kajabi, Teachable, Skool, etc.).
   * Payload format defined in docs/external-integration-guide.md.
   */
  async external(req: Request, res: Response, next: NextFunction) {
    try {
      const { source, event_type, location_id, contact_id, contact_email, data } = req.body;
      if (!source || !event_type || !location_id) {
        throw new ValidationError('source, event_type, location_id required');
      }

      const contactId = contact_id || '';
      if (!contactId && !contact_email) {
        throw new ValidationError('contact_id or contact_email required');
      }

      const eventId = `ext_${source}_${event_type}_${contactId || contact_email}_${Date.now()}`;
      if (await idempotencyRepository.isDuplicate(eventId, 'external', location_id)) {
        res.json({ status: 'duplicate', eventId });
        return;
      }

      // If no contactId, look up by email via GHL
      let resolvedContactId = contactId;
      if (!resolvedContactId && contact_email) {
        try {
          const { ghlApi: getApi } = await import('../clients/ghl.client');
          const api = await getApi(location_id);
          const search = await api.get('/contacts/search/duplicate', {
            params: { locationId: location_id, email: contact_email },
          });
          resolvedContactId = search.data.contact?.id || '';
        } catch {
          logger.warn({ contact_email, location_id }, 'Could not resolve contact by email');
        }
      }

      if (!resolvedContactId) {
        throw new ValidationError(`Could not resolve contact for ${contact_email}`);
      }

      const evidenceType = await evidenceService.handleExternalEvent(
        event_type, location_id, resolvedContactId, source, data || {},
      );

      res.json({ status: 'ok', eventId, evidenceType });
    } catch (err) { next(err); }
  },
};
