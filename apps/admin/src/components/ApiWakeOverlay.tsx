'use client';

import { useEffect, useState } from 'react';
import { subscribeApiWake, ApiWakeState } from '../lib/api-wake';

export function ApiWakeOverlay({ appName = 'Prolific Admin' }: { appName?: string }) {
  const [s, setS] = useState<ApiWakeState>({
    isWaking: false,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 0,
    message: '',
  });

  useEffect(() => subscribeApiWake((n) => setS(n)), []);
  if (!s.isWaking) return null;

  const elapsedSec = Math.max(0, Math.floor(s.elapsedMs / 1000));
  const etaSec = Math.max(0, Math.floor(s.etaMs / 1000));
  const pct = Math.min(95, Math.floor((s.elapsedMs / Math.max(1, s.elapsedMs + s.etaMs)) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${appName} server waking up`}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
    >
      <div className="w-[min(92vw,460px)] rounded-2xl border border-white/10 bg-white p-8 shadow-2xl shadow-slate-900/30">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 shrink-0">
            <div className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-indigo-100 border-t-indigo-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-900">
              {s.message || 'Server waking up — one moment…'}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">
              Backend boots in 30–90 seconds after idle timeout.
            </p>
          </div>
        </div>
        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500 tabular-nums">
            <span>attempt {Math.max(1, s.attempt)}</span>
            <span>
              {elapsedSec}s elapsed · ~{etaSec}s remaining
            </span>
          </div>
        </div>
        <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
          💡 First visit after idle triggers wake-up. Subsequent requests stay fast until next sleep cycle.
        </p>
      </div>
    </div>
  );
}
