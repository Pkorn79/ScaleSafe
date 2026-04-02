import { getSupabase } from '../clients/supabase.client';

export interface EvidenceRecord {
  id: string;
  location_id: string;
  contact_id: string;
  enrollment_id: string | null;
  merchant_id: string | null;
  evidence_type: string;
  data: Record<string, unknown>;
  ip_address: string | null;
  device_info: string | null;
  browser_info: string | null;
  created_at: string;
}

export interface EvidenceInsertData {
  location_id: string;
  contact_id: string;
  enrollment_id?: string;
  merchant_id?: string;
  evidence_type: string;
  data: Record<string, unknown>;
  ip_address?: string;
  device_info?: string;
  browser_info?: string;
}

export const phase2EvidenceRepository = {
  async create(record: EvidenceInsertData): Promise<EvidenceRecord> {
    const { data, error } = await getSupabase()
      .from('evidence')
      .insert(record)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findByEnrollment(enrollmentId: string): Promise<EvidenceRecord[]> {
    const { data, error } = await getSupabase()
      .from('evidence')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async findByType(enrollmentId: string, evidenceType: string): Promise<EvidenceRecord[]> {
    const { data, error } = await getSupabase()
      .from('evidence')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .eq('evidence_type', evidenceType)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async countByEnrollment(enrollmentId: string): Promise<number> {
    const { count, error } = await getSupabase()
      .from('evidence')
      .select('*', { count: 'exact', head: true })
      .eq('enrollment_id', enrollmentId);

    if (error) throw error;
    return count || 0;
  },
};
