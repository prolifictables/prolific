import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_PUBLIC_API_URL ||
      (import.meta as any).env.API_BASE_URL)) ||
  'http://localhost:4000/api/v1';

// POS is always browser; always show overlay on wake. SSR never runs.
async function guardedFetch(doFetch: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    beginWake();
    await waitForApiWake(API_BASE, {
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
    beginWake();
    await waitForApiWake(API_BASE, {
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    });
    return doFetch();
  }
  return res;
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
    res = await guardedFetch(() =>
      fetch(`${API_BASE}/auth/pin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: opts.signal,
      })
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
  const res = await guardedFetch(() =>
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
    })
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
