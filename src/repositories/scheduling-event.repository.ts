import { getSupabase } from '../clients/supabase.client';

export const schedulingEventRepository = {
  async upsert(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('evidence_scheduling_events')
      .upsert(input, { onConflict: 'location_id,source_provider,source_event_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async findMeetingCandidates(
    locationId: string,
    meetingProvider: string,
    meetingId: string,
    occurredAt: string,
  ): Promise<any[]> {
    const occurred = new Date(occurredAt).getTime();
    if (!Number.isFinite(occurred)) return [];
    const windowMs = 12 * 60 * 60_000;
    const { data, error } = await getSupabase()
      .from('evidence_scheduling_events')
      .select('*')
      .eq('location_id', locationId)
      .eq('meeting_provider', meetingProvider)
      .eq('meeting_id', meetingId)
      .gte('starts_at', new Date(occurred - windowMs).toISOString())
      .lte('starts_at', new Date(occurred + windowMs).toISOString())
      .not('status', 'in', '(cancelled,deleted)')
      .order('starts_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return data || [];
  },
};
