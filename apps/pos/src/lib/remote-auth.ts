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

  // #region debug-point pos-pin-login-not-working:F-remote-auth
  (() => {
    try {
      fetch("http://127.0.0.1:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "pos-pin-login-not-working",
          runId: "pre-fix",
          hypothesisId: "H4",
          location: "apps/pos/src/lib/remote-auth.ts pinLogin",
          msg: "[DEBUG] POS pinLogin remote-auth request built",
          data: {
            apiBase: API_BASE,
            bodyPinType: typeof payload.pin,
            bodyPinStr: String(payload.pin),
            bodyPinLen: String(payload.pin).length,
            hasBranchId: 'branchId' in payload,
            branchId: (payload as any).branchId || null,
            hasDeviceId: 'deviceId' in payload,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  })();
  // #endregion

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
    // H4: network-level exception before any response
    (() => { try { fetch("http://127.0.0.1:7777/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "pos-pin-login-not-working", runId: "pre-fix", hypothesisId: "H4", location: "apps/pos/src/lib/remote-auth.ts pinLogin catch", msg: "[DEBUG] POS pinLogin network error", data: { errName: err?.name, errMessage: err?.message || String(err) }, ts: Date.now() }) }).catch(() => {}); } catch {} })();
    throw err;
  }

  // #region debug-point pos-pin-login-not-working:F-remote-auth-response
  (() => {
    try {
      fetch("http://127.0.0.1:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "pos-pin-login-not-working",
          runId: "pre-fix",
          hypothesisId: "H4",
          location: "apps/pos/src/lib/remote-auth.ts pinLogin response",
          msg: "[DEBUG] POS pinLogin HTTP response received",
          data: {
            statusCode: res.status,
            statusText: res.statusText,
            contentType: res.headers.get('content-type'),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  })();
  // #endregion

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) || `HTTP ${res.status}`;
    // H4: log backend error message that gets thrown -> propagates to submitPin catch
    (() => { try { fetch("http://127.0.0.1:7777/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "pos-pin-login-not-working", runId: "pre-fix", hypothesisId: "H4", location: "apps/pos/src/lib/remote-auth.ts pinLogin !ok", msg: "[DEBUG] POS pinLogin !2xx error thrown", data: { msg, jsonTrunc: json ? String(JSON.stringify(json)).slice(0,200) : null }, ts: Date.now() }) }).catch(() => {}); } catch {} })();
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
