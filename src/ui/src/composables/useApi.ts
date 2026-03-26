import { ref } from 'vue';

/**
 * Get the SSO key from the URL query string.
 * GHL passes this when loading the app in an iframe.
 */
function getSsoKey(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('ssoKey') || '';
}

const ssoKey = getSsoKey();

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${path}${separator}ssoKey=${encodeURIComponent(ssoKey)}`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-sso-key': ssoKey,
      ...options.headers,
    },
    ...options,
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

  return { loading, error, get, post, put, del };
}
