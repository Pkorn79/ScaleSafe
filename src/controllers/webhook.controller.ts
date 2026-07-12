import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { paymentEventRepository } from '../repositories/paymentEvent.repository';
import { offerRepository } from '../repositories/offer.repository';
import { getSupabase } from '../clients/supabase.client';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { evidenceService } from '../services/evidence.service';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { ghlActivityService } from '../services/ghl-activity.service';
import { triggerController } from './trigger.controller';
import { merchantHasOAuthCredentials, merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { evidenceConnectionService } from '../services/evidence-connection.service';
import { evidenceConnectorService } from '../services/evidence-connector.service';

function webhookType(body: Record<string, any>): string {
  return String(body.type || body.event_type || body.eventType || body.triggerData?.eventType || '').trim();
}

function isTriggerSubscriptionWebhook(body: Record<string, any>): boolean {
  const hasTriggerIdentity = Boolean(
    body.triggerKey ||
    body.trigger_key ||
    body.triggerName ||
    body.trigger_name ||
    body.name ||
    body.label ||
    body.workflowTriggerName ||
    body.workflow_trigger_name ||
    body.trigger?.key ||
    body.trigger?.triggerKey ||
    body.trigger?.trigger_key ||
    body.trigger?.name ||
    body.trigger?.label ||
    body.event?.triggerKey ||
    body.event?.trigger_key ||
    body.event?.name ||
    body.event?.label ||
    body.triggerData?.key ||
    body.triggerData?.triggerKey ||
    body.triggerData?.trigger_key ||
    body.triggerData?.name ||
    body.triggerData?.label ||
    body.meta?.key ||
    body.meta?.triggerKey ||
    body.meta?.name ||
    body.meta?.label
  );
  const hasSubscriptionTarget = Boolean(
    body.subscriptionUrl ||
    body.subscription_url ||
    body.targetUrl ||
    body.target_url ||
    body.webhookUrl ||
    body.webhook_url ||
    body.url ||
    body.trigger?.subscriptionUrl ||
    body.trigger?.subscription_url ||
    body.trigger?.targetUrl ||
    body.trigger?.target_url ||
    body.event?.subscriptionUrl ||
    body.event?.subscription_url ||
    body.event?.targetUrl ||
    body.event?.target_url ||
    body.data?.subscriptionUrl ||
    body.data?.subscription_url ||
    body.data?.targetUrl ||
    body.data?.target_url ||
    body.triggerData?.targetUrl ||
    body.triggerData?.target_url ||
    body.triggerData?.subscriptionUrl ||
    body.triggerData?.subscription_url ||
    body.triggerData?.url ||
    body.meta?.subscriptionUrl ||
    body.meta?.subscription_url ||
    body.meta?.targetUrl ||
    body.meta?.target_url ||
    body.meta?.url
  );
  return hasTriggerIdentity && hasSubscriptionTarget;
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
    Boolean(body.appointment || body.invoiceNumber || body.invoiceItems || body.messageId || body.conversationId)
  );
}

export const webhookController = {
  /**
   * GHL Marketplace app lifecycle events (INSTALL / UNINSTALL).
   *
   * These are the authoritative per-location install signal — GHL fires a
   * company-level INSTALL (no locationId) and then one per sub-account
   * (locationId + companyId). The OAuth callback still supplies tokens, but
   * a merchant row is guaranteed here even if the callback fails, so the
   * install is never invisible to ScaleSafe.
   */
  async ghlAppLifecycle(req: Request, res: Response, _next: NextFunction) {
    const body = req.body || {};
    const type = webhookType(body);
    const locationId = String(body.locationId || '').trim();
    const companyId = String(body.companyId || '').trim();

    try {
      if (type === 'INSTALL') {
        if (!locationId) {
          logger.info({ companyId }, 'GHL app INSTALL (company-level) received; per-location events follow');
          res.json({ received: true });
          return;
        }
        let existing = await merchantRepository.findByLocationId(locationId);
        if (existing) {
          const reinstalling = existing.status === 'uninstalled';
          existing = await merchantRepository.update(locationId, {
            company_id: companyId || existing.company_id,
            status: 'active',
            ...(reinstalling ? {
              // Never reactivate credentials retained from a prior install.
              // OAuth (or a current same-company bulk authorization) must bind
              // this new installation before merchant SSO is accepted.
              ghl_access_token: '',
              ghl_refresh_token: '',
              ghl_access_token_encrypted: null,
              ghl_refresh_token_encrypted: null,
              ghl_token_expires_at: null,
              config: {
                ...(existing.config || {}),
                ghl_token_scope: null,
                ghl_token_company_id: null,
                ghl_token_location_id: null,
                location_access_token: null,
                location_refresh_token: null,
                location_access_token_encrypted: null,
                location_refresh_token_encrypted: null,
                location_token_expires_at: null,
              },
            } : {}),
          } as any);
          logger.info({ locationId, companyId }, 'GHL app INSTALL: existing merchant reactivated');
        } else {
          // Token-less stub — the OAuth callback (or a location-token mint)
          // fills tokens; provisioning waits until tokens exist.
          await merchantRepository.create({
            location_id: locationId,
            company_id: companyId || undefined,
            ghl_access_token: '',
            ghl_refresh_token: '',
          });
          logger.info({ locationId, companyId }, 'GHL app INSTALL: merchant stub created (tokens pending OAuth)');
        }

        const authorizedMerchant = companyId && (!existing || !merchantHasOAuthCredentials(existing))
          ? await merchantRepository.adoptCompanyAuthorization(locationId, companyId)
          : existing;
        if (authorizedMerchant && merchantHasOAuthCredentials(authorizedMerchant)
          && authorizedMerchant.snapshot_status !== 'installed') {
          merchantService.provisionMerchant(locationId).catch((err) => {
            logger.error({ err, locationId }, 'Provisioning after GHL INSTALL failed');
          });
        }
      } else if (type === 'UNINSTALL' && locationId) {
        const existing = await merchantRepository.findByLocationId(locationId);
        if (existing) {
          await merchantRepository.update(locationId, {
            status: 'uninstalled',
            ghl_access_token: '',
            ghl_refresh_token: '',
            ghl_access_token_encrypted: null,
            ghl_refresh_token_encrypted: null,
            ghl_token_expires_at: null,
            config: {
              ...(existing.config || {}),
              ghl_token_scope: null,
              ghl_token_company_id: null,
              ghl_token_location_id: null,
              location_access_token: null,
              location_refresh_token: null,
              location_access_token_encrypted: null,
              location_refresh_token_encrypted: null,
              location_token_expires_at: null,
            },
          } as any);
          logger.info({ locationId }, 'GHL app UNINSTALL: merchant marked uninstalled');
        } else {
          logger.info({ locationId }, 'GHL app UNINSTALL for unknown location — ignored');
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      // Return a retryable failure. Losing an INSTALL event can leave a future
      // bulk-installed location without credentials or provisioning state.
      logger.error(
        { err: err?.message || String(err), code: err?.code, type, locationId, companyId },
        'GHL app lifecycle webhook handling failed',
      );
      res.status(503).json({ received: false, retry: true });
    }
  },

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

    if (type === 'INSTALL' || type === 'UNINSTALL') {
      await webhookController.ghlAppLifecycle(req, res, next);
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
      const { formId, contactId, data, enrollment_id, enrollmentId } = req.body;
      const locationId = req.tenantContext?.locationId || '';
      const payloadLocationId = String(req.body?.locationId || req.body?.location_id || '').trim();
      if (!locationId || (payloadLocationId && payloadLocationId !== locationId)) {
        throw new ValidationError('Webhook tenant does not match payload location');
      }
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
      const tenantLocationId = req.tenantContext?.locationId;
      if (!tenantLocationId || tenantLocationId !== location_id) throw new ValidationError('Webhook tenant does not match payload location');
      if (!contact_id && !contact_email) throw new ValidationError('contact_id or contact_email required');

      const connection = await evidenceConnectionService.ensureLegacy(tenantLocationId, source);
      const result = await evidenceConnectorService.ingestLegacy({
        connection,
        auth: {
          connection,
          credential: {
            id: 'legacy_merchant_secret',
            connection_id: connection.id,
            credential_type: 'api_key',
            key_prefix: 'legacy',
            secret_hash: '',
            secret_encrypted: null,
            status: 'active',
            expires_at: null,
          },
          authMethod: 'api_key',
          signatureVerified: false,
        },
        payload: { source, event_type, location_id, contact_id, contact_email, data },
        rawBody: req.rawBody,
      });
      res.status(result.duplicate ? 200 : 202).json({ status: result.processingStatus, eventId: result.event.id });
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
      const locationId = req.tenantContext?.locationId || '';
      const payloadLocationId = String(body.locationId || body.location_id || '').trim();
      if (!locationId || (payloadLocationId && payloadLocationId !== locationId)) {
        throw new ValidationError('Webhook tenant does not match payload location');
      }
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

async function findEnrollmentForGhlPayment(
  body: Record<string, unknown>,
  statuses: string[] = ['enrolled', 'active', 'consent_captured', 'paid_pending_enrollment'],
): Promise<any | null> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const metadata = (body.metadata as Record<string, unknown>) || {};
  const explicitEnrollmentId = String(
    body.enrollmentId
    || body.enrollment_id
    || metadata.enrollmentId
    || metadata.enrollment_id
    || '',
  ).trim();

  if (explicitEnrollmentId) {
    let query = getSupabase()
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('id', explicitEnrollmentId)
      .in('status', statuses);
    if (contactId) {
      query = query.eq('contact_id', contactId);
    }
    const { data } = await query.maybeSingle();
    if (data) return data;
  }

  const subscriptionId = String(body.subscriptionId || (body.subscription as any)?.id || '').trim();
  if (subscriptionId) {
    let query = getSupabase()
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('processor_subscription_id', subscriptionId)
      .in('status', statuses);
    if (contactId) {
      query = query.eq('contact_id', contactId);
    }
    const { data } = await query.maybeSingle();
    if (data) return data;
  }

  if (!contactId) return null;
  const items = (body.items as any[]) || [];
  for (const item of items) {
    const productId = item.productId || item.product_id;
    if (!productId) continue;
    const offer = await findOfferByProductId(locationId, productId);
    if (!offer) continue;
    const { data } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('offer_id', offer.id)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(2);
    const matches = Array.isArray(data) ? data : [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      logger.warn(
        { locationId, contactId, offerId: offer.id, productId, matchCount: matches.length },
        'GHL payment product match was ambiguous; leaving payment client-level',
      );
    }
  }

  return null;
}

async function handleOrderCompleted(body: Record<string, unknown>): Promise<void> {
  const locationId = body.locationId as string;
  const contactId = body.contactId as string;
  const amount = (body.amount as number) || 0;
  const transactionId = (body.transactionId || body.orderId || '') as string;
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
    ? await enrollmentRepository.findByConsentToken(consentToken, locationId)
    : null;

  if (!enrollment) {
    enrollment = await findEnrollmentForGhlPayment(body, ['consent_captured', 'paid_pending_enrollment']);
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
  // Resolve a stable id consistently with the top-level dedupe (transactionId then orderId)
  // so the recurring handler can dedupe; an empty id means "do not increment" (#8).
  const transactionId = (body.transactionId || body.orderId || '') as string;
  if (!contactId) {
    logger.warn({ locationId }, 'SubscriptionPayment missing contactId');
    return;
  }

  const enrollment = await findEnrollmentForGhlPayment(body, ['enrolled', 'active']);

  if (!enrollment) {
    logger.info({ locationId, contactId, transactionId }, 'SubscriptionPayment: no confident enrollment match found');
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

  const enrollment = await findEnrollmentForGhlPayment(body, ['enrolled', 'active', 'at_risk']);

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

  const originalEvent = transactionId
    ? await paymentEventRepository.findByTransactionId('ghl', transactionId, locationId)
    : null;
  const enrollment = originalEvent?.enrollment_id
    ? await enrollmentRepository.findById(originalEvent.enrollment_id, locationId)
    : await findEnrollmentForGhlPayment(body, ['enrolled', 'active', 'at_risk']);

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
