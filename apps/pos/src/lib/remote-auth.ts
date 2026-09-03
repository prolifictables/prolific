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
  // (-1) HIGHEST PRIORITY — Electron desktop IPC (runs BEFORE all other
  // tiers). On packaged Electron apps, `window.location` is a `file:///` URL
  // with no hostname, so step (2) hostname detection never fires and we'd
  // fall straight to step (3) localhost:4000 on any packaged Windows/macOS
  // install — which is exactly the bug the user reported (exact error:
  // "Network error contacting backend after wake"). Ask the main process
  // synchronously via preload contextBridge; the main process uses the same
  // 4-tier chain we fixed yesterday (store > env > env > Render slug or dev).
  if (
    typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.getApiBaseUrlSync === 'function'
  ) {
    try {
      const fromMain: unknown = (window as any).electronAPI.getApiBaseUrlSync();
      if (typeof fromMain === 'string' && fromMain.trim().length > 3) {
        const trimmed = fromMain.trim().replace(/\/+$/, '');
        if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
          return trimmed;
        }
        return `${trimmed}/api/v1`;
      }
    } catch {
      // Preload IPC not ready / contextIsolation weirdness — fall through.
    }
  }
  // (0) HIGHEST PRIORITY — localStorage operator override.
  // Professional escape hatch: manager / DevOps can paste the exact real
  // backend base URL into the browser's localStorage on ANY terminal and
  // bypass ALL build-env + runtime-guess logic. No code deploy needed.
  //
  // How to use (manager-only):
  //   1. Open POS login screen
  //   2. Press F12 → Application → Local Storage → pos.prolifictables.com
  //   3. Add key = "prolific_api_base" with value like
  //      "https://prolific-api.onrender.com" (omit or include /api/v1)
  //   4. Cmd+Shift+R hard refresh. Done.
  //
  // This key is stored PER BROWSER / PER TERMINAL. If you ever move backends,
  // just change the value and refresh. No build, no deploy, no env var.
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const override = window.localStorage.getItem('prolific_api_base');
      if (typeof override === 'string' && override.trim().length > 3) {
        const trimmed = override.trim().replace(/\/+$/, '');
        // Append /api/v1 suffix if the operator forgot it (saves 1 support ticket)
        if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
          return trimmed;
        }
        return `${trimmed}/api/v1`;
      }
    } catch {
      // localStorage access denied (rare: Safari private mode, etc.) → ignore.
    }
  }
  // (1) Vite build env override (still honored — never broken)
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
  // NOTE: User explicitly confirmed the API is hosted at
  //       https://prolific-api.onrender.com. We use that onrender.com URL
  //       for the production default. If the operator later wires up a custom
  //       domain (api.prolifictables.com) they can simply set localStorage
  //       `prolific_api_base` once per browser and it overrides this.
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
//   • PIN interactions (preWakeApi / pinLogin / changePin) wait a MAX of 30s
//     total for cold-start wake. If the API is genuinely unreachable after
//     30s we STOP waiting and throw a marked SERVER_UNREACHABLE error so the
//     LoginScreen can render an AMBER "Server unreachable" warning chip —
//     never the misleading rose-red "Incorrect PIN" for a network fault.
//   • Every per-request HTTP timeout is 5s instead of 10s because the user is
//     actively waiting on a response. Non-PIN flows keep the 120s/10s defaults.
const PIN_FLOW_SHORT_WAKE_MS = 30_000;
const PIN_FLOW_PER_ATTEMPT_TIMEOUT_MS = 5_000;

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
  const { timeoutMs = 120_000 } = opts;
  let res: Response;
  try {
    res = await doFetch();
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
      return await doFetch();
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
      return await doFetch();
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
