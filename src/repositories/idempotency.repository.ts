import { getSupabase } from '../clients/supabase.client';

export const idempotencyRepository = {
  async exists(eventId: string, source: string, locationId: string): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('idempotency_keys')
      .select('id')
      .eq('location_id', locationId)
      .eq('event_id', eventId)
      .eq('source', source)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    return Boolean(data?.id);
  },

  async record(eventId: string, source: string, locationId: string, result?: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase()
      .from('idempotency_keys')
      .insert({ event_id: eventId, source, location_id: locationId, result: result || null });

    if (error && error.code !== '23505') throw error;
  },

  /**
   * Check if an event has already been processed.
   * If not, insert and return false. If already exists, return true.
   */
  async isDuplicate(eventId: string, source: string, locationId: string): Promise<boolean> {
    const { error } = await getSupabase()
      .from('idempotency_keys')
      .insert({ event_id: eventId, source, location_id: locationId });

    if (error) {
      // Unique constraint violation = already processed
      if (error.code === '23505') return true;
      throw error;
    }
    return false;
  },

  /**
   * Purge old idempotency keys (older than given days).
   */
  async cleanup(olderThanDays: number = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase()
      .from('idempotency_keys')
      .delete()
      .lt('processed_at', cutoff)
      .select('id');

    if (error) throw error;
    return data?.length || 0;
  },
};
