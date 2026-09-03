import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake, WakeSource } from './api-wake';

/**
 * resolveApiBase — professional grade fallback chain for API host.
 *
 * Priority (highest wins):
 *   0. localStorage operator override (manager paste-in URL — permanent escape
 *      hatch, no deploy needed). Key: "prolific_api_base".
 *   1. Vite build-time env: VITE_API_BASE_URL > VITE_API_URL > VITE_PUBLIC_API_URL > API_BASE_URL
 *      (set explicitly on Render static site service build env tab).
 *   2. Runtime hostname fallback: when browser is on a known production domain
 *      (*.prolifictables.com / *.onrender.com), resolve to the REAL confirmed
 *      Render Node API service: https://prolific-api.onrender.com/api/v1.
 *      The canonical api.prolifictables.com DNS record may not exist yet on
 *      the user's Cloudflare setup, but we know the Render slug for the
 *      server web service so we use that directly. CSP connect-src in POS
 *      index.html already whitelists https://*.onrender.com.
 *   3. Local dev fallback: http://localhost:4000/api/v1 (only when hostname is
 *      localhost / 127.0.0.1 / 0.0.0.0, i.e. `npm run dev` mode).
 */
export function resolveApiBase(): string {
  const REAL_PRODUCTION_API_BASE = 'https://prolific-api.onrender.com/api/v1';

  // Helper: appends /api/v1 to a raw base URL if the user forgot it
  const normalizeWithSuffix = (raw: string): string => {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
      return trimmed;
    }
    return `${trimmed}/api/v1`;
  };

  // Helper: detect if this renderer is running inside an Electron environment
  // (any of: preload contextBridge injected, UA token, process.versions set).
  const detectElectron = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      if (typeof (window as any).electronAPI !== 'undefined' && (window as any).electronAPI !== null) {
        return true;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && /Electron\//.test(navigator.userAgent)) {
        return true;
      }
      if (
        typeof (globalThis as any).process !== 'undefined' &&
        typeof (globalThis as any).process?.versions?.electron === 'string'
      ) {
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  // Helper: detect "packaged production desktop" environment — return true if
  // Vite dev server is NOT running (vite-plugin-electron sets
  // VITE_DEV_SERVER_URL only when running `vite dev` electron desktop, NOT on
  // packaged production builds). Combined with Electron env detection, this
  // is the most robust indicator of a packaged desktop install and avoids any
  // hostname-based heuristics on file:// URLs (which yield ""/undefined).
  const isPackagedElectronDesktop = (): boolean => {
    if (!detectElectron()) return false;
    // Packaged builds have NO VITE_DEV_SERVER_URL set.
    // Vite minifies this at build time; we cast to any so tsc never complains.
    const viteDevUrl =
      (typeof import.meta !== 'undefined' && (import.meta as any).env)
        ? ((import.meta as any).env.VITE_DEV_SERVER_URL as unknown)
        : undefined;
    if (typeof viteDevUrl === 'string' && viteDevUrl.length > 0) {
      // VITE_DEV_SERVER_URL present → `npm run dev` electron desktop mode → dev.
      return false;
    }
    // No VITE_DEV_SERVER_URL → packaged for production. Final belt check:
    // empty/localhost hostname confirms file:// shell.
    const hn = typeof window.location?.hostname === 'string'
      ? window.location.hostname.toLowerCase()
      : '';
    return ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(hn);
  };

  // (-1) HIGHEST PRIORITY — Electron desktop IPC (sync). On packaged Electron,
  // window.location is `file:///dist/index.html` (NO hostname) so the
  // hostname-based tier (2) never fires → localhost fallback → fail. Ask the
  // main process synchronously via preload contextBridge which already runs
  // the correct 4-tier chain.
  if (detectElectron() &&
    typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.getApiBaseUrlSync === 'function'
  ) {
    try {
      const fromMain: unknown = (window as any).electronAPI.getApiBaseUrlSync();
      if (typeof fromMain === 'string' && fromMain.trim().length > 3) {
        return normalizeWithSuffix(fromMain);
      }
    } catch {
      // Preload contextBridge may not yet be ready if this module is imported
      // before preload executes — fall through to the next belt+suspenders
      // Electron detection tier (-0.5) so packaged Windows builds still
      // resolve to prolific-api.onrender.com and never localhost.
    }
  }

  // (-0.5) ELECTRON PACKAGED-PRODUCTION DETECTION.
  // If detectElectron is true AND VITE_DEV_SERVER_URL is absent, this is a
  // packaged desktop production build on Windows/macOS/Linux. In this case
  // we short-circuit the ENTIRE chain and return the real Render production
  // URL. This is the safest belt+suspenders: main-process IPC (-1) already
  // returns this URL, but even if IPC fails for any reason on some user's
  // machine, this tier guarantees we never fall to localhost and never run
  // hostname-based detection.
  if (isPackagedElectronDesktop()) {
    return REAL_PRODUCTION_API_BASE;
  }

  // (0) localStorage operator override (per-terminal escape hatch, no deploy needed).
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const override = window.localStorage.getItem('prolific_api_base');
      if (typeof override === 'string' && override.trim().length > 3) {
        return normalizeWithSuffix(override);
      }
    } catch { /* ignore */ }
  }

  // (1) Vite build env override (still honored, never broken).
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const viteEnv = (import.meta as any).env;
    const explicit =
      viteEnv.VITE_API_BASE_URL ||
      viteEnv.VITE_API_URL ||
      viteEnv.VITE_PUBLIC_API_URL ||
      viteEnv.API_BASE_URL;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  }

  // (2) Production hostnames → REAL confirmed Render API slug.
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return REAL_PRODUCTION_API_BASE;
  }

  // (3) Dev fallback: localhost API
  return 'http://localhost:4000/api/v1';
}

const API_BASE = resolveApiBase();

// POS is always browser; SSR never runs.
//
// wakeSource controls overlay rendering (see api-wake.ts):
//   'proactive' = background pre-warm from LoginScreen mount. Full modal is
//                 DISABLED (App.tsx removed ApiWakeOverlay globally per user
//                 request: "don't show waking modal on POS"). Inline amber pill
//                 on LoginScreen connection chip shows progress.
//   'reactive'  = triggered during user action (Sign In click). Button CTA
//                 shows "🔐 Verifying PIN…" spinner; STILL NO full modal.
//
// PIN-login guardrails (professional-grade timeout + error classification):
//   • PIN interactions (preWakeApi / pinLogin / changePin) wait a MAX of 45s
//     total for cold-start wake (Render free tier often takes 25-40s on a
//     first cold ping from the North America Oregon instance after idle).
//     If the API is genuinely unreachable after 45s we STOP waiting and
//     throw a marked SERVER_UNREACHABLE error so LoginScreen can render an
//     AMBER "Server unreachable" warning chip — never the misleading rose-red
//     "Incorrect PIN" for a network fault.
//   • Every per-request HTTP timeout is 8s instead of 5s. A first-call fetch
//     through guardedFetch used to have NO per-attempt AbortController at all
//     (only wake-retries had one), so Render cold-start latency >15s OS-timeout
//     on Windows TCP SYN retries threw unreachableErr even when the API was
//     waking. 8s single-attempt cap = 5 wake retries possible in 45s.
const PIN_FLOW_SHORT_WAKE_MS = 45_000;
const PIN_FLOW_PER_ATTEMPT_TIMEOUT_MS = 8_000;

/**
 * Error message marker string. Prefix thrown errors with this token when the
 * root cause is backend unreachable / CSP block / DNS fail / 30s wake timeout
 * — NOT a real credential mismatch. LoginScreen scans for this exact token
 * and shows an AMBER "Server unreachable" warning chip — never the misleading
 * rose-red "Incorrect PIN" chip for a network fault.
 */
export const SERVER_UNREACHABLE_MARKER = '🔴 SERVER_UNREACHABLE';
const unreachableErr = (why: string) =>
  new Error(`${SERVER_UNREACHABLE_MARKER}: ${why}. Check your internet connection, wait 60 seconds, or ask your manager to verify the backend service.`);

export async function guardedFetch(
  doFetch: () => Promise<Response>,
  wakeSource: WakeSource = 'reactive',
  opts: { timeoutMs?: number; perAttemptMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 120_000, perAttemptMs = 10_000 } = opts;

  // Per-attempt fetch wrapper: wraps any user-provided doFetch() with an
  // explicit AbortController that fires after `perAttemptMs`. This ensures
  // that EVERY single fetch attempt (not just wake-loop pings) has a hard
  // timeout instead of waiting on OS-level TCP retries which can take 30-60s
  // on Windows. The user's doFetch() can read opts.signal if it wants to,
  // but we add a redundant outer timeout for calls that ignore it.
  const withTimeout = async (): Promise<Response> => {
    // If doFetch already supports signal, great. If not, the outer
    // AbortController + Promise.race will still cancel the waiting period.
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), perAttemptMs);
    try {
      return await Promise.race([
        doFetch(),
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException(`Per-attempt HTTP timeout (${perAttemptMs}ms)`, 'TimeoutError'));
          });
        }),
      ]);
    } finally {
      clearTimeout(timerId);
    }
  };

  let res: Response;
  try {
    res = await withTimeout();
  } catch (err) {
    beginWake('Server waking up — one moment…', wakeSource);
    const wokeOk: boolean = await waitForApiWake(API_BASE, {
      timeoutMs,
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
      // Override single-attempt health ping timeout (shorter for pin flows).
      // NOTE: waitForApiWake in utils currently uses internal hardcoded 10000;
      // if perAttemptMs is shorter AND we detected a timeout here, we abort
      // the outer promise early so the user never waits the full 120s.
    })
      .then(() => true)
      .catch(() => false);
    if (!wokeOk) {
      // waitForApiWake never resolved = timeout (or cancelled) = unreachable
      throw unreachableErr(
        `Backend did not respond within ${Math.round(timeoutMs / 1000)} seconds`
      );
    }
    try {
      return await withTimeout();
    } catch (fetchAfterWakeErr) {
      // Even after health ping woke, the real POST still failed (TCP reset,
      // CORS preflight, etc.) — classify same unreachable, not wrong PIN.
      throw unreachableErr('Network error contacting backend after wake');
    }
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
    const wokeOk: boolean = await waitForApiWake(API_BASE, {
      timeoutMs,
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    })
      .then(() => true)
      .catch(() => false);
    if (!wokeOk) throw unreachableErr(`Backend still waking after ${Math.round(timeoutMs / 1000)}s`);
    try {
      // Same per-attempt timeout on post-wake retry: prevents OS-level TCP
      // retry latency from stacking above the wake timeout and throwing the
      // misleading "after wake" error when the API is actually alive now.
      return await withTimeout();
    } catch {
      throw unreachableErr('Network error contacting backend after wake');
    }
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
  try {
    await guardedFetch(
      () =>
        fetch(API_BASE.replace(/\/+$/, '') + '/health', {
          method: 'GET',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ cache: 'no-store' } as any),
          credentials: 'omit',
        }),
      'proactive',
      // Proactive pre-warm: generous timeout so it never blocks input (the user
      // is still just looking at the PIN pad). 120s is fine for background.
      { timeoutMs: 120_000, perAttemptMs: 10_000 }
    );
  } catch {
    // ignore — pinLogin will show explicit SERVER_UNREACHABLE error if needed.
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

  // User is actively waiting → SHORT timeouts.
  // SERVER_UNREACHABLE errors thrown by guardedFetch propagate unchanged.
  let res: Response = await guardedFetch(
    () =>
      fetch(`${API_BASE}/auth/pin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: opts.signal,
      }),
    'reactive',
    { timeoutMs: PIN_FLOW_SHORT_WAKE_MS, perAttemptMs: PIN_FLOW_PER_ATTEMPT_TIMEOUT_MS }
  );

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = (json && (json.error?.message || json.message || json.error)) || `HTTP ${res.status}`;
    const msg = typeof raw === 'string' ? raw : String(raw);
    // 401 / Invalid PIN → fall through catch in LoginScreen handles it.
    // Anything else (500, etc.) → throw, but leave SERVER_UNREACHABLE marker
    // intact if it was already set upstream.
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
    'reactive',
    { timeoutMs: PIN_FLOW_SHORT_WAKE_MS, perAttemptMs: PIN_FLOW_PER_ATTEMPT_TIMEOUT_MS }
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
