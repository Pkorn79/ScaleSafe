import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let client: SupabaseClient | null = null;

export interface SupabaseRequestObservation {
  timedOut: boolean;
}

let requestObserver: ((event: SupabaseRequestObservation) => void) | null = null;

export function setSupabaseRequestObserver(
  observer: ((event: SupabaseRequestObservation) => void) | null,
): void {
  requestObserver = observer;
}

function observeSupabaseRequest(event: SupabaseRequestObservation): void {
  try {
    requestObserver?.(event);
  } catch {
    // Monitoring must never affect a database request.
  }
}

export function createFetchWithTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    let timedOut = false;

    const abortFromUpstream = () => controller.abort();
    if (upstreamSignal?.aborted) abortFromUpstream();
    else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timeout.unref();

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`Supabase request exceeded ${timeoutMs}ms`);
        timeoutError.name = 'SupabaseRequestTimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
      observeSupabaseRequest({ timedOut });
    }
  }) as typeof fetch;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
      global: {
        fetch: createFetchWithTimeout(fetch, config.supabase.requestTimeoutMs),
      },
    });
  }
  return client;
}
