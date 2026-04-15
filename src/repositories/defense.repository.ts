import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';

/**
 * Mirror of the actual `defense_packets` table schema (migration 002 + 043).
 * Field names here MUST match Postgres column names exactly — the repository
 * passes objects through to Supabase without renaming.
 */
export interface DefensePacketRecord {
  id: string;
  location_id: string;
  contact_id: string;
  offer_id: string | null;
  status: string;
  triggered_by: string | null;
  triggered_at: string | null;
  completed_at: string | null;

  // Chargeback details
  chargeback_reason_code: string | null;
  reason_code_category: string | null;
  chargeback_amount: number | null;
  chargeback_date: string | null;
  response_deadline: string | null;
  case_number: string | null;
  arn: string | null;

  // Evidence (frozen at compilation time)
  evidence_snapshot: unknown;
  evidence_count: number | null;

  // AI output
  defense_letter_text: string | null;
  prompt_tokens_used: number | null;
  response_tokens_used: number | null;
  template_id: string | null;

  // PDF bundle
  pdf_storage_path: string | null;
  pdf_url: string | null;
  enrollment_packet_id: string | null;

  // Error tracking
  error_message: string | null;
  retry_count: number | null;

  created_at: string;
  updated_at: string;
}

export const defenseRepository = {
  async create(data: {
    location_id: string;
    contact_id: string;
    offer_id?: string;
    chargeback_reason_code?: string;
    reason_code_category?: string;
    chargeback_amount?: number;
    chargeback_date?: string;
    response_deadline?: string;
    case_number?: string;
  }): Promise<DefensePacketRecord> {
    const { data: packet, error } = await getSupabase()
      .from('defense_packets')
      .insert({ ...data, status: 'pending' })
      .select()
      .single();

    if (error) throw error;
    return packet;
  },

  async getById(id: string): Promise<DefensePacketRecord> {
    const { data, error } = await getSupabase()
      .from('defense_packets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundError(`Defense packet ${id}`);
    return data;
  },

  async updateStatus(id: string, status: string, updates?: Partial<DefensePacketRecord>): Promise<void> {
    const { error } = await getSupabase()
      .from('defense_packets')
      .update({ status, ...updates })
      .eq('id', id);

    if (error) throw error;
  },

  async listByContact(locationId: string, contactId: string): Promise<DefensePacketRecord[]> {
    const { data, error } = await getSupabase()
      .from('defense_packets')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async listByLocation(locationId: string): Promise<DefensePacketRecord[]> {
    const { data, error } = await getSupabase()
      .from('defense_packets')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getReasonCodeStrategy(reasonCode: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('reason_code_strategies')
      .select('*')
      .eq('reason_code', reasonCode)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getDefenseTemplate(category: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('defense_templates')
      .select('*')
      .eq('reason_code_category', category)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async recordOutcome(defensePacketId: string, outcome: 'won' | 'lost', amountSaved: number, notes?: string): Promise<void> {
    const { error } = await getSupabase()
      .from('defense_outcomes')
      .insert({
        defense_packet_id: defensePacketId,
        outcome,
        amount_saved: outcome === 'won' ? amountSaved : 0,
        notes,
      });

    if (error) throw error;
  },
};
