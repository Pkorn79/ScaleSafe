/**
 * notification.service.ts — GHL Workflow Notification Trigger
 *
 * Thin service that triggers GHL workflows for notifications.
 * The app handles data processing and evidence logging. GHL handles
 * sending emails, SMS, and managing notification templates.
 *
 * Communication pattern:
 * - For recurring events (monthly payments): uses GHL Internal Webhooks
 *   (because GHL "Contact Tag Added" trigger only fires on FIRST tag add)
 * - For one-time events (enrollment, refund, cancellation): uses tag triggers
 *   (the tag is new each time, so the workflow fires reliably)
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';

const ghlClient = new GhlClient(tokenStore);

/**
 * Triggers a GHL workflow via an internal webhook.
 * Used for recurring events where tag triggers won't re-fire.
 */
export async function triggerGhlWebhook(
  locationId: string,
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const client = await ghlClient.getAuthenticatedClient(locationId);
    await client.post(webhookUrl, payload);
    logger.debug({ locationId, webhookUrl }, 'GHL internal webhook triggered');
  } catch (err) {
    logger.error({ err, locationId, webhookUrl }, 'Failed to trigger GHL webhook');
    // Don't throw — notification failure shouldn't block payment processing
  }
}

/**
 * Adds a tag to a GHL contact to trigger a one-time workflow.
 * Used for events like enrollment, refund, cancellation.
 */
export async function addContactTag(
  locationId: string,
  contactId: string,
  tag: string
): Promise<void> {
  try {
    const client = await ghlClient.getAuthenticatedClient(locationId);
    await client.post(
      `/contacts/${contactId}/tags`,
      { tags: [tag] },
      { headers: { Version: '2021-07-28' } }
    );
    logger.debug({ locationId, contactId, tag }, 'Contact tag added');
  } catch (err) {
    logger.error({ err, locationId, contactId, tag }, 'Failed to add contact tag');
  }
}

/**
 * Notifies merchant of a successful recurring payment.
 * Triggers via GHL internal webhook (not tag) because this happens monthly.
 */
export async function notifyRecurringPayment(
  locationId: string,
  contactId: string,
  data: { amount: number; programName: string; contactName: string }
): Promise<void> {
  // The GHL internal webhook URL would be configured per-merchant.
  // For now, log the intent. Phase 4 will add the webhook URL to merchant config.
  logger.info(
    { locationId, contactId, ...data },
    'Recurring payment notification queued (GHL webhook URL not yet configured)'
  );
}

/**
 * Notifies about a failed payment via tag (triggers dunning workflow).
 */
export async function notifyFailedPayment(
  locationId: string,
  contactId: string
): Promise<void> {
  await addContactTag(locationId, contactId, 'ss-payment-failed');
}

/**
 * Notifies about a refund via tag.
 */
export async function notifyRefund(
  locationId: string,
  contactId: string
): Promise<void> {
  await addContactTag(locationId, contactId, 'ss-refund-processed');
}

/**
 * Notifies about enrollment via tag.
 */
export async function notifyEnrollment(
  locationId: string,
  contactId: string
): Promise<void> {
  await addContactTag(locationId, contactId, 'ss-enrolled');
}
