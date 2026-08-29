'use client';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn, formatTime, statusVariant, padZero } from '../../lib/ui-helpers';
import type { ConnectionPillState, OpenShiftState } from '../../lib/types';
import { changePin } from '../../lib/remote-auth';

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
    <header className="h-20 shrink-0 border-b border-white/5 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
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

          <div className="flex items-center gap-3 pl-4 border-l border-white/5 min-w-0">
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
