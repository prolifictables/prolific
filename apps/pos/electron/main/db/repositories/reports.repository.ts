import type { PosDatabase } from '../database';

export type ReportPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface PeriodBucket {
  key: string;
  label: string;
  startTs: number;
  endTs: number;
  netCents: number;
  grossCents: number;
  tipCents: number;
  paymentCount: number;
  ordersCount: number;
}

export interface MethodSplit {
  method: string;
  netCents: number;
  tipCents: number;
  count: number;
}

export interface TopItem {
  menuItemId: string | null;
  name: string | null;
  qty: number;
  revenueCents: number;
}

export interface PeriodReport {
  period: ReportPeriod;
  scope: {
    year?: number;
    month?: number;
    weekStartTs?: number;
    dayTs?: number;
    branchId?: string | null;
    restaurantId?: string | null;
  };
  totals: {
    netCents: number;
    grossCents: number;
    tipCents: number;
    paymentCount: number;
    ordersCount: number;
    refundCents: number;
    payoutCents: number;
  };
  comparePrevPeriod: {
    netDeltaCents: number;
    orderDelta: number;
    pct: number;
    samePeriodLabel: string;
  } | null;
  buckets: PeriodBucket[];
  methodSplit: MethodSplit[];
  topItems: TopItem[];
  availableYears: number[];
}

const PAID_PAYMENT_STATUS = "('SUCCESS','COMPLETED','PAID','CLOSED')";
//
// When a payment qualifies as "recorded revenue":
//   (A) explicit SUCCESS / COMPLETED / PAID / CLOSED status,
//   (B) status is NULL / '' but amount_cents > 0 (legacy offline write),
//   (C) status = PENDING / AWAITING_CONFIRM but either
//        * attached order is PAID/COMPLETED/SERVED or payment_status = PAID,
//          OR the payment itself has a completed_at timestamp set, meaning
//          the provider settled it synchronously and we just haven't updated
//          the status field post-migration yet.
//
// The original filter dropped rows if `status == 'PENDING'` (default for
// card/transfer in PaymentModal) even though they carried a real
// completed_at / amount value — exactly the "reports shows 0 on online +
// offline POS" bug the user is seeing.
const PAID_FILTER = `(
  p.status IN ${PAID_PAYMENT_STATUS}
  OR (COALESCE(p.status, '') = '' AND COALESCE(p.amount_cents, 0) > 0)
  OR (p.status IN ('PENDING','AWAITING_CONFIRM') AND COALESCE(p.amount_cents, 0) > 0 AND (
    EXISTS (
      SELECT 1 FROM orders oo
      WHERE oo.id = p.order_id
        AND (
          UPPER(COALESCE(oo.status,'')) IN ('COMPLETED','PAID','CLOSED','SERVED','DELIVERED')
          OR UPPER(COALESCE(oo.payment_status,'')) IN ('PAID','PARTIALLY_PAID','REFUNDED','PARTIALLY_REFUNDED')
        )
    )
    OR COALESCE(p.completed_at, 0) > 0
  ))
)`;

// Fallback catch-all: any order marked PAID/COMPLETED with non-zero
// paid_amount_cents that does NOT have a matching payment row. Covers
// legacy offline cash writes that saved only the orders row, sync-pull
// orders where the payment table is eventually-consistent, and manual
// "mark paid" edits that bypass the payment ledger. Aggregations UNION
// these alongside real payments so the Reports tab never disagrees with
// Shift totals / History paid-orders counter.
const PAID_ORDER_STATUS_SQL = `('COMPLETED','PAID','CLOSED','SERVED','DELIVERED')`;
const PAID_ORDER_PAYSTATUS_SQL = `('PAID','PARTIALLY_PAID')`;
const PAID_ORDER_FALLBACK_WHERE = (oAlias: string, scopeClause: string) => `
  UPPER(COALESCE(${oAlias}.status,'')) IN ${PAID_ORDER_STATUS_SQL}
  AND UPPER(COALESCE(${oAlias}.payment_status,'')) IN ${PAID_ORDER_PAYSTATUS_SQL}
  AND COALESCE(${oAlias}.paid_amount_cents, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM payments pp
    WHERE pp.order_id = ${oAlias}.id
      AND COALESCE(pp.amount_cents, 0) > 0
      AND (
        pp.status IN ${PAID_PAYMENT_STATUS}
        OR (COALESCE(pp.status, '') = '' AND COALESCE(pp.amount_cents, 0) > 0)
        OR COALESCE(pp.completed_at, 0) > 0
      )
  )
  ${scopeClause.replace(/p\./g, `${oAlias}.`)}
`;

interface Scope {
  year?: number;
  month?: number;
  weekStartTs?: number;
  dayTs?: number;
  branchId?: string | null;
  restaurantId?: string | null;
}

interface PeriodRange {
  startTs: number;
  endTs: number;
  label: string;
}

function startOfDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMondayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function startOfMonthMs(year: number, month0: number): number {
  const d = new Date(year, month0, 1, 0, 0, 0, 0);
  return d.getTime();
}

function endOfMonthMs(year: number, month0: number): number {
  const d = new Date(year, month0 + 1, 0, 23, 59, 59, 999);
  return d.getTime();
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function resolvePeriodRange(period: ReportPeriod, scope: Scope, now: number): PeriodRange {
  switch (period) {
    case 'DAY': {
      const base = scope.dayTs && scope.dayTs > 0 ? scope.dayTs : now;
      const s = startOfDayMs(base);
      return { startTs: s, endTs: s + 86400000 - 1, label: new Date(s).toLocaleDateString() };
    }
    case 'WEEK': {
      const base = scope.weekStartTs && scope.weekStartTs > 0 ? scope.weekStartTs : now;
      const s = startOfWeekMondayMs(base);
      return { startTs: s, endTs: s + 7 * 86400000 - 1, label: `Week of ${new Date(s).toLocaleDateString()}` };
    }
    case 'MONTH': {
      const nowD = new Date(now);
      const y = scope.year ?? nowD.getFullYear();
      const m = (scope.month ?? nowD.getMonth() + 1) - 1;
      return {
        startTs: startOfMonthMs(y, m),
        endTs: endOfMonthMs(y, m),
        label: new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      };
    }
    case 'YEAR': {
      const nowD = new Date(now);
      const y = scope.year ?? nowD.getFullYear();
      return {
        startTs: new Date(y, 0, 1, 0, 0, 0, 0).getTime(),
        endTs: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
        label: String(y),
      };
    }
  }
}

function previousPeriodRange(period: ReportPeriod, current: PeriodRange, _scope: Scope): PeriodRange & { label: string } {
  switch (period) {
    case 'DAY': {
      const s = current.startTs - 86400000;
      return { startTs: s, endTs: s + 86400000 - 1, label: new Date(s).toLocaleDateString() };
    }
    case 'WEEK': {
      const s = current.startTs - 7 * 86400000;
      return { startTs: s, endTs: s + 7 * 86400000 - 1, label: `Prev week ${new Date(s).toLocaleDateString()}` };
    }
    case 'MONTH': {
      const curD = new Date(current.startTs);
      const y = curD.getFullYear();
      const m = curD.getMonth();
      const prevM = m === 0 ? 11 : m - 1;
      const prevY = m === 0 ? y - 1 : y;
      return {
        startTs: startOfMonthMs(prevY, prevM),
        endTs: endOfMonthMs(prevY, prevM),
        label: new Date(prevY, prevM, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      };
    }
    case 'YEAR': {
      const curD = new Date(current.startTs);
      const y = curD.getFullYear() - 1;
      return {
        startTs: new Date(y, 0, 1, 0, 0, 0, 0).getTime(),
        endTs: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
        label: String(y),
      };
    }
  }
}

function buildScopeWhere(scope: Scope): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.branchId) {
    clauses.push('p.branch_id = ?');
    params.push(scope.branchId);
  }
  if (scope.restaurantId) {
    clauses.push('p.restaurant_id = ?');
    params.push(scope.restaurantId);
  }
  return { clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export class ReportsRepository {
  constructor(private db: PosDatabase) {}

  listAvailableYears(scope?: { branchId?: string | null; restaurantId?: string | null }): number[] {
    const s = scope ?? {};
    const { clause, params } = buildScopeWhere(s);
    const rows = this.db.all<{ y: number }>(
      `SELECT CAST(strftime('%Y', p.completed_at/1000, 'unixepoch', 'localtime') AS INTEGER) y
       FROM payments p
       WHERE p.completed_at IS NOT NULL ${clause}
       GROUP BY y
       ORDER BY y DESC`,
      ...params
    );
    return (rows || []).map((r) => r.y).filter((y) => Number.isFinite(y) && y > 2000);
  }

  periodSales(opts: {
    period: ReportPeriod;
    year?: number;
    month?: number;
    weekStartTs?: number;
    dayTs?: number;
    branchId?: string | null;
    restaurantId?: string | null;
  }): PeriodReport {
    const now = Date.now();
    const period: ReportPeriod = opts.period;
    const scope: Scope = {
      year: opts.year,
      month: opts.month,
      weekStartTs: opts.weekStartTs,
      dayTs: opts.dayTs,
      branchId: opts.branchId,
      restaurantId: opts.restaurantId,
    };

    const current = resolvePeriodRange(period, scope, now);
    const prev = previousPeriodRange(period, current, scope);
    const availableYears = this.listAvailableYears({ branchId: scope.branchId, restaurantId: scope.restaurantId });

    const totals = this.aggregateTotals(current.startTs, current.endTs, scope);
    const prevTotals = this.aggregateTotals(prev.startTs, prev.endTs, scope);
    const buckets = this.buildBuckets(period, current, scope, now);
    const methodSplit = this.aggregateMethodSplit(current.startTs, current.endTs, scope);
    const topItems = this.aggregateTopItems(current.startTs, current.endTs, scope);

    let comparePrevPeriod: PeriodReport['comparePrevPeriod'] = null;
    if (prevTotals && (prevTotals.netCents > 0 || prevTotals.ordersCount > 0)) {
      const netDeltaCents = totals.netCents - prevTotals.netCents;
      const orderDelta = totals.ordersCount - prevTotals.ordersCount;
      const pctBase = prevTotals.netCents;
      const pct = pctBase > 0 ? Math.round((netDeltaCents / pctBase) * 10000) / 100 : 0;
      comparePrevPeriod = {
        netDeltaCents,
        orderDelta,
        pct,
        samePeriodLabel: prev.label,
      };
    } else if (prevTotals) {
      comparePrevPeriod = {
        netDeltaCents: totals.netCents,
        orderDelta: totals.ordersCount,
        pct: totals.netCents > 0 ? 100 : 0,
        samePeriodLabel: prev.label,
      };
    }

    return {
      period,
      scope: {
        year: scope.year,
        month: scope.month,
        weekStartTs: scope.weekStartTs,
        dayTs: scope.dayTs,
        branchId: scope.branchId,
        restaurantId: scope.restaurantId,
      },
      totals,
      comparePrevPeriod,
      buckets,
      methodSplit,
      topItems,
      availableYears,
    };
  }

  private aggregateTotals(startTs: number, endTs: number, scope: Scope): PeriodReport['totals'] {
    const { clause, params } = buildScopeWhere(scope);

    // -------- REAL PAYMENTS (classic path) --------------------------------
    const salesRow = this.db.get<{
      gross: number;
      tip: number;
      payCount: number;
      orderCount: number;
    }>(
      `SELECT
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM (
         SELECT p.id, p.amount_cents, p.tip_cents, p.order_id, p.completed_at, p.status
         FROM payments p
         WHERE p.completed_at IS NOT NULL
           AND p.completed_at >= ? AND p.completed_at <= ?
           AND ${PAID_FILTER}
           ${clause}
       ) p
       LEFT JOIN orders o ON o.id = p.order_id`,
      startTs, endTs, startTs, endTs, ...params,
    );

    // -------- FALLBACK: PAID orders with no qualifying payment row --------
    // Acts as a virtual "payment" so numbers reconcile with the shift
    // "paid orders" counter. Uses the exact same paid-qualifying filter
    // as PAID_FILTER but on orders.paid_amount_cents instead.
    const fallbackRow = this.db.get<{ gross: number; orderCount: number }>(
      `SELECT
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', clause)}`,
      startTs, endTs, startTs, endTs, ...params,
    );

    // Refunds are already an orders-status-level concept — no payment row
    // required — so remain order-centric.
    const refundRow = this.db.get<{ refunds: number }>(
      `SELECT COALESCE(SUM(ABS(COALESCE(o.paid_amount_cents,0))),0) refunds
       FROM orders o
       WHERE (o.status LIKE '%REFUND%' OR o.payment_status LIKE '%REFUND')
         AND o.created_at >= ? AND o.created_at <= ?
         ${clause.replace(/p\./g, 'o.')}`,
      ...[...params, startTs, endTs]
    );

    const { clause: caClause, params: caParams } = buildScopeWhere({
      branchId: scope.branchId,
      restaurantId: scope.restaurantId,
    });
    const payoutRow = this.db.get<{ payouts: number }>(
      `SELECT COALESCE(SUM(ABS(COALESCE(c.amount_cents,0))),0) payouts
       FROM cash_adjustments c
       WHERE (c.type = 'PAYOUT' OR c.direction = 'OUT' OR c.direction = 'PAID_OUT')
         AND c.created_at >= ? AND c.created_at <= ?
         ${caClause.replace(/p\./g, 'c.')}`,
      ...[...caParams, startTs, endTs]
    );

    const gross = Number(salesRow?.gross ?? 0) + Number(fallbackRow?.gross ?? 0);
    const tip = Number(salesRow?.tip ?? 0);
    const payCount = Number(salesRow?.payCount ?? 0) + Number(fallbackRow?.orderCount ?? 0);
    const orderCount = Number(salesRow?.orderCount ?? 0) + Number(fallbackRow?.orderCount ?? 0);
    return {
      grossCents: gross,
      tipCents: tip,
      netCents: gross,
      paymentCount: payCount,
      ordersCount: orderCount,
      refundCents: Number(refundRow?.refunds ?? 0),
      payoutCents: Number(payoutRow?.payouts ?? 0),
    };
  }

  private buildBuckets(
    period: ReportPeriod,
    range: PeriodRange,
    scope: Scope,
    _now: number
  ): PeriodBucket[] {
    const { clause, params } = buildScopeWhere(scope);

    switch (period) {
      case 'DAY':
        return this.buildHourlyBuckets(range, clause, params);
      case 'WEEK':
        return this.buildWeeklyDailyBuckets(range, clause, params);
      case 'MONTH':
        return this.buildMonthlyDailyBuckets(range, clause, params);
      case 'YEAR':
        return this.buildYearlyMonthlyBuckets(range, clause, params);
    }
  }

  private buildHourlyBuckets(range: PeriodRange, scopeClause: string, scopeParams: unknown[]): PeriodBucket[] {
    // Real payments JOINED with orders (the classic reporting path).
    // Use same PAID_FILTER + scope guard from aggregateTotals.
    const realRows = this.db.all<{
      h: number;
      gross: number;
      tip: number;
      payCount: number;
      orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%H', p.completed_at/1000, 'unixepoch', 'localtime') AS INTEGER) h,
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM payments p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${scopeClause}
       GROUP BY h
       ORDER BY h ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );

    // Fallback: orders marked PAID with no qualifying payment row. Bucketed
    // by o.created_at hour — same heuristic used by the cash drawer counter.
    const fallbackRows = this.db.all<{
      h: number; gross: number; payCount: number; orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%H', o.created_at/1000, 'unixepoch', 'localtime') AS INTEGER) h,
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         0 payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', scopeClause)}
       GROUP BY h
       ORDER BY h ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );

    const map = new Map<number, typeof realRows[number]>();
    for (const r of realRows || []) map.set(r.h, r);
    for (const r of fallbackRows || []) {
      const prev = map.get(r.h);
      if (prev) {
        prev.gross = Number(prev.gross || 0) + Number(r.gross || 0);
        prev.payCount = Number(prev.payCount || 0) + Number(r.orderCount || 0);
        prev.orderCount = Number(prev.orderCount || 0) + Number(r.orderCount || 0);
      } else {
        map.set(r.h, { h: r.h, gross: r.gross, tip: 0, payCount: r.orderCount, orderCount: r.orderCount });
      }
    }

    const buckets: PeriodBucket[] = [];
    const dayStart = startOfDayMs(range.startTs);
    for (let h = 0; h < 24; h++) {
      const r = map.get(h);
      const startTs = dayStart + h * 3600000;
      const endTs = startTs + 3600000 - 1;
      const hh = h.toString().padStart(2, '0');
      buckets.push({
        key: `h${h}`,
        label: `${hh}:00`,
        startTs,
        endTs,
        grossCents: Number(r?.gross ?? 0),
        tipCents: Number(r?.tip ?? 0),
        netCents: Number(r?.gross ?? 0),
        paymentCount: Number(r?.payCount ?? 0),
        ordersCount: Number(r?.orderCount ?? 0),
      });
    }
    return buckets;
  }

  private buildWeeklyDailyBuckets(range: PeriodRange, scopeClause: string, scopeParams: unknown[]): PeriodBucket[] {
    const realRows = this.db.all<{
      doy: number;
      gross: number;
      tip: number;
      payCount: number;
      orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%j', p.completed_at/1000, 'unixepoch', 'localtime') AS INTEGER) doy,
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM payments p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${scopeClause}
       GROUP BY doy`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );
    const fallbackRows = this.db.all<{
      doy: number; gross: number; payCount: number; orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%j', o.created_at/1000, 'unixepoch', 'localtime') AS INTEGER) doy,
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         0 payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', scopeClause)}
       GROUP BY doy`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );
    const map = new Map<number, typeof realRows[number]>();
    for (const r of realRows || []) map.set(r.doy, r);
    for (const r of fallbackRows || []) {
      const prev = map.get(r.doy);
      if (prev) {
        prev.gross = Number(prev.gross || 0) + Number(r.gross || 0);
        prev.payCount = Number(prev.payCount || 0) + Number(r.orderCount || 0);
        prev.orderCount = Number(prev.orderCount || 0) + Number(r.orderCount || 0);
      } else {
        map.set(r.doy, { doy: r.doy, gross: r.gross, tip: 0, payCount: r.orderCount, orderCount: r.orderCount });
      }
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const buckets: PeriodBucket[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = range.startTs + i * 86400000;
      const doy = Number(
        new Date(dayStart).toISOString().slice(0, 10).replace(/-/g, '/').replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, (_, y, m, d) => {
          const start = new Date(Number(y), 0, 0);
          const diff = (new Date(Number(y), Number(m) - 1, Number(d)).getTime() - start.getTime()) / 86400000;
          return String(Math.floor(diff));
        })
      );
      const r = map.get(doy);
      buckets.push({
        key: `d${i}`,
        label: dayNames[i],
        startTs: dayStart,
        endTs: dayStart + 86400000 - 1,
        grossCents: Number(r?.gross ?? 0),
        tipCents: Number(r?.tip ?? 0),
        netCents: Number(r?.gross ?? 0),
        paymentCount: Number(r?.payCount ?? 0),
        ordersCount: Number(r?.orderCount ?? 0),
      });
    }
    return buckets;
  }

  private buildMonthlyDailyBuckets(range: PeriodRange, scopeClause: string, scopeParams: unknown[]): PeriodBucket[] {
    const startD = new Date(range.startTs);
    const y = startD.getFullYear();
    const m = startD.getMonth();
    const maxDay = daysInMonth(y, m);

    const realRows = this.db.all<{
      dm: number;
      gross: number;
      tip: number;
      payCount: number;
      orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%d', p.completed_at/1000, 'unixepoch', 'localtime') AS INTEGER) dm,
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM payments p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${scopeClause}
       GROUP BY dm
       ORDER BY dm ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );
    const fallbackRows = this.db.all<{
      dm: number; gross: number; payCount: number; orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%d', o.created_at/1000, 'unixepoch', 'localtime') AS INTEGER) dm,
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         0 payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', scopeClause)}
       GROUP BY dm
       ORDER BY dm ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );

    const map = new Map<number, typeof realRows[number]>();
    for (const r of realRows || []) map.set(r.dm, r);
    for (const r of fallbackRows || []) {
      const prev = map.get(r.dm);
      if (prev) {
        prev.gross = Number(prev.gross || 0) + Number(r.gross || 0);
        prev.payCount = Number(prev.payCount || 0) + Number(r.orderCount || 0);
        prev.orderCount = Number(prev.orderCount || 0) + Number(r.orderCount || 0);
      } else {
        map.set(r.dm, { dm: r.dm, gross: r.gross, tip: 0, payCount: r.orderCount, orderCount: r.orderCount });
      }
    }

    const buckets: PeriodBucket[] = [];
    for (let d = 1; d <= maxDay; d++) {
      const r = map.get(d);
      const startTs = new Date(y, m, d, 0, 0, 0, 0).getTime();
      buckets.push({
        key: `dm${d}`,
        label: String(d),
        startTs,
        endTs: startTs + 86400000 - 1,
        grossCents: Number(r?.gross ?? 0),
        tipCents: Number(r?.tip ?? 0),
        netCents: Number(r?.gross ?? 0),
        paymentCount: Number(r?.payCount ?? 0),
        ordersCount: Number(r?.orderCount ?? 0),
      });
    }
    return buckets;
  }

  private buildYearlyMonthlyBuckets(range: PeriodRange, scopeClause: string, scopeParams: unknown[]): PeriodBucket[] {
    const y = new Date(range.startTs).getFullYear();
    const realRows = this.db.all<{
      mo: number;
      gross: number;
      tip: number;
      payCount: number;
      orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%m', p.completed_at/1000, 'unixepoch', 'localtime') AS INTEGER) mo,
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM payments p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${scopeClause}
       GROUP BY mo
       ORDER BY mo ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );
    const fallbackRows = this.db.all<{
      mo: number; gross: number; payCount: number; orderCount: number;
    }>(
      `SELECT
         CAST(strftime('%m', o.created_at/1000, 'unixepoch', 'localtime') AS INTEGER) mo,
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         0 payCount,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', scopeClause)}
       GROUP BY mo
       ORDER BY mo ASC`,
      ...[range.startTs, range.endTs, range.startTs, range.endTs, ...scopeParams]
    );
    const map = new Map<number, typeof realRows[number]>();
    for (const r of realRows || []) map.set(r.mo, r);
    for (const r of fallbackRows || []) {
      const prev = map.get(r.mo);
      if (prev) {
        prev.gross = Number(prev.gross || 0) + Number(r.gross || 0);
        prev.payCount = Number(prev.payCount || 0) + Number(r.orderCount || 0);
        prev.orderCount = Number(prev.orderCount || 0) + Number(r.orderCount || 0);
      } else {
        map.set(r.mo, { mo: r.mo, gross: r.gross, tip: 0, payCount: r.orderCount, orderCount: r.orderCount });
      }
    }

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const buckets: PeriodBucket[] = [];
    for (let m = 1; m <= 12; m++) {
      const r = map.get(m);
      const startTs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
      const endTs = endOfMonthMs(y, m - 1);
      buckets.push({
        key: `mo${m}`,
        label: monthNames[m - 1],
        startTs,
        endTs,
        grossCents: Number(r?.gross ?? 0),
        tipCents: Number(r?.tip ?? 0),
        netCents: Number(r?.gross ?? 0),
        paymentCount: Number(r?.payCount ?? 0),
        ordersCount: Number(r?.orderCount ?? 0),
      });
    }
    return buckets;
  }

  private aggregateMethodSplit(startTs: number, endTs: number, scope: Scope): MethodSplit[] {
    const { clause, params } = buildScopeWhere(scope);
    const realRows = this.db.all<{
      method: string | null;
      gross: number;
      tip: number;
      cnt: number;
    }>(
      `SELECT
         p.method,
         COALESCE(SUM(p.amount_cents),0) gross,
         COALESCE(SUM(p.tip_cents),0) tip,
         COUNT(p.id) cnt
       FROM payments p
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${clause}
       GROUP BY p.method
       ORDER BY gross DESC`,
      ...[startTs, endTs, startTs, endTs, ...params]
    );
    // Fallback: orders without a payment get bucketed under CASH method —
    // that's the overwhelmingly common case for offline "mark paid" orders.
    const fallback = this.db.get<{ gross: number; orderCount: number }>(
      `SELECT
         COALESCE(SUM(o.paid_amount_cents),0) gross,
         COUNT(DISTINCT o.id) orderCount
       FROM orders o
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', clause)}`,
      ...[startTs, endTs, startTs, endTs, ...params]
    );

    const byMethod = new Map<string, { method: string; netCents: number; tipCents: number; count: number }>();
    for (const r of realRows || []) {
      const k = r.method || 'OTHER';
      const p = byMethod.get(k) || { method: k, netCents: 0, tipCents: 0, count: 0 };
      p.netCents += Number(r.gross || 0);
      p.tipCents += Number(r.tip || 0);
      p.count += Number(r.cnt || 0);
      byMethod.set(k, p);
    }
    const fallbackCount = Number(fallback?.orderCount ?? 0);
    const fallbackGross = Number(fallback?.gross ?? 0);
    if (fallbackCount > 0 || fallbackGross > 0) {
      const k = 'CASH';
      const p = byMethod.get(k) || { method: k, netCents: 0, tipCents: 0, count: 0 };
      p.netCents += fallbackGross;
      p.count += fallbackCount;
      byMethod.set(k, p);
    }
    return [...byMethod.values()].sort((a, b) => b.netCents - a.netCents);
  }

  private aggregateTopItems(startTs: number, endTs: number, scope: Scope): TopItem[] {
    const { clause, params } = buildScopeWhere(scope);
    const clauseForOrders = clause.replace(/p\./g, 'p2.');
    // Top items via real-payment join (original behavior, but using the
    // full PAID_FILTER so PENDING payments on a PAID order are included).
    const realRows = this.db.all<{
      menuItemId: string | null;
      name: string | null;
      qty: number;
      revenue: number;
    }>(
      `SELECT
         oi.menu_item_id menuItemId,
         oi.name_snapshot name,
         COALESCE(SUM(oi.quantity),0) qty,
         COALESCE(SUM(oi.subtotal_cents),0) revenue
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id
       INNER JOIN payments p2 ON p2.order_id = o.id
       WHERE p2.completed_at IS NOT NULL
         AND p2.completed_at >= ? AND p2.completed_at <= ?
         AND ${PAID_FILTER.replace(/p\./g, 'p2.')}
         ${clauseForOrders}
       GROUP BY oi.menu_item_id, oi.name_snapshot
       ORDER BY revenue DESC
       LIMIT 10`,
      ...[startTs, endTs, startTs, endTs, ...params]
    );
    // Fallback: PAID orders with no qualifying payment row — JOIN their
    // items in separately so menu item popularity isn't under-counted just
    // because the payment row is missing/legacy (cash legacy writes).
    // Only pull order rows that match the PAID_ORDER_FALLBACK_WHERE guard.
    // Clause substitution maps p. scope (branchId/restaurantId) → o alias.
    const clauseForFbOrders = clause.replace(/p\./g, 'o.');
    const fallbackRows = this.db.all<{
      menuItemId: string | null;
      name: string | null;
      qty: number;
      revenue: number;
    }>(
      `SELECT
         oi.menu_item_id menuItemId,
         oi.name_snapshot name,
         COALESCE(SUM(oi.quantity),0) qty,
         COALESCE(SUM(oi.subtotal_cents),0) revenue
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= ? AND o.created_at <= ?
         AND ${PAID_ORDER_FALLBACK_WHERE('o', clause)}
       GROUP BY oi.menu_item_id, oi.name_snapshot
       ORDER BY revenue DESC
       LIMIT 10`,
      ...[startTs, endTs, startTs, endTs, ...params]
    );

    const agg = new Map<string, TopItem & { _isKey: string }>();
    for (const r of [...(realRows || []), ...(fallbackRows || [])]) {
      const key = `${r.menuItemId ?? ''}::${r.name ?? ''}`;
      const existing = agg.get(key);
      if (existing) {
        existing.qty += Number(r.qty || 0);
        existing.revenueCents += Number(r.revenue || 0);
      } else {
        agg.set(key, {
          _isKey: key,
          menuItemId: r.menuItemId ?? null,
          name: r.name ?? (r.menuItemId ? `Item` : null),
          qty: Number(r.qty || 0),
          revenueCents: Number(r.revenue || 0),
        });
      }
    }
    // Drop _isKey helper field before returning
    return [...agg.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 10)
      .map(({ _isKey, ...rest }) => rest as TopItem);
  }
}
