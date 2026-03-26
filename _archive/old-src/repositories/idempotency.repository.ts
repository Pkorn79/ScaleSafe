/**
 * idempotency.repository.ts — Idempotency Key Data Access
 *
 * Tracks which webhook events have already been processed to prevent
 * double-handling. accept.blue retries failed webhook deliveries, and
 * network issues can cause duplicate deliveries. Without idempotency,
 * a single payment could log evidence twice or update fields twice.
 *
 * Each event is identified by (event_id, source). If the combination
 * already exists, the event has been processed and should be skipped.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { logger } from '../utils/logger';

/** Checks if an event has already been processed. */
export async function exists(eventId: string, source: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('idempotency_keys')
    .select('id')
    .eq('event_id', eventId)
    .eq('source', source)
    .limit(1);

  if (error) {
    logger.error({ error, eventId, source }, 'Error checking idempotency');
    throw error;
  }

  return (data?.length ?? 0) > 0;
}

/** Marks an event as processed. Stores the result for debugging. */
export async function markProcessed(
  eventId: string,
  source: string,
  locationId: string,
  result?: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('idempotency_keys').insert({
    event_id: eventId,
    source,
    location_id: locationId,
    result: result || null,
  });

  if (error) {
    // Unique constraint violation means it was already marked — not an error
    if (error.code === '23505') {
      logger.debug({ eventId, source }, 'Idempotency key already exists (race condition)');
      return;
    }
    logger.error({ error, eventId, source }, 'Error marking event as processed');
    throw error;
  }
}
