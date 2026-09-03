import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';
import { resolveApiBase } from './remote-auth';

// IMPORTANT: remote-pos.ts MUST use the SAME resolveApiBase() as remote-auth.ts
// (same 6-tier chain with Tier -1 IPC sync main-process URL + Tier -0.5 Electron
// packaged-production detection). Earlier versions hardcoded a local independent
// chain at the top of this file using ONLY import.meta.env VITE_* || localhost
// which caused fetchPosBootstrap() calls AFTER successful PIN login to silently
// call http://localhost:4000 on packaged Electron desktop builds (where no
// VITE env is set) → throw SERVER_UNREACHABLE despite the preceding PIN login
// succeeding. This was the most frustrating "login works then immediately fails"
// bug for cashiers because no visible feedback distinguished bootstrap fetch
// from auth fetch. Resolving from the same canonical removeApiBase eliminates
// the drift entirely.
const API_BASE = resolveApiBase();

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

export async function fetchPosBootstrap(opts: {
  accessToken: string;
  signal?: AbortSignal;
}): Promise<{ employees: any[]; tables: any[] }> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}/pos/bootstrap`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.accessToken}` },
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
  const employees = Array.isArray(data?.employees) ? data.employees : [];
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  return { employees, tables };
}

export const REMOTE_POS_API_BASE = API_BASE;
