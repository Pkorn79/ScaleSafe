import { getSupabase } from '../clients/supabase.client';

export interface GhlActivityEventInsert {
  location_id: string;
  contact_id?: string | null;
  enrollment_id?: string | null;
  offer_id?: string | null;
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

export interface AppointmentMapping {
  id: string;
  location_id: string;
  calendar_id: string;
  offer_id: string | null;
  staff_user_id: string | null;
  title_keyword: string | null;
  appointment_type: string | null;
  delivery_role: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

    const { data, error } = await supabase
      .from('ghl_activity_events')
      .insert({
        status: 'unmatched',
        normalized: {},
        raw_payload: {},
        ...event,
      })
      .select()
      .single();

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
      .eq('status', 'unmatched')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async listAppointmentMappings(locationId: string): Promise<AppointmentMapping[]> {
    const { data, error } = await getSupabase()
      .from('ghl_appointment_mappings')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async upsertAppointmentMapping(locationId: string, mapping: Partial<AppointmentMapping>): Promise<AppointmentMapping> {
    const payload = {
      id: mapping.id || undefined,
      location_id: locationId,
      calendar_id: mapping.calendar_id,
      offer_id: mapping.offer_id || null,
      staff_user_id: mapping.staff_user_id || null,
      title_keyword: mapping.title_keyword || null,
      appointment_type: mapping.appointment_type || null,
      delivery_role: mapping.delivery_role || null,
      is_active: mapping.is_active ?? true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await getSupabase()
      .from('ghl_appointment_mappings')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deactivateAppointmentMapping(locationId: string, id: string): Promise<void> {
    const { error } = await getSupabase()
      .from('ghl_appointment_mappings')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('location_id', locationId)
      .eq('id', id);

    if (error) throw error;
  },
};
