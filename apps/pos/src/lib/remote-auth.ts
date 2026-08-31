import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake, WakeSource } from './api-wake';

/**
 * resolveApiBase — professional grade fallback chain for API host.
 *
 * Priority (highest wins):
 *   1. Vite build-time env: VITE_API_BASE_URL > VITE_API_URL > VITE_PUBLIC_API_URL > API_BASE_URL
 *      (set explicitly on Render static site service build env tab).
 *   2. Runtime hostname fallback: when browser is on a known production domain
 *      (*.prolifictables.com / *.onrender.com), resolve to canonical production
 *      https://api.prolifictables.com/api/v1 even if build env was forgotten.
 *      This prevents the all-too-common "forgot to set VITE env on static build"
 *      causing localhost:4000 leak into production bundle (the exact root cause
 *      debugged in pos-pin-modal-v4 via live browser network requests).
 *   3. Local dev fallback: http://localhost:4000/api/v1 (only when hostname is
 *      localhost / 127.0.0.1 / 0.0.0.0, i.e. `npm run dev` mode).
 */
function resolveApiBase(): string {
  // (1) Highest priority: build-time Vite env override (still honored, never broken)
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const viteEnv = (import.meta as any).env;
    const explicit =
      viteEnv.VITE_API_BASE_URL ||
      viteEnv.VITE_API_URL ||
      viteEnv.VITE_PUBLIC_API_URL ||
      viteEnv.API_BASE_URL;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  }

  // (2) Medium priority: production hostnames → canonical api.prolifictables.com.
  //    Works even when Render static build env var was not configured (most common
  //    misconfiguration; CSP already whitelisted this origin in index.html meta).
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return 'https://api.prolifictables.com/api/v1';
  }

  // (3) Dev fallback: localhost API (never reaches in real user production)
  return 'http://localhost:4000/api/v1';
}

const API_BASE = resolveApiBase();

// POS is always browser; always show overlay on wake. SSR never runs.
//
// wakeSource controls overlay rendering:
//   'proactive' = background pre-warm from LoginScreen mount. Do NOT show the
//                 full-screen blocking modal (the overlay skips rendering;
//                 LoginScreen renders its own inline "Checking server…" pill).
//   'reactive'  = triggered during actual user action (Sign In click). Show
//                 full modal so user knows why the submit is taking time (not
//                 frozen). The PIN they typed remains intact on LoginScreen.
async function guardedFetch(
  doFetch: () => Promise<Response>,
  wakeSource: WakeSource = 'reactive'
): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    beginWake('Server waking up — one moment…', wakeSource);
    await waitForApiWake(API_BASE, {
      timeoutMs: 120_000,
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    });
    return doFetch();
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
    beginWake('Server waking up — one moment…', wakeSource);
    await waitForApiWake(API_BASE, {
      timeoutMs: 120_000,
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    });
    return doFetch();
  }
  return res;
}

/**
 * Pre-warm the backend from LoginScreen on mount. If the Render backend is
 * currently asleep, begin the health ping loop silently so by the time the
 * cashier finishes typing their 4-6 digit PIN the backend is almost always
 * already awake. Only escalate to a full modal if the cashier clicks Sign In
 * while still waking — see wakeSource='reactive' branch in pinLogin().
 */
export async function preWakeApi(): Promise<void> {
  // Fire guardedFetch against the cheapest public endpoint (health), but tag
  // it 'proactive' so the overlay skips rendering its blocking modal.
  try {
    await guardedFetch(
      () =>
        fetch(API_BASE.replace(/\/+$/, '') + '/health', {
          method: 'GET',
          // Pass via type assertion — older TS DOM libs omit cache prop string
          // literal 'no-store' but it's Fetch spec standard.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ cache: 'no-store' } as any),
          credentials: 'omit',
        }),
      'proactive'
    );
  } catch {
    // ignore — guardedFetch swallowed wake loop + any real error gets surfaced
    // later when we actually call pinLogin() and the user needs an answer.
  }
}

export async function pinLogin(opts: {
  pin: string;
  branchId?: string;
  deviceId?: string;
  signal?: AbortSignal;
}): Promise<any> {
  const payload: Record<string, unknown> = { pin: opts.pin };
  if (opts.branchId) payload.branchId = opts.branchId;
  if (opts.deviceId !== undefined) payload.deviceId = opts.deviceId;

  let res: Response;
  try {
    res = await guardedFetch(
      () =>
        fetch(`${API_BASE}/auth/pin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: opts.signal,
        }),
      'reactive'
    );
  } catch (err: any) {
    throw err;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json && (json.data ?? json)) || null;
}

export async function changePin(opts: {
  accessToken: string;
  currentPin: string;
  newPin: string;
  signal?: AbortSignal;
}): Promise<{ ok: true }> {
  const res = await guardedFetch(
    () =>
      fetch(`${API_BASE}/auth/pin/change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.accessToken}`,
        },
        body: JSON.stringify({
          currentPin: opts.currentPin,
          newPin: opts.newPin,
        }),
        signal: opts.signal,
      }),
    'reactive'
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const data = json && (json.data ?? json);
  return (data as { ok: true }) || { ok: true };
}

export const REMOTE_AUTH_API_BASE = API_BASE;
