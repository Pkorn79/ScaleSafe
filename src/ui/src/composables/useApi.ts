import { ref, reactive } from 'vue';

interface SsoSession {
  locationId: string;
  companyId: string;
  userId: string;
  email: string;
  role: string;
  userName: string;
  ready: boolean;
  error: string | null;
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
});

let ssoInitPromise: Promise<void> | null = null;

/**
 * Initialize SSO by requesting user data from the GHL parent frame via postMessage.
 * GHL responds with an encrypted payload, which we send to our backend for decryption.
 */
function initSso(): Promise<void> {
  if (ssoInitPromise) return ssoInitPromise;

  ssoInitPromise = new Promise<void>((resolve) => {
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
      ssoSession.error = 'Not running inside GHL iframe';
      ssoSession.ready = true;
      resolve();
      return;
    }

    // Listen for GHL's response
    const handler = async (event: MessageEvent) => {
      if (event.data?.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      window.removeEventListener('message', handler);

      const encryptedPayload = event.data.payload;
      if (!encryptedPayload) {
        ssoSession.error = 'GHL returned empty SSO payload';
        ssoSession.ready = true;
        resolve();
        return;
      }

      // Store the encrypted payload for API calls
      sessionStorage.setItem('ss_sso_payload', encryptedPayload);

      // Decrypt via our backend
      try {
        const res = await fetch('/auth/sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: encryptedPayload }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `SSO validation failed (${res.status})`);
        }

        const data = await res.json();
        ssoSession.locationId = data.locationId;
        ssoSession.companyId = data.companyId;
        ssoSession.userId = data.userId;
        ssoSession.email = data.email;
        ssoSession.role = data.role;
        ssoSession.userName = data.userName;
        ssoSession.ready = true;

        // Cache locationId for API headers
        sessionStorage.setItem('ss_location_id', data.locationId);
        sessionStorage.setItem('ss_company_id', data.companyId || '');
        sessionStorage.setItem('ss_user_id', data.userId || '');
      } catch (err: any) {
        ssoSession.error = err.message;
        ssoSession.ready = true;
      }

      resolve();
    };

    window.addEventListener('message', handler);

    // Timeout after 5 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      if (!ssoSession.ready) {
        ssoSession.error = 'SSO handshake timed out — GHL did not respond';
        ssoSession.ready = true;
        resolve();
      }
    }, 5000);

    // Request user data from GHL parent
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });

  return ssoInitPromise;
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
  } else {
    // Fallback: send cached locationId
    const locationId = ssoSession.locationId || sessionStorage.getItem('ss_location_id') || '';
    if (locationId) {
      headers['x-location-id'] = locationId;
      const companyId = sessionStorage.getItem('ss_company_id');
      const userId = sessionStorage.getItem('ss_user_id');
      if (companyId) headers['x-company-id'] = companyId;
      if (userId) headers['x-user-id'] = userId;
    }
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
    throw new Error(body.message || `API error ${res.status}`);
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
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, get, post, put, del, ssoSession };
}

export { ssoSession, initSso };
