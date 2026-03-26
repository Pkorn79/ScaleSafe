/**
 * evidence.repository.ts — Evidence Data Access Layer
 *
 * All database operations for the 10 evidence tables in Supabase.
 * Evidence records are APPEND-ONLY — they are never updated or deleted
 * because they form a legal audit trail for chargeback defense.
 *
 * Every insert includes contact_id and location_id for multi-tenant isolation.
 * Timestamps are set server-side (not from the client payload).
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import { EVIDENCE_TABLES, EVIDENCE_TIMELINE_VIEW } from '../constants/evidence-types';

/**
 * Inserts a single evidence record into the specified table.
 * The table name must be one of the EVIDENCE_TABLES constants.
 */
export async function insertEvidence(
  table: string,
  record: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();

  // Ensure required fields are present
  if (!record.contact_id || !record.location_id) {
    throw new Error(`Evidence insert missing required fields: contact_id=${record.contact_id}, location_id=${record.location_id}`);
  }

  const { data, error } = await supabase
    .from(table)
    .insert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, table, contactId: record.contact_id }, 'Error inserting evidence');
    throw error;
  }

  logger.debug(
    { table, contactId: record.contact_id, locationId: record.location_id },
    `Evidence logged to ${table}`
  );

  return data;
}

/**
 * Queries the evidence_timeline view for ALL evidence for a contact.
 * Returns a chronological array of all evidence types.
 * Used by the AI Defense Compiler to gather everything for a defense packet.
 */
export async function getTimelineForContact(
  locationId: string,
  contactId: string
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(EVIDENCE_TIMELINE_VIEW)
    .select('*')
    .eq('location_id', locationId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error, locationId, contactId }, 'Error fetching evidence timeline');
    throw error;
  }

  return data || [];
}

/**
 * Gets evidence of a specific type for a contact.
 * For example: all session logs, or all payment records.
 */
export async function getByTypeForContact(
  table: string,
  locationId: string,
  contactId: string
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('location_id', locationId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error, table, locationId, contactId }, 'Error fetching evidence by type');
    throw error;
  }

  return data || [];
}

/**
 * Gets a summary count of evidence per type for a contact.
 * Useful for the evidence viewer dashboard.
 */
export async function getSummaryForContact(
  locationId: string,
  contactId: string
): Promise<Record<string, number>> {
  const supabase = getSupabaseClient();
  const summary: Record<string, number> = {};

  for (const [key, table] of Object.entries(EVIDENCE_TABLES)) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('location_id', locationId)
      .eq('contact_id', contactId);

    if (error) {
      logger.warn({ error, table }, 'Error counting evidence');
      summary[key] = 0;
    } else {
      summary[key] = count || 0;
    }
  }

  return summary;
}
