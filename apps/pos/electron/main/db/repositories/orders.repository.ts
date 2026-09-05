import type { PosDatabase } from '../database';
import type {
  OrderRow,
  OrderItemRow,
  OrderItemModifierOptionRow,
} from '../types';

export class OrdersRepository {
  constructor(private db: PosDatabase) {}

  create(data: Partial<OrderRow> & { id: string }): string {
    const now = Date.now();
    const idempotencyKey = typeof (data as any).idempotency_key === 'string' && (data as any).idempotency_key
      ? String((data as any).idempotency_key)
      : null;

    // Idempotency pre-check.
    //  ——
    // SQLite `idx_orders_idempotency` is a UNIQUE index on orders.idempotency_key
    // (migrations.ts L342). Double-click on "Confirm payment" or a React
    // StrictMode double-invoke that runs PaymentModal.confirmPayment twice in
    // quick succession would otherwise throw "UNIQUE constraint failed:
    // orders.idempotency_key". Because PaymentModal wraps the whole flow in a
    // single try/catch with a generic toast, this surfaces to the cashier as
    // "Payment not recorded. Try again." even though order + payments rows
    // were actually persisted on the first pass.
    //
    // To fix:
    //   (1) If an idempotency_key is supplied, try SELECT FIRST. If a row
    //       exists with that idempotency key, return the existing row's id
    //       immediately as if the create succeeded. Safe because the caller
    //       guarantees idempotency_key maps 1:1 to orderId.
    //   (2) Otherwise run INSERT OR IGNORE (not plain INSERT). The "OR
    //       IGNORE" path silently swallows the UNIQUE race so this call is
    //       safe even when two create()s race. If rows inserted = 0 and we
    //       supplied an idempotency key, look up the loser-of-the-race row
    //       and return its id instead of throwing.
    if (idempotencyKey) {
      const existing = this.db.get<{ id: string }>(
        'SELECT id FROM orders WHERE idempotency_key = ? LIMIT 1',
        idempotencyKey
      );
      if (existing && existing.id) return String(existing.id);
    }

    const result = this.db.run(
      `INSERT OR IGNORE INTO orders (
        id, branch_id, restaurant_id, order_number, source, order_type,
        table_id, table_session_id, customer_id, customer_name, customer_phone, customer_email, employee_id,
        held_by, held_at, status, payment_status, payment_method, paid_amount_cents, balance_due_cents, subtotal_cents,
        discount_cents, tax_cents, total_cents, tip_cents, change_due_cents,
        discount_id, note, split_group_id, idempotency_key, server_version,
        local_version, synced, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @restaurant_id, @order_number, @source, @order_type,
        @table_id, @table_session_id, @customer_id, @customer_name, @customer_phone, @customer_email, @employee_id,
        @held_by, @held_at, @status, @payment_status, @payment_method, @paid_amount_cents, @balance_due_cents, @subtotal_cents,
        @discount_cents, @tax_cents, @total_cents, @tip_cents, @change_due_cents,
        @discount_id, @note, @split_group_id, @idempotency_key,
        COALESCE(@server_version, 0), COALESCE(@local_version, 1),
        COALESCE(@synced, 0),
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )`,
      data
    );
    if (result && typeof result.changes === 'number' && result.changes > 0) {
      return data.id;
    }
    if (idempotencyKey) {
      const fallback = this.db.get<{ id: string }>(
        'SELECT id FROM orders WHERE idempotency_key = ? LIMIT 1',
        idempotencyKey
      );
      if (fallback && fallback.id) return String(fallback.id);
    }
    return data.id;
  }

  updateStatus(id: string, status: string): void {
    this.db.run(
      `UPDATE orders SET status = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      status,
      id
    );
  }

  /** Atomic counter-pay update: patches order payment fields AND returns the
   *  post-update row. Called exclusively from the IPC bridge which also writes
   *  the matching Payment ledger row inside the same transaction boundary. */
  patchPaymentAndReturn(
    id: string,
    patch: {
      payment_status: string;
      payment_method?: string | null;
      paid_amount_cents: number;
      balance_due_cents: number;
    }
  ): OrderRow | undefined {
    this.db.run(
      `UPDATE orders SET
         payment_status = ?,
         payment_method = COALESCE(?, payment_method),
         paid_amount_cents = ?,
         balance_due_cents = ?,
         updated_at = unixepoch('now')*1000
       WHERE id = ?`,
      patch.payment_status,
      patch.payment_method ?? null,
      patch.paid_amount_cents,
      patch.balance_due_cents,
      id
    );
    return this.getById(id);
  }

  getById(id: string): OrderRow | undefined {
    return this.db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', id);
  }

  listRecent(branchId: string, limit = 50): OrderRow[] {
    // ——— Offline-scoping safety: treat empty branchId as "no filter" ———
    // getActiveBranchId() returns '' when the meta table auth snapshot is
    // missing/corrupted or hasn't been written yet after a fresh install.
    // Without this guard the query becomes WHERE branch_id = '' → 0 rows,
    // which surfaces to the cashier as a completely empty History panel even
    // though dozens of sales are saved locally (the "History not populating"
    // bug). Falling back to an unfiltered list matches the browser-mode mock
    // shim parity and is safe because orders never leave the local device;
    // shift totals and close-shift reports use shift_id + time-window scoping
    // so they never double-count.
    if (!branchId) {
      return this.db.all<OrderRow>(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT ?',
        limit
      );
    }
    return this.db.all<OrderRow>(
      'SELECT * FROM orders WHERE branch_id = ? ORDER BY created_at DESC LIMIT ?',
      branchId,
      limit
    );
  }

  listHeld(employeeId?: string): OrderRow[] {
    if (employeeId) {
      return this.db.all<OrderRow>(
        `SELECT * FROM orders WHERE held_by = ? AND status = 'ON_HOLD' ORDER BY held_at DESC`,
        employeeId
      );
    }
    return this.db.all<OrderRow>(
      `SELECT * FROM orders WHERE status = 'ON_HOLD' ORDER BY held_at DESC`
    );
  }

  setHeld(id: string, by: string, at: number | null = null): void {
    const heldAt = at ?? Date.now();
    this.db.run(
      `UPDATE orders SET held_by = ?, held_at = ?, status = 'ON_HOLD', updated_at = unixepoch('now')*1000 WHERE id = ?`,
      by,
      heldAt,
      id
    );
  }

  addItem(orderId: string, itemRow: Partial<OrderItemRow> & { id: string }): void {
    // INSERT OR IGNORE so repeated calls for the same lineId are safe (double
    // click on confirm, StrictMode double-invoke, …). order_items.id is the
    // PRIMARY KEY (migrations.ts L460) so a duplicate INSERT used to throw a
    // "NOT NULL constraint" → PaymentModal catch fires "Payment not recorded".
    this.db.run(
      `INSERT OR IGNORE INTO order_items (
        id, order_id, menu_item_id, name_snapshot, price_snapshot_cents,
        quantity, subtotal_cents, tax_cents, discount_cents, total_cents,
        special_instructions, preparation_status
      ) VALUES (
        @id, @order_id, @menu_item_id, @name_snapshot, @price_snapshot_cents,
        @quantity, @subtotal_cents, @tax_cents, @discount_cents, @total_cents,
        @special_instructions, @preparation_status
      )`,
      { order_id: orderId, ...itemRow }
    );
  }

  removeItem(orderItemId: string): void {
    this.db.run('DELETE FROM order_item_modifier_options WHERE order_item_id = ?', orderItemId);
    this.db.run('DELETE FROM order_items WHERE id = ?', orderItemId);
  }

  /** Danger: cascade-wipe every order + order item + modifier option row in
   *  the local SQLite database (not the remote server). Used by the Manager
   *  Tools → "Clear local orders & sales data" action so the POS kiosk can
   *  start taking 100% fresh orders without the old seeded/demo rows leaking
   *  into the new shift totals after the server-side purge has already been
   *  performed on the Admin dashboard. */
  deleteAll(branchId?: string): {
    ordersDeleted: number;
    orderItemsDeleted: number;
    modifiersDeleted: number;
  } {
    const branchClause =
      typeof branchId === 'string' && branchId ? 'WHERE branch_id = ?' : '';
    const params: unknown[] = typeof branchId === 'string' && branchId ? [branchId] : [];

    const modifierResult = this.db.run(
      `DELETE FROM order_item_modifier_options
       WHERE order_item_id IN (
         SELECT id FROM order_items WHERE order_id IN (
           SELECT id FROM orders ${branchClause}
         )
       )`,
      ...params
    );
    const itemsResult = this.db.run(
      `DELETE FROM order_items WHERE order_id IN (
         SELECT id FROM orders ${branchClause}
       )`,
      ...params
    );
    const ordersResult = this.db.run(
      `DELETE FROM orders ${branchClause}`,
      ...params
    );
    return {
      ordersDeleted: ordersResult?.changes ?? 0,
      orderItemsDeleted: itemsResult?.changes ?? 0,
      modifiersDeleted: modifierResult?.changes ?? 0,
    };
  }

  listByShiftId(shiftId: string, limit = 200): OrderRow[] {
    return this.db.all<OrderRow>(
      `SELECT o.* FROM orders o
       INNER JOIN payments p ON p.order_id = o.id
       WHERE p.shift_id = ?
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT ?`,
      shiftId,
      limit
    );
  }

  listByTable(tableId: string, activeOnly = false): OrderRow[] {
    const clauses: string[] = ['table_id = ?'];
    const params: unknown[] = [tableId];
    if (activeOnly) {
      clauses.push("status NOT IN ('COMPLETED','CANCELLED','VOIDED','REFUNDED')");
    }
    return this.db.all<OrderRow>(
      `SELECT * FROM orders WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      ...params
    );
  }

  getTotals(orderId: string): {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    itemCount: number;
  } {
    const row = this.db.get<{
      s: number;
      d: number;
      t: number;
      tot: number;
      n: number;
    }>(
      `SELECT
        COALESCE(SUM(subtotal_cents),0) s,
        COALESCE(SUM(discount_cents),0) d,
        COALESCE(SUM(tax_cents),0) t,
        COALESCE(SUM(total_cents),0) tot,
        COUNT(*) n
       FROM order_items WHERE order_id = ?`,
      orderId
    );
    return {
      subtotal: row?.s ?? 0,
      discount: row?.d ?? 0,
      tax: row?.t ?? 0,
      total: row?.tot ?? 0,
      itemCount: row?.n ?? 0,
    };
  }

  syncClaimPendingForUpload(
    batchSize: number,
    _deviceId: string
  ): OrderRow[] {
    return this.db.all<OrderRow>(
      `SELECT * FROM orders
       WHERE synced = 0 AND status NOT IN ('CANCELLED','VOIDED')
       ORDER BY created_at ASC
       LIMIT ?`,
      batchSize
    );
  }
}

export class OrderItemsRepository {
  constructor(private db: PosDatabase) {}

  listByOrderId(orderId: string): OrderItemRow[] {
    return this.db.all<OrderItemRow>(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC',
      orderId
    );
  }

  /** Update quantity and subtotal for an existing line. Used by the
   *  running-tab system when attendants edit a cart line live. */
  updateQtyAndSubtotal(
    orderItemId: string,
    quantity: number,
    subtotalCents: number
  ): void {
    this.db.run(
      `UPDATE order_items SET
         quantity = ?,
         subtotal_cents = ?,
         total_cents = COALESCE(total_cents, 0) + (? - COALESCE(
           (SELECT subtotal_cents FROM order_items WHERE id = ?), 0))
       WHERE id = ?`,
      quantity,
      subtotalCents,
      subtotalCents,
      orderItemId,
      orderItemId
    );
    // Keep the arithmetic simple — write the subtotal again directly:
    this.db.run(
      `UPDATE order_items SET subtotal_cents = ?, quantity = ? WHERE id = ?`,
      subtotalCents,
      quantity,
      orderItemId
    );
  }

  bulkInsert(items: (Partial<OrderItemRow> & { id: string })[]): void {
    if (items.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO order_items (
        id, order_id, menu_item_id, name_snapshot, price_snapshot_cents,
        quantity, subtotal_cents, tax_cents, discount_cents, total_cents,
        special_instructions, preparation_status
      ) VALUES (
        @id, @order_id, @menu_item_id, @name_snapshot, @price_snapshot_cents,
        @quantity, @subtotal_cents, @tax_cents, @discount_cents, @total_cents,
        @special_instructions, @preparation_status
      )
    `);
    this.db.transaction(() => {
      for (const item of items) stmt.run(item);
    })();
  }
}

export class OrderItemModifierOptionsRepository {
  constructor(private db: PosDatabase) {}

  listByOrderId(orderId: string): OrderItemModifierOptionRow[] {
    return this.db.all<OrderItemModifierOptionRow>(
      `SELECT omo.* FROM order_item_modifier_options omo
       INNER JOIN order_items oi ON oi.id = omo.order_item_id
       WHERE oi.order_id = ?`,
      orderId
    );
  }

  bulkInsert(items: (Partial<OrderItemModifierOptionRow> & { id: string })[]): void {
    if (items.length === 0) return;
    // INSERT OR IGNORE: the primary key idempotency (same pattern as orders +
    // payments + sync_queue: if PaymentModal runs twice the rows were already
    // written, skip silently. Without this, a double click would throw a
    // SQLite PRIMARY KEY constraint "UNIQUE" → generic PaymentModal toast.
    const stmt = this.db['prepare'] ? this.db['prepare'](`
      INSERT OR IGNORE INTO order_item_modifier_options (
        id, order_item_id, modifier_id, modifier_name, option_id,
        option_name, price_delta_cents
      ) VALUES (
        @id, @order_item_id, @modifier_id, @modifier_name, @option_id,
        @option_name, @price_delta_cents
      )
    `) : null;
    this.db.transaction(() => {
      if (stmt) {
        for (const item of items) stmt.run(item);
      } else {
        for (const item of items) {
          this.db.run(
            `INSERT OR IGNORE INTO order_item_modifier_options (
              id, order_item_id, modifier_id, modifier_name, option_id,
              option_name, price_delta_cents
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            item.id,
            item.order_item_id,
            item.modifier_id,
            item.modifier_name,
            item.option_id,
            item.option_name,
            item.price_delta_cents
          );
        }
      }
    })();
  }
}
