// POS browser-only global wake-up bus (shared across POS screens).
// Wake mode controls whether ApiWakeOverlay renders as a full-blocking modal
// (reactive = during user action like PIN submit) vs a silent inline pill on
// LoginScreen (proactive = pre-warm at mount, we show an inline status chip).
export type WakeSource = 'proactive' | 'reactive';
export type ApiWakeState = {
  isWaking: boolean;
  source: WakeSource | null;
  attempt: number;
  elapsedMs: number;
  etaMs: number;
  message: string;
};
type Listener = (s: ApiWakeState) => void;
const DEFAULT_STATE: ApiWakeState = {
  isWaking: false,
  source: null,
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
export const getApiWakeState = (): Readonly<ApiWakeState> => ({ ...state });
export const publishApiWake = (patch: Partial<ApiWakeState>): void => {
  state = { ...state, ...patch };
  for (const l of listeners) l({ ...state });
};
/**
 * beginWake — signal the wake overlay pipeline.
 *   source='proactive' → caller is pre-warming on LoginScreen mount; do NOT
 *     block the whole UI with a full modal. The LoginScreen will show its own
 *     inline "Checking server…" pill so the user can still type their PIN
 *     uninterrupted while the server boots in the background.
 *   source='reactive' (default) → hit during user action (Sign In / other).
 *     Show the standard full-screen modal so user knows action is blocked on
 *     server wake, not stuck.
 */
export const beginWake = (
  msg: string = 'Server waking up — one moment…',
  source: WakeSource = 'reactive'
): void => {
  // Reactive always wins — if we were doing a quiet proactive warm and the
  // user now taps Submit → escalate to full modal so they see what's happening
  // instead of a silent hanging spinner.
  const nextSource: WakeSource =
    state.isWaking && state.source === 'reactive' ? 'reactive' : source;
  publishApiWake({
    isWaking: true,
    source: nextSource,
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
