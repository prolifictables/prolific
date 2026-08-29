'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn, padZero } from '../../lib/ui-helpers';
import type { OpenShiftState } from '../../lib/types';

type Mode = 'OPEN' | 'CLOSE';

interface ShiftModalProps {
  mode: Mode;
  openShift: OpenShiftState;
  onClose: () => void;
  onDone: (updatedShift: OpenShiftState) => void;
}

const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function ShiftModal({ mode, openShift, onClose, onDone }: ShiftModalProps) {
  const { employee, branch, restaurant } = useAuthStore();
  const [amountRaw, setAmountRaw] = useState<string>('');
  // amountDirty tracks whether the user has edited the opening amount.
  // When false (default untouched), the first digit keypress REPLACES the
  // default "5000.00" value instead of appending digits onto the end.
  const [amountDirty, setAmountDirty] = useState<boolean>(false);
  const [managerPin, setManagerPin] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cashSales, setCashSales] = useState<number>(0);
  const [cardSales, setCardSales] = useState<number>(0);
  const [otherSales, setOtherSales] = useState<number>(0);
  const [totalSales, setTotalSales] = useState<number>(0);
  const [refundsPayouts, setRefundsPayouts] = useState<number>(0);

  useEffect(() => {
    if (mode === 'OPEN') {
      if (!amountRaw) {
        const defaultOpen = openShift.openingCashCents ?? 500000;
        setAmountRaw((defaultOpen / 100).toFixed(2));
      }
      return;
    }
    let alive = true;
    (async () => {
      try {
        const shiftId = openShift.shiftId;
        if (!shiftId) return;
        const pays: any = await window.electronAPI?.db?.payments?.listByShiftId?.(shiftId);
        const list = Array.isArray(pays) ? pays : (pays as any)?.data || [];
        let cs = 0,
          cd = 0,
          ot = 0;
        for (const p of list) {
          const amt =
            typeof p.amount_cents === 'number'
              ? p.amount_cents
              : typeof p.amountCents === 'number'
                ? p.amountCents
                : Math.round((p.amount || 0) * 100);
          if ((p.method || '').includes('CASH')) cs += amt;
          else if ((p.method || '').includes('CARD') || (p.method || '').includes('POS')) cd += amt;
          else ot += amt;
        }
        if (!alive) return;
        setCashSales(cs);
        setCardSales(cd);
        setOtherSales(ot);
        setTotalSales(cs + cd + ot);
        const adj: any = await window.electronAPI?.db?.cashAdjustments?.listByShiftId?.(shiftId);
        const alist = Array.isArray(adj) ? adj : (adj as any)?.data || [];
        let payout = 0;
        for (const a of alist) {
          const amt =
            typeof a.amount_cents === 'number'
              ? a.amount_cents
              : typeof a.amountCents === 'number'
                ? a.amountCents
                : Math.round((a.amount || 0) * 100);
          if (a.type === 'PAID_OUT') payout += amt;
          else payout -= amt;
        }
        setRefundsPayouts(Math.max(0, payout));
        const expected = (openShift.openingCashCents || 0) + cs - payout;
        setAmountRaw((expected / 100).toFixed(2));
      } catch (e) {
        console.warn('[shift] close summary failed', e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, openShift.shiftId]);

  const amountCents = (() => {
    const n = parseFloat(amountRaw || '0');
    if (isNaN(n)) return 0;
    return Math.round(n * 100);
  })();

  const expectedClosing =
    (openShift.openingCashCents || 0) + cashSales - refundsPayouts;
  const variance = amountCents - expectedClosing;
  const needsManagerPin = mode === 'CLOSE' && Math.abs(variance) > 100000;

  const appendKey = (k: string, target: 'amount' | 'pin' = 'amount') => {
    const setter = target === 'amount' ? setAmountRaw : setManagerPin;
    const getter = target === 'amount' ? amountRaw : managerPin;
    if (k === '⌫') {
      setter(getter.slice(0, -1));
      // Any edit (including backspace) means user is now in control of the value
      if (target === 'amount') setAmountDirty(true);
      return;
    }
    if (target === 'pin') {
      if (k === '.') return;
      if (getter.length >= 6) return;
      setter(getter + k);
      return;
    }
    if (k === '.') {
      setAmountDirty(true);
      setter(getter.includes('.') ? getter : getter + '.');
      return;
    }
    // For amount field: if value is still the untouched default, REPLACE the
    // whole value with this digit instead of appending. This lets users punch
    // in "7500" directly without first clearing the default ₦5,000.00.
    if (!amountDirty) {
      setAmountDirty(true);
      setter(k);
      return;
    }
    setter((p) => {
      if (p.includes('.') && p.split('.')[1]?.length >= 2) return p;
      if (p === '0') return k;
      return p + k;
    });
  };

  const handleConfirm = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (mode === 'OPEN') {
        if (!employee?.id || !branch?.id || !restaurant?.id) {
          setErrorMsg('Missing employee/branch context. Please login again.');
          setLoading(false);
          return;
        }

        const now = Date.now();
        const shiftId =
          (crypto.randomUUID && crypto.randomUUID()) || `sh_${now}_${Math.random()}`;
        const idempotencyKey =
          (crypto.randomUUID && crypto.randomUUID()) || `shift_${now}_${Math.random()}`;
        const deviceRes = (await window.electronAPI?.getDeviceId?.()) as
          | string
          | { deviceId?: unknown }
          | undefined;
        const deviceId =
          typeof deviceRes === 'string'
            ? deviceRes
            : deviceRes && typeof deviceRes === 'object' && 'deviceId' in deviceRes
              ? String((deviceRes as any).deviceId ?? '')
              : undefined;

        const payload = {
          id: shiftId,
          device_id: deviceId ? deviceId : null,
          branch_id: String(branch.id),
          restaurant_id: String(restaurant.id),
          employee_id: String(employee.id),
          status: 'OPEN',
          opening_cash_cents: amountCents,
          expected_cash_cents: 0,
          closing_cash_cents: 0,
          variance_cents: 0,
          cash_sales_cents: 0,
          card_sales_cents: 0,
          other_sales_cents: 0,
          refunds_cents: 0,
          payout_cents: 0,
          note: null,
          opened_at: now,
          idempotency_key: idempotencyKey,
          server_version: 0,
          local_version: 1,
          synced: 0,
          created_at: now,
          updated_at: now,
        };

        const res = await window.electronAPI?.db?.shifts?.open?.(payload);
        const id = typeof res === 'string' && res ? res : shiftId;
        console.log('[shift] opened', id);
        onDone({
          shiftId: id,
          openedAt: now,
          openingCashCents: amountCents,
        });
      } else {
        if (needsManagerPin) {
          let ok = false;
          try {
            const mgr: any = await window.electronAPI?.db?.employees?.findByPin?.(managerPin);
            const role = (mgr && (mgr.role || '')) || '';
            if (
              mgr &&
              (role === 'MANAGER' ||
                role === 'ADMIN' ||
                role === 'SUPER_ADMIN' ||
                role === 'SUPERVISOR')
            ) {
              ok = true;
            }
          } catch {
            ok = false;
          }
          if (!ok) {
            setErrorMsg('Manager PIN required (variance > ₦1,000).');
            setLoading(false);
            return;
          }
        }
        const payload = {
          id: openShift.shiftId,
          closing_cash_cents: amountCents,
          variance_cents: variance,
          note: needsManagerPin
            ? `Manager-approved variance ${formatCentsToNgn(variance)}`
            : null,
          closed_at: Date.now(),
        };
        await window.electronAPI?.db?.shifts?.close?.(payload);
        console.log('[shift] closed', payload.id);
        onDone({ shiftId: null, openedAt: null, openingCashCents: null });
      }
    } catch (e: any) {
      console.warn('[shift] action failed', e);
      setErrorMsg(e?.message || 'Could not save shift.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-slide-up p-4">
      <div className="w-full sm:max-w-3xl max-h-[96vh] bg-slate-900 border border-white/10 sm:rounded-3xl rounded-t-3xl shadow-glow flex flex-col">
        <div className="p-4 border-b border-white/5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">
              {mode === 'OPEN' ? 'Open New Shift' : 'Close Shift'}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {mode === 'OPEN'
                ? 'Count the drawer, enter the opening cash.'
                : 'Count the drawer, enter closing cash.'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="btn-ghost !min-h-10 !w-10 !px-0 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid lg:grid-cols-2 gap-4">
          {mode === 'CLOSE' && (
            <div className="card p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between text-slate-300">
                <span>Opening Cash</span>
                <span className="tabular-nums">
                  {formatCentsToNgn(openShift.openingCashCents || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-emerald-300">
                <span>💵 Cash Sales</span>
                <span className="tabular-nums">+{formatCentsToNgn(cashSales)}</span>
              </div>
              <div className="flex items-center justify-between text-indigo-300">
                <span>💳 Card Sales</span>
                <span className="tabular-nums">+{formatCentsToNgn(cardSales)}</span>
              </div>
              <div className="flex items-center justify-between text-amber-300">
                <span>🏦 Other Sales</span>
                <span className="tabular-nums">+{formatCentsToNgn(otherSales)}</span>
              </div>
              <div className="flex items-center justify-between text-rose-300">
                <span>📤 Payouts / Refunds</span>
                <span className="tabular-nums">−{formatCentsToNgn(refundsPayouts)}</span>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <span className="text-white font-semibold">Expected in Drawer</span>
                <span className="text-gradient-neon font-black text-xl tabular-nums animate-text-glow">
                  {formatCentsToNgn(expectedClosing)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Variance</span>
                <span
                  className={`font-bold tabular-nums ${
                    Math.abs(variance) > 100000
                      ? 'text-rose-400'
                      : variance === 0
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }`}
                >
                  {variance >= 0 ? '+' : ''}
                  {formatCentsToNgn(variance)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total Sales</span>
                <span className="text-white font-bold tabular-nums">
                  {formatCentsToNgn(totalSales)}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400 font-medium">
                  {mode === 'OPEN' ? 'Opening Cash in Drawer' : 'Actual Closing Cash'}
                </span>
              </div>
              <div className="min-h-16 rounded-2xl bg-slate-950/50 ring-1 ring-inset ring-white/10 flex items-center justify-end px-5">
                <div className="text-3xl font-black tabular-nums text-white tracking-tight">
                  {formatCentsToNgn(amountCents)}
                </div>
              </div>
              {mode === 'OPEN' && (
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {[250000, 500000, 750000, 1000000].map((v) => (
                    <button
                      key={v}
                      onClick={() => {
                        setAmountDirty(true);
                        setAmountRaw((v / 100).toFixed(2));
                      }}
                      className="chip !py-1 hover:bg-amber-500/15 hover:text-amber-200 transition-colors text-xs font-bold ring-1 ring-inset ring-white/10"
                    >
                      {formatCentsToNgn(v)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {needsManagerPin && (
              <div className="card p-4 space-y-2 ring-2 ring-rose-500/40">
                <div className="flex items-center gap-2 text-rose-300">
                  <span>🔐</span>
                  <span className="font-bold text-sm">
                    Manager PIN required — variance over ₦1,000
                  </span>
                </div>
                <div className="min-h-12 rounded-xl bg-slate-950/50 ring-1 ring-inset ring-white/10 flex items-center justify-center px-5">
                  <div className="text-2xl font-black tabular-nums text-white tracking-[0.5em]">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className={managerPin[i] ? 'text-white' : 'text-slate-700'}>
                        {managerPin[i] ? '•' : '·'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {NUM_KEYS.map((k) => (
                    <button
                      key={`m-${k}`}
                      onClick={() => appendKey(k, 'pin')}
                      disabled={k === '.'}
                      className={`min-h-[3rem] rounded-xl font-black text-xl transition-all active:scale-[0.96] disabled:opacity-30 ${
                        k === '⌫'
                          ? 'bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/20 hover:bg-rose-500/20'
                          : 'bg-white/5 text-white ring-1 ring-inset ring-white/10 hover:bg-white/10'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="grid grid-cols-3 gap-2">
                {NUM_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => appendKey(k, 'amount')}
                    className={`min-h-[3.25rem] rounded-2xl font-black text-xl transition-all active:scale-[0.96] ${
                      k === '⌫'
                        ? 'bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/20 hover:bg-rose-500/20'
                        : 'bg-white/5 text-white ring-1 ring-inset ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5 flex flex-col sm:flex-row gap-2">
          <button onClick={onClose} disabled={loading} className="btn-secondary sm:flex-1">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || (needsManagerPin && managerPin.length < 4)}
            className={`font-bold min-h-12 sm:flex-[2] text-lg disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'OPEN' ? 'btn-success' : 'btn-primary'
            }`}
          >
            {loading
              ? 'Saving…'
              : mode === 'OPEN'
              ? `Open Shift · ${formatCentsToNgn(amountCents)}`
              : needsManagerPin
              ? 'Approve & Close Shift'
              : 'Close Shift'}
          </button>
        </div>

        {errorMsg && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
            <div className="chip bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/30 shadow-glow px-5 py-3 !rounded-2xl">
              {errorMsg}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
