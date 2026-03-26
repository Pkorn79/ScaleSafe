import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';

export interface DefensePacketRecord {
  id: string;
  location_id: string;
  contact_id: string;
  offer_id: string | null;
  status: string;
  reason_code: string | null;
  reason_category: string | null;
  dispute_amount: number | null;
  dispute_date: string | null;
  deadline: string | null;
  case_number: string | null;
  evidence_snapshot: unknown;
  defense_letter_text: string | null;
  defense_letter_url: string | null;
  evidence_pdf_url: string | null;
  enrollment_packet_url: string | null;
  bundled_pdf_url: string | null;
  template_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export const defenseRepository = {
  async create(data: {
    location_id: string;
    contact_id: string;
    offer_id?: string;
    reason_code?: string;
    reason_category?: string;
    dispute_amount?: number;
    dispute_date?: string;
    deadline?: string;
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
