import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

/**
 * resolveAdminApiBase — professional fallback chain (matches POS pattern, see
 * apps/pos/src/lib/remote-auth.ts resolveApiBase for detailed docstring).
 * Priority:
 *   0. localStorage prolific_api_base operator override (HIGHEST, manager paste-in)
 *   1. NEXT_PUBLIC_API_URL env build
 *   2. runtime hostname *.prolifictables.com → https://api.prolifictables.com/api/v1
 *   3. localhost dev http://localhost:4000/api/v1
 */
function resolveAdminApiBase(): string {
  // (0) localStorage operator override — HIGHEST priority, no deploy needed.
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const override = window.localStorage.getItem('prolific_api_base');
      if (typeof override === 'string' && override.trim().length > 3) {
        const trimmed = override.trim().replace(/\/+$/, '');
        if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
          return trimmed;
        }
        return `${trimmed}/api/v1`;
      }
    } catch {
      // ignore
    }
  }
  // (1) Explicit build env (Next.js)
  const explicit = process.env.NEXT_PUBLIC_API_URL;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  // (2) Runtime: production hostnames → REAL confirmed Render API slug.
  // NOTE: User explicitly confirmed the API is hosted at
  //       https://prolific-api.onrender.com. Use that for the production
  //       default. localStorage `prolific_api_base` still overrides this
  //       at priority 0 if the operator sets a custom domain later.
  const REAL_PRODUCTION_API_BASE = 'https://prolific-api.onrender.com/api/v1';
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return REAL_PRODUCTION_API_BASE;
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

// Tolerant unwrapper — Nest controller payloads are inconsistent across the
// codebase: auth endpoints envelope as {data:T} but tables / qr-codes /
// table-sessions / orders list actions return raw arrays / raw docs. Accept
// either shape so Admin pages never silently read "undefined" empty lists.
const smartUnwrap = <T = any>(json: any): T => {
  if (json === null || json === undefined) return json as T;
  if (Array.isArray(json)) return json as unknown as T;
  if (typeof json === 'object' && 'data' in json) return json.data as T;
  return json as T;
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
  return smartUnwrap<T>(json);
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

// Public website base used when generating scannable QR codes that point at
// the menu viewer (NOT admin). Customers scan the QR on a table's sticker,
// which resolves to a public page on the Website surface that calls the Nest
// public/qr/:token endpoint. For production *.prolifictables.com hosts the
// Website is www.prolifictables.com.
export function resolveWebsiteBase(): string {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const override = window.localStorage.getItem('prolific_website_base');
      if (typeof override === 'string' && override.trim().length > 3) {
        return override.trim().replace(/\/+$/, '');
      }
    } catch { /* storage access denied */ }
  }
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return 'https://www.prolifictables.com';
  }
  const explicit = process.env.NEXT_PUBLIC_WEBSITE_URL;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

export const WEBSITE_BASE_URL = resolveWebsiteBase();

// Utility used by every Admin list page so both raw arrays returned directly
// by Nest list actions and wrapped { data: […] } payloads (auth controller
// inconsistencies currently exist) are handled without fragile brittle code.
export function unwrapList<T = any>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.data)) return p.data as T[];
  }
  return [];
}

export const sidEq = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
export const sid = (x: unknown) => String(x ?? '');

export { withFallbackNull } from './api-wake';
