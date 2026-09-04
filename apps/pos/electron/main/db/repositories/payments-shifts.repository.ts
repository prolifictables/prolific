import type { PosDatabase } from '../database';
import type { PaymentRow, ShiftRow, CashAdjustmentRow } from '../types';

export class PaymentsRepository {
  constructor(private db: PosDatabase) {}

  create(data: Partial<PaymentRow> & { id: string }): string {
    const now = Date.now();
    this.db.run(
      `INSERT INTO payments (
        id, order_id, employee_id, shift_id, branch_id, restaurant_id,
        method, provider, transaction_reference, amount_cents, tip_cents,
        change_due_cents, status, verification_source, completed_at,
        reference_note, idempotency_key, server_version, local_version,
        synced, failure_reason, provider_response_json, created_at, updated_at
      ) VALUES (
        @id, @order_id, @employee_id, @shift_id, @branch_id, @restaurant_id,
        @method, @provider, @transaction_reference, @amount_cents, @tip_cents,
        @change_due_cents, @status, @verification_source, @completed_at,
        @reference_note, @idempotency_key,
        COALESCE(@server_version, 0), COALESCE(@local_version, 1),
        COALESCE(@synced, 0), @failure_reason, @provider_response_json,
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )`,
      data
    );
    return data.id;
  }

  listByOrderId(orderId: string): PaymentRow[] {
    return this.db.all<PaymentRow>(
      'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC',
      orderId
    );
  }

  listByShiftId(shiftId: string): PaymentRow[] {
    return this.db.all<PaymentRow>(
      'SELECT * FROM payments WHERE shift_id = ? ORDER BY created_at ASC',
      shiftId
    );
  }

  markSynced(paymentId: string, serverVersion: number): void {
    this.db.run(
      `UPDATE payments SET synced = 1, server_version = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      serverVersion,
      paymentId
    );
  }

  getShiftTotals(shiftId: string): {
    cash: number;
    card: number;
    other: number;
    total: number;
    tip: number;
    counts: {
      cash: number;
      card: number;
      other: number;
      total: number;
    };
    perMethod: Array<{ method: string; amount: number; tip: number; count: number }>;
    orders: {
      paidOrderCount: number;
      voidedOrderCount: number;
      refundedOrderCount: number;
      paidItemQty: number;
      subtotalCents: number;
      discountCents: number;
      taxCents: number;
      totalPaidCents: number;
    };
    payouts: {
      totalPayoutCents: number;
      payoutCount: number;
    };
    cashAdjustments: {
      totalPaidInCents: number;
      totalPaidOutCents: number;
      count: number;
    };
  } {
    // First, load the shift's opened_at (used to scope order-level fallback
    // aggregation to opened_at <= ts <= Date.now()).
    const shiftRow = this.db.get<{ opened_at: number }>(
      `SELECT COALESCE(opened_at, 0) opened_at FROM shifts WHERE id = ?`,
      shiftId,
    );
    const openedAt = Number(shiftRow?.opened_at || 0);
    const closeAt = Date.now();

    // -------------------------------------------------------------------
    // Payment aggregation — mirrors reports.repository: accept payments
    // with PAID status OR legacy NULL/empty status with amount_cents > 0
    // OR PENDING/AWAITING_CONFIRM where either completed_at is set OR the
    // attached order is already marked PAID. This ensures close-shift
    // numbers EXACTLY match ReportsPanel + History numbers above.
    // -------------------------------------------------------------------
    const PAID_STATUS_FILTER = `
      status IN ('SUCCESS','COMPLETED','PAID','CLOSED')
      OR (COALESCE(status,'') = '' AND COALESCE(amount_cents,0) > 0)
      OR (status IN ('PENDING','AWAITING_CONFIRM') AND COALESCE(amount_cents,0) > 0 AND (
           COALESCE(completed_at,0) > 0
           OR EXISTS (
             SELECT 1 FROM orders oo WHERE oo.id = payments.order_id
               AND (
                 UPPER(COALESCE(oo.status,'')) IN ('COMPLETED','PAID','CLOSED','SERVED','DELIVERED')
                 OR UPPER(COALESCE(oo.payment_status,'')) IN ('PAID','PARTIALLY_PAID','REFUNDED','PARTIALLY_REFUNDED')
               )
           )
         ))
    `;

    const payRows = this.db.all<{ method: string; amount: number; tip: number; cnt: number }>(
      `SELECT method,
              COALESCE(SUM(amount_cents),0) amount,
              COALESCE(SUM(tip_cents),0) tip,
              COUNT(*) cnt
       FROM payments WHERE shift_id = ? AND (${PAID_STATUS_FILTER})
       GROUP BY method`,
      shiftId,
    );

    // PAID-ORDER FALLBACK — rows marked PAID/COMPLETED with paid_amount_cents
    // > 0 AND shift_id = this shift that do NOT have a qualifying payment
    // row. Bucket these as method = (order.payment_method else CASH). This is
    // the exact same rule as used by Reports repository so numbers match.
    const fallbackRows = this.db.all<{ method: string; amount: number; tip: number; cnt: number }>(
      `SELECT
         COALESCE(o.payment_method, 'CASH') method,
         COALESCE(SUM(o.paid_amount_cents),0) amount,
         0 tip,
         COUNT(DISTINCT o.id) cnt
       FROM orders o
       WHERE o.shift_id = ?
         AND UPPER(COALESCE(o.status,'')) IN ('COMPLETED','PAID','CLOSED','SERVED','DELIVERED')
         AND UPPER(COALESCE(o.payment_status,'')) IN ('PAID','PARTIALLY_PAID')
         AND COALESCE(o.paid_amount_cents,0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM payments pp
           WHERE pp.shift_id = o.shift_id
             AND pp.order_id = o.id
             AND COALESCE(pp.amount_cents,0) > 0
             AND (${PAID_STATUS_FILTER.replace(/payments\./g, 'pp.')})
         )
       GROUP BY COALESCE(o.payment_method, 'CASH')`,
      shiftId,
    );

    // Merge real payments + fallback by method.
    const mergedByMethod = new Map<string, { method: string; amount: number; tip: number; count: number }>();
    for (const r of payRows || []) {
      const k = r.method || 'OTHER';
      const p = mergedByMethod.get(k) || { method: k, amount: 0, tip: 0, count: 0 };
      p.amount += Number(r.amount || 0);
      p.tip += Number(r.tip || 0);
      p.count += Number(r.cnt || 0);
      mergedByMethod.set(k, p);
    }
    for (const r of fallbackRows || []) {
      const k = r.method || 'OTHER';
      const p = mergedByMethod.get(k) || { method: k, amount: 0, tip: 0, count: 0 };
      p.amount += Number(r.amount || 0);
      p.tip += Number(r.tip || 0);
      p.count += Number(r.cnt || 0);
      mergedByMethod.set(k, p);
    }

    let cash = 0, card = 0, other = 0, tip = 0;
    let cashCount = 0, cardCount = 0, otherCount = 0;
    const perMethod: Array<{ method: string; amount: number; tip: number; count: number }> = [];
    for (const r of mergedByMethod.values()) {
      tip += r.tip;
      perMethod.push(r);
      const up = (r.method || '').toUpperCase();
      if (up === 'CASH') { cash += r.amount; cashCount += r.count; }
      else if (up.includes('CARD') || up === 'POS_CARD' || up === 'CARD_POS' || up === 'PAYSTACK' || up === 'FLUTTERWAVE') {
        card += r.amount; cardCount += r.count;
      } else { other += r.amount; otherCount += r.count; }
    }

    // Order-level metrics for the close-shift sheet:
    //   paidOrderCount: distinct orders whose SUM of qualifying payments +
    //                   order paid_amount fallback covers their total OR
    //                   order.payment_status = PAID / PARTIALLY_PAID with
    //                   non-zero paid_amount.
    //   voidedOrderCount: status = VOID / VOIDED in this shift.
    //   refundedOrderCount: status = REFUNDED / payment_status REFUNDED /
    //                       PARTIALLY_REFUNDED.
    //   paidItemQty: SUM of item_qty from PAID orders; fallback 0 if column
    //                absent in earlier migrations.
    //   subtotal / discount / tax / total: sums from order rows; missing
    //                columns → 0.
    const scopedOrders = (sql: string, ...extraParams: unknown[]) =>
      this.db.all(sql, shiftId, ...extraParams);

    let subtotal = 0, discount = 0, tax = 0, orderTotal = 0, itemQty = 0;
    try {
      const cols = this.db.all<{ cid: number; name: string }>(
        `PRAGMA table_info(orders)`,
      );
      const colsSet = new Set((cols || []).map((c) => c.name));
      const parts: string[] = [];
      const pushIf = (col: string, alias: string) => {
        if (colsSet.has(col)) parts.push(`COALESCE(SUM(${col}),0) ${alias}`);
        else parts.push(`0 ${alias}`);
      };
      pushIf('subtotal_cents', 'subtotal');
      pushIf('discount_cents', 'discount');
      pushIf('tax_cents', 'tax');
      pushIf('total_cents', 'total');
      pushIf('item_qty', 'items_qty');
      const row = this.db.get<{
        subtotal: number; discount: number; tax: number; total: number; items_qty: number;
      }>(
        `SELECT ${parts.join(', ')} FROM orders WHERE shift_id = ?`,
        shiftId,
      );
      subtotal = Number(row?.subtotal || 0);
      discount = Number(row?.discount || 0);
      tax = Number(row?.tax || 0);
      orderTotal = Number(row?.total || 0);
      itemQty = Number(row?.items_qty || 0);
    } catch { /* ignore — defaults zeroed above */ }

    const paidAndVoids = this.db.get<{ paid: number; voided: number; refunded: number; ordersCoveredCount: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN UPPER(COALESCE(o.payment_status,'')) IN ('PAID','PARTIALLY_PAID') AND COALESCE(o.paid_amount_cents,0) > 0 THEN 1 ELSE 0 END),0) paid,
         COALESCE(SUM(CASE WHEN UPPER(COALESCE(o.status,'')) IN ('VOID','VOIDED') THEN 1 ELSE 0 END),0) voided,
         COALESCE(SUM(CASE WHEN UPPER(COALESCE(o.status,'')) = 'REFUNDED' OR UPPER(COALESCE(o.payment_status,'')) IN ('REFUNDED','PARTIALLY_REFUNDED') THEN 1 ELSE 0 END),0) refunded,
         COUNT(DISTINCT o.id) ordersCoveredCount
       FROM orders o
       WHERE o.shift_id = ?`,
      shiftId,
    );

    // Payouts — already filtered by shift_id (table present; else 0).
    let payouts = { totalPayoutCents: 0, payoutCount: 0 };
    try {
      const p = this.db.all<{ amount: number; cnt: number }>(
        `SELECT COALESCE(SUM(amount_cents),0) amount, COUNT(*) cnt FROM payouts WHERE shift_id = ?`,
        shiftId,
      );
      if (p && p[0]) payouts = { totalPayoutCents: p[0].amount || 0, payoutCount: p[0].cnt || 0 };
    } catch { /* payouts table may not exist in earlier schema — ignore */ }

    // Cash adjustments — paid-in / paid-out by shift_id.
    let cashAdj = { totalPaidInCents: 0, totalPaidOutCents: 0, count: 0 };
    try {
      const c = this.db.all<{ paidin: number; paidout: number; cnt: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'PAID_IN' THEN amount_cents ELSE 0 END),0) paidin,
           COALESCE(SUM(CASE WHEN direction = 'PAID_OUT' THEN amount_cents ELSE 0 END),0) paidout,
           COUNT(*) cnt
         FROM cash_adjustments WHERE shift_id = ?`,
        shiftId,
      );
      if (c && c[0]) cashAdj = {
        totalPaidInCents: c[0].paidin || 0,
        totalPaidOutCents: c[0].paidout || 0,
        count: c[0].cnt || 0,
      };
    } catch { /* cash_adjustments table may not exist in earlier schema */ }

    // Grand total paid: cash + card + other. Must equal the totals card in
    // HISTORY + REPORTS tabs for the same shift window.
    const total = cash + card + other;
    // orderTotal (from orders.total_cents) is an informational baseline.
    // Use the actual cash+card+other derived sum as the single source of
    // truth for paid $ because it reconciles with drawer math (cash) +
    // card processor (card) + any transfer methods.
    void orderTotal; void closeAt; void openedAt; void paidAndVoids?.ordersCoveredCount;
    return {
      cash,
      card,
      other,
      total,
      tip,
      counts: {
        cash: cashCount,
        card: cardCount,
        other: otherCount,
        total: cashCount + cardCount + otherCount,
      },
      perMethod,
      orders: {
        paidOrderCount: Number(paidAndVoids?.paid || 0),
        voidedOrderCount: Number(paidAndVoids?.voided || 0),
        refundedOrderCount: Number(paidAndVoids?.refunded || 0),
        paidItemQty: itemQty,
        subtotalCents: subtotal,
        discountCents: discount,
        taxCents: tax,
        totalPaidCents: total,
      },
      payouts,
      cashAdjustments: cashAdj,
    };
  }
}

export class ShiftsRepository {
  constructor(private db: PosDatabase) {}

  open(data: Partial<ShiftRow> & { id: string }): string {
    const now = Date.now();
    // Idempotency guard: the SQLite partial UNIQUE index
    //   idx_shifts_device_open ON shifts(device_id) WHERE status = 'OPEN'
    // only allows a single OPEN shift per device at a time. If a previous
    // shift for the same device is still OPEN (e.g. cashier rebooted mid-shift
    // without explicitly closing it, or React StrictMode double-mounted the
    // modal and fired open() twice, or the call site didn't pre-check
    // getOpen()), reuse the existing open shift instead of throwing
    // "Unique constraint failed: shifts.device_id".
    const deviceId = (data as any)?.device_id;
    if (deviceId) {
      const existingOpen = this.getOpen(String(deviceId));
      if (existingOpen && existingOpen.id) {
        // If the caller passed opening_cash_cents and we have none, patch the
        // existing shift so first-open data is captured (this handles the
        // "getOpen returned a ghost open shift with no opening balance" edge
        // case where some prior code opened a shift skeleton).
        const openingCents = Number((data as any)?.opening_cash_cents ?? 0);
        if (
          openingCents > 0 &&
          (existingOpen.opening_cash_cents == null || existingOpen.opening_cash_cents === 0)
        ) {
          try {
            this.db.run(
              `UPDATE shifts SET opening_cash_cents = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
              openingCents,
              existingOpen.id
            );
          } catch { /* best-effort patch */ }
        }
        return existingOpen.id;
      }
    }
    this.db.run(
      `INSERT INTO shifts (
        id, device_id, branch_id, restaurant_id, employee_id, status,
        opening_cash_cents, expected_cash_cents, closing_cash_cents,
        variance_cents, cash_sales_cents, card_sales_cents, other_sales_cents,
        refunds_cents, payout_cents, note, opened_at, closed_at,
        idempotency_key, server_version, local_version, synced,
        created_at, updated_at
      ) VALUES (
        @id, @device_id, @branch_id, @restaurant_id, @employee_id,
        COALESCE(@status, 'OPEN'),
        @opening_cash_cents,
        COALESCE(@expected_cash_cents, 0),
        COALESCE(@closing_cash_cents, 0),
        COALESCE(@variance_cents, 0),
        COALESCE(@cash_sales_cents, 0),
        COALESCE(@card_sales_cents, 0),
        COALESCE(@other_sales_cents, 0),
        COALESCE(@refunds_cents, 0),
        COALESCE(@payout_cents, 0),
        @note,
        COALESCE(@opened_at, ${now}),
        NULL,
        @idempotency_key,
        COALESCE(@server_version, 0),
        COALESCE(@local_version, 1),
        COALESCE(@synced, 0),
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )`,
      data
    );
    return data.id;
  }

  close(
    id: string,
    data: {
      closing_cash_cents: number;
      variance_cents: number;
      note?: string | null;
      closed_at?: number | null;
    }
  ): void {
    const closedAt = data.closed_at ?? Date.now();
    this.db.run(
      `UPDATE shifts SET
        status = 'CLOSED',
        closing_cash_cents = ?,
        variance_cents = ?,
        note = COALESCE(?, note),
        closed_at = ?,
        updated_at = unixepoch('now')*1000
       WHERE id = ?`,
      data.closing_cash_cents,
      data.variance_cents,
      data.note ?? null,
      closedAt,
      id
    );
  }

  getOpen(deviceId: string, employeeId?: string): ShiftRow | undefined {
    if (employeeId) {
      return this.db.get<ShiftRow>(
        `SELECT * FROM shifts WHERE device_id = ? AND employee_id = ? AND status = 'OPEN' LIMIT 1`,
        deviceId,
        employeeId
      );
    }
    return this.db.get<ShiftRow>(
      `SELECT * FROM shifts WHERE device_id = ? AND status = 'OPEN' LIMIT 1`,
      deviceId
    );
  }

  listByEmployee(employeeId: string, limit = 50): ShiftRow[] {
    return this.db.all<ShiftRow>(
      'SELECT * FROM shifts WHERE employee_id = ? ORDER BY opened_at DESC LIMIT ?',
      employeeId,
      limit
    );
  }

  listByDate(branchId: string, from: number, to: number): ShiftRow[] {
    return this.db.all<ShiftRow>(
      `SELECT * FROM shifts WHERE branch_id = ? AND opened_at >= ? AND opened_at <= ? ORDER BY opened_at DESC`,
      branchId,
      from,
      to
    );
  }

  getCashierReportSummary(shiftId: string): {
    openingCash: number;
    cashSales: number;
    cardSales: number;
    otherSales: number;
    refunds: number;
    payouts: number;
    expectedCash: number;
    closingCash: number;
    variance: number;
    transactionCount: number;
  } {
    const shift = this.db.get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', shiftId);
    if (!shift) {
      return {
        openingCash: 0, cashSales: 0, cardSales: 0, otherSales: 0,
        refunds: 0, payouts: 0, expectedCash: 0, closingCash: 0,
        variance: 0, transactionCount: 0,
      };
    }
    const txCount = this.db.get<{ c: number }>(
      'SELECT COUNT(*) c FROM payments WHERE shift_id = ?',
      shiftId
    );
    return {
      openingCash: shift.opening_cash_cents ?? 0,
      cashSales: shift.cash_sales_cents ?? 0,
      cardSales: shift.card_sales_cents ?? 0,
      otherSales: shift.other_sales_cents ?? 0,
      refunds: shift.refunds_cents ?? 0,
      payouts: shift.payout_cents ?? 0,
      expectedCash: shift.expected_cash_cents ?? 0,
      closingCash: shift.closing_cash_cents ?? 0,
      variance: shift.variance_cents ?? 0,
      transactionCount: txCount?.c ?? 0,
    };
  }
}

export class CashAdjustmentsRepository {
  constructor(private db: PosDatabase) {}

  create(shiftId: string, data: Partial<CashAdjustmentRow> & { id: string }): string {
    this.db.run(
      `INSERT INTO cash_adjustments (
        id, shift_id, employee_id, branch_id, amount_cents, type, reason,
        reference, created_at
      ) VALUES (
        @id, @shift_id, @employee_id, @branch_id, @amount_cents, @type,
        @reason, @reference,
        COALESCE(@created_at, unixepoch('now')*1000)
      )`,
      { shift_id: shiftId, ...data }
    );
    return data.id;
  }

  listByShiftId(shiftId: string): CashAdjustmentRow[] {
    return this.db.all<CashAdjustmentRow>(
      'SELECT * FROM cash_adjustments WHERE shift_id = ? ORDER BY created_at ASC',
      shiftId
    );
  }
}
