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
    // Payment aggregation: sum amount_cents + tip_cents + count GROUP BY method
    const payRows = this.db.all<{ method: string; amount: number; tip: number; cnt: number }>(
      `SELECT method,
              COALESCE(SUM(amount_cents),0) amount,
              COALESCE(SUM(tip_cents),0) tip,
              COUNT(*) cnt
       FROM payments WHERE shift_id = ? AND status = 'PAID'
       GROUP BY method`,
      shiftId
    );
    let cash = 0, card = 0, other = 0, tip = 0;
    let cashCount = 0, cardCount = 0, otherCount = 0;
    const perMethod: Array<{ method: string; amount: number; tip: number; count: number }> = [];
    for (const r of payRows) {
      tip += r.tip;
      const amt = r.amount || 0;
      const count = r.cnt || 0;
      perMethod.push({
        method: r.method || 'OTHER',
        amount: amt,
        tip: r.tip || 0,
        count,
      });
      if (r.method === 'CASH') { cash += amt; cashCount += count; }
      else if (r.method === 'CARD_POS' || r.method === 'PAYSTACK' || r.method === 'FLUTTERWAVE') {
        card += amt; cardCount += count;
      }
      else { other += amt; otherCount += count; }
    }

    // Order-level aggregation for paid orders in this shift.
    // Columns are sourced from shifts.order*_cents fields stored on each order.
    const orderStats = this.db.all<{
      subtotal: number; discount: number; tax: number; total: number; items_qty: number;
      paid: number; voided: number; refunded: number;
    }>(
      `SELECT
         COALESCE(SUM(subtotal_cents),0) subtotal,
         COALESCE(SUM(discount_cents),0) discount,
         COALESCE(SUM(tax_cents),0) tax,
         COALESCE(SUM(total_cents),0) total,
         COALESCE(SUM(item_qty),0) items_qty,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END),0) paid,
         COALESCE(SUM(CASE WHEN status = 'VOID' THEN 1 ELSE 0 END),0) voided,
         COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN 1 ELSE 0 END),0) refunded
       FROM orders WHERE shift_id = ?`,
      shiftId
    );
    const orderRow = orderStats[0] || {
      subtotal: 0, discount: 0, tax: 0, total: 0, items_qty: 0,
      paid: 0, voided: 0, refunded: 0,
    };

    // Payouts (manager petty cash payouts / withdrawals) — legacy table may be
    // absent (SQLite → fallback to 0).
    let payouts = { totalPayoutCents: 0, payoutCount: 0 };
    try {
      const p = this.db.all<{ amount: number; cnt: number }>(
        `SELECT COALESCE(SUM(amount_cents),0) amount, COUNT(*) cnt FROM payouts WHERE shift_id = ?`,
        shiftId
      );
      if (p && p[0]) {
        payouts = { totalPayoutCents: p[0].amount || 0, payoutCount: p[0].cnt || 0 };
      }
    } catch { /* payouts table may not exist in earlier schema — ignore */ }

    // Cash adjustments (cash drops / no-sales / paid-in / paid-out)
    let cashAdj = { totalPaidInCents: 0, totalPaidOutCents: 0, count: 0 };
    try {
      const c = this.db.all<{ paidin: number; paidout: number; cnt: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'PAID_IN' THEN amount_cents ELSE 0 END),0) paidin,
           COALESCE(SUM(CASE WHEN direction = 'PAID_OUT' THEN amount_cents ELSE 0 END),0) paidout,
           COUNT(*) cnt
         FROM cash_adjustments WHERE shift_id = ?`,
        shiftId
      );
      if (c && c[0]) {
        cashAdj = {
          totalPaidInCents: c[0].paidin || 0,
          totalPaidOutCents: c[0].paidout || 0,
          count: c[0].cnt || 0,
        };
      }
    } catch { /* cash_adjustments table may not exist in earlier schema */ }

    return {
      cash,
      card,
      other,
      total: cash + card + other,
      tip,
      counts: {
        cash: cashCount,
        card: cardCount,
        other: otherCount,
        total: cashCount + cardCount + otherCount,
      },
      perMethod,
      orders: {
        paidOrderCount: orderRow.paid || 0,
        voidedOrderCount: orderRow.voided || 0,
        refundedOrderCount: orderRow.refunded || 0,
        paidItemQty: orderRow.items_qty || 0,
        subtotalCents: orderRow.subtotal || 0,
        discountCents: orderRow.discount || 0,
        taxCents: orderRow.tax || 0,
        totalPaidCents: orderRow.total || 0,
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
