import { getSupabase } from '../clients/supabase.client';

export interface GhlFulfillmentCourseRow {
  id: string;
  table: string;
  created_at: string | null;
  contact_id: string | null;
  enrollment_id: string | null;
  offer_id: string | null;
  source: string | null;
  payload: Record<string, any>;
}

async function listCourseTable(
  table: string,
  locationId: string,
  limit: number,
): Promise<GhlFulfillmentCourseRow[]> {
  const { data, error } = await getSupabase()
    .from(table)
    .select('*')
    .eq('location_id', locationId)
    .eq('source', 'ghl_course')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
    if (error.code === '42P01' || message.includes('does not exist')) return [];
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    table,
    created_at: row.created_at || null,
    contact_id: row.contact_id || null,
    enrollment_id: row.enrollment_id || null,
    offer_id: row.offer_id || null,
    source: row.source || null,
    payload: row,
  }));
}

export const ghlFulfillmentRepository = {
  async listActivityEvents(locationId: string, limit = 100): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('ghl_activity_events')
      .select('id, contact_id, enrollment_id, offer_id, source_object, event_type, source_record_id, occurred_at, status, match_reason, action_taken, error_message, normalized, created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async listCourseEvidence(locationId: string, limitPerTable = 25): Promise<GhlFulfillmentCourseRow[]> {
    const rows = await Promise.all([
      listCourseTable('evidence_service_access', locationId, limitPerTable),
      listCourseTable('evidence_modules', locationId, limitPerTable),
      listCourseTable('evidence_course_completion', locationId, limitPerTable),
      listCourseTable('evidence_assignments', locationId, limitPerTable),
    ]);
    return rows.flat();
  },
};
