import { getSupabase } from '../clients/supabase.client';

export const zoomIntegrationRepository = {
  async createOAuthState(input: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase().from('evidence_oauth_states').insert(input);
    if (error) throw error;
  },

  async claimOAuthState(stateHash: string): Promise<any> {
    const { data, error } = await getSupabase().rpc('claim_evidence_oauth_state', {
      p_state_hash: stateHash,
      p_provider_key: 'zoom',
    });
    if (error) throw error;
    return data;
  },

  async getAuthorization(connectionId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_authorizations')
      .select('*')
      .eq('connection_id', connectionId)
      .eq('provider_key', 'zoom')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getAuthorizationByAccount(accountId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_authorizations')
      .select('*, connection:evidence_connections(*)')
      .eq('provider_key', 'zoom')
      .eq('external_account_id', accountId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async saveAuthorization(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_authorizations')
      .upsert(input, { onConflict: 'connection_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async updateAuthorization(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase().from('evidence_provider_authorizations').update(updates).eq('id', id);
    if (error) throw error;
  },

  async listOffers(locationId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('offers_mirror')
      .select('id, offer_name, active')
      .eq('location_id', locationId)
      .eq('active', true)
      .order('offer_name');
    if (error) throw error;
    return data || [];
  },

  async findOpenAttendance(connectionId: string, meetingUuid: string, participantInstanceId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_zoom_attendance_sessions')
      .select('*')
      .eq('connection_id', connectionId)
      .eq('meeting_uuid', meetingUuid)
      .eq('participant_instance_id', participantInstanceId)
      .eq('status', 'joined')
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async createAttendance(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('evidence_zoom_attendance_sessions')
      .upsert(input, { onConflict: 'connection_id,join_source_event_id', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async completeAttendance(id: string, updates: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('evidence_zoom_attendance_sessions')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async linkEvidenceEvent(id: string, evidenceEventId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('evidence_zoom_attendance_sessions')
      .update({ evidence_event_id: evidenceEventId, status: 'published' })
      .eq('id', id);
    if (error) throw error;
  },
};
