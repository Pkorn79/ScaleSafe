import { getSupabase } from '../clients/supabase.client';

export interface GhlActivityEventInsert {
  location_id: string;
  contact_id?: string | null;
  contact_email?: string | null;
  source_contact_id?: string | null;
  enrollment_id?: string | null;
  offer_id?: string | null;
  linked_enrollment_ids?: string[];
  linked_offer_ids?: string[];
  match_confidence?: string | null;
  source_object: string;
  event_type: string;
  source_record_id?: string | null;
  source_parent_id?: string | null;
  occurred_at?: string | null;
  status?: string;
  match_reason?: string | null;
  action_taken?: string | null;
  error_message?: string | null;
  normalized?: Record<string, unknown>;
  raw_payload?: Record<string, unknown>;
}

function missingColumnMessage(err: any, column: string): boolean {
  const text = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return text.includes(`'${column}'`) || text.includes(`"${column}"`) || text.includes(`${column} column`);
}

function stripEventCompatibilityColumns(event: Record<string, unknown>, err: any): Record<string, unknown> {
  const next = { ...event };
  for (const col of ['contact_email', 'source_contact_id', 'match_confidence', 'linked_enrollment_ids', 'linked_offer_ids']) {
    if (missingColumnMessage(err, col)) delete next[col];
  }
  return next;
}

export const ghlActivityRepository = {
  async createEventIfNew(event: GhlActivityEventInsert): Promise<{ row: any; inserted: boolean }> {
    const supabase = getSupabase();

    if (event.source_record_id) {
      const { data: existing, error: lookupError } = await supabase
        .from('ghl_activity_events')
        .select('*')
        .eq('location_id', event.location_id)
        .eq('source_object', event.source_object)
        .eq('source_record_id', event.source_record_id)
        .eq('event_type', event.event_type)
        .maybeSingle();

      if (lookupError && lookupError.code !== 'PGRST116') throw lookupError;
      if (existing) return { row: existing, inserted: false };
    }

    const insertPayload: Record<string, unknown> = {
      status: 'unmatched',
      normalized: {},
      raw_payload: {},
      ...event,
    };

    let { data, error } = await supabase
      .from('ghl_activity_events')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      const compatiblePayload = stripEventCompatibilityColumns(insertPayload, error);
      if (Object.keys(compatiblePayload).length !== Object.keys(insertPayload).length) {
        const retry = await supabase
          .from('ghl_activity_events')
          .insert(compatiblePayload)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }
    }

    if (error) {
      if (event.source_record_id && error.code === '23505') {
        const { data: existing } = await supabase
          .from('ghl_activity_events')
          .select('*')
          .eq('location_id', event.location_id)
          .eq('source_object', event.source_object)
          .eq('source_record_id', event.source_record_id)
          .eq('event_type', event.event_type)
          .maybeSingle();
        if (existing) return { row: existing, inserted: false };
      }
      throw error;
    }

    return { row: data, inserted: true };
  },

  async listRecent(locationId: string, contactId: string, limit = 25): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('ghl_activity_events')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async listUnmatched(locationId: string, limit = 50): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('ghl_activity_events')
      .select('*')
      .eq('location_id', locationId)
      .in('status', ['unmatched', 'client_level'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async linkActivityToEnrollment(params: {
    locationId: string;
    activityEventId: string;
    enrollmentId: string;
    offerId?: string | null;
    reason?: string | null;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('ghl_activity_enrollment_links')
      .upsert({
        location_id: params.locationId,
        activity_event_id: params.activityEventId,
        enrollment_id: params.enrollmentId,
        offer_id: params.offerId || null,
        link_reason: params.reason || null,
        linked_by: 'system',
      });

    if (error) {
      const text = `${error.message || ''} ${error.details || ''}`.toLowerCase();
      if (text.includes('ghl_activity_enrollment_links') || error.code === '42P01') return;
      throw error;
    }
  },
};
