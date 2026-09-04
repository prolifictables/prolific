'use client';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn, formatTime, statusVariant, padZero } from '../../lib/ui-helpers';
import type { ConnectionPillState, OpenShiftState } from '../../lib/types';
import { changePin } from '../../lib/remote-auth';
import { useCartStore } from '../../lib/cart-store';

// ---------------------------------------------------------------------------
// Helper: mark an element as participating in the OS-level drag region
// for frameless windows (Electron). React's React.CSSProperties type does
// not declare -webkit-app-region, so we emit it via a loose cast.
// Pass 'no-drag' to exclude a child (buttons, selects, links, inputs) so
// clicks on interactive controls reach their handlers instead of being
// captured by the drag region.
// ---------------------------------------------------------------------------
const dragRegion = (kind: 'drag' | 'no-drag'): React.CSSProperties =>
  ({ ['-webkit-app-region' as any]: kind }) as React.CSSProperties;

function ConnectionPill({ state }: { state: ConnectionPillState }) {
  const v = statusVariant(state.status);
  const isSyncError = state.status === 'SYNC_ERROR';
  return (
    <button
      onClick={() => {
        console.log('[header] sync manually requested');
        window.electronAPI?.sync?.requestNow?.().catch((e) => console.warn(e));
      }}
      className={`chip ${v.bg} ${v.text} ring-1 ring-inset ${v.ring} ${
        isSyncError ? 'bg-repeating-linear' : ''
      }`}
      title={
        state.lastSuccessfulAt
          ? `Last sync OK ${formatTime(state.lastSuccessfulAt)}`
          : 'No successful sync yet'
      }
    >
      <span className={`h-2.5 w-2.5 rounded-full ${v.dot}`} />
      <span className="font-semibold">{v.label}</span>
      {state.pendingCount > 0 && (
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold tabular-nums">
          {state.pendingCount}
        </span>
      )}
      {state.failedCount > 0 && (
        <span className="rounded-full bg-rose-500/30 text-rose-200 px-2 py-0.5 text-xs font-bold tabular-nums">
          {state.failedCount}✕
        </span>
      )}
    </button>
  );
}

function OpenShiftPill({ shift }: { shift: OpenShiftState }) {
  if (!shift.shiftId) {
    return (
      <div className="chip bg-rose-500/10 text-rose-300 ring-rose-500/20 ring-1 ring-inset">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="font-semibold">No Open Shift</span>
      </div>
    );
  }
  return (
    <div className="chip-neon">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-neon-pulse" />
      <span className="font-semibold">Shift Open</span>
      <span className="text-amber-300/80 text-xs">
        {formatCentsToNgn(shift.openingCashCents || 0)} opening ·{' '}
        {shift.openedAt ? formatTime(shift.openedAt) : '--:--'}
      </span>
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);
  const hh = padZero(now.getHours());
  const mm = padZero(now.getMinutes());
  return (
    <div className="font-mono text-2xl font-bold tabular-nums text-white tracking-wider">
      {hh}
      <span className="text-slate-500 animate-pulse-soft">:</span>
      {mm}
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS-domain quick-action "Add" button.
// Clicking it clears the current cart (items, discount, customer, note,
// table) and generates a fresh idempotency key — same semantic as pressing
// "New Transaction" on a traditional retail POS terminal. It is intentionally
// placed beside the window chrome so the top-right corner of every screen
// carries the "start something new affordance" operators expect.
// ---------------------------------------------------------------------------
function NewCartAddButton(): JSX.Element {
  const clear = useCartStore((s) => s.actions.clear);
  const lineCount = useCartStore((s) => s.lines.length);
  const [armed, setArmed] = useState<boolean>(false);

  // Auto-collapse the armed (confirm) state after 3s of no user action so
  // an accidental click on a busy counter doesn't permanently re-layout the
  // header.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3_000);
    return () => clearTimeout(t);
  }, [armed]);

  // If the cart is already empty, clicking is a no-op — we flash a toast via
  // the DOM instead of wiring another global bus just for this affordance.
  const onClick = () => {
    if (lineCount === 0) {
      // Flash the button amber 3x to signal "nothing to clear"
      setArmed(true);
      const t = setTimeout(() => setArmed(false), 800);
      return () => clearTimeout(t);
    }
    if (!armed) {
      setArmed(true);
      return;
    }
    // Armed + confirmed — actually reset.
    clear();
    setArmed(false);
  };

  return (
    <button
      onClick={onClick}
      title={
        lineCount === 0
          ? 'Cart is already empty'
          : armed
            ? 'Click again to confirm: clear the current cart'
            : `New cart — has ${lineCount} item${lineCount === 1 ? '' : 's'} in the current cart`
      }
      className={[
        'inline-flex items-center gap-2 h-9 px-3 rounded-xl font-black text-[11px] uppercase tracking-[0.16em] transition-all',
        'ring-1 ring-inset shadow-[0_0_24px_-10px_rgba(251,191,36,0.7)]',
        armed && lineCount > 0
          ? 'bg-gradient-radial from-rose-500/40 via-orange-500/30 to-amber-500/40 text-white ring-rose-400/50 animate-shake-soft'
          : lineCount === 0
            ? 'bg-white/5 text-slate-400 ring-white/10 hover:text-white hover:ring-white/20'
            : 'bg-gradient-radial from-amber-500/30 via-yellow-500/20 to-transparent text-amber-100 ring-amber-400/40 hover:text-white hover:ring-amber-300/60 hover:shadow-[0_0_32px_-6px_rgba(251,191,36,0.85)] active:scale-95',
      ].join(' ')}
    >
      <span className="text-[15px] leading-none">{armed ? '✖' : '＋'}</span>
      <span className="hidden sm:inline">
        {armed ? (lineCount === 0 ? 'Empty' : 'Confirm') : 'Add'}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Custom renderer-driven window chrome (min / toggle-max / close).
// The native frame is disabled in window-manager.ts so every platform renders
// a unified Prolific-styled title bar. On macOS the traffic-light buttons
// still exist at the OS level; we still render these controls on all
// platforms so the layout is symmetric and Windows/Linux are fully usable.
// ---------------------------------------------------------------------------
function WindowChromeControls(): JSX.Element {
  const [maximized, setMaximized] = useState<boolean>(false);
  const [platform, setPlatform] = useState<string>('browser');

  // Query Electron (or browser polyfill) once on mount, then subscribe to
  // maximize/unmaximize events so the icon stays in sync with native chrome
  // interactions (Win + Up, Mac cmd-Ctrl-F, dragging to the top of the screen).
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    const api = window.electronAPI?.window;
    if (!api) return undefined;

    // Seed initial state.
    api
      .isMaximized()
      .then((s: any) => {
        if (!alive) return;
        setMaximized(Boolean(s?.maximized));
        if (s?.platform) setPlatform(String(s.platform));
      })
      .catch(() => { /* ignore; fallback to icons */ });

    // Subscribe to state changes issued by the main process on native events.
    try {
      unsub = api.subscribeState((next: any) => {
        if (!alive || !next || typeof next !== 'object') return;
        if (typeof (next as any).maximized === 'boolean') {
          setMaximized(Boolean((next as any).maximized));
        }
      });
    } catch { /* subscription not available in some shim contexts */ }

    return () => {
      alive = false;
      try { unsub?.(); } catch { /* noop */ }
    };
  }, []);

  const api = window.electronAPI?.window;
  const disabled = !api;

  // Per-platform layout: macOS shows native traffic lights in the top-left
  // (window-manager.ts: trafficLightPosition { x:14, y:14 }), so we render a
  // left spacer of ~80px to leave them a clear hit-area. Windows/Linux have
  // no native chrome so controls sit flush to the right without a spacer.
  const isDarwin = /^darwin$/i.test(platform) || /mac|os x/i.test(platform);
  const trafficLightPad = isDarwin ? 'md:pl-24' : '';

  const hoverBg = (danger: boolean) =>
    danger
      ? 'hover:bg-rose-500/90 hover:text-white hover:ring-rose-400/70'
      : 'hover:bg-white/10 hover:text-white hover:ring-white/25';

  return (
    <div
      className={`flex shrink-0 items-center gap-1 ${trafficLightPad}`}
      // Mark the entire group as non-stealing for the OS drag-region
      // in frameless windows (via -webkit-app-region:drag on the header row
      // itself; we mark the controls as no-drag so clicks land cleanly).
      style={dragRegion('no-drag')}
    >
      <button
        onClick={() => api?.minimize?.().catch(() => {})}
        disabled={disabled}
        className={[
          'group relative h-9 w-9 inline-flex items-center justify-center rounded-lg',
          'ring-1 ring-inset ring-white/10 bg-white/5 text-slate-300 transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          hoverBg(false),
        ].join(' ')}
        title="Minimize"
        aria-label="Minimize window"
      >
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
          <rect x="1.5" y="5.5" width="9" height="1.5" rx="0.75" fill="currentColor" />
        </svg>
      </button>

      <button
        onClick={async () => {
          if (!api) return;
          try {
            const res = (await api.toggleMaximize()) as { maximized?: boolean } | undefined;
            if (res && typeof res.maximized === 'boolean') {
              setMaximized(res.maximized);
            }
          } catch { /* noop */ }
        }}
        disabled={disabled}
        className={[
          'group relative h-9 w-9 inline-flex items-center justify-center rounded-lg',
          'ring-1 ring-inset ring-white/10 bg-white/5 text-slate-300 transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          hoverBg(false),
        ].join(' ')}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M3 2.5h5.25a.75.75 0 0 1 .75.75V8.5a.25.25 0 0 1-.25.25H8.5V5a.5.5 0 0 0-.5-.5H4.75V3.25A.75.75 0 0 1 5.5 2.5H3zM2 4.75c0-.69.56-1.25 1.25-1.25H3v4.5c0 .69.56 1.25 1.25 1.25h4.5v.25c0 .69-.56 1.25-1.25 1.25h-4.5A1.25 1.25 0 0 1 2 9.25v-4.5z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
            <rect
              x="1.75"
              y="1.75"
              width="8.5"
              height="8.5"
              rx="0.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        )}
      </button>

      <button
        onClick={() => api?.close?.().catch(() => {})}
        disabled={disabled}
        className={[
          'group relative h-9 w-9 inline-flex items-center justify-center rounded-lg',
          'ring-1 ring-inset ring-white/10 bg-white/5 text-slate-300 transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          hoverBg(true),
        ].join(' ')}
        title="Close"
        aria-label="Close window"
      >
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M2.28 2.28a.75.75 0 0 1 1.06 0L6 4.94l2.66-2.66a.75.75 0 1 1 1.06 1.06L7.06 6l2.66 2.66a.75.75 0 1 1-1.06 1.06L6 7.06l-2.66 2.66a.75.75 0 0 1-1.06-1.06L4.94 6 2.28 3.34a.75.75 0 0 1 0-1.06z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}

export default function Header({
  connectionState,
  openShift,
  onRequestOpenShift,
  onRequestCloseShift,
}: {
  connectionState: ConnectionPillState;
  openShift: OpenShiftState;
  onRequestOpenShift?: () => void;
  onRequestCloseShift?: () => void;
}) {
  const navigate = useNavigate();
  const { employee, branch, restaurant, loginMode } = useAuthStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const authActions = useAuthStore((s) => s.actions);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' && !!document.fullscreenElement
  );
  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const roleName =
    employee?.role ||
    employee?.positionTitle ||
    employee?.employeeNumber ||
    'Cashier';

  const handleLogout = () => {
    console.log('[header] logout');
    authActions.logout();
    navigate('/login', { replace: true });
  };

  const submitPinChange = async () => {
    if (!accessToken) {
      setPinError('You must be online to change your PIN.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('PIN confirmation does not match.');
      return;
    }
    if (String(newPin).trim().length < 4 || String(newPin).trim().length > 6 || !/^\d+$/.test(String(newPin).trim())) {
      setPinError('New PIN must be 4–6 digits.');
      return;
    }
    setPinSaving(true);
    setPinError(null);
    try {
      await changePin({
        accessToken,
        currentPin,
        newPin,
      });
      const employeeRecord = employee
        ? {
            id: employee.id,
            userId: employee.userId,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            phone: employee.phone,
            role: employee.role,
            branchId: employee.branchId,
            restaurantId: employee.restaurantId,
          }
        : null;
      if (employeeRecord) {
        await window.electronAPI?.db?.employees?.upsertWithPin?.(employeeRecord, newPin);
      }
      setShowPinModal(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e: any) {
      setPinError(e?.message || 'Failed to change PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  const toggleFullscreen = async () => {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.warn('[header] fullscreen failed', e);
    }
  };

  return (
    <header
      className="h-20 shrink-0 border-b border-white/5 bg-slate-900/60 backdrop-blur sticky top-0 z-30"
      // Make the header an OS-level drag region for frameless windows.
      // Child interactive controls opt-out with dragRegion('no-drag').
      style={dragRegion('drag')}
    >
      <div className="h-full px-6 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl glass-neon">
            <div className="h-10 w-10 rounded-xl bg-gradient-neon flex items-center justify-center shadow-glow-restaurant animate-neon-pulse">
              <span className="text-black text-xl font-black">P</span>
            </div>
            <div className="leading-tight min-w-0">
              <div className="text-white font-bold tracking-tight text-sm">
                {restaurant?.name || 'Prolific POS'}
              </div>
              <div className="text-xs text-amber-300/80 truncate">
                {branch?.name || 'Main Branch'} · Cashier
              </div>
            </div>
          </div>
          <ConnectionPill state={connectionState} />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openShift.shiftId ? onRequestCloseShift : onRequestOpenShift}
            className="transition-transform active:scale-[0.98]"
            style={dragRegion('no-drag')}
          >
            <OpenShiftPill shift={openShift} />
          </button>
        </div>

        <div className="flex items-center gap-4 min-w-0">
          <div className="hidden md:flex items-center gap-2">
            <LiveClock />
            <span className="text-slate-500 text-xl" title="Weather placeholder">
              🌤️
            </span>
          </div>

          <div
            className="flex items-center gap-3 pl-4 border-l border-white/5 min-w-0"
            style={dragRegion('no-drag')}
          >
            <div className="h-11 w-11 rounded-full bg-gradient-neon flex items-center justify-center text-black font-bold shrink-0 ring-2 ring-amber-400/30 shadow-glow-restaurant">
              {(employee?.firstName || employee?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight min-w-0 hidden sm:block">
              <div className="text-white font-semibold truncate">
                {employee?.firstName
                  ? `${employee.firstName} ${employee.lastName || ''}`.trim()
                  : employee?.name || 'Unnamed Cashier'}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    loginMode === 'OFFLINE_PIN'
                      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-400/25'
                      : 'bg-emerald-500/20 text-emerald-200 ring-1 ring-inset ring-emerald-400/25'
                  }`}
                >
                  {loginMode === 'OFFLINE_PIN' ? 'Offline Login' : 'Online'}
                </span>
                <span className="text-xs text-slate-400 truncate">{roleName}</span>
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-2"
            style={dragRegion('no-drag')}
          >
            <button
              onClick={toggleFullscreen}
              className="btn-ghost !px-3 !min-h-11"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? '🗗' : '⛶'}
            </button>

            <button
              onClick={() => {
                setShowPinModal(true);
                setPinError(null);
                setCurrentPin('');
                setNewPin('');
                setConfirmPin('');
              }}
              className="btn-ghost !min-h-11 !px-4"
              title="Change PIN"
            >
              Change PIN
            </button>

            <button onClick={handleLogout} className="btn-secondary !min-h-11 !px-4">
              <span>Logout</span>
            </button>
          </div>

          {/* --- Custom window chrome: [＋ Add] [－] [☐/▣] [✕] -----------
                Rendered as the rightmost strip so it mirrors where the native
                title bar would have them. Controls + Add button are fully
                keyboard accessible (aria-label, disabled state) and visually
                match the Prolific neon-dark aesthetic. */}
          <div
            className="flex items-center gap-2 border-l border-white/5 pl-4"
            style={dragRegion('no-drag')}
          >
            <NewCartAddButton />
            <WindowChromeControls />
          </div>
        </div>
      </div>

      {showPinModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-glow-restaurant">
            <div className="text-white font-black text-lg tracking-tight">Update PIN</div>
            <div className="text-sm text-slate-300 mt-1">
              Enter your current PIN and choose a new 4–6 digit PIN.
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Current PIN
                </label>
                <input
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  className="input"
                  inputMode="numeric"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    New PIN
                  </label>
                  <input
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    className="input"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Confirm PIN
                  </label>
                  <input
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    className="input"
                    inputMode="numeric"
                  />
                </div>
              </div>
              {pinError && (
                <div className="text-sm text-rose-200 bg-rose-500/10 ring-1 ring-inset ring-rose-500/20 rounded-2xl p-3">
                  {pinError}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowPinModal(false)}
                className="btn-secondary !min-h-11 !px-4"
                disabled={pinSaving}
              >
                Cancel
              </button>
              <button
                onClick={submitPinChange}
                className="btn-primary !min-h-11 !px-5"
                disabled={pinSaving}
              >
                {pinSaving ? 'Saving…' : 'Save PIN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
