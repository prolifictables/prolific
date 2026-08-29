// Browser-only global pub/sub for API wake-up state.
// Render free plan spins down server on idle — next request hits HTTP 502/503
// "Application Loading" HTML for 20–90s.
//
// Design:
//   1. UI ALWAYS renders FIRST (no blocking fetches before paint).
//   2. Any apiGet/apiPost that detects waking-state broadcasts to this bus.
//   3. A <ApiWakeOverlay/> component mounted at the root layout listens and
//      shows a polite spinner overlay ONLY while server boots (NEVER Render's HTML).
//   4. Once API is up the bus clears the flag + overlay disappears.

export type ApiWakeState = {
  isWaking: boolean;
  attempt: number;
  elapsedMs: number;
  etaMs: number;
  message: string;
};

type Listener = (s: ApiWakeState) => void;

const DEFAULT_STATE: ApiWakeState = {
  isWaking: false,
  attempt: 0,
  elapsedMs: 0,
  etaMs: 0,
  message: '',
};

let state: ApiWakeState = { ...DEFAULT_STATE };
const listeners = new Set<Listener>();

export const getApiWakeState = (): ApiWakeState => ({ ...state });

export const subscribeApiWake = (fn: Listener): (() => void) => {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
};

// Push state to all listeners. Component-only — no-op if no browser (SSR safe).
export const publishApiWake = (patch: Partial<ApiWakeState>): void => {
  state = { ...state, ...patch };
  for (const l of listeners) l({ ...state });
};

// Convenience: set waking ON (called first time any API call detects 502/503 HTML)
export const beginWake = (msg: string = 'Server waking up — one moment…'): void => {
  publishApiWake({
    isWaking: true,
    message: msg,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 120_000,
  });
};

// Convenience: reset everything to idle
export const endWake = (): void => {
  state = { ...DEFAULT_STATE };
  for (const l of listeners) l({ ...state });
};

// Helper for SSR / pre-hydration to know "this page call failed because server down"
// without throwing at SSR phase. Wrap any critical server fetch during getServer
// side in try/catch, return null from getServerSideProps-like code, and let the
// hydrated client re-fetch (which uses apiGet wrapper → triggers overlay).
//
// Usage:
//   export default async function Page() {
//     const data = await withFallbackNull(() => apiGet<Menu>('/public/menu'));
//     // data is null when server cold → use skeleton; client re-mounts and
//     // will call apiGet → triggers overlay on wake.
//   }
export async function withFallbackNull<T>(p: Promise<T> | (() => Promise<T>)): Promise<T | null> {
  try {
    return typeof p === 'function' ? await p() : await p;
  } catch {
    return null;
  }
}
