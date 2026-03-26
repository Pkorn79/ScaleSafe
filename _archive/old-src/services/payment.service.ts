/**
 * payment.service.ts — Payment Event Processing Service
 *
 * Handles all accept.blue webhook events after they've been identified
 * and verified. This is the Node.js equivalent of Make.com S7 (Post-Payment Handler)
 * with its 4 routes: Enrollment, Recurring, Refund, Failed.
 *
 * For each payment event, this service:
 * 1. Logs evidence to Supabase
 * 2. Updates the contact's 19 payment custom fields in GHL
 * 3. Triggers GHL workflows for notifications (via internal webhooks)
 *
 * Key design: uses accept.blue's recurring schedule data (num_left, next_run_date)
 * as the source of truth for payment counts, rather than incrementing GHL fields
 * (which can drift if a webhook is missed).
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import { createAcceptBlueClient, getRecurringSchedules } from '../clients/acceptblue.client';
import * as customerMapRepo from '../repositories/customer-map.repository';
import * as evidenceService from './evidence.service';
import {
  SS_PAYMENT_STATUS, SS_LAST_PAYMENT_DATE, SS_LAST_PAYMENT_AMOUNT,
  SS_PAYMENTS_MADE, SS_PAYMENTS_REMAINING, SS_TOTAL_PAID,
  SS_SUCCESSFUL_PAYMENT_COUNT, SS_FAILED_PAYMENT_COUNT,
  SS_LAST_FAILED_PAYMENT_DATE, SS_BILLING_FREQUENCY,
  SS_SUBSCRIPTION_START, SS_NEXT_PAYMENT_DATE, SS_REMAINING_BALANCE,
  SS_TOTAL_CONTRACT_VALUE, SS_TOTAL_SCHEDULED,
  SS_REFUND_AMOUNT, SS_REFUND_DATE, SS_REFUND_TRANSACTION_ID,
} from '../constants/ghl-contact-fields';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/** Parsed accept.blue webhook event. */
export interface PaymentEvent {
  type: string;       // succeeded, declined, error, status, updated
  subType: string;    // charge, refund, credit, void, adjust, settled, returned, etc.
  event: string;      // transaction or batch
  id: string;         // unique event ID (for idempotency)
  timestamp: string;
  data: {
    transaction?: {
      id: number;
      created_at: string;
      amount_details: { amount: number; tax?: number; surcharge?: number };
      status_details: { status: string; status_code: string; error_message?: string };
      customer?: { customer_id: number; email?: string };
      card_details?: { card_type: string; last_4: string };
      transaction_details?: { invoice_number?: string; description?: string };
    };
    reference_number?: string;
    auth_code?: string;
    auth_amount?: number;
  };
}

/**
 * Master dispatcher — routes a payment event to the correct handler.
 * Called by the webhook controller after idempotency check and merchant identification.
 */
export async function routeWebhook(
  locationId: string,
  contactId: string,
  event: PaymentEvent,
  abApiKey: string
): Promise<{ handler: string; success: boolean }> {
  const { type, subType } = event;

  logger.info(
    { locationId, contactId, type, subType, eventId: event.id },
    `Payment event: ${type}/${subType}`
  );

  if (type === 'succeeded' && (subType === 'refund' || subType === 'credit')) {
    await handleRefund(locationId, contactId, event);
    return { handler: 'refund', success: true };
  }

  if (type === 'succeeded' && subType === 'charge') {
    await handleChargeSucceeded(locationId, contactId, event, abApiKey);
    return { handler: 'charge_succeeded', success: true };
  }

  if (type === 'declined') {
    await handleChargeDeclined(locationId, contactId, event);
    return { handler: 'declined', success: true };
  }

  if (type === 'error') {
    await handleError(locationId, contactId, event);
    return { handler: 'error', success: true };
  }

  if (type === 'status') {
    await handleACHStatus(locationId, contactId, event);
    return { handler: 'ach_status', success: true };
  }

  logger.warn({ type, subType }, 'Unhandled payment event type');
  return { handler: 'unknown', success: false };
}

/**
 * Handles a successful charge (enrollment or recurring).
 * Logs evidence, updates all payment contact fields.
 */
async function handleChargeSucceeded(
  locationId: string,
  contactId: string,
  event: PaymentEvent,
  abApiKey: string
): Promise<void> {
  const txn = event.data.transaction;
  if (!txn) return;

  const amount = txn.amount_details.amount;
  const customerId = txn.customer?.customer_id;

  // Log payment evidence
  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'charge_succeeded',
    amount,
    reference_number: event.data.reference_number,
    card_type: txn.card_details?.card_type,
    last_4: txn.card_details?.last_4,
    transaction_id: txn.id,
    status: txn.status_details.status,
  });

  // Fetch recurring schedule data from accept.blue for accurate counts
  let paymentsRemaining: number | null = null;
  let nextPaymentDate: string | null = null;
  let totalScheduled: number | null = null;

  if (customerId && abApiKey) {
    try {
      const abClient = createAcceptBlueClient(abApiKey);
      const schedules = await getRecurringSchedules(abClient, customerId);
      if (schedules?.length > 0) {
        const schedule = schedules[0]; // Primary schedule
        paymentsRemaining = schedule.num_left ?? null;
        nextPaymentDate = schedule.next_run_date ?? null;
        totalScheduled = schedule.num_left != null
          ? (schedule.num_left + 1) // current payment + remaining
          : null;
      }
    } catch (err) {
      logger.warn({ customerId, err }, 'Could not fetch recurring schedule — using field increment');
    }
  }

  // Update contact payment fields in GHL
  const fieldUpdates: Record<string, unknown> = {
    [SS_LAST_PAYMENT_DATE.key]: new Date().toISOString().split('T')[0],
    [SS_LAST_PAYMENT_AMOUNT.key]: amount,
    [SS_PAYMENT_STATUS.key]: 'Current',
  };

  if (paymentsRemaining !== null) {
    fieldUpdates[SS_PAYMENTS_REMAINING.key] = paymentsRemaining;
  }
  if (nextPaymentDate !== null) {
    fieldUpdates[SS_NEXT_PAYMENT_DATE.key] = nextPaymentDate;
  }

  await updateContactFields(locationId, contactId, fieldUpdates);

  logger.info(
    { locationId, contactId, amount, paymentsRemaining },
    'Charge succeeded — evidence logged, fields updated'
  );
}

/**
 * Handles a declined/failed charge.
 * Logs evidence, updates payment status to "Past Due".
 */
async function handleChargeDeclined(
  locationId: string,
  contactId: string,
  event: PaymentEvent
): Promise<void> {
  const txn = event.data.transaction;

  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'charge_declined',
    amount: txn?.amount_details.amount,
    decline_reason: txn?.status_details.error_message || txn?.status_details.status,
    transaction_id: txn?.id,
  });

  await updateContactFields(locationId, contactId, {
    [SS_PAYMENT_STATUS.key]: 'Past Due',
    [SS_LAST_FAILED_PAYMENT_DATE.key]: new Date().toISOString().split('T')[0],
  });

  logger.info({ locationId, contactId }, 'Charge declined — status set to Past Due');
}

/**
 * Handles a successful refund.
 * Logs to evidence_refund_activity and updates refund fields on contact.
 */
async function handleRefund(
  locationId: string,
  contactId: string,
  event: PaymentEvent
): Promise<void> {
  const txn = event.data.transaction;
  const amount = txn?.amount_details.amount || 0;

  await evidenceService.logRefundActivity(locationId, contactId, {
    amount,
    reference_number: event.data.reference_number,
    transaction_id: txn?.id,
    refund_date: new Date().toISOString(),
  });

  await updateContactFields(locationId, contactId, {
    [SS_REFUND_AMOUNT.key]: String(amount),
    [SS_REFUND_DATE.key]: new Date().toISOString().split('T')[0],
    [SS_REFUND_TRANSACTION_ID.key]: String(event.data.reference_number || txn?.id || ''),
    [SS_PAYMENT_STATUS.key]: 'Refunded',
  });

  logger.info({ locationId, contactId, amount }, 'Refund processed — evidence logged, fields updated');
}

/**
 * Handles a processing error from accept.blue.
 */
async function handleError(
  locationId: string,
  contactId: string,
  event: PaymentEvent
): Promise<void> {
  const txn = event.data.transaction;

  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'processing_error',
    error_message: txn?.status_details.error_message,
    transaction_id: txn?.id,
  });

  logger.error(
    { locationId, contactId, error: txn?.status_details.error_message },
    'Payment processing error'
  );
}

/**
 * Handles ACH-specific status updates (settled, returned, originated, etc.).
 */
async function handleACHStatus(
  locationId: string,
  contactId: string,
  event: PaymentEvent
): Promise<void> {
  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: `ach_${event.subType}`,
    transaction_id: event.data.transaction?.id,
    status: event.subType,
  });

  // If ACH returned, treat like a decline
  if (event.subType === 'returned') {
    await updateContactFields(locationId, contactId, {
      [SS_PAYMENT_STATUS.key]: 'Past Due',
      [SS_LAST_FAILED_PAYMENT_DATE.key]: new Date().toISOString().split('T')[0],
    });
  }

  logger.info({ locationId, contactId, achStatus: event.subType }, 'ACH status update logged');
}

/**
 * Resolves a payment webhook to a GHL contact using the ab_customer_map.
 * Returns { locationId, contactId } or null if the customer is unknown.
 */
export async function resolveContactFromWebhook(
  event: PaymentEvent
): Promise<{ locationId: string; contactId: string; abApiKey: string } | null> {
  const customerId = event.data.transaction?.customer?.customer_id;
  if (!customerId) {
    logger.warn({ eventId: event.id }, 'Payment event has no customer_id — cannot resolve');
    return null;
  }

  const mapping = await customerMapRepo.findByAbCustomerId(String(customerId));
  if (!mapping) {
    logger.warn({ customerId, eventId: event.id }, 'No customer map entry — unknown customer');
    return null;
  }

  // Get the merchant's accept.blue API key for schedule lookups
  const { findByLocationId } = await import('../repositories/merchant.repository');
  const merchant = await findByLocationId(mapping.location_id);
  if (!merchant?.ab_api_key) {
    logger.warn({ locationId: mapping.location_id }, 'Merchant has no accept.blue API key');
    return null;
  }

  return {
    locationId: mapping.location_id,
    contactId: mapping.contact_id,
    abApiKey: merchant.ab_api_key,
  };
}

/**
 * Updates custom fields on a GHL contact.
 * Used by all payment handlers to update the 19 payment fields.
 */
async function updateContactFields(
  locationId: string,
  contactId: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    const client = await ghlClient.getAuthenticatedClient(locationId);
    await client.put(
      `/contacts/${contactId}`,
      { customFields: fields },
      { headers: { Version: '2021-07-28' } }
    );
    logger.debug({ locationId, contactId, fieldCount: Object.keys(fields).length }, 'Contact fields updated');
  } catch (err) {
    logger.error({ err, locationId, contactId }, 'Failed to update contact fields');
    // Don't throw — evidence is already logged, field update failure shouldn't block webhook response
  }
}
