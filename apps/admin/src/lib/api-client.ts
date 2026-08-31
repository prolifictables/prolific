import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

/**
 * resolveAdminApiBase — professional fallback chain (matches POS pattern, see
 * apps/pos/src/lib/remote-auth.ts resolveApiBase for docstring).
 * Priority: NEXT_PUBLIC_API_URL env build > runtime hostname *.prolifictables.com
 * → canonical https://api.prolifictables.com/api/v1 > localhost dev.
 */
function resolveAdminApiBase(): string {
  // (1) Highest: explicit build env (Next.js)
  const explicit = process.env.NEXT_PUBLIC_API_URL;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  // (2) Runtime: production hostnames → canonical API
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return 'https://api.prolifictables.com/api/v1';
  }

  // (3) Local dev fallback
  return 'http://localhost:4000/api/v1';
}

const API_BASE = resolveAdminApiBase();

const getToken = (): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (typeof window !== 'undefined') {
    return window.localStorage.getItem('access_token');
  }
  return null;
};

const handleUnauthorized = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('access_token');
    window.localStorage.removeItem('refresh_token');
    window.localStorage.removeItem('auth_user');
    window.localStorage.removeItem('auth_employee');
    window.localStorage.removeItem('auth_restaurant');
    window.localStorage.removeItem('auth_branch');
    if (typeof document !== 'undefined') {
      document.cookie = 'access_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    }
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
};

const unwrap = async <T>(res: Response): Promise<T> => {
  let json: any;
  try {
    json = await res.json();
  } catch {
    json = { error: { message: 'Invalid response' } };
  }
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data as T;
};

const authHeaders = (): HeadersInit => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

// Admin: browser-only app. SSR minimal; still guard SSR path with
// typeof window check (throws once on SSR so caller can withFallbackNull).
async function guardedFetch(doFetch: () => Promise<Response>): Promise<Response> {
  const isBrowser = typeof window !== 'undefined';
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    if (isBrowser) {
      beginWake();
      await waitForApiWake(API_BASE, {
        onProgress: (p) =>
          publishApiWake({
            attempt: p.attempt,
            elapsedMs: p.elapsedMs,
            etaMs: p.etaMs,
          }),
        onWakeResolved: endWake,
      });
      return doFetch();
    }
    throw err;
  }
  const ct = res.headers.get('content-type');
  let bodyStart = '';
  try {
    if (res.status >= 500 || !!ct?.toLowerCase().includes('text/html')) {
      const cloned = res.clone();
      bodyStart = (await cloned.text()).slice(0, 300);
    }
  } catch {
    // ignore
  }
  const waking = isApiWakingResponse(res.status, ct, bodyStart);
  if (waking) {
    if (isBrowser) {
      beginWake();
      await waitForApiWake(API_BASE, {
        onProgress: (p) =>
          publishApiWake({
            attempt: p.attempt,
            elapsedMs: p.elapsedMs,
            etaMs: p.etaMs,
          }),
        onWakeResolved: endWake,
      });
      return doFetch();
    }
    throw new Error(`Render waking page detected (${res.status}) — SSR fallback to null`);
  }
  return res;
}

export async function apiGet<T>(path: string, opts?: { headers?: HeadersInit }): Promise<T> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...authHeaders(),
        ...(opts?.headers || {}),
      },
    })
  );
  return unwrap<T>(res);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit; skipAuth?: boolean }
): Promise<T> {
  const headers = opts?.skipAuth
    ? { 'Content-Type': 'application/json', ...(opts?.headers || {}) }
    : { ...authHeaders(), ...(opts?.headers || {}) };
  const mkBody = () => JSON.stringify(body);
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: mkBody(),
    })
  );
  return unwrap<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit }
): Promise<T> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: {
        ...authHeaders(),
        ...(opts?.headers || {}),
      },
      body: JSON.stringify(body),
    })
  );
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string, opts?: { headers?: HeadersInit }): Promise<T> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: {
        ...authHeaders(),
        ...(opts?.headers || {}),
      },
    })
  );
  return unwrap<T>(res);
}

export const API_BASE_URL = API_BASE;
export { withFallbackNull } from './api-wake';
