/**
 * idempotency.service.ts — Webhook Deduplication
 *
 * Wraps any webhook handler with idempotency checking.
 * Before processing an event, checks if the event_id has already been handled.
 * After successful processing, marks it as done.
 *
 * Usage:
 *   const result = await withIdempotency(eventId, 'acceptblue', locationId, async () => {
 *     // ... process the webhook event ...
 *     return { success: true };
 *   });
 *
 * If the event was already processed, returns null without running the handler.
 */

import * as idempotencyRepo from '../repositories/idempotency.repository';
import { logger } from '../utils/logger';

/**
 * Executes a handler only if the event hasn't been processed before.
 * Returns the handler's result, or null if the event was a duplicate.
 */
export async function withIdempotency<T>(
  eventId: string,
  source: string,
  locationId: string,
  handler: () => Promise<T>
): Promise<T | null> {
  // Check if already processed
  const alreadyProcessed = await idempotencyRepo.exists(eventId, source);
  if (alreadyProcessed) {
    logger.info({ eventId, source, locationId }, 'Duplicate event skipped (idempotent)');
    return null;
  }

  // Process the event
  const result = await handler();

  // Mark as processed (store a summary for debugging)
  const resultSummary = typeof result === 'object' && result !== null
    ? result as Record<string, unknown>
    : { value: result };
  await idempotencyRepo.markProcessed(eventId, source, locationId, resultSummary);

  logger.debug({ eventId, source, locationId }, 'Event processed and marked');
  return result;
}
