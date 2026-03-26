/**
 * defense.repository.ts — Defense Packet Data Access
 *
 * CRUD operations for the defense_packets table in Supabase.
 * Each row tracks one chargeback defense compilation:
 * status (pending → processing → complete/failed), the frozen evidence
 * snapshot, Claude's output, PDF location, and token usage for cost tracking.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

export interface DefensePacketRow {
  id: string;
  location_id: string;
  contact_id: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  chargeback_reason_code: string | null;
  chargeback_amount: number | null;
  chargeback_date: string | null;
  evidence_snapshot: Record<string, unknown> | null;
  evidence_count: number | null;
  defense_letter_text: string | null;
  prompt_tokens_used: number | null;
  response_tokens_used: number | null;
  pdf_storage_path: string | null;
  pdf_url: string | null;
  triggered_by: string | null;
  triggered_at: string;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
}

/** Creates a new defense packet in "pending" status. */
export async function create(
  locationId: string,
  contactId: string,
  chargebackData: {
    reasonCode?: string;
    amount?: number;
    date?: string;
    triggeredBy?: string;
  }
): Promise<DefensePacketRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('defense_packets')
    .insert({
      location_id: locationId,
      contact_id: contactId,
      status: 'pending',
      chargeback_reason_code: chargebackData.reasonCode || null,
      chargeback_amount: chargebackData.amount || null,
      chargeback_date: chargebackData.date || null,
      triggered_by: chargebackData.triggeredBy || 'manual',
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, locationId, contactId }, 'Error creating defense packet');
    throw error;
  }

  return data;
}

/** Updates the status and data of a defense packet. */
export async function update(
  defenseId: string,
  updates: Partial<DefensePacketRow>
): Promise<DefensePacketRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('defense_packets')
    .update(updates)
    .eq('id', defenseId)
    .select()
    .single();

  if (error) {
    logger.error({ error, defenseId }, 'Error updating defense packet');
    throw error;
  }

  return data;
}

/** Gets a defense packet by ID. */
export async function findById(defenseId: string): Promise<DefensePacketRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('defense_packets')
    .select('*')
    .eq('id', defenseId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error({ error, defenseId }, 'Error fetching defense packet');
    throw error;
  }

  return data;
}

/** Lists all defense packets for a contact. */
export async function findByContact(
  locationId: string,
  contactId: string
): Promise<DefensePacketRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('defense_packets')
    .select('*')
    .eq('location_id', locationId)
    .eq('contact_id', contactId)
    .order('triggered_at', { ascending: false });

  if (error) {
    logger.error({ error, locationId, contactId }, 'Error listing defense packets');
    throw error;
  }

  return data || [];
}
