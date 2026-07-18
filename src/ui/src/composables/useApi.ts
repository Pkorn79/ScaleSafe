import { ref, reactive } from 'vue';
import { toast } from './useToast';

export interface MarketplaceEntitlement {
  planId: string | null;
  planKey: 'legacy' | 'standard' | 'wholepay' | 'unknown';
  planLabel: string;
  billingStatus: 'unknown' | 'pending' | 'complete' | 'failed';
  accessAllowed: boolean;
  accessState: 'active' | 'needs_wholepay_approval' | 'payment_failed' | 'unknown_plan';
  message: string;
  wholepayApproved: boolean;
  wholepayApprovedAt: string | null;
  processors: { stripe: boolean; nmi: boolean; whop: boolean };
}

interface SsoSession {
  locationId: string;
  companyId: string;
  userId: string;
  email: string;
  role: string;
  userName: string;
  ready: boolean;
  error: string | null;
  errorCode: SsoErrorCode | null;
  /** True when GHL launched ScaleSafe from agency context (no sub-account).
   *  The app fails closed — there is deliberately NO sub-account chooser. */
  agencyContext: boolean;
  entitlement: MarketplaceEntitlement;
}

export type SsoErrorCode =
  | 'not_embedded'
  | 'parent_context_timeout'
  | 'empty_parent_payload'
  | 'agency_context'
  | 'installation_pending'
  | 'installation_missing'
  | 'installation_invalid'
  | 'authentication_invalid'
  | 'service_unavailable'
  | 'backend_timeout'
  | 'unknown';

class SsoHandshakeError extends Error {
  constructor(public code: SsoErrorCode, message: string) {
    super(message);
    this.name = 'SsoHandshakeError';
  }
}

const ssoSession = reactive<SsoSession>({
  locationId: '',
  companyId: '',
  userId: '',
  email: '',
  role: '',
  userName: '',
  ready: false,
  error: null,
  errorCode: null,
  agencyContext: false,
  entitlement: {
    planId: null,
    planKey: 'legacy',
    planLabel: 'Legacy installation',
    billingStatus: 'unknown',
    accessAllowed: true,
    accessState: 'active',
    message: '',
    wholepayApproved: false,
    wholepayApprovedAt: null,
    processors: { stripe: true, nmi: true, whop: true },
  },
});

let ssoInitPromise: Promise<void> | null = null;
let ssoAttempt = 0;
const INSTALL_SETTLE_RETRY_MS = 3_000;
const INSTALL_SETTLE_TIMEOUT_MS = 2 * 60 * 1000;

const DEFAULT_GHL_PARENT_ORIGINS = [
  'https://app.gohighlevel.com',
  'https://app.leadconnectorhq.com',
];

function parseOrigins(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getReferrerOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '';
  } catch {
    return '';
  }
}

function allowedParentOrigins(): string[] {
  return Array.from(new Set([
    getReferrerOrigin(),
    ...parseOrigins(import.meta.env.VITE_GHL_PARENT_ORIGINS),
    ...DEFAULT_GHL_PARENT_ORIGINS,
  ].filter(Boolean)));
}

function isAllowedParentOrigin(origin: string): boolean {
  return allowedParentOrigins().includes(origin);
}

function applySsoData(data: any): void {
  ssoSession.locationId = data.locationId;
  ssoSession.companyId = data.companyId;
  ssoSession.userId = data.userId;
  ssoSession.email = data.email;
  ssoSession.role = data.role;
  ssoSession.userName = data.userName;
  if (data.entitlement) ssoSession.entitlement = data.entitlement;
  ssoSession.error = null;
  ssoSession.errorCode = null;
  ssoSession.agencyContext = false;
  ssoSession.ready = true;

  sessionStorage.setItem('ss_location_id', data.locationId);
  sessionStorage.setItem('ss_company_id', data.companyId || '');
  sessionStorage.setItem('ss_user_id', data.userId || '');
}

function setSsoError(code: SsoErrorCode, message: string): void {
  ssoSession.errorCode = code;
  ssoSession.error = message;
  ssoSession.ready = true;
}

function backendErrorCode(status: number, code: string): SsoErrorCode {
  if (code === 'INSTALLATION_PENDING') return 'installation_pending';
  if (code === 'INSTALLATION_NOT_FOUND') return 'installation_missing';
  if (code === 'INSTALLATION_INVALID') return 'installation_invalid';
  if (code === 'INVALID_SSO_PAYLOAD') return 'authentication_invalid';
  if (code === 'SERVICE_UNAVAILABLE' || status >= 500) return 'service_unavailable';
  return 'unknown';
}

async function completeSsoHandshakeOnce(encryptedPayload: string, attempt: number): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch('/auth/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: encryptedPayload }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new SsoHandshakeError('backend_timeout', 'ScaleSafe account services did not respond in time.');
    }
    throw new SsoHandshakeError('service_unavailable', 'ScaleSafe account services are temporarily unavailable.');
  } finally {
    window.clearTimeout(timeout);
  }

  const body = await res.json().catch(() => ({}));
  if (attempt !== ssoAttempt) return;

  // Agency-context launch: fail closed. A merchant session is bound to one
  // sub-account — no chooser, by design.
  if (res.status === 403 && body.error === 'AGENCY_CONTEXT') {
    ssoSession.agencyContext = true;
    ssoSession.error = body.message || 'Open ScaleSafe from the sub-account you want to manage.';
    ssoSession.errorCode = 'agency_context';
    ssoSession.ready = true;
    return;
  }

  if (!res.ok) {
    throw new SsoHandshakeError(
      backendErrorCode(res.status, body.error),
      body.message || `SSO validation failed (${res.status})`,
    );
  }

  applySsoData(body);
}

async function completeSsoHandshake(encryptedPayload: string, attempt: number): Promise<void> {
  const installSettleDeadline = Date.now() + INSTALL_SETTLE_TIMEOUT_MS;

  while (attempt === ssoAttempt) {
    try {
      await completeSsoHandshakeOnce(encryptedPayload, attempt);
      return;
    } catch (err: any) {
      const pending = err instanceof SsoHandshakeError && err.code === 'installation_pending';
      if (!pending || Date.now() >= installSettleDeadline) throw err;

      ssoSession.errorCode = 'installation_pending';
      ssoSession.error = err.message;
      ssoSession.ready = false;
      await new Promise((resolve) => window.setTimeout(resolve, INSTALL_SETTLE_RETRY_MS));
    }
  }
}

/**
 * Initialize SSO by requesting user data from the GHL parent frame via postMessage.
 * GHL responds with an encrypted payload, which we send to our backend for decryption.
 */
function initSso(): Promise<void> {
  if (ssoInitPromise) return ssoInitPromise;

  ssoInitPromise = new Promise<void>((resolve) => {
    const attempt = ++ssoAttempt;
    // If not in an iframe (dev mode), check for location_id in URL
    if (window.self === window.top) {
      const params = new URLSearchParams(window.location.search);
      const devLocationId = params.get('location_id') || params.get('locationId') || '';
      if (devLocationId) {
        ssoSession.locationId = devLocationId;
        ssoSession.ready = true;
        resolve();
        return;
      }
      setSsoError('not_embedded', 'ScaleSafe was not opened inside GoHighLevel.');
      resolve();
      return;
    }

    // Listen for GHL's response
    let parentTimeout: number | null = null;
    const handler = async (event: MessageEvent) => {
      if (attempt !== ssoAttempt) return;
      if (event.source !== window.parent || !isAllowedParentOrigin(event.origin)) return;
      if (event.data?.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      window.removeEventListener('message', handler);
      if (parentTimeout !== null) window.clearTimeout(parentTimeout);

      const encryptedPayload = event.data.payload;
      if (!encryptedPayload) {
        setSsoError('empty_parent_payload', 'GoHighLevel returned empty account context.');
        resolve();
        return;
      }

      // Store the encrypted payload for API calls
      sessionStorage.setItem('ss_sso_payload', encryptedPayload);

      // Decrypt via our backend
      try {
        await completeSsoHandshake(encryptedPayload, attempt);
      } catch (err: any) {
        if (attempt !== ssoAttempt) return;
        setSsoError(err instanceof SsoHandshakeError ? err.code : 'unknown', err.message || 'Unable to connect');
      }

      resolve();
    };

    window.addEventListener('message', handler);

    // Installed Custom Pages can take several seconds to initialize the parent bridge.
    parentTimeout = window.setTimeout(() => {
      if (attempt !== ssoAttempt) return;
      window.removeEventListener('message', handler);
      if (!ssoSession.ready) {
        setSsoError('parent_context_timeout', 'GoHighLevel did not provide secure sub-account context.');
        resolve();
      }
    }, 10_000);

    // HighLevel documents a wildcard target for this context request because
    // installed and white-label parent origins vary. The request has no tenant
    // data; the response remains source/origin checked and backend-decrypted.
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });

  return ssoInitPromise;
}

function retrySso(): Promise<void> {
  sessionStorage.removeItem('ss_sso_payload');
  sessionStorage.removeItem('ss_location_id');
  ssoSession.locationId = '';
  ssoSession.error = null;
  ssoSession.errorCode = null;
  ssoSession.agencyContext = false;
  ssoSession.ready = false;
  ssoInitPromise = null;
  return initSso();
}

// Start SSO immediately on module load
initSso();

/**
 * Build headers for authenticated API calls.
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Prefer the encrypted payload (re-validated server-side each request)
  const payload = sessionStorage.getItem('ss_sso_payload');
  if (payload) {
    headers['x-sso-payload'] = payload;
  }
  const locationId = sessionStorage.getItem('ss_location_id');
  if (locationId) {
    headers['x-location-id'] = locationId;
  }

  return headers;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Wait for SSO to complete before making any API call
  await initSso();

  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `API error ${res.status}`);
  }

  return res.json();
}

export function useApi() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function get<T>(path: string): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      return await apiFetch<T>(path);
    } catch (e: any) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      return await apiFetch<T>(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      error.value = e.message;
      toast.error(e.message);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function put<T>(path: string, body?: unknown): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      return await apiFetch<T>(path, {
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      error.value = e.message;
      toast.error(e.message);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function patch<T>(path: string, body?: unknown): Promise<T> {
    loading.value = true;
    error.value = null;
    try {
      return await apiFetch<T>(path, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e: any) {
      error.value = e.message;
      toast.error(e.message);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function del(path: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await apiFetch(path, { method: 'DELETE' });
    } catch (e: any) {
      error.value = e.message;
      toast.error(e.message);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, get, post, put, patch, del, ssoSession };
}

export { ssoSession, initSso, retrySso };
