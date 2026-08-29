import type { PosDatabase } from '../database';
import type {
  KitchenOrderRow,
  KitchenOrderItemRow,
  InventoryItemRow,
  InventoryTransactionRow,
} from '../types';

export class KitchenOrdersRepository {
  constructor(private db: PosDatabase) {}

  createFromOrder(
    orderId: string,
    items: (Partial<KitchenOrderItemRow> & { id: string; order_item_id: string })[]
  ): string | null {
    const order = this.db.get<{
      id: string;
      branch_id: string | null;
    }>('SELECT id, branch_id FROM orders WHERE id = ?', orderId);
    if (!order) return null;

    const kitchenOrderId = `ko_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO kitchen_orders (
          id, order_id, branch_id, station, status, priority, started_at,
          ready_at, completed_at, served_by, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'NEW', 'NORMAL', NULL, NULL, NULL, NULL, ?, ?)`,
        kitchenOrderId,
        orderId,
        order.branch_id,
        now,
        now
      );
      const stmt = this.db['prepare'](`
        INSERT INTO kitchen_order_items (
          id, kitchen_order_id, order_item_id, menu_item_id, menu_item_name,
          qty, special_instructions, status
        ) VALUES (
          @id, @kitchen_order_id, @order_item_id, @menu_item_id,
          @menu_item_name, @qty, @special_instructions,
          COALESCE(@status, 'NEW')
        )
      `);
      for (const item of items) {
        stmt.run({ kitchen_order_id: kitchenOrderId, ...item });
      }
    })();

    return kitchenOrderId;
  }

  updateStatus(id: string, status: string): void {
    const now = Date.now();
    const sets = [`status = '${status.replace(/'/g, "''")}'`];
    if (status === 'PREPARING') sets.push(`started_at = ${now}`);
    if (status === 'READY') sets.push(`ready_at = ${now}`);
    if (status === 'COMPLETED') sets.push(`completed_at = ${now}`);
    sets.push(`updated_at = unixepoch('now')*1000`);
    this.db.run(`UPDATE kitchen_orders SET ${sets.join(', ')} WHERE id = ?`, id);
  }

  listByStatus(branchId: string, statuses: string[]): KitchenOrderRow[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    return this.db.all<KitchenOrderRow>(
      `SELECT * FROM kitchen_orders WHERE branch_id = ? AND status IN (${placeholders}) ORDER BY created_at ASC`,
      branchId,
      ...statuses
    );
  }

  bumpByOrder(orderId: string): void {
    this.db.run(
      `UPDATE kitchen_orders SET priority = 'URGENT', updated_at = unixepoch('now')*1000 WHERE order_id = ?`,
      orderId
    );
  }
}

export class InventoryItemsRepository {
  constructor(private db: PosDatabase) {}

  list(
    branchId: string,
    filters?: { lowStockOnly?: boolean; supplierId?: string }
  ): InventoryItemRow[] {
    const clauses: string[] = ['branch_id = ?'];
    const params: unknown[] = [branchId];
    if (filters?.lowStockOnly) {
      clauses.push('current_stock_level <= min_stock_level');
    }
    if (filters?.supplierId) {
      clauses.push('supplier_id = ?');
      params.push(filters.supplierId);
    }
    return this.db.all<InventoryItemRow>(
      `SELECT * FROM inventory_items WHERE ${clauses.join(' AND ')} ORDER BY name ASC`,
      ...params
    );
  }

  listLowStock(branchId: string): InventoryItemRow[] {
    return this.list(branchId, { lowStockOnly: true });
  }

  updateStock(id: string, delta: number, tx?: unknown): void {
    const fn = () => {
      this.db.run(
        `UPDATE inventory_items SET
          current_stock_level = COALESCE(current_stock_level, 0) + ?,
          last_counted_at = unixepoch('now')*1000,
          updated_at = unixepoch('now')*1000
         WHERE id = ?`,
        delta,
        id
      );
    };
    if (tx === undefined) {
      this.db.transaction(fn)();
    } else {
      fn();
    }
  }

  findById(id: string): InventoryItemRow | undefined {
    return this.db.get<InventoryItemRow>('SELECT * FROM inventory_items WHERE id = ?', id);
  }

  upsertMany(rows: Partial<InventoryItemRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO inventory_items (
        id, branch_id, sku, name, unit, supplier_id, current_stock_level,
        min_stock_level, unit_cost_cents, last_counted_at, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @sku, @name, @unit, @supplier_id, @current_stock_level,
        @min_stock_level, @unit_cost_cents, @last_counted_at,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        sku = excluded.sku,
        name = excluded.name,
        unit = excluded.unit,
        supplier_id = excluded.supplier_id,
        current_stock_level = excluded.current_stock_level,
        min_stock_level = excluded.min_stock_level,
        unit_cost_cents = excluded.unit_cost_cents,
        last_counted_at = excluded.last_counted_at,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }
}

export class InventoryTransactionsRepository {
  constructor(private db: PosDatabase) {}

  listByItemId(
    itemId: string,
    filters?: { from?: number; to?: number; limit?: number }
  ): InventoryTransactionRow[] {
    const clauses: string[] = ['inventory_item_id = ?'];
    const params: unknown[] = [itemId];
    if (filters?.from) {
      clauses.push('performed_at >= ?');
      params.push(filters.from);
    }
    if (filters?.to) {
      clauses.push('performed_at <= ?');
      params.push(filters.to);
    }
    const limit = filters?.limit ?? 100;
    return this.db.all<InventoryTransactionRow>(
      `SELECT * FROM inventory_transactions WHERE ${clauses.join(' AND ')} ORDER BY performed_at DESC LIMIT ?`,
      ...params,
      limit
    );
  }

  listByShiftId(shiftId: string): InventoryTransactionRow[] {
    return this.db.all<InventoryTransactionRow>(
      `SELECT * FROM inventory_transactions WHERE reference_id = ? ORDER BY performed_at ASC`,
      shiftId
    );
  }

  create(txRow: Partial<InventoryTransactionRow> & { id: string }): string {
    this.db.run(
      `INSERT INTO inventory_transactions (
        id, inventory_item_id, branch_id, reference_id, reference_type, type,
        qty, unit_cost_cents, reason, performed_by, performed_at
      ) VALUES (
        @id, @inventory_item_id, @branch_id, @reference_id, @reference_type,
        @type, @qty, @unit_cost_cents, @reason, @performed_by,
        COALESCE(@performed_at, unixepoch('now')*1000)
      )`,
      txRow
    );
    return txRow.id;
  }
}
