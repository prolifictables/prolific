import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type NextFetchRequestConfig = {
  revalidate?: number | false;
  tags?: string[];
};

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
          publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
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
  if (isApiWakingResponse(res.status, ct, bodyStart)) {
    if (isBrowser) {
      beginWake();
      await waitForApiWake(API_BASE, {
        onProgress: (p) =>
          publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
        onWakeResolved: endWake,
      });
      return doFetch();
    }
    throw new Error(`Render waking page detected (${res.status}) — SSR fallback to null`);
  }
  return res;
}

export async function apiGet<T>(
  path: string,
  opts?: { next?: NextFetchRequestConfig; headers?: HeadersInit; token?: string | null }
): Promise<T> {
  const authHeaders: Record<string, string> = {};
  if (opts?.token) authHeaders['Authorization'] = `Bearer ${opts.token}`;
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { ...authHeaders, ...(opts?.headers || {}) },
      ...(opts?.next ? { next: opts.next } : {}),
    })
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit; token?: string | null }
): Promise<T> {
  const authHeaders: Record<string, string> = {};
  if (opts?.token) authHeaders['Authorization'] = `Bearer ${opts.token}`;
  const mkBody = () => JSON.stringify(body);
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(opts?.headers || {}),
      },
      body: mkBody(),
    })
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit; token?: string | null }
): Promise<T> {
  const authHeaders: Record<string, string> = {};
  if (opts?.token) authHeaders['Authorization'] = `Bearer ${opts.token}`;
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(opts?.headers || {}),
      },
      body: JSON.stringify(body),
    })
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export const API_BASE_URL = API_BASE;
export { withFallbackNull } from './api-wake';
