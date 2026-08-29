'use client';

import { useEffect, useState } from 'react';
import { subscribeApiWake, ApiWakeState } from './api-wake';

// Renders FULL SCREEN polite overlay ONLY while Render wakes up.
// Mount at root layout; children are invisible with pointer-events-none so that
// the actual page DOM (skeleton, nav, layout) renders BEHIND and is ready to go
// the moment endWake fires. This satisfies: "UI loads first, then silently waits".
export function ApiWakeOverlay({ appName = 'Prolific' }: { appName?: string }) {
  const [s, setS] = useState<ApiWakeState>({
    isWaking: false,
    attempt: 0,
    elapsedMs: 0,
    etaMs: 0,
    message: '',
  });

  useEffect(() => subscribeApiWake((next) => setS(next)), []);

  if (!s.isWaking) return null;

  const elapsedSec = Math.max(0, Math.floor(s.elapsedMs / 1000));
  const etaSec = Math.max(0, Math.floor(s.etaMs / 1000));
  const pct = Math.min(95, Math.floor((s.elapsedMs / Math.max(1, s.elapsedMs + s.etaMs)) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={appName + ' server is waking up'}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Keep page DOM alive under overlay by not covering with a modal that dismisses; only visual + status info */}
      <div className="w-[min(92vw,440px)] rounded-3xl border border-white/10 bg-neutral-900 p-8 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 shrink-0">
            <div className="absolute inset-0 animate-ping rounded-full bg-amber-400/30" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-amber-400/20 border-t-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-white">
              {s.message || 'Server waking up — one moment…'}
            </p>
            <p className="mt-1 truncate text-xs text-neutral-400">
              {appName} usually boots in 30–90 seconds. Your place in line is saved.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-neutral-500 tabular-nums">
            <span>
              attempt {Math.max(1, s.attempt)}
            </span>
            <span>
              {elapsedSec}s elapsed · ~{etaSec}s remaining
            </span>
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-neutral-500">
          💡 Tip: The server sleeps after 15 minutes idle to save resources. First
          request of the day warms it up. After this it stays fast until next idle.
        </p>
      </div>
    </div>
  );
}
