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

const PAID_STATUS = "('SUCCESS','COMPLETED','PAID','CLOSED')";
const PAID_FILTER = `(p.status IN ${PAID_STATUS} OR (p.status IS NULL AND COALESCE(p.amount_cents,0) > 0))`;

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
    const paidParams = [...params, startTs, endTs];

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
       FROM payments p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.completed_at IS NOT NULL
         AND p.completed_at >= ? AND p.completed_at <= ?
         AND ${PAID_FILTER}
         ${clause}`,
      ...paidParams
    );

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

    const gross = Number(salesRow?.gross ?? 0);
    const tip = Number(salesRow?.tip ?? 0);
    return {
      grossCents: gross,
      tipCents: tip,
      netCents: gross,
      paymentCount: Number(salesRow?.payCount ?? 0),
      ordersCount: Number(salesRow?.orderCount ?? 0),
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
    const rows = this.db.all<{
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
      ...[...scopeParams, range.startTs, range.endTs]
    );
    const map = new Map<number, typeof rows[number]>();
    for (const r of rows || []) map.set(r.h, r);

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
    const rows = this.db.all<{
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
      ...[...scopeParams, range.startTs, range.endTs]
    );
    const map = new Map<number, typeof rows[number]>();
    for (const r of rows || []) map.set(r.doy, r);

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

    const rows = this.db.all<{
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
      ...[...scopeParams, range.startTs, range.endTs]
    );
    const map = new Map<number, typeof rows[number]>();
    for (const r of rows || []) map.set(r.dm, r);

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
    const rows = this.db.all<{
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
      ...[...scopeParams, range.startTs, range.endTs]
    );
    const map = new Map<number, typeof rows[number]>();
    for (const r of rows || []) map.set(r.mo, r);

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
    const rows = this.db.all<{
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
      ...[...params, startTs, endTs]
    );
    return (rows || []).map((r) => ({
      method: r.method || 'OTHER',
      netCents: Number(r.gross ?? 0),
      tipCents: Number(r.tip ?? 0),
      count: Number(r.cnt ?? 0),
    }));
  }

  private aggregateTopItems(startTs: number, endTs: number, scope: Scope): TopItem[] {
    const { clause, params } = buildScopeWhere(scope);
    const clauseForOrders = clause.replace(/p\./g, 'p2.');
    const rows = this.db.all<{
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
      ...[...params, startTs, endTs]
    );
    return (rows || []).map((r, i) => ({
      menuItemId: r.menuItemId ?? null,
      name: r.name ?? (r.menuItemId ? `Item #${i + 1}` : null),
      qty: Number(r.qty ?? 0),
      revenueCents: Number(r.revenue ?? 0),
    }));
  }
}
