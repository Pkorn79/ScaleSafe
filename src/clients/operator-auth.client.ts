import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { createFetchWithTimeout } from './supabase.client';

/**
 * Supabase Auth clients carry request-local session state during MFA. Never
 * reuse one across operator requests or expose its session to the browser.
 */
export function createOperatorAuthClient(): SupabaseClient {
  if (!config.operator.authEnabled || !config.operator.supabaseAuthKey) {
    throw new Error('ScaleSafe operator authentication is not enabled');
  }
  return createClient(config.supabase.url, config.operator.supabaseAuthKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: createFetchWithTimeout(fetch, config.supabase.requestTimeoutMs),
    },
  });
}
