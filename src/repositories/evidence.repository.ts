import { getSupabase } from '../clients/supabase.client';
import { EVIDENCE_TABLE_MAP, EvidenceType } from '../constants/evidence-types';

export interface EvidenceInsert {
  location_id: string;
  contact_id: string;
  source: string;
  [key: string]: unknown;
}

export const evidenceRepository = {
  /**
   * Insert a record into the appropriate evidence table.
   */
  async insert(evidenceType: EvidenceType, record: EvidenceInsert): Promise<void> {
    const table = EVIDENCE_TABLE_MAP[evidenceType];
    if (!table) throw new Error(`Unknown evidence type: ${evidenceType}`);

    const { error } = await getSupabase().from(table).insert(record);
    if (error) throw error;
  },

  /**
   * Get the unified evidence timeline for a contact.
   * Uses the evidence_timeline view which UNIONs all evidence tables.
   */
  async getTimeline(locationId: string, contactId: string, limit: number = 100): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_timeline')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('event_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  /**
   * Get evidence counts per type for a contact (for readiness scoring).
   */
  async getCounts(locationId: string, contactId: string): Promise<Record<string, number>> {
    const { data, error } = await getSupabase()
      .from('evidence_timeline')
      .select('evidence_type')
      .eq('location_id', locationId)
      .eq('contact_id', contactId);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      counts[row.evidence_type] = (counts[row.evidence_type] || 0) + 1;
    }
    return counts;
  },

  /**
   * Get all evidence for a contact as a snapshot (used for defense compilation).
   */
  async getFullSnapshot(locationId: string, contactId: string): Promise<any[]> {
    return this.getTimeline(locationId, contactId, 10000);
  },

  /**
   * Get the most recent evidence date for a contact.
   */
  async getLastEvidenceDate(locationId: string, contactId: string): Promise<string | null> {
    const { data, error } = await getSupabase()
      .from('evidence_timeline')
      .select('event_date')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('event_date', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.event_date || null;
  },
};
