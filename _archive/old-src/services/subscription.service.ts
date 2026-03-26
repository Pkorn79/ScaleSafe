/**
 * subscription.service.ts — Subscription Management Service
 *
 * Handles pause, resume, and cancel operations for installment payment
 * schedules via the accept.blue API. Each action:
 * 1. Calls accept.blue to modify the recurring schedule
 * 2. Logs evidence to Supabase (for the audit trail)
 * 3. Updates the contact's payment status in GHL
 *
 * These operations are triggered by the merchant through the portal
 * or by GHL workflows (e.g., cancellation form → webhook → this service).
 */

import { findByLocationId } from '../repositories/merchant.repository';
import { findByContactId } from '../repositories/customer-map.repository';
import {
  createAcceptBlueClient,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
  cancelRecurringSchedule,
  getRecurringSchedules,
} from '../clients/acceptblue.client';
import * as evidenceService from './evidence.service';
import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import { SS_PAYMENT_STATUS } from '../constants/ghl-contact-fields';
import { logger } from '../utils/logger';
import { NotFoundError, ExternalServiceError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/**
 * Pauses a client's installment schedule.
 * The schedule remains in accept.blue but no charges are processed.
 */
export async function pause(locationId: string, contactId: string): Promise<void> {
  const { abClient, scheduleId } = await resolveSchedule(locationId, contactId);

  await pauseRecurringSchedule(abClient, scheduleId);

  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'subscription_paused',
    schedule_id: scheduleId,
  });

  await updateContactStatus(locationId, contactId, 'Paused');

  logger.info({ locationId, contactId, scheduleId }, 'Subscription paused');
}

/**
 * Resumes a paused installment schedule.
 */
export async function resume(locationId: string, contactId: string): Promise<void> {
  const { abClient, scheduleId } = await resolveSchedule(locationId, contactId);

  await resumeRecurringSchedule(abClient, scheduleId);

  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'subscription_resumed',
    schedule_id: scheduleId,
  });

  await updateContactStatus(locationId, contactId, 'Current');

  logger.info({ locationId, contactId, scheduleId }, 'Subscription resumed');
}

/**
 * Cancels a client's installment schedule permanently.
 * Logs cancellation evidence and updates the contact's payment status.
 */
export async function cancel(locationId: string, contactId: string, reason?: string): Promise<void> {
  const { abClient, scheduleId } = await resolveSchedule(locationId, contactId);

  await cancelRecurringSchedule(abClient, scheduleId);

  await evidenceService.logPaymentEvent(locationId, contactId, {
    event_type: 'subscription_cancelled',
    schedule_id: scheduleId,
    reason: reason || 'Merchant requested',
  });

  await updateContactStatus(locationId, contactId, 'Cancelled');

  logger.info({ locationId, contactId, scheduleId, reason }, 'Subscription cancelled');
}

/**
 * Gets the current status of a client's recurring schedule from accept.blue.
 * Returns schedule details including payments remaining and next payment date.
 */
export async function getStatus(locationId: string, contactId: string): Promise<Record<string, unknown>> {
  const { abClient, abCustomerId } = await resolveCustomer(locationId, contactId);

  const schedules = await getRecurringSchedules(abClient, parseInt(abCustomerId, 10));
  if (!schedules?.length) {
    return { active: false, message: 'No recurring schedules found' };
  }

  const schedule = schedules[0];
  return {
    active: schedule.active ?? true,
    scheduleId: schedule.id,
    amount: schedule.amount,
    frequency: schedule.frequency,
    paymentsRemaining: schedule.num_left,
    nextPaymentDate: schedule.next_run_date,
    prevPaymentDate: schedule.prev_run_date,
  };
}

/** Resolves the accept.blue recurring schedule ID for a contact. */
async function resolveSchedule(locationId: string, contactId: string) {
  const { abClient, abCustomerId } = await resolveCustomer(locationId, contactId);

  const schedules = await getRecurringSchedules(abClient, parseInt(abCustomerId, 10));
  if (!schedules?.length) {
    throw new NotFoundError('No recurring schedule found for this contact');
  }

  return { abClient, scheduleId: schedules[0].id as number };
}

/** Resolves an accept.blue client and customer ID for a contact. */
async function resolveCustomer(locationId: string, contactId: string) {
  const merchant = await findByLocationId(locationId);
  if (!merchant?.ab_api_key) {
    throw new ExternalServiceError('accept.blue', 'Merchant has no accept.blue API key');
  }

  const mappings = await findByContactId(locationId, contactId);
  if (!mappings.length) {
    throw new NotFoundError('No accept.blue customer mapping found for this contact');
  }

  const abClient = createAcceptBlueClient(merchant.ab_api_key);
  return { abClient, abCustomerId: mappings[0].ab_customer_id };
}

/** Updates the contact's payment status field in GHL. */
async function updateContactStatus(locationId: string, contactId: string, status: string): Promise<void> {
  try {
    const client = await ghlClient.getAuthenticatedClient(locationId);
    await client.put(
      `/contacts/${contactId}`,
      { customFields: { [SS_PAYMENT_STATUS.key]: status } },
      { headers: { Version: '2021-07-28' } }
    );
  } catch (err) {
    logger.error({ err, locationId, contactId }, 'Failed to update payment status');
  }
}
