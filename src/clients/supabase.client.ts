import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
