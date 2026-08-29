// Admin-only bus for API wake-up notifications. Mirrors website/lib/api-wake.ts — each
// Next.js app has its own module scope so they can't share file-system bus across apps.
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

export const subscribeApiWake = (fn: Listener): (() => void) => {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
};

export const publishApiWake = (patch: Partial<ApiWakeState>): void => {
  state = { ...state, ...patch };
  for (const l of listeners) l({ ...state });
};

export const beginWake = (msg: string = 'Server waking up — one moment…'): void => {
  publishApiWake({
    isWaking: true,
    message: msg,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 120_000,
  });
};

export const endWake = (): void => {
  state = { ...DEFAULT_STATE };
  for (const l of listeners) l({ ...state });
};

export async function withFallbackNull<T>(p: Promise<T> | (() => Promise<T>)): Promise<T | null> {
  try {
    return typeof p === 'function' ? await p() : await p;
  } catch {
    return null;
  }
}
