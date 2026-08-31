import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake, WakeSource } from './api-wake';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_PUBLIC_API_URL ||
      (import.meta as any).env.API_BASE_URL)) ||
  'http://localhost:4000/api/v1';

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
