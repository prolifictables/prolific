import {
  isApiWakingResponse,
  waitForApiWake,
  ApiWakeOpts,
} from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

/**
 * resolveWebsiteApiBase — same fallback chain as Admin/POS.
 * Priority:
 *   0. localStorage prolific_api_base operator override
 *   1. NEXT_PUBLIC_API_URL env build
 *   2. runtime hostname *.prolifictables.com → https://api.prolifictables.com/api/v1
 *   3. localhost dev
 */
function resolveWebsiteApiBase(): string {
  // (0) localStorage operator override — HIGHEST priority.
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
  const explicit = process.env.NEXT_PUBLIC_API_URL;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  // Production: user confirmed API at https://prolific-api.onrender.com.
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
  return 'http://localhost:4000/api/v1';
}

const API_BASE = resolveWebsiteApiBase();

type NextFetchRequestConfig = {
  revalidate?: number | false;
  tags?: string[];
};

// Shared Render cold-start resilience pattern.
// 1. Run the fetch call normally.
// 2. If response STATUS (502/503/504 or content-type html body with Application Loading)
//    → Detect "Render waking page" detected → call beginWake → start waitForApiWake
//       (poll /health up to 120 s with Fib backoff) → one more doFetch() and return that.
// 3. Browser-only (typeof window !== undefined) we publish progress via global bus
//    → ApiWakeOverlay shows polite spinner. On SSR (no window), we don't block forever
//    — instead throw after a single attempt so caller can withFallbackNull skip.
async function guardedFetch(
  doFetch: () => Promise<Response>,
  callerOpts?: { isBrowser?: boolean }
): Promise<Response> {
  const isBrowser = callerOpts?.isBrowser ?? (typeof window !== 'undefined');
  let res: Response;
  let wokeFired = false;
  try {
    res = await doFetch();
  } catch (err) {
    // Network-level failure → treat as wake state ONLY on browser
    if (isBrowser) {
      if (!wokeFired) {
        wokeFired = true;
        beginWake();
      }
      await waitForApiWake(API_BASE, {
        onProgress: (p) => {
          if (!wokeFired) {
            wokeFired = true;
            beginWake();
          }
          publishApiWake({
            attempt: p.attempt,
            elapsedMs: p.elapsedMs,
            etaMs: p.etaMs,
          });
        },
        onWakeResolved: endWake,
      });
      // Retry exactly once after wake resolved
      return doFetch();
    }
    // SSR: don't hold rendering thread forever. Rethrow for caller to fallback.
    throw err;
  }

  // Peek status/content-type for waking response.
  const ct = res.headers.get('content-type');
  let bodyStart = '';
  try {
    const statusBad = res.status >= 500;
    const looksHtml = !!ct?.toLowerCase().includes('text/html');
    if (statusBad || looksHtml) {
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
      // Retry once after resolved successfully (API now up)
      return doFetch();
    }
    // SSR: give caller a chance to use null fallback
    throw new Error(`Render waking page detected (${res.status}) — SSR fallback to null`);
  }
  return res;
}

export async function apiGet<T>(
  path: string,
  opts?: { next?: NextFetchRequestConfig; headers?: HeadersInit }
): Promise<T> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: opts?.headers,
      ...(opts?.next ? { next: opts.next } : {}),
    })
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = { error: { message: 'Invalid response' } };
  }
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit }
): Promise<T> {
  const mkHeaders = (): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(opts?.headers || {}),
  });
  const mkBody = () => JSON.stringify(body);
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: mkHeaders(),
      body: mkBody(),
    })
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = { error: { message: 'Invalid response' } };
  }
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export const API_BASE_URL = API_BASE;
// Re-export so pages can destructure { withFallbackNull } instead of re-import api-wake
export { withFallbackNull } from './api-wake';
export type { ApiWakeOpts };
