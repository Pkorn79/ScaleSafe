/**
 * supabase.client.ts — Supabase Database Client
 *
 * Creates and exports a singleton Supabase client using the service role key.
 * The service role key bypasses Row Level Security — this is intentional because
 * the app enforces tenant isolation in the repository layer (every query includes location_id).
 *
 * All database operations go through this client via the repository layer.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let client: SupabaseClient | null = null;

/** Returns the singleton Supabase client, creating it on first call. */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return client;
}
