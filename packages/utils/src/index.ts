import { nanoid } from 'nanoid';
import clsx, { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Node's `crypto` module is NOT available in browser environments and Vite
// externalizes it to a proxy that throws on property access. To avoid the
// entire utils module failing to import when loaded by browser frontends
// (POS / Admin / Website / KDS — none of which actually need sha256 hashing)
// we resolve `createHash` on-demand inside generateIdempotencyKey rather
// than via a top-level static ESM import. Browser callers that reach
// generateIdempotencyKey (none today) fall back to nanoid-based UUID.
function tryGetNodeCreateHash() {
  try {
    // require-style dynamic resolution works in Node / Nest runtimes; the
    // string literal avoids bundlers (Vite / Webpack) from tracing it.
    const mod = (globalThis as any).require?.('crypto');
    return mod?.createHash as typeof import('crypto').createHash | undefined;
  } catch {
    return undefined;
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs));
}

export const generateId = (prefix?: string): string => {
  const id = nanoid(16);
  return prefix ? `${prefix}_${id}` : id;
};

export const generateShortId = (length = 8): string => nanoid(length);

export const generateQRToken = (): string => {
  return nanoid(6).toUpperCase();
};

export const generateOrderNumber = (branchCode: string, sequence: number): string => {
  const padded = sequence.toString().padStart(5, '0');
  return `${branchCode}-${padded}`;
};

export const generateIdempotencyKey = (
  entityType: string,
  entityUniqueInput: string
): string => {
  const base = `${entityType}:${entityUniqueInput}:${Date.now()}`;
  const createHash = tryGetNodeCreateHash();
  // Node runtime (server-side) -> use sha256 for a stable opaque digest.
  if (createHash) return createHash('sha256').update(base).digest('hex');
  // Browser runtime -> the function is not called from frontends today, but
  // if it ever is we still need a sync unique string. nanoid is
  // cryptographically random and collision-safe for idempotency keys.
  return `${base}__${nanoid(40)}`;
};

export const formatMoney = (
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount / 100);
};

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (amount: number): number => amount / 100;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---- RENDER COLD-START DETECTION & WAIT FOR API WAKE-UP
// ---------------------------------------------------------------------------
// Render's free plan spins down the web service after idle (~15 min). When the next
// request to a cold service returns:
//   • HTTP 502 / 503 / 504 with HTML body containing
//     ("Application Loading… / SERVICE IS WAKING UP")
//   • Then 503s for 20–90 s while the container boots.
//
// Design goals:
//   1. The FRONTEND UI MUST render first (page/UI is static and NEVER EVER show
//      Render's error HTML. We keep all "waking up" UX is OUR overlay,
//      Render HTML NEVER leaks to user.
//   2. Detect waking state by BOTH (status code in the set {502,503,504,499,0} OR
//      (response body content-type is text/html — Render "Loading" page HTML)
//   3. Exponential backoff with jitter — max total timeout 120 s (Render boot
//      typically 20–90 s; boot)
// ---------------------------------------------------------------------------
const WAKING_HTTP_STATUS_CODES = new Set([502, 503, 504, 0]);

export type WakeProgress = {
  attempt: number;
  nextDelayMs: number;
  elapsedMs: number;
  etaMs: number;
};

export type WakeListener = (p: WakeProgress) => void;

// Check whether a Response / fetch error looks like Render waking page (HTTP 5xx or
// response body is "Loading" HTML. We inspect Content-Type first because Render's
// "Application is waking HTML pages are always HTML.
export function isApiWakingResponse(
  status: number,
  contentType: string | null | undefined,
  textBodyFirst300?: string
): boolean {
  if (WAKING_HTTP_STATUS_CODES.has(status)) return true;
  const ct = (contentType || '').toLowerCase();
  // Render waking page / Nginx reverse proxy gateway errors text/html; charset=utf-8
  // with bodies that start like: <!doctype html><html><head><title>Application Loading
  if (ct.includes('text/html') || ct.includes('text/htm')) {
    const snippet = (textBodyFirst300 || '').toLowerCase();
    if (
      snippet.includes('application loading') ||
      snippet.includes('service is waking') ||
      snippet.includes('waking up') ||
      snippet.includes('application is loading') ||
      snippet.includes('render.com') ||
      snippet.includes('502 bad gateway') ||
      snippet.includes('503 service unavailable')
    ) {
      return true;
    }
  }
  // Status 0 / 499 means TCP-level failures
  if (status === 0 || status === 499) return true;
  return false;
}

export type ApiWakeOpts = {
  /** Total time before we give up (default 120_000). Render free containers normally boot < 90s */
  timeoutMs?: number;
  /** Called each time before waiting between attempts (for UI overlay progress) */
  onProgress?: WakeListener;
  /** Called once the FIRST time wake-state is DETECTED (used to mount overlay) */
  onWakeDetected?: () => void;
  /** Called after API finishes successfully (hide overlay) */
  onWakeResolved?: () => void;
};

// Ping /health endpoint repeatedly with exponential backoff until success / timeout.
// Uses /health because it's the cheapest endpoint (no DB query, no auth, no body,
// instant response once API boots) and server already exposes it.
export async function waitForApiWake(apiBaseUrl: string, opts: ApiWakeOpts = {}): Promise<void> {
  const { timeoutMs = 120_000, onProgress, onWakeDetected, onWakeResolved } = opts;
  const healthUrl = apiBaseUrl.replace(/\/+$/, '') + '/health';
  const startedAt = Date.now();
  let attempt = 0;
  // Backoff schedule (ms): 1500, 2500, 4000, 6500, 10500, 15000 then cap at 15s
  const nextDelay = (a: number): number => {
    const fib = [1500, 2500, 4000, 6500, 10500, 15000, 15000];
    return fib[Math.min(a, fib.length - 1)] + Math.floor(Math.random() * 300);
  };
  let firstWakeFired = false;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    let status = 0;
    let ct: string | null = null;
    let bodyStart = '';
    try {
      // Credentials: omit — we don't need cookies for /health. Signal: don't abort
      // Controller for health ping short timeout per-attempt (10s hard per single attempt).
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(healthUrl, {
        method: 'GET',
        // cache: 'no-store' is Fetch standard but older TS DOM lib typings may
        // omit — pass via type assertion. We must NOT cache health pings so we
        // always get fresh Render proxy response (no stale CDN 503).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ cache: 'no-store' } as any),
        credentials: 'omit',
        signal: controller.signal,
      });
      clearTimeout(t);
      status = res.status;
      ct = res.headers.get('content-type');
      // Inspect first 300 chars as text for Render waking HTML text regardless
      // (content-type lie scenario (some middleboxes some proxies)
      try {
        const textFull = await res.text();
        bodyStart = textFull.slice(0, 300);
      } catch {
        // ignore body read failure
      }
      if (status >= 200 && status < 500 && !isApiWakingResponse(status, ct, bodyStart)) {
        onWakeResolved?.();
        return;
      }
    } catch (err) {
      // Network-level failure (TypeError: fetch failed / AbortError / ERR_*)
      // Treat as waking state. Continue loop.
      status = 0;
    }
    if (!firstWakeFired) {
      firstWakeFired = true;
      onWakeDetected?.();
    }
    const delay = nextDelay(attempt - 1);
    const elapsed = Date.now() - startedAt;
    onProgress?.({
      attempt,
      nextDelayMs: delay,
      elapsedMs: elapsed,
      etaMs: Math.max(0, timeoutMs - elapsed),
    });
    await sleep(delay);
  }
  // Timeout — allow caller to show "Service still unavailable — try again later"
  // Fall through. Don't throw; caller decides UX.
  onWakeResolved?.();
  return;
}

// ---------------------------------------------------------------------------
// Higher-level wrapper: takes a fetch-wrapped call with retry + wake detect.
// If the call hits waking state it transparently switches into waitForApiWake then
// retries ONE more time ONCE after waking resolves.
// ---------------------------------------------------------------------------
export async function fetchWithWakeRetry<T>(
  doFetch: () => Promise<Response>,
  apiBaseUrl: string,
  opts: ApiWakeOpts & { retryAfterWake?: boolean } = {}
): Promise<Response> {
  const { retryAfterWake = true, ...rest } = opts;
  try {
    const res = await doFetch();
    const ct = res.headers.get('content-type');
    let bodyStart = '';
    try {
      // We MUST NOT consume ReadableStream body of 2xx real responses;
      // only peek for 5xx / HTML (which we'll re-fetch anyway). Clone to peek.
      const htmlCt = ct?.toLowerCase().includes('text/html') || false;
      if (res.status >= 500 || htmlCt) {
        const cloned = res.clone();
        bodyStart = (await cloned.text()).slice(0, 300);
      }
    } catch {
      // ignore
    }
    if (isApiWakingResponse(res.status, ct, bodyStart)) {
      await waitForApiWake(apiBaseUrl, rest);
      if (retryAfterWake) return doFetch();
    }
    return res;
  } catch (err) {
    // Network failure / 0 status → waking attempt to wake first then retry once
    await waitForApiWake(apiBaseUrl, rest);
    if (retryAfterWake) return doFetch();
    throw err;
  }
  throw new Error('unreachable');
}

export const retry = async <T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = 2,
    onError,
  }: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: number;
    onError?: (err: Error, attempt: number) => void;
  } = {}
): Promise<T> => {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      onError?.(lastError, attempt);
      if (attempt < maxAttempts) {
        await sleep(delayMs * Math.pow(backoff, attempt - 1));
      }
    }
  }
  throw lastError;
};
