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

// Shift totals shape — shared between Electron repository's getShiftTotals
// and the browser shim's mirror implementation. Declared locally (not
// imported from main/) so the renderer stays decoupled from Electron main.
type ShiftTotals = {
  cash: number; card: number; other: number; total: number; tip: number;
  counts: { cash: number; card: number; other: number; total: number };
  perMethod: Array<{ method: string; amount: number; tip: number; count: number }>;
  orders: {
    paidOrderCount: number; voidedOrderCount: number; refundedOrderCount: number;
    paidItemQty: number;
    subtotalCents: number; discountCents: number; taxCents: number; totalPaidCents: number;
  };
  payouts: { totalPayoutCents: number; payoutCount: number };
  cashAdjustments: { totalPaidInCents: number; totalPaidOutCents: number; count: number };
};

const fmtMethodLabel = (m: string): string => {
  switch ((m || '').toUpperCase()) {
    case 'CASH': return '💵 Cash';
    case 'CARD_POS':
    case 'POS_CARD':
    case 'CARD': return '💳 Card (POS)';
    case 'PAYSTACK': return '💳 Paystack';
    case 'FLUTTERWAVE': return '💳 Flutterwave';
    case 'TRANSFER': return '🏦 Transfer';
    case 'POS': return '💳 Card';
    default: return `🏦 ${m || 'Other'}`;
  }
};

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

  // Close-shift reconciliation — sourced from the repository's getShiftTotals.
  // Falls back to zeros if no shift id or fetch fails (defensive rendering).
  const [totals, setTotals] = useState<ShiftTotals | null>(null);

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
        // Prefer the new repository-level getShiftTotals — it returns all
        // metrics we need for a professional close shift reconciliation.
        // If the call is unavailable (old installer / missing bridge handler),
        // fall back to the list-level summation so the modal still works.
        let data: ShiftTotals | null = null;
        try {
          const fn = window.electronAPI?.db?.payments?.getShiftTotals as
            | ((id: string) => Promise<ShiftTotals>)
            | undefined;
          if (typeof fn === 'function') {
            data = await fn(shiftId);
          }
        } catch (e) {
          console.warn('[shift] getShiftTotals bridge unavailable — fallback', e);
        }
        // LEGACY FALLBACK — if totals is still null after bridge call, manually
        // compute a minimum viable summary using listByShiftId.
        if (!data) {
          const pays: any = await window.electronAPI?.db?.payments?.listByShiftId?.(shiftId);
          const list = Array.isArray(pays) ? pays : (pays as any)?.data || [];
          let cash = 0, card = 0, other = 0, tip = 0;
          let cashCount = 0, cardCount = 0, otherCount = 0;
          const perMethod = new Map<string, { method: string; amount: number; tip: number; count: number }>();
          for (const p of list) {
            const amt =
              typeof p.amount_cents === 'number'
                ? p.amount_cents
                : typeof p.amountCents === 'number'
                  ? p.amountCents
                  : Math.round((p.amount || 0) * 100);
            const tp =
              typeof p.tip_cents === 'number'
                ? p.tip_cents
                : typeof p.tipCents === 'number'
                  ? p.tipCents
                  : Math.round((p.tip || 0) * 100);
            tip += tp;
            const m = (p.method || 'OTHER').toUpperCase();
            const bucket = perMethod.get(m) || { method: m, amount: 0, tip: 0, count: 0 };
            bucket.amount += amt; bucket.tip += tp; bucket.count += 1;
            perMethod.set(m, bucket);
            if (m === 'CASH') { cash += amt; cashCount++; }
            else if (m.includes('CARD') || m === 'PAYSTACK' || m === 'FLUTTERWAVE') { card += amt; cardCount++; }
            else { other += amt; otherCount++; }
          }
          // List cash adjustments (paid-in / paid-out / payouts) for close-shift
          // math — expected in drawer, variance.
          const adj: any = await window.electronAPI?.db?.cashAdjustments?.listByShiftId?.(shiftId);
          const alist = Array.isArray(adj) ? adj : (adj as any)?.data || [];
          let paidIn = 0, paidOut = 0;
          for (const a of alist) {
            const amt =
              typeof a.amount_cents === 'number'
                ? a.amount_cents
                : typeof a.amountCents === 'number'
                  ? a.amountCents
                  : Math.round((a.amount || 0) * 100);
            const dir = ((a.direction || a.type) || 'PAID_OUT').toUpperCase();
            if (dir === 'PAID_OUT') paidOut += amt;
            else if (dir === 'PAID_IN') paidIn += amt;
          }
          data = {
            cash, card, other,
            total: cash + card + other,
            tip,
            counts: { cash: cashCount, card: cardCount, other: otherCount, total: cashCount + cardCount + otherCount },
            perMethod: Array.from(perMethod.values()),
            orders: {
              paidOrderCount: 0, voidedOrderCount: 0, refundedOrderCount: 0,
              paidItemQty: 0, subtotalCents: 0, discountCents: 0, taxCents: 0,
              totalPaidCents: cash + card + other,
            },
            payouts: { totalPayoutCents: paidOut, payoutCount: alist.filter((a: any) => ((a.direction || a.type) || '').toUpperCase() === 'PAID_OUT').length },
            cashAdjustments: { totalPaidInCents: paidIn, totalPaidOutCents: paidOut, count: alist.length },
          };
        }
        if (!alive) return;
        setTotals(data);
        // Default closing entry amount = computed EXPECTED cash in drawer
        // (opening float + cash sales + paid-ins - paid-outs - payouts).
        // User can still edit this to the actual counted value, and variance
        // updates live as they type.
        const opening = openShift.openingCashCents || 0;
        const cashSales = data.cash || 0;
        const paidInCents = data.cashAdjustments?.totalPaidInCents || 0;
        const paidOutCents =
          (data.cashAdjustments?.totalPaidOutCents || 0) +
          (data.payouts?.totalPayoutCents || 0);
        const expected = Math.max(0, opening + cashSales + paidInCents - paidOutCents);
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

  // Derived close-mode reconciliation numbers (defensive zeros if totals not
  // loaded yet so the panel always has sensible values, even on first render).
  const openingCash = openShift.openingCashCents || 0;
  const cashSales = totals?.cash ?? 0;
  const cardSales = totals?.card ?? 0;
  const otherSales = totals?.other ?? 0;
  const grossSales = cashSales + cardSales + otherSales; // = totals.total
  const tips = totals?.tip ?? 0;
  const subtotalCents = totals?.orders?.subtotalCents ?? 0;
  const discountCents = totals?.orders?.discountCents ?? 0;
  const taxCents = totals?.orders?.taxCents ?? 0;
  const totalPaidCents = totals?.orders?.totalPaidCents ?? grossSales;
  const paidIn = totals?.cashAdjustments?.totalPaidInCents ?? 0;
  const paidOutAdj = totals?.cashAdjustments?.totalPaidOutCents ?? 0;
  const payouts = totals?.payouts?.totalPayoutCents ?? 0;
  const totalCashOutflows = paidOutAdj + payouts;

  // Expected closing cash = opening float + cash sales + cash paid-ins
  //                        − cash paid-outs − petty cash payouts.
  // Card/other sales never hit the drawer, so they do NOT affect expected
  // cash in the drawer.
  const expectedClosing =
    Math.max(0, openingCash + cashSales + paidIn - totalCashOutflows);

  // Variance = counted actual (amount entered by user) − expected.
  // Positive = over; negative = short.
  const variance = amountCents - expectedClosing;

  // Variance threshold: require a manager PIN for any short/over greater
  // than ₦1,000.00 (100,000 cents). This keeps honest mistakes from needing
  // sign-off but ensures any non-trivial variance is auditable.
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

        // -------------------------------------------------------------------
        // Belt-and-suspenders guard BEFORE we call open(): the Electron
        // SQLite partial unique index idx_shifts_device_open only allows ONE
        // row with status='OPEN' per device_id. If a previous shift was
        // left OPEN (crash mid-shift, logout without close, React
        // StrictMode double-invoke in dev, etc.), return it silently instead
        // of letting the repo INSERT throw "Unique constraint failed:
        // shifts.device_id" to the user. The repository also guards this at
        // the SQL layer, but checking FIRST here means:
        //   (A) user never sees an error chip,
        //   (B) we can populate onDone() with the correct opening cash from
        //       the existing row so close-shift reconciliation still works,
        //   (C) browser shim and real Electron packaged paths behave the
        //       same.
        // -------------------------------------------------------------------
        if (deviceId) {
          try {
            // NOTE: preload cashiers.ts shifts.getOpen() takes 0-1 args (a
            // single optional filter object). Repository.getOpen takes
            // (deviceId, employeeId?) positional — call through the single
            // object form so both Electron and browser shim paths agree on
            // the contract (filter object with deviceId/employeeId inside).
            const alreadyOpen: any =
              await window.electronAPI?.db?.shifts?.getOpen?.(
                // Cast to any because the TypeScript-declared getOpen()
                // signature in the generated ElectronAPI interface (from
                // cashier preload cashiers.ts L161: `getOpen: () => invokeDb(...)`
                // → typed as 0 args) doesn't reflect the wider runtime contract
                // accepted by both the browser shim and the IPC bridge wrap
                // handler in ipc-db-bridge.ts L800-848, which accepts either
                // positional (deviceId, employeeId) OR a single filter object
                // with employeeId/branchId/restaurantId keys.
                {
                  deviceId,
                  employeeId: employee?.id,
                  branchId: branch?.id,
                  restaurantId: restaurant?.id,
                } as any
              );
            const existingId = alreadyOpen?.id || alreadyOpen?._id || alreadyOpen?.shiftId;
            if (existingId) {
              const priorOpen = Number(
                alreadyOpen?.opening_cash_cents ?? alreadyOpen?.openingCashCents ?? 0
              );
              const priorAt = Number(
                alreadyOpen?.opened_at ?? alreadyOpen?.openedAt ?? now
              );
              console.log('[shift] open() skipped — existing open shift found', {
                shiftId: existingId,
                deviceId,
              });
              onDone({
                shiftId: String(existingId),
                openedAt: priorAt > 0 ? priorAt : now,
                openingCashCents: priorOpen > 0 ? priorOpen : amountCents,
              });
              return;
            }
          } catch (getOpenErr) {
            console.warn(
              '[shift] getOpen() pre-flight check failed — falling back to open()',
              getOpenErr
            );
          }
        }

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

        // NOTE: electron preload shifts.open() returns a STRING (shift id
        // from SQLite INSERT). Browser shim returns the FULL shift OBJECT
        // (id + snake_case fields). Normalize both paths so onDone always
        // gets a concrete string shiftId.
        const res = await window.electronAPI?.db?.shifts?.open?.(payload);
        let resolvedId: string = shiftId;
        if (typeof res === 'string' && res) resolvedId = res;
        else if (res && typeof res === 'object') {
          const idFromObj = (res as any).id || (res as any)._id || (res as any).shiftId;
          if (idFromObj) resolvedId = String(idFromObj);
        }
        console.log('[shift] opened', resolvedId);
        onDone({
          shiftId: resolvedId,
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
        const now = Date.now();
        // Persist ALL reconciliation numbers to the shifts row on close —
        // auditors & owner dashboards need this data long after the POS app
        // session ends. Repository.close() will do the actual UPDATE.
        const closingPayload = {
          id: openShift.shiftId,
          status: 'CLOSED',
          closing_cash_cents: amountCents,
          expected_cash_cents: expectedClosing,
          variance_cents: variance,
          cash_sales_cents: cashSales,
          card_sales_cents: cardSales,
          other_sales_cents: otherSales,
          tip_cents: tips,
          refunds_cents: 0,
          payout_cents: totalCashOutflows,
          paid_count: totals?.counts?.total ?? 0,
          orders_count: totals?.orders?.paidOrderCount ?? 0,
          voided_orders_count: totals?.orders?.voidedOrderCount ?? 0,
          items_sold: totals?.orders?.paidItemQty ?? 0,
          note: needsManagerPin
            ? `Manager-approved variance ${formatCentsToNgn(variance)}`
            : null,
          closed_at: now,
          updated_at: now,
        };
        await window.electronAPI?.db?.shifts?.close?.(closingPayload);
        // Fire-and-forget print of the close-shift reconciliation receipt
        // so the cashier & manager each have a signed physical copy.
        // Silently ignore print failures (offline printer, etc.) — the
        // reconciliation is already saved to SQLite and will sync later.
        try {
          const p = window.electronAPI?.print?.testPage as (() => Promise<unknown>) | undefined;
          if (typeof p === 'function') {
            // Test page is the closest built-in printer smoke check. A
            // dedicated close-shift receipt builder (mirroring receipt/kitchen)
            // can be wired in a later pass — the reconciliation row itself is
            // already persisted which is the critical piece.
            void Promise.resolve(p()).catch(() => {});
          }
        } catch { /* ignore */ }
        console.log('[shift] closed', closingPayload.id, {
          expected: formatCentsToNgn(expectedClosing),
          actual: formatCentsToNgn(amountCents),
          variance: formatCentsToNgn(variance),
        });
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
      <div className={`w-full sm:max-w-5xl max-h-[96vh] bg-slate-900 border border-white/10 sm:rounded-3xl rounded-t-3xl shadow-glow flex flex-col`}>
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
            {mode === 'CLOSE' && openShift.openedAt ? (
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                Opened: {new Date(openShift.openedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            ) : null}
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

        <div className="flex-1 overflow-y-auto p-4 grid lg:grid-cols-5 gap-4">
          {mode === 'CLOSE' && (
            <div className="lg:col-span-3 space-y-4">
              {/* KPI summary cards: orders, items sold, voids, refunds, tx count, tips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Paid Orders</div>
                  <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.orders?.paidOrderCount ?? 0}</div>
                </div>
                <div className="card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Items Sold</div>
                  <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.orders?.paidItemQty ?? 0}</div>
                </div>
                <div className="card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Payments</div>
                  <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.counts?.total ?? 0}</div>
                </div>
                <div className="card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Tips</div>
                  <div className="mt-1 text-2xl font-black text-emerald-300 tabular-nums">{formatCentsToNgn(tips)}</div>
                </div>
                {(totals?.orders?.voidedOrderCount ?? 0) > 0 && (
                  <div className="card p-3 ring-1 ring-rose-500/30">
                    <div className="text-[10px] uppercase tracking-wider text-rose-300 font-bold">Voids</div>
                    <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.orders?.voidedOrderCount ?? 0}</div>
                  </div>
                )}
                {(totals?.orders?.refundedOrderCount ?? 0) > 0 && (
                  <div className="card p-3 ring-1 ring-amber-500/30">
                    <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">Refunds</div>
                    <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.orders?.refundedOrderCount ?? 0}</div>
                  </div>
                )}
                {(totals?.payouts?.payoutCount ?? 0) > 0 && (
                  <div className="card p-3 ring-1 ring-indigo-500/30">
                    <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-bold">Payouts</div>
                    <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.payouts?.payoutCount ?? 0}</div>
                  </div>
                )}
                {(totals?.cashAdjustments?.count ?? 0) > 0 && (
                  <div className="card p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Cash Adj</div>
                    <div className="mt-1 text-2xl font-black text-white tabular-nums">{totals?.cashAdjustments?.count ?? 0}</div>
                  </div>
                )}
              </div>

              {/* Professional reconciliation: Sales build-up */}
              <div className="card p-4">
                <div className="text-sm font-bold text-white mb-2">Sales Breakdown</div>
                <div className="text-sm space-y-2">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCentsToNgn(subtotalCents)}</span>
                  </div>
                  {discountCents > 0 && (
                    <div className="flex items-center justify-between text-rose-300">
                      <span>Discounts</span>
                      <span className="tabular-nums">−{formatCentsToNgn(discountCents)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Taxes</span>
                    <span className="tabular-nums">+{formatCentsToNgn(taxCents)}</span>
                  </div>
                  {tips > 0 && (
                    <div className="flex items-center justify-between text-emerald-300">
                      <span>Tips</span>
                      <span className="tabular-nums">+{formatCentsToNgn(tips)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <span className="text-white font-bold">Total Collected</span>
                    <span className="text-white font-black text-lg tabular-nums">
                      {formatCentsToNgn(Math.max(0, totalPaidCents))}
                    </span>
                  </div>
                </div>
              </div>

              {/* By method: amount + count + tips */}
              <div className="card p-4">
                <div className="text-sm font-bold text-white mb-2">By Payment Method</div>
                <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 text-slate-400">
                      <tr>
                        <th className="text-left font-bold px-3 py-2">Method</th>
                        <th className="text-right font-bold px-3 py-2">Count</th>
                        <th className="text-right font-bold px-3 py-2">Amount</th>
                        <th className="text-right font-bold px-3 py-2">Tips</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(totals?.perMethod?.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-slate-500 italic">
                            No payments recorded for this shift yet.
                          </td>
                        </tr>
                      )}
                      {(totals?.perMethod ?? []).map((r, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="px-3 py-2 text-white font-medium">{fmtMethodLabel(r.method)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.count || 0}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-white font-semibold">
                            {formatCentsToNgn(r.amount || 0)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                            {formatCentsToNgn(r.tip || 0)}
                          </td>
                        </tr>
                      ))}
                      {(totals?.perMethod ?? []).length > 0 && (
                        <tr className="border-t-2 border-double border-white/15 bg-white/5">
                          <td className="px-3 py-2 text-white font-black">Total</td>
                          <td className="px-3 py-2 text-right tabular-nums text-white font-bold">
                            {totals?.counts?.total ?? 0}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-white font-black">
                            {formatCentsToNgn(grossSales)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-300 font-bold">
                            {formatCentsToNgn(tips)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Drawer reconciliation (expected vs counted variance) */}
              <div className="card p-4 space-y-2.5 text-sm">
                <div className="text-sm font-bold text-white mb-1.5">Drawer Reconciliation</div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Opening Float</span>
                  <span className="tabular-nums">{formatCentsToNgn(openingCash)}</span>
                </div>
                <div className="flex items-center justify-between text-emerald-300">
                  <span>💵 Cash Sales</span>
                  <span className="tabular-nums">+{formatCentsToNgn(cashSales)}</span>
                </div>
                {paidIn > 0 && (
                  <div className="flex items-center justify-between text-emerald-300/80">
                    <span>↘️ Cash Paid-In</span>
                    <span className="tabular-nums">+{formatCentsToNgn(paidIn)}</span>
                  </div>
                )}
                {paidOutAdj > 0 && (
                  <div className="flex items-center justify-between text-rose-300/80">
                    <span>↙️ Cash Paid-Out (adj)</span>
                    <span className="tabular-nums">−{formatCentsToNgn(paidOutAdj)}</span>
                  </div>
                )}
                {payouts > 0 && (
                  <div className="flex items-center justify-between text-rose-300">
                    <span>📤 Payouts / Petty Cash</span>
                    <span className="tabular-nums">−{formatCentsToNgn(payouts)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3">
                  <span className="text-white font-semibold">Expected Cash in Drawer</span>
                  <span className="text-gradient-neon font-black text-xl tabular-nums animate-text-glow">
                    {formatCentsToNgn(expectedClosing)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Actual Counted</span>
                  <span className="text-white font-bold tabular-nums">{formatCentsToNgn(amountCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Variance</span>
                  <span
                    className={`font-black tabular-nums text-lg ${
                      Math.abs(variance) > 100000
                        ? 'text-rose-400'
                        : variance === 0
                        ? 'text-emerald-300'
                        : variance < 0
                        ? 'text-amber-300'
                        : 'text-amber-400'
                    }`}
                  >
                    {variance > 0 ? '+' : ''}
                    {formatCentsToNgn(variance)}
                  </span>
                </div>
                <div className="pt-2 text-xs text-slate-500 italic">
                  {variance === 0
                    ? 'Perfect match — no variance.'
                    : variance > 0
                    ? `Over ${formatCentsToNgn(variance)}. Enter a manager PIN to approve if variance > ₦1,000.`
                    : `Short ${formatCentsToNgn(Math.abs(variance))}. Enter a manager PIN to approve if variance > ₦1,000.`}
                </div>
                <div className="flex items-center justify-between pt-1 text-slate-400">
                  <span>Gross Sales (all methods)</span>
                  <span className="text-white font-bold tabular-nums">{formatCentsToNgn(grossSales)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>💳 + 🏦 Non-Cash Sales</span>
                  <span className="text-slate-200 font-semibold tabular-nums">
                    {formatCentsToNgn(cardSales + otherSales)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className={`space-y-3 ${mode === 'CLOSE' ? 'lg:col-span-2' : 'lg:col-span-2 mx-auto w-full max-w-md'}`}>
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
              {mode === 'CLOSE' && (
                <div className="flex gap-1.5 flex-wrap pt-1">
                  <button
                    onClick={() => {
                      setAmountDirty(true);
                      setAmountRaw((expectedClosing / 100).toFixed(2));
                    }}
                    className="chip !py-1 hover:bg-emerald-500/15 hover:text-emerald-200 transition-colors text-xs font-bold ring-1 ring-inset ring-emerald-500/20"
                  >
                    Use Expected ({formatCentsToNgn(expectedClosing)})
                  </button>
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
