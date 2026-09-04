// ==============================================================
// ReportsPanel — 100% OFFLINE, aggregated from the POS terminal's
// local SQLite payments/orders tables via the new
// `window.electronAPI.db.reports.periodSales()` and
// `.availableYears()` endpoints. Zero network calls, zero JWT
// dependency, works indefinitely while offline.
//
// Period resolution:  DAY · WEEK · MONTH · YEAR
// Previous-year navigation via dropdown (years available from
// distinct strftime('%Y') on completed payments — any year a
// payment was recorded on this device shows up automatically).
//
// Drill selectors:
//   DAY    -> HTML5 date picker for any single day (today default)
//   WEEK   -> HTML5 week picker (ISO 8601 week, Monday start)
//   MONTH  -> Year dropdown + 12-month dropdown
//   YEAR   -> Year dropdown, 12 monthly buckets
//
// Cross-tab UX: on reconnect, the existing sync/push/pull cycle
// also populates more history into payments/orders on the SQLite
// side via sync cloud-pull-worker → so availableYears will include
// server-side prior-year payments/orders automatically within one
// 30-second pull cycle after first online sync from fresh install.
// ==============================================================

import { useEffect, useMemo, useState } from 'react';
import { formatCentsToNgn } from '../../lib/ui-helpers';
import type { OpenShiftState } from '../../lib/types';

type ReportPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

interface PeriodBucket {
  key: string; label: string; startTs: number; endTs: number;
  netCents: number; grossCents: number; tipCents: number;
  paymentCount: number; ordersCount: number;
}
interface MethodSplit { method: string; netCents: number; tipCents: number; count: number; }
interface TopItem { menuItemId: string | null; name: string | null; qty: number; revenueCents: number; }
interface PeriodReport {
  period: ReportPeriod;
  scope: { year?: number; month?: number; weekStartTs?: number; dayTs?: number; branchId?: string | null; restaurantId?: string | null; };
  totals: { netCents: number; grossCents: number; tipCents: number; paymentCount: number; ordersCount: number; refundCents: number; payoutCents: number; };
  comparePrevPeriod: { netDeltaCents: number; orderDelta: number; pct: number; samePeriodLabel: string; } | null;
  buckets: PeriodBucket[];
  methodSplit: MethodSplit[];
  topItems: TopItem[];
  availableYears: number[];
}

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export default function ReportsPanel({ employee, shift }: { orders?: any[]; employee: any; shift: OpenShiftState }) {
  // ---------- Drill selectors (local state, independent per tab) ----------
  const today = new Date();
  const [period, setPeriod] = useState<ReportPeriod>('DAY');
  const [availableYears, setAvailableYears] = useState<number[]>([today.getFullYear()]);
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  // MONTH mode: 1..12
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1);
  // WEEK mode: ISO Monday 00:00 start of the week containing "now"
  const startOfThisWeek = ((): number => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun .. 6=Sat; ISO Mon=1..Sun=7
    const diffToMon = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMon);
    return d.getTime();
  })();
  const [weekStartTs, setWeekStartTs] = useState<number>(startOfThisWeek);
  // DAY mode: local 00:00 of selected calendar day
  const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const [dayTs, setDayTs] = useState<number>(startOfToday);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PeriodReport | null>(null);

  const scopeBranchId = employee?.branchId || employee?.branch?.id || null;
  const scopeRestaurantId = employee?.restaurantId || employee?.restaurant?.id || null;

  // ---------- Load available years (distinct YYYY from payments.completed_at) ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const yearsResult = await (window as any).electronAPI?.db?.reports?.availableYears?.({
          branchId: scopeBranchId,
          restaurantId: scopeRestaurantId,
        });
        if (!alive) return;
        // Unwrap IPC success envelope if present
        const years: number[] = yearsResult && typeof yearsResult === 'object' && 'success' in yearsResult
          ? (yearsResult as any).success ? ((yearsResult as any).result || []) : []
          : Array.isArray(yearsResult) ? yearsResult : [];
        const yearsArr = Array.isArray(years) && years.length ? years : [today.getFullYear()];
        setAvailableYears(yearsArr);
        if (!yearsArr.includes(selectedYear) && yearsArr.length > 0) {
          setSelectedYear(yearsArr[0]);
        }
      } catch {
        // Non-fatal: fallback keeps current year in dropdown so user
        // can at least see 2026 reports on a fresh install with
        // no payments history yet written to SQLite.
      }
    })();
    return () => { alive = false; };
  }, [scopeBranchId, scopeRestaurantId, selectedYear]);

  // ---------- Fetch PeriodReport whenever any drill input changes ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const opts = {
          period,
          year: selectedYear,
          month: period === 'MONTH' ? selectedMonth : undefined,
          weekStartTs: period === 'WEEK' ? weekStartTs : undefined,
          dayTs: period === 'DAY' ? dayTs : undefined,
          branchId: scopeBranchId,
          restaurantId: scopeRestaurantId,
        };
        const r = await (window as any).electronAPI?.db?.reports?.periodSales?.(opts);
        if (!alive) return;
        const unwrapped: PeriodReport | null = r && typeof r === 'object' && 'success' in r
          ? (r as any).success ? ((r as any).result || null) : (() => { throw new Error((r as any).error || 'Reports query failed.'); })()
          : (r || null);
        setReport(unwrapped);
      } catch (e: any) {
        if (!alive) return;
        console.warn('[reports] periodSales failed', e);
        setError(e?.message || 'Unable to load offline report data.');
        setReport(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [period, selectedYear, selectedMonth, weekStartTs, dayTs, scopeBranchId, scopeRestaurantId]);

  const totals = report?.totals;
  const buckets = report?.buckets || [];
  const methodSplit = report?.methodSplit || [];
  const topItems = report?.topItems || [];
  const compare = report?.comparePrevPeriod;

  const revenueCents = totals?.netCents ?? 0;
  const ordersCount = totals?.ordersCount ?? 0;
  const avgCents = ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0;
  const tipCents = totals?.tipCents ?? 0;

  const cards = [
    { label: 'Revenue', value: formatCentsToNgn(revenueCents), sub: totals ? `${totals.paymentCount || 0} payments` : '—', icon: '💰', tint: 'from-[#FFD700]/30', delta: compare },
    { label: 'Orders', value: ordersCount.toString(), sub: 'Unique paid orders', icon: '📦', tint: 'from-[#CD7F32]/30' },
    { label: 'Avg Order', value: formatCentsToNgn(avgCents), sub: revenueCents > 0 ? 'Revenue ÷ paid orders' : 'No paid orders', icon: '📊', tint: 'from-[#EA580C]/28' },
    { label: 'Tips', value: formatCentsToNgn(tipCents), sub: totals?.paymentCount ? 'Across all payments' : '—', icon: '💵', tint: 'from-[#22D3EE]/26' },
  ];

  // ---------- Human-readable period header string ----------
  const periodLabel = useMemo(() => {
    if (period === 'DAY') {
      return new Date(dayTs).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (period === 'WEEK') {
      const s = new Date(weekStartTs);
      const e = new Date(weekStartTs + 6 * 86_400_000);
      return `Week of ${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (period === 'MONTH') {
      const d = new Date(selectedYear, selectedMonth - 1, 1);
      return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    return `${selectedYear}`;
  }, [period, dayTs, weekStartTs, selectedMonth, selectedYear]);

  // ---------- Bar chart: period-resolution SVG-sized bars ----------
  function BarChart({ data }: { data: PeriodBucket[] }) {
    if (!data || data.length === 0) return (
      <div className="h-60 flex items-center justify-center text-ink-300 text-sm font-bold">
        No data for this period yet. Charge orders — results are saved locally on this device.
      </div>
    );
    const max = Math.max(100, ...data.map((b) => b.netCents));
    return (
      <div className="relative">
        <div
          className="grid items-end gap-2"
          style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, height: 240 }}
        >
          {data.map((b) => {
            const hPct = Math.max(4, Math.round((b.netCents / max) * 100));
            return (
              <div key={b.key} className="group flex flex-col items-center justify-end h-full gap-2 relative min-w-0">
                <div
                  title={`${b.label} · ${formatCentsToNgn(b.netCents)} · ${b.ordersCount || 0} orders`}
                  className="w-full max-w-[48px] mx-auto rounded-t-2xl rounded-b-lg shadow-inner transition-all group-hover:-translate-y-0.5"
                  style={{
                    height: `${hPct}%`,
                    background: 'linear-gradient(180deg, rgba(255,215,0,0.95) 0%, rgba(205,127,50,0.85) 55%, rgba(234,88,12,0.65) 100%)',
                    boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.25), inset 0 -4px 0 rgba(0,0,0,0.25), 0 8px 24px -12px rgba(255,180,0,0.5)',
                  }}
                />
                <div className="text-[10px] text-ink-300 font-black uppercase tracking-widest truncate w-full text-center leading-tight">
                  {b.label}
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute left-0 -top-1 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.16em] font-black text-amber-400/80">
            Peak: {formatCentsToNgn(max)}
          </span>
        </div>
      </div>
    );
  }

  // ---------- Period vs previous-period delta badge ----------
  const DeltaBadge = ({ pct, netCents, prefix = '' }: { pct: number | null | undefined; netCents: number; prefix?: string }) => {
    if (pct == null || !isFinite(pct)) return null;
    const up = pct > 0;
    const flat = pct === 0;
    return (
      <span className={`inline-flex items-center gap-1 chip !py-1 !px-2.5 !text-[11px] !font-black uppercase tracking-widest !ring-inset ${flat ? '!ring-white/10 !bg-white/5 !text-ink-200' : up ? '!ring-emerald-400/30 !bg-emerald-500/10 !text-emerald-300' : '!ring-rose-400/30 !bg-rose-500/10 !text-rose-300'}`}>
        {flat ? '▬' : up ? '▲' : '▼'} {prefix} {Math.abs(Math.round(pct * 10) / 10)}% · {formatCentsToNgn(Math.abs(netCents))}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Header / controls row */}
      <div className="p-6 pb-4 border-b border-white/5 bg-slate-900/30 backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">100% Offline · Local SQLite</div>
            <h2 className="text-3xl font-black mt-1">
              <span className="text-gradient-neon animate-text-glow">Reports</span>
              <span className="text-white"> · {periodLabel}</span>
            </h2>
            <div className="mt-2 text-sm text-ink-300 font-semibold">
              Cashier: <span className="text-white font-bold">{employee?.firstName || employee?.name || '—'} {employee?.lastName || ''}</span>
              <span className="dot-separator mx-2.5 align-middle" />
              Branch: <span className="text-white font-bold">{employee?.branch?.name || employee?.branchName || 'All device history'}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 justify-end">
            {/* Period pill selector */}
            <div className="inline-flex rounded-2xl p-1 bg-white/5 ring-1 ring-inset ring-white/10">
              {(['DAY', 'WEEK', 'MONTH', 'YEAR'] as ReportPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 text-xs font-black uppercase tracking-[0.14em] rounded-xl transition-all ${period === p ? 'bg-gradient-neon text-slate-950 shadow-glow-restaurant scale-[1.02]' : 'text-ink-200 hover:text-white hover:bg-white/5'}`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Year dropdown (WEEK/MONTH/YEAR modes) */}
            {period !== 'DAY' && (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="chip !py-2.5 !px-4 !text-xs !font-black uppercase tracking-widest !bg-slate-900/70 text-amber-300 cursor-pointer"
                title="Previous years preserved from local payment history"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}

            {/* Month dropdown for MONTH mode */}
            {period === 'MONTH' && (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="chip !py-2.5 !px-4 !text-xs !font-black uppercase tracking-widest !bg-slate-900/70 text-amber-300 cursor-pointer"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                  const label = new Date(selectedYear, m - 1, 1).toLocaleString(undefined, { month: 'long' });
                  return <option key={m} value={m}>{label}</option>;
                })}
              </select>
            )}

            {/* Week picker for WEEK mode */}
            {period === 'WEEK' && (
              <input
                type="week"
                value={(function isoWeekString() {
                  const d = new Date(weekStartTs);
                  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                  const dayNum = target.getUTCDay() || 7;
                  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
                  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
                  const wk = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
                  return `${target.getUTCFullYear()}-W${pad2(wk)}`;
                })()}
                onChange={(e) => {
                  const match = /^(\d{4})-W(\d{1,2})$/.exec(e.target.value);
                  if (!match) return;
                  const [, yStr, wStr] = match;
                  const y = parseInt(yStr, 10);
                  const w = parseInt(wStr, 10);
                  // ISO 8601 week -> Monday of that week (UTC, then cast to local ts)
                  const jan4 = new Date(Date.UTC(y, 0, 4));
                  const jan4Dow = jan4.getUTCDay() || 7; // Mon=1..Sun=7
                  const mondayOfWeek1 = new Date(jan4);
                  mondayOfWeek1.setUTCDate(jan4.getUTCDate() + 1 - jan4Dow);
                  const target = new Date(mondayOfWeek1);
                  target.setUTCDate(mondayOfWeek1.getUTCDate() + (w - 1) * 7);
                  setWeekStartTs(target.getTime());
                }}
                className="chip !py-2.5 !px-4 !text-xs !font-black uppercase tracking-widest !bg-slate-900/70 text-amber-300 cursor-pointer"
                title="Pick any week — including prior years from the year dropdown."
              />
            )}

            {/* HTML5 date picker for DAY mode */}
            {period === 'DAY' && (
              <input
                type="date"
                value={(function ymd() {
                  const d = new Date(dayTs);
                  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
                })()}
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
                  setDayTs(dt.getTime());
                }}
                className="chip !py-2.5 !px-4 !text-xs !font-black uppercase tracking-widest !bg-slate-900/70 text-amber-300 cursor-pointer"
                title="Any past or future calendar date from this device's local payment history."
              />
            )}

            {shift.shiftId && (
              <div className="chip-neon !py-2 !px-4 !text-xs !font-black uppercase tracking-[0.14em]">
                🕒 {shift.openedAt ? new Date(shift.openedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Shift open'} · ₦{((shift.openingCashCents || 0) / 100).toFixed(0)} opening
              </div>
            )}
          </div>
        </div>

        {/* Compare-vs-previous banner row */}
        {compare && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] font-black text-ink-300">
              vs {compare.samePeriodLabel}
            </span>
            <DeltaBadge pct={compare.pct} netCents={compare.netDeltaCents} prefix="Revenue" />
            <span className={`text-xs font-bold ${compare.orderDelta > 0 ? 'text-emerald-300' : compare.orderDelta < 0 ? 'text-rose-300' : 'text-ink-200'}`}>
              {compare.orderDelta > 0 ? '+' : ''}{compare.orderDelta} orders
            </span>
            {error && <span className="text-xs font-bold text-rose-300 ml-auto">{error}</span>}
          </div>
        )}
      </div>

      {/* Content body */}
      <div className="p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div key={c.label} className="card-glow card neon-border p-5 relative overflow-hidden group">
              <div className={`absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl opacity-60 bg-gradient-to-br ${c.tint} to-transparent group-hover:opacity-90 transition-opacity`} />
              <div className="flex items-start justify-between mb-4 relative">
                <div className="text-[11px] uppercase tracking-[0.18em] font-black text-ink-300">{c.label}</div>
                <div
                  className="h-11 w-11 rounded-2xl shadow-glow-restaurant flex items-center justify-center text-xl animate-float-slow ring-1 ring-inset ring-white/15"
                  style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.20) 0%, rgba(205,127,50,0.15) 100%)' }}
                >
                  {c.icon}
                </div>
              </div>
              <div className="text-3xl font-black text-white leading-none mb-2 relative tabular-nums">
                {loading ? (
                  <span className="inline-block w-24 h-7 rounded-xl bg-white/5 animate-pulse" />
                ) : c.value}
              </div>
              <div className="text-xs text-ink-300 font-bold relative">
                {loading ? 'Loading local history…' : c.sub}
              </div>
              {i === 0 && c.delta && !loading && (
                <div className="mt-3 relative">
                  <DeltaBadge pct={c.delta.pct} netCents={c.delta.netDeltaCents} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Refunds / Payouts tertiary KPIs */}
        {totals && (totals.refundCents > 0 || totals.payoutCents > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4 ring-1 ring-inset ring-rose-500/15 bg-rose-500/5">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-rose-300/80">Refunds</div>
              <div className="text-2xl font-black text-white tabular-nums mt-1">{formatCentsToNgn(totals.refundCents)}</div>
            </div>
            <div className="card p-4 ring-1 ring-inset ring-orange-500/20 bg-orange-500/5">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-orange-300/80">Payouts (Cash Out)</div>
              <div className="text-2xl font-black text-white tabular-nums mt-1">{formatCentsToNgn(totals.payoutCents)}</div>
            </div>
          </div>
        )}

        {/* Trends bar chart by period resolution */}
        <div className="card-glow card p-6 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-neon" />
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Sales Trend</div>
              <h3 className="text-xl font-black text-white mt-1">
                {period === 'DAY' ? '24 Hour Snapshot' : period === 'WEEK' ? '7 Day Breakdown' : period === 'MONTH' ? 'Daily Breakdown' : '12 Monthly Buckets'}
              </h3>
            </div>
            <div className="text-xs text-ink-300 font-bold">
              {loading ? 'Loading…' : `${buckets.length} ${period === 'YEAR' ? 'months' : period === 'DAY' ? 'hours' : 'days'} from local SQLite`}
            </div>
          </div>
          {loading ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(24, buckets.length || 12)}, 1fr)`, height: 240 }}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="w-full rounded-t-2xl rounded-b-lg bg-white/5 animate-pulse"
                  style={{ height: `${10 + (i % 5) * 12}%` }}
                />
              ))}
            </div>
          ) : (
            <BarChart data={buckets} />
          )}
        </div>

        {/* 2-col: Top Items + Method Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card-glow card p-6 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-neon" />
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Performance</div>
                <h3 className="text-xl font-black text-white mt-1">🏆 Top Selling Items</h3>
              </div>
              <div className="chip !py-1 !px-3 !text-xs !font-bold uppercase tracking-widest text-amber-300 !ring-amber-400/30 !bg-amber-500/10">
                Top {Math.min(10, topItems.length)}
              </div>
            </div>
            {topItems.length === 0 ? (
              <div className="text-center py-12 text-ink-300 font-bold">
                No sales for this period yet. Charge orders in the Menu tab — everything is saved locally on device.
              </div>
            ) : (
              <div className="space-y-3">
                {topItems.map((it, i) => {
                  const max = topItems[0]?.revenueCents || 1;
                  const pct = Math.max(4, Math.round((it.revenueCents / max) * 100));
                  return (
                    <div key={i} className="relative">
                      <div
                        className="absolute inset-y-0 left-0 rounded-2xl bg-gradient-to-r from-[#FFD700]/15 to-transparent -z-0"
                        style={{ width: `${pct}%` }}
                      />
                      <div className="flex items-center justify-between text-sm mb-2 relative z-10 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="h-8 w-8 rounded-xl flex items-center justify-center text-xs font-black text-slate-950 shadow-glow-restaurant shrink-0"
                            style={{
                              background:
                                i === 0
                                  ? 'linear-gradient(135deg, #FFD700, #D4AF37)'
                                  : i === 1
                                    ? 'linear-gradient(135deg, #CD7F32, #EA580C)'
                                    : 'linear-gradient(135deg, rgba(212,175,55,0.6), rgba(205,127,50,0.6))',
                            }}
                          >
                            {i + 1}
                          </span>
                          <div className="font-bold text-white truncate">
                            {it.name || `Item ${it.menuItemId || '—'}`}
                          </div>
                        </div>
                        <div className="text-ink-200 font-bold tabular-nums shrink-0 ml-3 flex items-center gap-3">
                          <span className="chip-neon !py-0.5 !px-2.5 !text-[11px]">
                            {it.qty} sold
                          </span>
                          <span className="text-amber-300">
                            {formatCentsToNgn(it.revenueCents)}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 ring-1 ring-inset ring-white/10 overflow-hidden relative z-10">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #FFD700, #EA580C)',
                            boxShadow: '0 0 10px -2px rgba(255,180,0,0.5)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment method mix */}
          <div className="card-glow card p-6 relative overflow-hidden">
            <div
              className="absolute inset-x-0 top-0 h-1"
              style={{ background: 'linear-gradient(90deg, #22D3EE, #CD7F32, #FFD700)' }}
            />
            <div className="mb-5">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Sales Mix</div>
              <h3 className="text-xl font-black text-white mt-1">💳 By Payment Method</h3>
            </div>
            {methodSplit.length === 0 ? (
              <div className="text-center py-10 text-ink-300 font-bold text-sm">
                No payments recorded for this period.
              </div>
            ) : (
              (() => {
                const total = Math.max(1, methodSplit.reduce((s, m) => s + (m.netCents || 0), 0));
                return (
                  <div className="space-y-4">
                    {methodSplit.map((m) => {
                      const pct = Math.round((m.netCents / total) * 100);
                      const key = (m.method || 'OTHER').replace(/_/g, ' ');
                      const isCash = /CASH/i.test(key);
                      const isCard = /CARD|POS[_ ]?TRANSFER|TRANSFER/i.test(key);
                      return (
                        <div key={m.method || 'UNKNOWN'}>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <div className="font-black text-white uppercase tracking-wider">{key}</div>
                            <div className="font-bold text-ink-200 tabular-nums">
                              <span className="text-amber-300 mr-2">{formatCentsToNgn(m.netCents)}</span>
                              · {m.count} tx · {pct}%
                            </div>
                          </div>
                          <div className="h-3 rounded-full bg-white/5 ring-1 ring-inset ring-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background: `linear-gradient(90deg, ${isCash ? '#FFD700, #D4AF37' : isCard ? '#22D3EE, #60A5FA' : '#CD7F32, #F97316'})`,
                                boxShadow: '0 0 10px -2px rgba(255,255,255,0.35)',
                              }}
                            />
                          </div>
                          {m.tipCents > 0 && (
                            <div className="text-[11px] text-ink-300 font-bold mt-0.5">
                              Tips {formatCentsToNgn(m.tipCents)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {/* Active shift context + offline explanation banner */}
        {shift.shiftId && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-6 ring-1 ring-inset ring-white/10">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-ink-300 mb-3">Active Shift</div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-black text-ink-300 uppercase tracking-widest">Opened</div>
                  <div className="text-white font-black text-lg tabular-nums">
                    {shift.openedAt
                      ? new Date(shift.openedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black text-ink-300 uppercase tracking-widest">Opening Float</div>
                  <div className="text-gradient-neon font-black text-2xl tabular-nums">
                    {formatCentsToNgn(shift.openingCashCents || 0)}
                  </div>
                </div>
              </div>
            </div>
            <div className="card p-6 ring-1 ring-inset ring-amber-400/20 bg-amber-500/5">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-300/80 mb-3">Offline-first Guarantee</div>
              <div className="flex items-center gap-3 text-sm text-ink-200 font-bold leading-relaxed">
                <span
                  className="h-10 w-10 rounded-2xl flex items-center justify-center text-lg shadow-glow-restaurant shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.25), rgba(205,127,50,0.2))' }}
                >
                  🛰️
                </span>
                <div>
                  All KPIs above are computed from this terminal&apos;s local SQLite database.
                  When the device reconnects to the internet, any queued shifts/orders/payments/menu
                  edits automatically synchronize to the Admin portal &amp; public website in the
                  background — zero cashier action required.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
