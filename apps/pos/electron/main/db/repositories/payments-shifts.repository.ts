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
  } {
    const rows = this.db.all<{ method: string; amount: number; tip: number }>(
      `SELECT method, COALESCE(SUM(amount_cents),0) amount, COALESCE(SUM(tip_cents),0) tip
       FROM payments WHERE shift_id = ? AND status = 'PAID'
       GROUP BY method`,
      shiftId
    );
    let cash = 0,
      card = 0,
      other = 0,
      tip = 0;
    for (const r of rows) {
      tip += r.tip;
      if (r.method === 'CASH') cash += r.amount;
      else if (r.method === 'CARD_POS' || r.method === 'PAYSTACK' || r.method === 'FLUTTERWAVE')
        card += r.amount;
      else other += r.amount;
    }
    return { cash, card, other, total: cash + card + other, tip };
  }
}

export class ShiftsRepository {
  constructor(private db: PosDatabase) {}

  open(data: Partial<ShiftRow> & { id: string }): string {
    const now = Date.now();
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
