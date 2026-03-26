/**
 * webhook.controller.ts — Webhook Request Handler
 *
 * Receives webhooks from three sources and dispatches them:
 *
 * 1. accept.blue — payment events (succeeded, declined, error, refund, ACH status)
 *    Dispatched by type + subType fields in the payload.
 *
 * 2. GHL — form submissions and workflow triggers
 *    Dispatched by form ID in the payload.
 *
 * 3. External — third-party tools (Calendly, Zoom, Kajabi, etc.)
 *    Dispatched by event_type field in the payload.
 *
 * All handlers use idempotency to prevent duplicate processing.
 * accept.blue webhooks are HMAC-verified before processing.
 */

import { Request, Response, NextFunction } from 'express';
import * as evidenceService from '../services/evidence.service';
import * as paymentService from '../services/payment.service';
import { withIdempotency } from '../services/idempotency.service';
import { verifyWebhookSignature } from '../middleware/webhookVerification';
import { BadRequestError, WebhookVerificationError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================
// ACCEPT.BLUE WEBHOOK HANDLER
// ============================================

/**
 * Handles all accept.blue transaction webhooks.
 * Webhook payload includes: type, subType, event, id, timestamp, data.
 *
 * Routing logic:
 * - type:"succeeded" + subType:"charge"   → payment succeeded
 * - type:"succeeded" + subType:"refund"   → refund succeeded
 * - type:"succeeded" + subType:"credit"   → credit/refund succeeded
 * - type:"declined"  + any subType        → payment declined
 * - type:"error"     + any subType        → processing error
 * - type:"status"    + any subType        → ACH status update
 * - type:"updated"   + any subType        → transaction adjusted/voided
 * - event:"batch"                         → batch closed (ignored for now)
 */
export async function handleAcceptBlueWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body;
    const { type, subType, event, id: eventId, data } = payload;

    if (!eventId || !type) {
      throw new BadRequestError('Invalid accept.blue webhook: missing id or type');
    }

    // Batch events don't need processing right now
    if (event === 'batch') {
      logger.info({ eventId, type }, 'Batch event received — skipping');
      res.status(200).json({ received: true });
      return;
    }

    logger.info(
      { eventId, type, subType, event },
      `accept.blue webhook: ${type}/${subType}`
    );

    // Resolve the merchant and contact from the accept.blue customer_id
    // via the ab_customer_map table
    const resolved = await paymentService.resolveContactFromWebhook(payload);

    if (!resolved) {
      // Unknown customer — might be a new enrollment (handled by enrollment flow)
      // or a webhook for a customer we haven't mapped yet. Log and acknowledge.
      logger.warn({ eventId, type, subType }, 'Could not resolve merchant from webhook — acknowledging');
      res.status(200).json({ received: true, resolved: false });
      return;
    }

    const { locationId, contactId, abApiKey } = resolved;

    // Verify the webhook HMAC signature
    const signature = req.headers['x-signature'] as string;
    const rawBody = (req as any).rawBody as Buffer;
    if (signature && rawBody) {
      const isValid = await verifyWebhookSignature(rawBody, signature, locationId);
      if (!isValid) {
        logger.warn({ eventId, locationId }, 'accept.blue webhook signature verification failed');
        throw new WebhookVerificationError();
      }
    }

    // Use idempotency to prevent double-processing
    const result = await withIdempotency(eventId, 'acceptblue', locationId, async () => {
      return paymentService.routeWebhook(locationId, contactId, payload, abApiKey);
    });

    if (result === null) {
      logger.info({ eventId }, 'Duplicate accept.blue webhook — already processed');
    }

    // Always respond 200 quickly to prevent retries
    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}

// ============================================
// GHL WEBHOOK HANDLER
// ============================================

/**
 * Handles GHL form submissions and workflow triggers.
 * The payload includes the form ID (or workflow trigger data) which
 * determines which evidence table to write to.
 */
export async function handleGhlWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body;
    const locationId = payload.location_id || payload.locationId;
    const formId = payload.form_id || payload.formId;
    const contactId = payload.contact_id || payload.contactId;

    if (!locationId) {
      throw new BadRequestError('GHL webhook missing location_id');
    }

    logger.info(
      { locationId, formId, contactId },
      `GHL webhook received: form=${formId}`
    );

    if (formId) {
      // Form submission → route to evidence table
      await evidenceService.logFromForm(locationId, formId, payload);
      logger.info({ locationId, formId, contactId }, 'Evidence logged from GHL form');
    } else {
      // Workflow trigger or other event — log for debugging
      logger.info({ locationId, payload }, 'GHL workflow event received');
    }

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}

// ============================================
// EXTERNAL INTEGRATION WEBHOOK HANDLER
// ============================================

/**
 * Handles webhooks from third-party tools (Calendly, Zoom, Kajabi, Zapier, etc.).
 * Payload must match the schema from external-integration-guide.md:
 *   { source, event_type, location_id, contact_email, contact_name, contact_id, data }
 */
export async function handleExternalWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body;
    const { source, event_type, location_id, contact_email, contact_name, contact_id, data } = payload;

    // Validate required fields
    if (!source || !event_type || !location_id) {
      throw new BadRequestError(
        'External webhook missing required fields: source, event_type, location_id'
      );
    }

    if (!contact_email && !contact_id) {
      throw new BadRequestError(
        'External webhook must include contact_email or contact_id'
      );
    }

    logger.info(
      { source, eventType: event_type, locationId: location_id, contactId: contact_id },
      `External webhook: ${source}/${event_type}`
    );

    await evidenceService.logExternalEvent(location_id, {
      source,
      event_type,
      location_id,
      contact_email: contact_email || '',
      contact_name: contact_name || '',
      contact_id,
      data: data || {},
    });

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}

// ============================================
// SERVICE ACCESS WEBHOOK HANDLER
// ============================================

/**
 * Handles platform access events (login, view, download, completion).
 * From S13 sources: Kajabi, Skool, GHL Memberships, Teachable.
 */
export async function handleServiceAccessWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body;
    const { location_id, contact_id, event_type, source } = payload;

    if (!location_id || !contact_id) {
      throw new BadRequestError('Service access webhook missing location_id or contact_id');
    }

    logger.info(
      { locationId: location_id, contactId: contact_id, source, eventType: event_type },
      `Service access: ${source}/${event_type}`
    );

    await evidenceService.logServiceAccess(location_id, contact_id, {
      platform: source || payload.platform,
      event_type: event_type || 'access',
      content_accessed: payload.data?.content_accessed || payload.resource_accessed,
      access_date: payload.data?.access_date || new Date().toISOString(),
      time_spent: payload.data?.time_spent || payload.duration_seconds,
      completion_status: payload.data?.completion_status || null,
    });

    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}
