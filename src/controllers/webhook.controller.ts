import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { paymentEventRepository } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { evidenceService } from '../services/evidence.service';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { EVIDENCE_TYPES } from '../constants/evidence-types';

export const webhookController = {
  /**
   * POST /webhooks/ghl/payment
   * GHL payment webhooks: OrderCompleted, SubscriptionPaymentSuccess,
   * SubscriptionPaymentFailed, OrderRefunded.
   * Always returns 200 to avoid GHL retries.
   */
  async ghlPayment(req: Request, res: Response, _next: NextFunction) {
    try {
      const body = req.body;
      const type = body.type;
      const locationId = body.locationId;
      const contactId = body.contactId;

      if (!type || !locationId) {
        logger.warn({ body: JSON.stringify(body).slice(0, 500) }, 'Payment webhook missing type or locationId');
        res.json({ status: 'ok', skipped: true });
        return;
      }

      // Log raw payload for debugging
      logger.info({ type, locationId, contactId }, 'GHL payment webhook received');

      // Idempotency: check by transactionId or orderId
      const transactionId = body.transactionId || body.orderId || '';
      if (transactionId) {
        const existing = await paymentEventRepository.findByTransactionId('ghl', transactionId);
        if (existing) {
          logger.info({ transactionId, type }, 'Duplicate payment webhook, skipping');
          res.json({ status: 'duplicate', transactionId });
          return;
        }
      }

      switch (type) {
        case 'OrderCompleted':
        case 'order.completed':
        case 'OrderCreate':
          await handleOrderCompleted(body);
          break;

        case 'SubscriptionPaymentSuccess':
        case 'subscription.charged':
        case 'InvoicePaymentReceived':
          await handleSubscriptionPayment(body);
          break;

        case 'SubscriptionPaymentFailed':
        case 'payment.failed':
        case 'InvoicePaymentFailed':
          await handlePaymentFailed(body);
          break;

        case 'OrderRefunded':
        case 'refund.processed':
        case 'RefundCreated':
          await handleRefund(body);
          break;

        default:
          logger.info({ type, locationId }, 'Unhandled GHL payment event type');
          break;
      }

      res.json({ status: 'ok', type });
    } catch (err) {
      // Always return 200 to GHL
      logger.error({ err }, 'Error processing GHL payment webhook');
      res.json({ status: 'ok', error: 'internal' });
    }
  },

  /**
   * POST /webhooks/ghl/forms
   * GHL form submission + workflow webhooks (SYS2-07 through SYS2-11, WF-01, WF-02).
   */
  async ghlForms(req: Request, res: Response, next: NextFunction) {
    try {
      const { formId, locationId, contactId, data, enrollment_id, enrollmentId } = req.body;
      if (!formId || !locationId || !contactId) {
        throw new ValidationError('formId, locationId, contactId required');
      }

      const eventId = `form_${formId}_${contactId}_${Date.now()}`;
      if (await idempotencyRepository.isDuplicate(eventId, 'ghl_form', locationId)) {
        res.json({ status: 'duplicate', eventId });
        return;
      }

      const evidenceType = await evidenceService.handleFormSubmission(
        formId, locationId, contactId, { ...(data || {}), enrollment_id: enrollment_id || enrollmentId || data?.enrollment_id || data?.enrollmentId },
      );

      res.json({ status: 'ok', eventId, evidenceType });
    } catch (err) { next(err); }
  },

  /**
   * POST /webhooks/external
   * External platform webhooks (Calendly, Zoom, Kajabi, Teachable, Skool, etc.).
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

      const eventId = stableExternalEventId(source, event_type, contactId || contact_email, data || {});
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

function stableExternalEventId(source: string, eventType: string, contactIdentifier: string, data: unknown): string {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      source,
      eventType,
      contactIdentifier,
      data: stableSort(data),
    }))
    .digest('hex')
    .slice(0, 24);

  return `ext_${source}_${eventType}_${contactIdentifier}_${hash}`;
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableSort((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

// --- Internal handler functions ---

async function handleOrderCompleted(body: Record<string, unknown>): Promise<void> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const amount = (body.amount as number) || 0;
  const transactionId = (body.transactionId || body.orderId || '') as string;
  const items = (body.items as any[]) || [];
  const metadata = (body.metadata as Record<string, unknown>) || {};
  const subscription = body.subscription as Record<string, unknown> | undefined;

  if (!contactId) {
    logger.warn({ locationId, body: JSON.stringify(body).slice(0, 300) }, 'OrderCompleted missing contactId');
    // Still log payment event with no enrollment
    await paymentEventRepository.create({
      location_id: locationId,
      contact_id: '',
      event_type: 'payment_success',
      processor: 'ghl',
      processor_transaction_id: transactionId,
      amount,
      raw_webhook_payload: body,
    });
    return;
  }

  // Try to match enrollment
  // Primary: consent_token from metadata
  const consentToken = (metadata.consent_token || metadata.consentToken || '') as string;
  let enrollment = consentToken
    ? await enrollmentRepository.findByConsentToken(consentToken)
    : null;

  // Fallback: match by contactId + product → offer mapping
  if (!enrollment && items.length > 0) {
    for (const item of items) {
      const productId = item.productId || item.product_id;
      if (productId) {
        // Look up offer by GHL product ID
        const offer = await findOfferByProductId(locationId, productId);
        if (offer) {
          enrollment = await enrollmentRepository.findByContactAndOffer(
            contactId, offer.id, locationId,
          );
          if (enrollment) break;
        }
      }
    }
  }

  if (!enrollment) {
    // No matching enrollment — log payment event without enrollment link
    logger.info(
      { locationId, contactId, transactionId },
      'OrderCompleted: no matching enrollment found (may be non-ScaleSafe purchase)',
    );
    await paymentEventRepository.create({
      location_id: locationId,
      contact_id: contactId,
      event_type: 'payment_success',
      processor: 'ghl',
      processor_transaction_id: transactionId,
      amount,
      raw_webhook_payload: body,
    });
    return;
  }

  // Determine payment type and total
  const paymentType = subscription ? 'installment' : 'pif';
  const paymentsTotal = subscription
    ? (subscription.totalCycles as number) || null
    : null;

  // Complete enrollment
  await phase2EnrollmentService.completeEnrollment({
    enrollmentId: enrollment.id,
    locationId,
    contactId,
    paymentAmount: amount,
    paymentType,
    transactionId,
    paymentsTotal,
  });

  logger.info(
    { enrollmentId: enrollment.id, contactId, locationId, transactionId },
    'OrderCompleted processed — enrollment completed',
  );
}

async function handleSubscriptionPayment(body: Record<string, unknown>): Promise<void> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const amount = (body.amount as number) || 0;
  const transactionId = (body.transactionId || '') as string;
  const subscriptionId = (body.subscriptionId || (body.subscription as any)?.id || '') as string;

  if (!contactId) {
    logger.warn({ locationId }, 'SubscriptionPayment missing contactId');
    return;
  }

  // Find enrollment by contact + offer (from product in webhook)
  const items = (body.items as any[]) || [];
  let enrollment = null;
  for (const item of items) {
    const productId = item.productId || item.product_id;
    if (productId) {
      const offer = await findOfferByProductId(locationId, productId);
      if (offer) {
        enrollment = await enrollmentRepository.findByContactAndOffer(contactId, offer.id, locationId);
        if (!enrollment) {
          // Also check enrolled status (not just consent_captured)
          const { data } = await (await import('../clients/supabase.client')).getSupabase()
            .from('enrollments')
            .select('*')
            .eq('contact_id', contactId)
            .eq('offer_id', offer.id)
            .eq('location_id', locationId)
            .in('status', ['enrolled', 'active'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          enrollment = data;
        }
        if (enrollment) break;
      }
    }
  }

  // Broader fallback: find any active enrollment for this contact at this location
  if (!enrollment) {
    const { data } = await (await import('../clients/supabase.client')).getSupabase()
      .from('enrollments')
      .select('*')
      .eq('contact_id', contactId)
      .eq('location_id', locationId)
      .in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    enrollment = data;
  }

  if (!enrollment) {
    logger.info({ locationId, contactId }, 'SubscriptionPayment: no enrollment found');
    await paymentEventRepository.create({
      location_id: locationId,
      contact_id: contactId,
      event_type: 'payment_success',
      processor: 'ghl',
      processor_transaction_id: transactionId,
      amount,
      raw_webhook_payload: body,
    });
    return;
  }

  await phase2EnrollmentService.handleRecurringPayment({
    locationId,
    contactId,
    enrollmentId: enrollment.id,
    amount,
    transactionId,
    paymentNumber: enrollment.payments_made + 1,
    paymentsRemaining: enrollment.payments_total
      ? enrollment.payments_total - enrollment.payments_made - 1
      : undefined,
    rawPayload: body,
  });
}

async function handlePaymentFailed(body: Record<string, unknown>): Promise<void> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const amount = (body.amount as number) || 0;
  const transactionId = (body.transactionId || '') as string;
  const failureReason = (body.declineReason || body.failureReason || body.reason || 'unknown') as string;
  const attemptCount = (body.attemptCount as number) || 1;

  if (!contactId) {
    logger.warn({ locationId }, 'PaymentFailed missing contactId');
    return;
  }

  // Find enrollment
  const { data: enrollment } = await (await import('../clients/supabase.client')).getSupabase()
    .from('enrollments')
    .select('*')
    .eq('contact_id', contactId)
    .eq('location_id', locationId)
    .in('status', ['enrolled', 'active', 'at_risk'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  await phase2EnrollmentService.handleFailedPayment({
    locationId,
    contactId,
    enrollmentId: enrollment?.id || null,
    amount,
    transactionId,
    failureReason,
    attemptCount,
    rawPayload: body,
  });
}

async function handleRefund(body: Record<string, unknown>): Promise<void> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const amount = (body.amount || body.refundAmount || 0) as number;
  const transactionId = (body.transactionId || body.originalTransactionId || '') as string;
  const reason = (body.reason || '') as string;

  if (!contactId) {
    logger.warn({ locationId }, 'Refund missing contactId');
    return;
  }

  // Find enrollment
  const { data: enrollment } = await (await import('../clients/supabase.client')).getSupabase()
    .from('enrollments')
    .select('*')
    .eq('contact_id', contactId)
    .eq('location_id', locationId)
    .in('status', ['enrolled', 'active', 'at_risk'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  await phase2EnrollmentService.handleRefund({
    locationId,
    contactId,
    enrollmentId: enrollment?.id || null,
    amount,
    transactionId,
    reason,
    rawPayload: body,
  });
}

async function findOfferByProductId(locationId: string, productId: string) {
  try {
    const offers = await offerRepository.listByLocation(locationId);
    return offers.find((o) => o.ghl_product_id === productId) || null;
  } catch {
    return null;
  }
}
