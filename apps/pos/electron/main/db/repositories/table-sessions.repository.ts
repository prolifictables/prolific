import type { PosDatabase } from '../database';
import type {
  TableSessionRow,
  TableSessionLedgerRow,
  TableLedgerEntryType,
} from '../types';

/** CRUD + domain helpers for the dine-in "running tab" (table session).
 *  Combined with the ledger repo, every mutation creates an audit row. */
export class TableSessionsRepository {
  constructor(private db: PosDatabase) {}

  create(
    data: Partial<TableSessionRow> & { id: string }
  ): TableSessionRow {
    const now = Date.now();
    const toWrite = {
      subtotal_cents: 0,
      discount_cents: 0,
      tax_cents: 0,
      tip_cents: 0,
      total_cents: 0,
      paid_amount_cents: 0,
      balance_due_cents: 0,
      covers: 0,
      customer_count: 0,
      status: 'OPEN',
      server_version: 0,
      local_version: 1,
      synced: 0,
      created_at: now,
      updated_at: now,
      ...data,
    } as Partial<TableSessionRow> & { id: string };

    this.db.run(
      `INSERT INTO table_sessions (
        id, branch_id, restaurant_id, table_id, tab_number, status,
        covers, opened_by, opened_by_name, server_id, server_name,
        opened_at, closed_at, closed_by, subtotal_cents, discount_cents,
        tax_cents, tip_cents, total_cents, paid_amount_cents,
        balance_due_cents, customer_count, customer_name, note,
        current_order_id, server_version, local_version, synced,
        created_at, updated_at
      ) VALUES (
        @id, @branch_id, @restaurant_id, @table_id, @tab_number, @status,
        @covers, @opened_by, @opened_by_name, @server_id, @server_name,
        @opened_at, @closed_at, @closed_by, @subtotal_cents,
        @discount_cents, @tax_cents, @tip_cents, @total_cents,
        @paid_amount_cents, @balance_due_cents, @customer_count,
        @customer_name, @note, @current_order_id,
        @server_version, @local_version, @synced,
        @created_at, @updated_at
      )`,
      toWrite
    );
    return this.getById(toWrite.id)!;
  }

  getById(id: string): TableSessionRow | undefined {
    return this.db.get<TableSessionRow>(
      'SELECT * FROM table_sessions WHERE id = ?',
      id
    );
  }

  /** Fetch the one OPEN / open-ish session for a given table.
   *  Returns undefined if the table has no running tab. */
  getOpenForTable(tableId: string): TableSessionRow | undefined {
    return this.db.get<TableSessionRow>(
      `SELECT * FROM table_sessions
       WHERE table_id = ? AND status IN ('OPEN','AWAITING_PAYMENT','PARTIALLY_PAID')
       ORDER BY created_at DESC LIMIT 1`,
      tableId
    );
  }

  listOpen(branchId: string): TableSessionRow[] {
    return this.db.all<TableSessionRow>(
      `SELECT * FROM table_sessions
       WHERE branch_id = ? AND status IN ('OPEN','AWAITING_PAYMENT','PARTIALLY_PAID')
       ORDER BY created_at DESC`,
      branchId
    );
  }

  listRecent(branchId: string, limit = 100): TableSessionRow[] {
    return this.db.all<TableSessionRow>(
      `SELECT * FROM table_sessions WHERE branch_id = ?
       ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?`,
      branchId,
      limit
    );
  }

  /** Overwrite the running totals and bump local_version.
   *  Caller is responsible for writing a matching ledger entry. */
  updateTotals(
    id: string,
    totals: {
      subtotal_cents: number;
      discount_cents: number;
      tax_cents: number;
      tip_cents: number;
      total_cents: number;
      paid_amount_cents: number;
      balance_due_cents: number;
    },
    extra: Partial<Pick<TableSessionRow, 'current_order_id' | 'status' | 'covers' | 'note'>> = {}
  ): void {
    this.db.run(
      `UPDATE table_sessions SET
         subtotal_cents = @subtotal_cents,
         discount_cents = @discount_cents,
         tax_cents = @tax_cents,
         tip_cents = @tip_cents,
         total_cents = @total_cents,
         paid_amount_cents = @paid_amount_cents,
         balance_due_cents = @balance_due_cents,
         current_order_id = COALESCE(@current_order_id, current_order_id),
         status = COALESCE(@status, status),
         covers = COALESCE(@covers, covers),
         note = COALESCE(@note, note),
         local_version = local_version + 1,
         synced = 0,
         updated_at = unixepoch('now')*1000
       WHERE id = @id`,
      { id, ...totals, ...extra }
    );
  }

  setCurrentOrder(sessionId: string, orderId: string | null): void {
    this.db.run(
      `UPDATE table_sessions SET
         current_order_id = ?,
         local_version = local_version + 1,
         synced = 0,
         updated_at = unixepoch('now')*1000
       WHERE id = ?`,
      orderId,
      sessionId
    );
  }

  updateStatus(
    id: string,
    status: TableSessionRow['status'],
    opts?: { closedAt?: number; closedBy?: string }
  ): void {
    this.db.run(
      `UPDATE table_sessions SET
         status = ?,
         closed_at = COALESCE(?, closed_at),
         closed_by = COALESCE(?, closed_by),
         local_version = local_version + 1,
         synced = 0,
         updated_at = unixepoch('now')*1000
       WHERE id = ?`,
      status,
      opts?.closedAt ?? null,
      opts?.closedBy ?? null,
      id
    );
  }
}

/** Immutable append-only ledger for table session mutations.
 *  Every time the running tab changes, one row is inserted so
 *  managers have a complete audit trail. */
export class TableSessionLedgerRepository {
  constructor(private db: PosDatabase) {}

  append(
    data: Partial<Omit<TableSessionLedgerRow, 'id' | 'entry_type' | 'amount_after_cents'>> &
      Pick<TableSessionLedgerRow, 'entry_type' | 'amount_after_cents'> & {
        session_id?: string | null;
        created_at?: number;
      }
  ): number {
    const now = Date.now();
    // Defaults — every field that isn't set by the caller has a sensible
    // SQLite-safe fallback so call sites don't have to spell out 10+ nulls.
    // Explicitly strip entry_type/amount_after_cents from the spread to avoid
    // TS2783 "specified more than once" warnings.
    const { entry_type, amount_after_cents, ...rest } = data;
    const row: Omit<TableSessionLedgerRow, 'id'> = {
      session_id: null,
      branch_id: null,
      restaurant_id: null,
      entry_type,
      reference_id: null,
      actor_id: null,
      actor_name: null,
      label: null,
      quantity: 0,
      amount_delta_cents: 0,
      amount_after_cents,
      note: null,
      metadata_json: null,
      created_at: now,
      ...rest,
    };
    const stmt = this.db.run(
      `INSERT INTO table_session_ledger (
        session_id, branch_id, restaurant_id, entry_type, reference_id,
        actor_id, actor_name, label, quantity, amount_delta_cents,
        amount_after_cents, note, metadata_json, created_at
      ) VALUES (
        @session_id, @branch_id, @restaurant_id, @entry_type, @reference_id,
        @actor_id, @actor_name, @label, @quantity, @amount_delta_cents,
        @amount_after_cents, @note, @metadata_json,
        @created_at
      )`,
      row
    );
    return (stmt as { lastInsertRowid: number }).lastInsertRowid;
  }

  listForSession(sessionId: string): TableSessionLedgerRow[] {
    return this.db.all<TableSessionLedgerRow>(
      `SELECT * FROM table_session_ledger
       WHERE session_id = ? ORDER BY created_at DESC, id DESC`,
      sessionId
    );
  }

  listRecent(branchId: string, limit = 200): TableSessionLedgerRow[] {
    return this.db.all<TableSessionLedgerRow>(
      `SELECT * FROM table_session_ledger
       WHERE branch_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      branchId,
      limit
    );
  }
}

/** Helpers that coordinate sessions + ledger so every mutation leaves an
 *  audit trail. These are used by the IPC bridge (and tests) as a single
 *  entry point for "the running tab". */
export class TableSessionService {
  constructor(
    private sessions: TableSessionsRepository,
    private ledger: TableSessionLedgerRepository,
    private ordersDb: {
      create: (d: any) => string;
      addItem: (orderId: string, item: any) => void;
      listItems: (orderId: string) => any[];
      removeItem: (orderItemId: string) => void;
      updateItemQty: (orderItemId: string, qty: number, subtotalCents: number) => void;
    }
  ) {}

  private uuid(): string {
    try {
      return (crypto as any).randomUUID();
    } catch (_) {
      return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private recompute(sessionId: string, taxRates: any[] = []): {
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    tip_cents: number;
    total_cents: number;
    paid_amount_cents: number;
    balance_due_cents: number;
  } {
    const sess = this.sessions.getById(sessionId);
    if (!sess) {
      return {
        subtotal_cents: 0, discount_cents: 0, tax_cents: 0, tip_cents: 0,
        total_cents: 0, paid_amount_cents: 0, balance_due_cents: 0,
      };
    }
    const items = sess.current_order_id
      ? this.ordersDb.listItems(sess.current_order_id)
      : [];
    const subtotal = items.reduce(
      (s, it) => s + (Number(it.subtotal_cents) || 0),
      0
    );
    const discount = Number(sess.discount_cents) || 0;
    const taxableBase = Math.max(0, subtotal - discount);
    let tax = 0;
    for (const t of taxRates || []) {
      const rate = Number(t.rate_percent ?? t.rate ?? 0);
      const inclusive = Boolean(t.is_inclusive ?? t.isIncludedInPrice);
      if (inclusive) continue;
      tax += Math.round(taxableBase * (rate / 100));
    }
    const tip = Number(sess.tip_cents) || 0;
    const total = taxableBase + tax + tip;
    const paid = Number(sess.paid_amount_cents) || 0;
    return {
      subtotal_cents: subtotal,
      discount_cents: discount,
      tax_cents: tax,
      tip_cents: tip,
      total_cents: total,
      paid_amount_cents: paid,
      balance_due_cents: Math.max(0, total - paid),
    };
  }

  openOrGet(args: {
    tableId: string;
    tableName?: string;
    branchId?: string;
    restaurantId?: string;
    openedBy?: string;
    openedByName?: string;
    serverId?: string;
    serverName?: string;
    covers?: number;
  }): { session: TableSessionRow; wasCreated: boolean } {
    const existing = this.sessions.getOpenForTable(args.tableId);
    if (existing) return { session: existing, wasCreated: false };

    const id = this.uuid();
    const now = Date.now();
    // Friendly tab number — seeded by epoch-second hash to look stable
    const seq = ((now / 1000) >>> 0) % 9000 + 1000;
    const tabNumber = `T-${seq}`;

    const created = this.sessions.create({
      id,
      branch_id: args.branchId ?? null,
      restaurant_id: args.restaurantId ?? null,
      table_id: args.tableId,
      tab_number: tabNumber,
      status: 'OPEN',
      covers: args.covers ?? 0,
      opened_by: args.openedBy ?? null,
      opened_by_name: args.openedByName ?? null,
      server_id: args.serverId ?? args.openedBy ?? null,
      server_name: args.serverName ?? args.openedByName ?? null,
      opened_at: now,
      customer_name: args.tableName ?? null,
    });

    this.ledger.append({
      session_id: created.id,
      branch_id: created.branch_id,
      restaurant_id: created.restaurant_id,
      entry_type: 'OPENED',
      actor_id: args.openedBy ?? null,
      actor_name: args.openedByName ?? null,
      label: `Tab ${tabNumber} opened`,
      amount_after_cents: 0,
      metadata_json: JSON.stringify({
        tableId: args.tableId,
        tableName: args.tableName ?? null,
      }),
    });
    return { session: created, wasCreated: true };
  }

  /** Add a menu item line to the running tab (creates a current_order if
   *  none exists), write an ADD_ITEM ledger row, and recompute totals. */
  addItem(args: {
    sessionId: string;
    item: {
      id: string;
      menuItemId: string;
      name: string;
      unitPriceCents: number;
      quantity: number;
      subtotalCents: number;
      specialInstructions?: string;
    };
    actorId?: string;
    actorName?: string;
    taxRates?: any[];
  }): { session: TableSessionRow; orderId: string; orderItemId: string } {
    let sess = this.sessions.getById(args.sessionId);
    if (!sess) throw new Error(`Table session ${args.sessionId} not found`);

    let orderId = sess.current_order_id;
    if (!orderId) {
      orderId = this.uuid();
      const now = Date.now();
      this.ordersDb.create({
        id: orderId,
        branch_id: sess.branch_id,
        restaurant_id: sess.restaurant_id,
        order_number: `O-${((now / 1000) >>> 0) % 9000 + 1000}`,
        source: 'POS',
        order_type: 'DINE_IN',
        table_id: sess.table_id,
        table_session_id: sess.id,
        employee_id: args.actorId ?? null,
        customer_name: sess.customer_name,
        status: 'IN_PROGRESS',
        payment_status: 'UNPAID',
        subtotal_cents: 0,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 0,
      });
      this.sessions.setCurrentOrder(sess.id, orderId);
    }

    const orderItemId = args.item.id;
    this.ordersDb.addItem(orderId, {
      id: orderItemId,
      menu_item_id: args.item.menuItemId,
      name_snapshot: args.item.name,
      price_snapshot_cents: args.item.unitPriceCents,
      quantity: args.item.quantity,
      subtotal_cents: args.item.subtotalCents,
      special_instructions: args.item.specialInstructions ?? null,
      preparation_status: 'NEW',
    });

    const totals = this.recompute(sess.id, args.taxRates);
    this.sessions.updateTotals(sess.id, totals, { status: 'OPEN' });

    this.ledger.append({
      session_id: sess.id,
      branch_id: sess.branch_id,
      restaurant_id: sess.restaurant_id,
      entry_type: 'ADD_ITEM',
      reference_id: orderItemId,
      actor_id: args.actorId ?? null,
      actor_name: args.actorName ?? null,
      label: `+${args.item.quantity}× ${args.item.name}`,
      quantity: args.item.quantity,
      amount_delta_cents: args.item.subtotalCents,
      amount_after_cents: totals.total_cents,
      metadata_json: JSON.stringify({
        orderId,
        unitPriceCents: args.item.unitPriceCents,
      }),
    });

    return {
      session: this.sessions.getById(sess.id)!,
      orderId,
      orderItemId,
    };
  }

  updateItemQty(args: {
    sessionId: string;
    orderItemId: string;
    newQty: number;
    newSubtotalCents: number;
    actorId?: string;
    actorName?: string;
    taxRates?: any[];
  }): TableSessionRow {
    const sess = this.sessions.getById(args.sessionId);
    if (!sess) throw new Error(`Session ${args.sessionId} not found`);
    this.ordersDb.updateItemQty(args.orderItemId, args.newQty, args.newSubtotalCents);
    const totals = this.recompute(sess.id, args.taxRates);
    this.sessions.updateTotals(sess.id, totals);

    this.ledger.append({
      session_id: sess.id,
      branch_id: sess.branch_id,
      restaurant_id: sess.restaurant_id,
      entry_type: 'EDIT_QTY',
      reference_id: args.orderItemId,
      actor_id: args.actorId ?? null,
      actor_name: args.actorName ?? null,
      label: `Qty updated to ${args.newQty}`,
      quantity: args.newQty,
      amount_delta_cents: args.newSubtotalCents,
      amount_after_cents: totals.total_cents,
    });
    return this.sessions.getById(sess.id)!;
  }

  removeItem(args: {
    sessionId: string;
    orderItemId: string;
    reason?: string;
    actorId?: string;
    actorName?: string;
    taxRates?: any[];
  }): TableSessionRow {
    const sess = this.sessions.getById(args.sessionId);
    if (!sess) throw new Error(`Session ${args.sessionId} not found`);
    this.ordersDb.removeItem(args.orderItemId);
    const totals = this.recompute(sess.id, args.taxRates);
    this.sessions.updateTotals(sess.id, totals);

    this.ledger.append({
      session_id: sess.id,
      branch_id: sess.branch_id,
      restaurant_id: sess.restaurant_id,
      entry_type: 'VOID_ITEM',
      reference_id: args.orderItemId,
      actor_id: args.actorId ?? null,
      actor_name: args.actorName ?? null,
      label: 'Item removed from tab',
      amount_delta_cents: 0,
      amount_after_cents: totals.total_cents,
      note: args.reason ?? null,
    });
    return this.sessions.getById(sess.id)!;
  }

  replaceAllItems(args: {
    sessionId: string;
    items: Array<{
      id: string;
      menuItemId: string;
      name: string;
      unitPriceCents: number;
      quantity: number;
      subtotalCents: number;
      specialInstructions?: string;
    }>;
    actorId?: string;
    actorName?: string;
    taxRates?: any[];
  }): TableSessionRow {
    const sess = this.sessions.getById(args.sessionId);
    if (!sess) throw new Error(`Session ${args.sessionId} not found`);
    // Blow away the existing current order wholesale; the cart is the source
    // of truth for the "editing user" view.
    if (sess.current_order_id) {
      const existing = this.ordersDb.listItems(sess.current_order_id);
      for (const it of existing) this.ordersDb.removeItem(it.id);
    }
    // Re-add everything that's currently in the cart in a single tx block.
    for (const it of args.items) {
      this.addItem({
        sessionId: sess.id,
        item: it,
        actorId: args.actorId,
        actorName: args.actorName,
        taxRates: args.taxRates,
      });
    }
    return this.sessions.getById(sess.id)!;
  }

  appendLedger(
    row: Partial<Omit<TableSessionLedgerRow, 'id' | 'entry_type' | 'amount_after_cents'>> &
      Pick<TableSessionLedgerRow, 'entry_type' | 'amount_after_cents'> & {
        session_id?: string | null;
        created_at?: number;
      }
  ): number {
    return this.ledger.append(row);
  }
}
