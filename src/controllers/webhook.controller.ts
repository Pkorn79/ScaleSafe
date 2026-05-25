import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { paymentEventRepository } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { evidenceService } from '../services/evidence.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { ghlActivityService } from '../services/ghl-activity.service';
import { triggerController } from './trigger.controller';

function webhookType(body: Record<string, any>): string {
  return String(body.type || body.event_type || body.eventType || body.triggerData?.eventType || '').trim();
}

function isTriggerSubscriptionWebhook(body: Record<string, any>): boolean {
  return Boolean(
    body.triggerKey ||
    body.trigger_key ||
    body.triggerData?.key ||
    body.meta?.key ||
    body.subscriptionUrl ||
    body.subscription_url ||
    body.triggerData?.targetUrl,
  );
}

function isGhlPaymentWebhook(type: string): boolean {
  const normalized = type.toLowerCase();
  return [
    'ordercompleted',
    'ordercreate',
    'orderstatusupdate',
    'subscriptionpaymentsuccess',
    'subscriptionpaymentfailed',
    'invoicepaymentreceived',
    'invoicepaymentfailed',
    'orderrefunded',
    'refund.processed',
    'refundcreated',
    'payment.failed',
    'subscription.charged',
    'order.completed',
  ].includes(normalized);
}

function isGhlActivityWebhook(type: string, body: Record<string, any>): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized.includes('appointment') ||
    normalized.includes('message') ||
    normalized.includes('conversation') ||
    normalized.includes('invoice') ||
    normalized.includes('note') ||
    normalized.includes('task') ||
    normalized.includes('opportunity') ||
    normalized.includes('contact') ||
    Boolean(body.appointment || body.invoiceNumber || body.invoiceItems || body.messageId || body.conversationId)
  );
}

export const webhookController = {
  /**
   * POST /webhooks/ghl
   * Default HighLevel Marketplace webhook URL. HighLevel allows custom URLs
   * per event, but this default route must accept and route mixed event types.
   */
  async ghlUnified(req: Request, res: Response, next: NextFunction) {
    const body = req.body || {};
    const type = webhookType(body);

    if (isTriggerSubscriptionWebhook(body)) {
      await triggerController.handleSubscription(req, res, next);
      return;
    }

    if (isGhlPaymentWebhook(type)) {
      await webhookController.ghlPayment(req, res, next);
      return;
    }

    if (isGhlActivityWebhook(type, body)) {
      await webhookController.ghlActivity(req, res, next);
      return;
    }

    logger.info({ type: type || 'unknown', bodyKeys: Object.keys(body) }, 'Unhandled GHL default webhook event');
    res.json({ status: 'ok', skipped: true, type: type || 'unknown' });
  },

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
        const existing = await paymentEventRepository.findByTransactionId('ghl', transactionId, locationId);
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
          logger.warn({ hasContactEmail: !!contact_email, location_id }, 'Could not resolve contact by email');
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

  /**
   * POST /webhooks/ghl/course-activity
   * GHL workflow webhook bridge for native course/membership activity.
   * Protected by the merchant workflow webhook secret.
   */
  async ghlCourseActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body || {};
      const locationId = body.locationId || body.location_id;
      const contactId = body.contactId || body.contact_id || '';
      const contactEmail = body.contactEmail || body.contact_email || body.email || '';
      const rawEventType = String(body.eventType || body.event_type || body.type || '').trim();

      if (!locationId || !rawEventType) {
        throw new ValidationError('locationId and eventType required');
      }
      if (!contactId && !contactEmail) {
        throw new ValidationError('contactId or contactEmail required');
      }

      const eventId = stableExternalEventId('ghl_course', rawEventType, contactId || contactEmail, body);
      if (await idempotencyRepository.isDuplicate(eventId, 'ghl_course', locationId)) {
        res.json({ status: 'duplicate', eventId });
        return;
      }

      let resolvedContactId = contactId;
      if (!resolvedContactId && contactEmail) {
        try {
          const { ghlApi: getApi } = await import('../clients/ghl.client');
          const api = await getApi(locationId);
          const search = await api.get('/contacts/search/duplicate', {
            params: { locationId, email: contactEmail },
          });
          resolvedContactId = search.data.contact?.id || '';
        } catch {
          logger.warn({ hasContactEmail: !!contactEmail, locationId }, 'Could not resolve GHL course contact by email');
        }
      }

      if (!resolvedContactId) {
        throw new ValidationError(`Could not resolve contact for ${contactEmail}`);
      }

      const mapped = mapCourseActivity(rawEventType, body);
      const evidenceType = await evidenceService.handleExternalEvent(
        mapped.eventType,
        locationId,
        resolvedContactId,
        'ghl_course',
        mapped.data,
      );

      res.json({ status: 'ok', eventId, rawEventType, evidenceType });
    } catch (err) { next(err); }
  },

  /**
   * POST /webhooks/ghl/activity
   * Native GHL activity webhooks: appointments, invoices, and conversation messages.
   */
  async ghlActivity(req: Request, res: Response, _next: NextFunction) {
    try {
      const result = await ghlActivityService.handleWebhook(req.body || {});
      res.json({ ok: true, ...result });
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error processing GHL activity webhook');
      res.json({ status: 'ok', error: 'internal' });
    }
  },
};

function normalizeCourseEventType(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
}

function mapCourseActivity(rawEventType: string, body: Record<string, any>): { eventType: string; data: Record<string, unknown> } {
  const normalized = normalizeCourseEventType(rawEventType);
  const occurredAt = body.occurredAt || body.occurred_at || body.timestamp || body.dateAdded || new Date().toISOString();
  const courseName = body.courseName || body.course_name || body.productName || body.product_name || body.product || body.course || '';
  const categoryName = body.categoryName || body.category_name || body.category || '';
  const lessonName = body.lessonName || body.lesson_name || body.lesson || '';
  const contentName = lessonName || categoryName || courseName || body.contentName || body.content_name || rawEventType;
  const base = {
    id: body.id || body.event_id || body.eventId || '',
    event_id: body.event_id || body.eventId || '',
    event_type: normalized,
    event_timestamp: occurredAt,
    platform: 'GHL Courses',
    course_name: courseName,
    product_name: courseName,
    category_name: categoryName,
    lesson_name: lessonName,
    module_name: contentName,
    content_accessed: contentName,
    ip_address: body.ipAddress || body.ip_address || '',
    device_fingerprint: body.deviceFingerprint || body.device_fingerprint || '',
    time_spent: body.timeSpent || body.time_spent || '',
    raw: body,
  };

  if (normalized.includes('login') || normalized === 'access_granted') {
    return {
      eventType: 'service_access',
      data: {
        ...base,
        event_type: normalized.includes('login') ? 'login' : 'access_granted',
        access_date: occurredAt,
        content_accessed: contentName || 'GHL course portal',
      },
    };
  }

  if (normalized === 'access_removed') {
    return {
      eventType: 'custom_event',
      data: {
        ...base,
        type: 'course_access_removed',
        description: `GHL course access removed${courseName ? ` for ${courseName}` : ''}.`,
        summary: `GHL course access removed${courseName ? ` for ${courseName}` : ''}.`,
      },
    };
  }

  if (normalized.includes('product_completed') || normalized.includes('course_completed')) {
    return {
      eventType: 'course_completed',
      data: {
        ...base,
        completion_date: occurredAt,
        certificate: body.certificateUrl || body.certificate_url || '',
      },
    };
  }

  if (normalized.includes('completed')) {
    return {
      eventType: 'module_completed',
      data: {
        ...base,
        completion_date: occurredAt,
        progress_pct: body.progressPct || body.progress_pct || 100,
      },
    };
  }

  return {
    eventType: 'module_progress',
    data: {
      ...base,
      started_at: occurredAt,
      progress_pct: body.progressPct || body.progress_pct || 0,
    },
  };
}

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
