const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_PUBLIC_API_URL ||
      (import.meta as any).env.API_BASE_URL)) ||
  'http://localhost:4000/api/v1';

export async function pinLogin(opts: {
  pin: string;
  branchId?: string;
  deviceId?: string;
  signal?: AbortSignal;
}): Promise<any> {
  const payload: Record<string, unknown> = { pin: opts.pin };
  // branchId is OPTIONAL — the server resolves the correct branch from the
  // employee record automatically. Only include it if explicitly provided
  // so the server's global-PIN search path fires for the default flow.
  if (opts.branchId) payload.branchId = opts.branchId;
  if (opts.deviceId !== undefined) payload.deviceId = opts.deviceId;

  const res = await fetch(`${API_BASE}/auth/pin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) ||
      `HTTP ${res.status}`;
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
  const res = await fetch(`${API_BASE}/auth/pin/change`, {
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
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const data = json && (json.data ?? json);
  return (data as { ok: true }) || { ok: true };
}
