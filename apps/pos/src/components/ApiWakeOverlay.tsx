import { useEffect, useState } from 'react';
import { subscribeApiWake, ApiWakeState } from '../lib/api-wake';

// POS Terminal branded overlay — amber/rust palette matches Prolific POS cash-register aesthetic.
// Mounted as the FIRST child inside <App/> so it sits above all routes/screens.
//
// Key UX rule (professional-grade cold-start handling, post-692128b fix):
//   We NEVER show a full-screen blocking modal for "proactive" pre-warm calls
//   (LoginScreen is already warming the API silently in the background and
//   renders its own inline "Checking server…" pill under the connection chip).
//   Full blocking modal only appears on "reactive" wake — i.e. the user
//   actually clicked "Sign In" while the server was still sleeping. That way:
//     • User lands on login → types PIN without any jarring popup (no modal).
//     • If they press Sign In while cold → modal says "Waking the server…"
//       AND THE PIN THEY ENTERED IS KEPT INTACT so they don't retype.
//   See LoginScreen inline status pill + guardedFetch wake-source tagging.
export function ApiWakeOverlay({ appName = 'Prolific POS Terminal' }: { appName?: string }) {
  const [s, setS] = useState<ApiWakeState>({
    isWaking: false,
    source: null,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 0,
    message: '',
  });

  useEffect(() => subscribeApiWake((n) => setS(n)), []);

  // (1) Not waking → render nothing (fast path).
  // (2) Waking but source="proactive" → silent: LoginScreen shows its own
  //     inline pill; do NOT block the whole screen. This is the professional
  //     default — first page-load should be usable without popups.
  if (!s.isWaking || s.source === 'proactive') return null;

  const elapsedSec = Math.max(0, Math.floor(s.elapsedMs / 1000));
  const etaSec = Math.max(0, Math.floor(s.etaMs / 1000));
  const pct = Math.min(95, Math.floor((s.elapsedMs / Math.max(1, s.elapsedMs + s.etaMs)) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${appName} server is waking up`}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-neutral-950/75 backdrop-blur-sm"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="w-[min(92vw,460px)] rounded-2xl border border-amber-500/20 bg-gradient-to-br from-neutral-900 to-neutral-950 p-8 shadow-2xl shadow-amber-950/40">
        <div className="flex items-center gap-4">
          {/* Amber pulse + spinner — POS cashier colour */}
          <div className="relative h-12 w-12 shrink-0">
            <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/30" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-amber-500/15 border-t-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-amber-50">
              {s.message || 'Server waking up — one moment…'}
            </p>
            <p className="mt-1 truncate text-xs text-amber-200/60">
              {appName} · boots in 30–90 seconds after idle timeout.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-orange-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-amber-200/50 tabular-nums">
            <span>attempt {Math.max(1, s.attempt)}</span>
            <span>
              {elapsedSec}s elapsed · ~{etaSec}s remaining
            </span>
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-amber-100/40">
          💡 The backend hibernates after 15 minutes idle to save resources. First
          order of the day warms it up; stays fast for the rest of the shift.
        </p>
      </div>
    </div>
  );
}
