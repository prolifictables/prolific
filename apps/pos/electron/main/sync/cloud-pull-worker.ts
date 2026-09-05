import type { PosDatabase } from '../db/database';
import type { ReposBundle } from '../db';
import type {
  ConnectionStatus,
  SyncEntityType,
  SyncOperation,
  PullResponse,
} from './types';
import { SyncHttpClient, NetworkError } from './client-http';

const PULL_INTERVAL_MS = 30_000;
const PULL_PAGE_LIMIT = 50;

const PULL_ORDER: SyncEntityType[] = [
  'MENU_CATEGORY',
  'MENU_MODIFIER',
  'TAX',
  'DISCOUNT',
  'MENU_ITEM',
  'TABLE',
  'CUSTOMER',
  'EMPLOYEE',
  'INVENTORY_ITEM',
  'RECIPE',
  'RECIPE_INGREDIENT',
  'SETTING',
  'QR_CODE',
  'SHIFT',
  'CASH_ADJUSTMENT',
  'ORDER',
  'ORDER_ITEM',
  'ORDER_ITEM_MODIFIER_OPTION',
  'PAYMENT',
  'KITCHEN_ORDER',
  'KITCHEN_ORDER_ITEM',
  'INVENTORY_TRANSACTION',
];

type GetAuthFn = () => { accessToken?: string; deviceId?: string; branchId?: string };

interface SnapshotRow {
  __op: SyncOperation;
  __entityType: SyncEntityType;
  id: string;
  [key: string]: any;
}

export class PullWorker {
  private readonly repos: ReposBundle;
  private readonly db: PosDatabase | undefined;
  private readonly httpClient: SyncHttpClient;
  private readonly getAuthFn: GetAuthFn;
  private readonly onChangeStatus?: (s: ConnectionStatus) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pullInProgress = false;
  private immediateRequested = false;

  constructor(
    repos: ReposBundle,
    db: PosDatabase | undefined,
    httpClient: SyncHttpClient,
    getAuthFn: GetAuthFn,
    onChangeStatus?: (s: ConnectionStatus) => void
  ) {
    this.repos = repos;
    this.db = db;
    this.httpClient = httpClient;
    this.getAuthFn = getAuthFn;
    this.onChangeStatus = onChangeStatus;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.runPullAll();
    }, PULL_INTERVAL_MS);
    void this.runPullAll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  requestNow(): void {
    this.immediateRequested = true;
    void this.runPullAll();
  }

  private setStatus(s: ConnectionStatus): void {
    this.onChangeStatus?.(s);
  }

  private async runPullAll(): Promise<void> {
    if (!this.running) return;
    if (this.pullInProgress) return;
    const auth = this.getAuthFn();
    if (!auth.branchId) return;

    this.pullInProgress = true;
    let networkErrorHit = false;

    try {
      for (const entityType of PULL_ORDER) {
        if (networkErrorHit) break;
        try {
          await this.pullEntityType(entityType, auth.branchId);
        } catch (err) {
          if (err instanceof NetworkError) {
            networkErrorHit = true;
            this.setStatus('OFFLINE');
          }
        }
      }
    } finally {
      this.pullInProgress = false;
      this.immediateRequested = false;
    }
  }

  private async pullEntityType(
    entityType: SyncEntityType,
    branchId: string
  ): Promise<void> {
    let cursor: string | undefined =
      this.repos.meta.getSyncCursor(entityType) ?? undefined;
    let hasMore = true;
    let lastCursor: string | undefined = cursor;

    while (hasMore && this.running) {
      const resp: PullResponse = await this.httpClient.pull({
        entityTypes: [entityType],
        cursor,
        limit: PULL_PAGE_LIMIT,
        branchId,
      });

      if (resp.data && resp.data.length > 0) {
        this.applySnapshots(resp.data as SnapshotRow[]);
      }

      lastCursor = resp.meta.cursor;
      hasMore = resp.meta.hasMore;
      cursor = lastCursor;

      if (!hasMore) {
        if (lastCursor) {
          this.repos.meta.setSyncCursor(entityType, lastCursor);
        }
        break;
      }
    }
  }

  private applySnapshots(rows: SnapshotRow[]): void {
    if (rows.length === 0) return;
    // -------------------------------------------------------------------------
    // PRE-PROCESS PASS 1 — Cross-entity denormalization + child-row extraction
    //
    // Background: the server sync/pull cursor returns each entity independently
    // (ORDER, CUSTOMER, PAYMENT, …) with __entityType. Two relationships require
    // cross-cut processing BEFORE we dispatch to per-entity repo calls:
    //
    //   (A) Customer denormalization — Mongo Order only stores `customerId`; the
    //       name/phone/email live on the CUSTOMER document. POS SQLite stores
    //       them denormalized on orders (customer_name / customer_phone /
    //       customer_email) so that listRecent queries don't need to JOIN. We
    //       join on-the-fly here from any CUSTOMER snapshots in the same pull
    //       batch, and fall back to already-synced rows in the customers table
    //       for older customers pulled in previous batches.
    //
    //   (B) Embedded items flattening — Mongo Order stores items as a nested
    //       `items: OrderItem[]` subdocument array with nested
    //       `modifierOptions[]`. POS SQLite uses relational tables order_items
    //       and order_item_modifier_options. We split the embedded arrays into
    //       individual child rows and inject them into the by-entity dispatch
    //       map so they are written by rawBulkInsertOrderItems / rawBulkInsert-
    //       OrderItemModOpts below.
    //
    // Without (A): every real synced website/QR order has customer_* = NULL, so
    // the POS rail "📞 / 📧" contact chips render blank for real customers.
    // Without (B): order_items table is empty for every pulled website/QR order,
    // so HistoryPanel "8 items · 3 lines", recall-to-cart, and rail "🧾 X items"
    // all display as zero (no line items).
    // -------------------------------------------------------------------------
    const customerSnapshots: SnapshotRow[] = [];
    const orderSnapshots: SnapshotRow[] = [];
    for (const r of rows) {
      if (r.__entityType === 'CUSTOMER') customerSnapshots.push(r as any);
      if (r.__entityType === 'ORDER') orderSnapshots.push(r as any);
    }

    // 2a. Build in-memory customerId → {name,phone,email} lookup from this batch
    const customersById = new Map<string, { fullName?: string; phone?: string; email?: string }>();
    for (const c of customerSnapshots as any[]) {
      const id = String(c.id ?? c._id ?? '');
      if (!id) continue;
      const firstName = c.firstName ?? c.first_name ?? '';
      const lastName = c.lastName ?? c.last_name ?? '';
      const fullName = c.fullName ?? c.full_name ?? (firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || '');
      customersById.set(id, {
        fullName: fullName || undefined,
        phone: c.phone ?? c.phoneNumber ?? c.phone_number ?? undefined,
        email: c.email ?? undefined,
      });
    }
    // 2b. Fallback: look up any CUSTOMER rows already in SQLite for orders whose
    // customer wasn't pulled in this same batch (customers change rarely, orders
    // arrive frequently in subsequent batches).
    const customerLookupFromDb = (custId: string) => {
      if (!custId || !this.db) return undefined;
      try {
        const stmt = this.db['prepare'](`
          SELECT first_name, last_name, phone, email
          FROM customers WHERE id = ? LIMIT 1
        `);
        const row = stmt.get(String(custId)) as any;
        if (!row) return undefined;
        const full = (row.first_name && row.last_name
          ? `${row.first_name} ${row.last_name}`.trim()
          : row.first_name || row.last_name || '');
        return {
          fullName: full || undefined,
          phone: row.phone ?? undefined,
          email: row.email ?? undefined,
        };
      } catch {
        return undefined;
      }
    };

    // 2c. Apply denormalization join to each ORDER snapshot in this batch
    for (const o of orderSnapshots as any[]) {
      const custId = String(o.customerId ?? o.customer_id ?? '');
      if (!custId) continue;
      const cust = customersById.get(custId) ?? customerLookupFromDb(custId);
      if (!cust) continue;
      if (!o.customerName && cust.fullName) o.customerName = cust.fullName;
      if (!o.customerPhone && cust.phone) o.customerPhone = cust.phone;
      if (!o.customerEmail && cust.email) o.customerEmail = cust.email;
    }

    // 3. Split ORDER embedded items[] + modifierOptions[] → child rows.
    //    POS SQLite schema uses a relational model for order_items /
    //    order_item_modifier_options, while Mongo embeds them inside the
    //    single ORDER document. We unpack them here and append synthetic
    //    ORDER_ITEM / ORDER_ITEM_MODIFIER_OPTION snapshot rows to `rows`
    //    so applyCreatesOrUpdates dispatches them below.
    const syntheticChildRows: SnapshotRow[] = [];
    for (const o of orderSnapshots as any[]) {
      const orderId = String(o.id ?? o._id ?? '');
      if (!orderId || !Array.isArray(o.items) || o.items.length === 0) continue;
      for (let i = 0; i < o.items.length; i++) {
        const it = o.items[i];
        // Deterministic order_item id: {orderId}__{i} → stable across
        // re-pulls so ON CONFLICT UPDATE correctly converges to the same row.
        const orderItemId = it.id ?? it._id ?? `${orderId}__${i}`;
        const unitCents =
          typeof it.unitPriceCents === 'number'
            ? it.unitPriceCents
            : typeof it.unitPrice === 'number'
              ? Math.round(it.unitPrice * 100)
              : 0;
        const subCents =
          typeof it.subtotalCents === 'number'
            ? it.subtotalCents
            : typeof it.subtotal === 'number'
              ? Math.round(it.subtotal * 100)
              : unitCents * (it.quantity ?? 1);
        const totalCents =
          typeof it.totalCents === 'number'
            ? it.totalCents
            : typeof it.total === 'number'
              ? Math.round(it.total * 100)
              : Math.max(0, subCents - (it.discountCents ?? 0) + (it.taxCents ?? 0));
        syntheticChildRows.push({
          __entityType: 'ORDER_ITEM',
          __op: 'UPSERT',
          id: String(orderItemId),
          order_id: orderId,
          menu_item_id: String(it.menuItemId ?? it.menu_item_id ?? ''),
          name_snapshot: String(it.menuItemName ?? it.name ?? it.name_snapshot ?? ''),
          price_snapshot_cents: unitCents,
          quantity: typeof it.quantity === 'number' ? it.quantity : 1,
          subtotal_cents: subCents,
          tax_cents: typeof it.taxCents === 'number' ? it.taxCents : 0,
          discount_cents: typeof it.discountCents === 'number' ? it.discountCents : 0,
          total_cents: totalCents,
          special_instructions: it.notes ?? it.notes ?? it.specialInstructions ?? null,
          preparation_status: it.preparationStatus ?? it.preparation_status ?? 'NEW',
        } as any);
        // Flatten nested modifierOptions[] → ORDER_ITEM_MODIFIER_OPTION rows
        if (Array.isArray(it.modifierOptions) && it.modifierOptions.length > 0) {
          for (let j = 0; j < it.modifierOptions.length; j++) {
            const mo = it.modifierOptions[j];
            const modId = mo.modifierId ?? mo.modifier_id;
            const optId = mo.optionId ?? mo.option_id;
            if (!modId || !optId) continue;
            syntheticChildRows.push({
              __entityType: 'ORDER_ITEM_MODIFIER_OPTION',
              __op: 'UPSERT',
              id: `${orderItemId}__${j}`,
              order_item_id: String(orderItemId),
              modifier_id: String(modId),
              modifier_name: String(mo.modifierName ?? mo.modifier_name ?? mo.name ?? ''),
              option_id: String(optId),
              option_name: String(mo.optionName ?? mo.option_name ?? mo.name ?? ''),
              price_delta_cents:
                typeof mo.priceDeltaCents === 'number'
                  ? mo.priceDeltaCents
                  : typeof mo.priceDelta === 'number'
                    ? Math.round(mo.priceDelta * 100)
                    : 0,
            } as any);
          }
        }
      }
    }
    // Append synthesized child rows so the dispatch below sees them.
    const dispatchRows = [...rows, ...syntheticChildRows];

    const byEntity = new Map<SyncEntityType, SnapshotRow[]>();
    for (const r of dispatchRows) {
      const et = r.__entityType;
      const arr = byEntity.get(et) ?? [];
      arr.push(r);
      byEntity.set(et, arr);
    }
    for (const [entityType, group] of byEntity) {
      this.applyEntityGroup(entityType, group);
    }
  }

  private applyEntityGroup(entityType: SyncEntityType, rows: SnapshotRow[]): void {
    if (rows.length === 0) return;
    const creates = rows.filter((r) => r.__op !== 'DELETE');
    const deletes = rows.filter((r) => r.__op === 'DELETE');

    if (creates.length > 0) {
      this.applyCreatesOrUpdates(entityType, creates);
    }
    if (deletes.length > 0) {
      this.applyDeletes(entityType, deletes);
    }
  }

  private applyCreatesOrUpdates(entityType: SyncEntityType, rows: SnapshotRow[]): void {
    switch (entityType) {
      case 'MENU_CATEGORY':
        this.repos.menuCategories.upsertMany(rows);
        break;
      case 'MENU_ITEM':
        this.repos.menuItems.upsertMany(rows);
        break;
      case 'MENU_MODIFIER':
        this.applyMenuModifierUpserts(rows);
        break;
      case 'TAX':
        this.repos.taxes.upsertMany(rows);
        break;
      case 'DISCOUNT':
        this.repos.discounts.upsertMany(rows);
        break;
      case 'TABLE':
        this.repos.tables.upsertMany(rows);
        break;
      case 'CUSTOMER':
        this.repos.customers.upsertMany(rows);
        break;
      case 'EMPLOYEE':
        this.repos.employees.upsertMany(rows);
        break;
      case 'INVENTORY_ITEM':
        this.repos.inventoryItems.upsertMany(rows);
        break;
      case 'RECIPE':
        this.applyRecipeUpserts(rows);
        break;
      case 'RECIPE_INGREDIENT':
        this.rawUpsertRecipeIngredients(rows);
        break;
      case 'SETTING':
        this.rawUpsertSettings(rows);
        break;
      case 'ORDER':
        this.rawUpsertOrders(rows);
        break;
      case 'ORDER_ITEM':
        this.rawBulkInsertOrderItems(rows);
        break;
      case 'ORDER_ITEM_MODIFIER_OPTION':
        this.rawBulkInsertOrderItemModOpts(rows);
        break;
      case 'PAYMENT':
        this.rawUpsertPayments(rows);
        break;
      case 'SHIFT':
        this.rawUpsertShifts(rows);
        break;
      case 'CASH_ADJUSTMENT':
        this.rawUpsertCashAdjustments(rows);
        break;
      case 'KITCHEN_ORDER':
        this.rawUpsertKitchenOrders(rows);
        break;
      case 'KITCHEN_ORDER_ITEM':
        this.rawBulkInsertKitchenOrderItems(rows);
        break;
      case 'INVENTORY_TRANSACTION':
        this.rawUpsertInventoryTransactions(rows);
        break;
      case 'QR_CODE':
        this.rawUpsertQrCodes(rows);
        break;
    }
  }

  private applyDeletes(entityType: SyncEntityType, rows: SnapshotRow[]): void {
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0 || !this.db) return;
    const softDeleteTables = new Set([
      'MENU_CATEGORY', 'MENU_ITEM', 'MENU_MODIFIER', 'TAX', 'DISCOUNT',
      'TABLE', 'CUSTOMER', 'EMPLOYEE', 'INVENTORY_ITEM',
    ]);
    if (softDeleteTables.has(entityType)) {
      const tableMap: Record<string, string> = {
        MENU_CATEGORY: 'menu_categories',
        MENU_ITEM: 'menu_items',
        MENU_MODIFIER: 'menu_modifiers',
        TAX: 'taxes',
        DISCOUNT: 'discounts',
        TABLE: 'tables',
        CUSTOMER: 'customers',
        EMPLOYEE: 'employees',
        INVENTORY_ITEM: 'inventory_items',
      };
      const table = tableMap[entityType];
      if (!table) return;
      const placeholders = ids.map(() => '?').join(',');
      this.db.run(
        `UPDATE ${table} SET is_active = 0, updated_at = unixepoch('now')*1000 WHERE id IN (${placeholders})`,
        ...ids
      );
    } else {
      const tableMap: Record<string, string> = {
        ORDER: 'orders',
        ORDER_ITEM: 'order_items',
        ORDER_ITEM_MODIFIER_OPTION: 'order_item_modifier_options',
        PAYMENT: 'payments',
        SHIFT: 'shifts',
        CASH_ADJUSTMENT: 'cash_adjustments',
        KITCHEN_ORDER: 'kitchen_orders',
        KITCHEN_ORDER_ITEM: 'kitchen_order_items',
        INVENTORY_TRANSACTION: 'inventory_transactions',
        RECIPE: 'recipes',
        RECIPE_INGREDIENT: 'recipe_ingredients',
        SETTING: 'settings',
        QR_CODE: 'qr_codes',
      };
      const table = tableMap[entityType];
      if (!table) return;
      const placeholders = ids.map(() => '?').join(',');
      this.db.run(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ...ids);
    }
  }

  private applyMenuModifierUpserts(rows: SnapshotRow[]): void {
    const modifiers: any[] = [];
    const options: any[] = [];
    for (const r of rows) {
      if (r.modifier_id) {
        options.push(r);
      } else {
        modifiers.push(r);
      }
    }
    if (modifiers.length > 0 || options.length > 0) {
      this.repos.menuModifiers.upsertMany({ modifiers, options });
    }
  }

  private applyRecipeUpserts(rows: SnapshotRow[]): void {
    const recipes: any[] = [];
    const ingredients: any[] = [];
    for (const r of rows) {
      if (r.recipe_id) {
        ingredients.push(r);
      } else {
        recipes.push(r);
      }
    }
    if (recipes.length > 0) {
      this.repos.recipes.upsertMany({ recipes, ingredients });
    } else if (ingredients.length > 0 && this.db) {
      this.rawUpsertRecipeIngredients(ingredients);
    }
  }

  private rawUpsertRecipeIngredients(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO recipe_ingredients (
        id, recipe_id, inventory_item_id, ingredient_name, qty, unit, cost_snapshot_cents
      ) VALUES (
        @id, @recipe_id, @inventory_item_id, @ingredient_name, @qty, @unit,
        COALESCE(@cost_snapshot_cents, 0)
      )
      ON CONFLICT(id) DO UPDATE SET
        recipe_id = excluded.recipe_id,
        inventory_item_id = excluded.inventory_item_id,
        ingredient_name = excluded.ingredient_name,
        qty = excluded.qty,
        unit = excluded.unit,
        cost_snapshot_cents = excluded.cost_snapshot_cents
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertSettings(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    for (const r of rows) {
      this.db.run(
        `INSERT INTO settings (scope, key, value, restaurant_id, branch_id, updated_at)
         VALUES (@scope, @key, @value, @restaurant_id, @branch_id, unixepoch('now')*1000)
         ON CONFLICT(scope, key, restaurant_id, branch_id) DO UPDATE SET
           value = excluded.value,
           updated_at = unixepoch('now')*1000`,
        r
      );
    }
  }

  private rawUpsertOrders(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const now = Date.now();
    // Normalize each server snapshot row to fill BOTH camelCase + snake_case keys
    // needed by the INSERT @parameters. The server can return EITHER shape:
    //
    // SHAPE A — raw MongoDB .lean() docs (direct sync/pull from production):
    //   { _id, source, type, subtotalCents, discountCents, taxCents, totalCents,
    //     paymentStatus, items: [], customerId, notes, ... }
    //   — currency columns are ALREADY INTEGER cents (*not* dollar scalars),
    //     keys use short Mongo names (not orderType/sourceChannel/totalAmount)
    //
    // SHAPE B — shared-types camelCase DTOs (from admin UI / public endpoints):
    //   { sourceChannel, orderType, totalAmount, subtotalAmount, customerName,
    //     customerPhone, customerEmail, paidAmount, balanceDue, ... }
    //   — currency columns are dollar scalars (105.75) needing *100 conversion.
    //
    // Without handling BOTH shapes in the same map, any website/QR order pulled
    // via sync ends up with NULL source/order_type/totals → re-defaults to POS
    // source in hydration → employee-scoped filter drops it from every POS
    // view and the notification rail never fires.
    const normalized: any[] = rows.map((r: any) => {
      const o: any = { ...r };
      // Primary id: Mongo docs use _id, DTOs use id.
      if (!o.id && o._id) o.id = String(o._id);
      // Source discriminator (POS vs QR vs WEBSITE). Mongo docs have `source`;
      // shared-types DTOs use `sourceChannel`. Snake alias `source_channel` also
      // accepted as a fallthrough.
      if (o.sourceChannel && !o.source) o.source = o.sourceChannel;
      if (o.source_channel && !o.source) o.source = o.source_channel;
      // order_type discriminator. Mongo raw uses `type`; DTOs use `orderType`.
      if (o.orderType && !o.order_type) o.order_type = o.orderType;
      if (o.type && !o.order_type) o.order_type = o.type;
      // Customer / table / idempotency keys. Mongo docs use `customerId` only
      // (NO denormalized name/phone/email); those get joined from the CUSTOMER
      // snapshot set by the caller (see applySnapshots) before this map runs.
      if (o.customerName && !o.customer_name) o.customer_name = o.customerName;
      if (o.customerPhone && !o.customer_phone) o.customer_phone = o.customerPhone;
      if (o.customerEmail && !o.customer_email) o.customer_email = o.customerEmail;
      if (o.orderNumber && !o.order_number) o.order_number = o.orderNumber;
      if (o.tableSessionId && !o.table_session_id) o.table_session_id = o.tableSessionId;
      if (o.customerId && !o.customer_id) o.customer_id = o.customerId;
      if (o.employeeId && !o.employee_id) o.employee_id = o.employeeId;
      if (o.heldBy && !o.held_by) o.held_by = o.heldBy;
      if (o.heldAt && !o.held_at) o.held_at = o.heldAt;
      if (o.paymentStatus && !o.payment_status) o.payment_status = o.paymentStatus;
      if (o.discountId && !o.discount_id) o.discount_id = o.discountId;
      if (o.splitGroupId && !o.split_group_id) o.split_group_id = o.splitGroupId;
      if (o.idempotencyKey && !o.idempotency_key) o.idempotency_key = o.idempotencyKey;
      if (o.serverVersion !== undefined && !o.server_version) o.server_version = o.serverVersion;
      if (o.localVersion !== undefined && !o.local_version) o.local_version = o.localVersion;
      if (o.createdAt && !o.created_at) {
        o.created_at = o.createdAt instanceof Date ? o.createdAt.getTime() : Number(o.createdAt) || now;
      }
      if (o.updatedAt && !o.updated_at) {
        o.updated_at = o.updatedAt instanceof Date ? o.updatedAt.getTime() : Number(o.updatedAt) || now;
      }
      // Currency / cents columns. Mongo raw docs use SHORT names ending in
      // `Cents` ALREADY as integers (subtotalCents, discountCents, taxCents,
      // totalCents). DTOs use long dollar scalars (subtotalAmount → *100).
      // Fallthrough priority: 1) raw Mongo Cents  (assign directly, no *100)
      //                       2) dollar Amount    (multiply by 100)
      //                       3) existing snake_*_cents (no-op)
      const assignCents = (
        mongoCentsKey: string,
        dollarKey: string,
        snakeKey: string,
        targetCentsKey: string,
      ) => {
        if (typeof o[targetCentsKey] === 'number') return;
        if (typeof o[mongoCentsKey] === 'number') {
          o[targetCentsKey] = Math.round(Number(o[mongoCentsKey]));
          return;
        }
        const dollarVal =
          typeof o[dollarKey] === 'number'
            ? o[dollarKey]
            : typeof o[snakeKey] === 'number'
              ? o[snakeKey]
              : null;
        if (dollarVal === null || dollarVal === undefined) return;
        o[targetCentsKey] = Math.round(Number(dollarVal) * 100);
      };
      assignCents('subtotalCents', 'subtotalAmount', 'subtotal_amount', 'subtotal_cents');
      assignCents('discountCents', 'discountAmount', 'discount_amount', 'discount_cents');
      assignCents('taxCents', 'taxAmount', 'tax_amount', 'tax_cents');
      assignCents('totalCents', 'totalAmount', 'total_amount', 'total_cents');
      assignCents('tipCents', 'tipAmount', 'tip_amount', 'tip_cents');
      assignCents('changeDueCents', 'changeDueAmount', 'change_due_amount', 'change_due_cents');
      // GLOBAL ZERO-TAX OVERRIDE: ANY server-created order (Admin, QR website,
      // public API) must reconcile with POS-originated orders at ₦0 tax. Force
      // tax_cents = 0 unconditionally and re-derive total_cents from
      // (subtotal - discount + tip). Without this, ShiftClosure reports would
      // show mixed totals between channel-A and channel-B orders.
      o.tax_cents = 0;
      const sub = typeof o.subtotal_cents === 'number' ? o.subtotal_cents : 0;
      const disc = typeof o.discount_cents === 'number' ? o.discount_cents : 0;
      const tip = typeof o.tip_cents === 'number' ? o.tip_cents : 0;
      o.total_cents = Math.max(0, sub - disc + tip);
      // 3 v33 migration columns (payment_method, paid_amount_cents, balance_due_cents)
      if (o.paymentMethod && !o.payment_method) o.payment_method = o.paymentMethod;
      assignCents('paidCents', 'paidAmount', 'paid_amount', 'paid_amount_cents');
      assignCents('balanceDueCents', 'balanceDue', 'balance_due', 'balance_due_cents');
      if (typeof o.paid_amount_cents !== 'number') o.paid_amount_cents = 0;
      if (typeof o.balance_due_cents !== 'number') {
        if (typeof o.total_cents === 'number') o.balance_due_cents = Math.max(0, o.total_cents - o.paid_amount_cents);
        else o.balance_due_cents = 0;
      }
      return o;
    });
    const stmt = this.db['prepare'](`
      INSERT INTO orders (
        id, branch_id, restaurant_id, order_number, source, order_type,
        table_id, table_session_id, customer_id, customer_name, customer_phone,
        customer_email, employee_id,
        held_by, held_at, status, payment_status, payment_method,
        subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents,
        change_due_cents, paid_amount_cents, balance_due_cents,
        discount_id, note, split_group_id, idempotency_key, server_version,
        local_version, synced, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @restaurant_id, @order_number, @source, @order_type,
        @table_id, @table_session_id, @customer_id, @customer_name, @customer_phone,
        @customer_email, @employee_id,
        @held_by, @held_at, @status, @payment_status, @payment_method,
        @subtotal_cents, @discount_cents, @tax_cents, @total_cents, @tip_cents,
        @change_due_cents, @paid_amount_cents, @balance_due_cents,
        @discount_id, @note, @split_group_id, @idempotency_key,
        COALESCE(@server_version, 0), COALESCE(@local_version, 1),
        COALESCE(@synced, 1),
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        order_number = excluded.order_number,
        source = excluded.source,
        order_type = excluded.order_type,
        table_id = excluded.table_id,
        table_session_id = excluded.table_session_id,
        customer_id = excluded.customer_id,
        customer_name = excluded.customer_name,
        customer_phone = excluded.customer_phone,
        customer_email = excluded.customer_email,
        employee_id = excluded.employee_id,
        held_by = excluded.held_by,
        held_at = excluded.held_at,
        status = excluded.status,
        payment_status = excluded.payment_status,
        payment_method = excluded.payment_method,
        subtotal_cents = excluded.subtotal_cents,
        discount_cents = excluded.discount_cents,
        tax_cents = excluded.tax_cents,
        total_cents = excluded.total_cents,
        tip_cents = excluded.tip_cents,
        change_due_cents = excluded.change_due_cents,
        paid_amount_cents = excluded.paid_amount_cents,
        balance_due_cents = excluded.balance_due_cents,
        discount_id = excluded.discount_id,
        note = excluded.note,
        split_group_id = excluded.split_group_id,
        server_version = excluded.server_version,
        local_version = excluded.local_version,
        synced = excluded.synced,
        updated_at = ${now}
    `);
    this.db.transaction(() => {
      for (const r of normalized) stmt.run(r);
    })();
  }

  private rawBulkInsertOrderItems(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
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
      ON CONFLICT(id) DO UPDATE SET
        order_id = excluded.order_id,
        menu_item_id = excluded.menu_item_id,
        name_snapshot = excluded.name_snapshot,
        price_snapshot_cents = excluded.price_snapshot_cents,
        quantity = excluded.quantity,
        subtotal_cents = excluded.subtotal_cents,
        tax_cents = excluded.tax_cents,
        discount_cents = excluded.discount_cents,
        total_cents = excluded.total_cents,
        special_instructions = excluded.special_instructions,
        preparation_status = excluded.preparation_status
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawBulkInsertOrderItemModOpts(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO order_item_modifier_options (
        id, order_item_id, modifier_id, modifier_name, option_id,
        option_name, price_delta_cents
      ) VALUES (
        @id, @order_item_id, @modifier_id, @modifier_name, @option_id,
        @option_name, @price_delta_cents
      )
      ON CONFLICT(id) DO UPDATE SET
        order_item_id = excluded.order_item_id,
        modifier_id = excluded.modifier_id,
        modifier_name = excluded.modifier_name,
        option_id = excluded.option_id,
        option_name = excluded.option_name,
        price_delta_cents = excluded.price_delta_cents
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertPayments(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const now = Date.now();
    // Normalize server camelCase snapshots → snake_case for SQLite @params.
    // Same rationale as rawUpsertOrders: server returns { amount, amountCents,
    // orderId, tipAmount, transactionReference, ... } but the prepared statement
    // @parameters bind only to literal snake_case JS object keys.
    const normalized: any[] = rows.map((r: any) => {
      const o: any = { ...r };
      if (!o.order_id && o.orderId) o.order_id = o.orderId;
      if (!o.employee_id && o.employeeId) o.employee_id = o.employeeId;
      if (!o.shift_id && o.shiftId) o.shift_id = o.shiftId;
      if (!o.branch_id && o.branchId) o.branch_id = o.branchId;
      if (!o.restaurant_id && o.restaurantId) o.restaurant_id = o.restaurantId;
      if (!o.transaction_reference && o.transactionReference) o.transaction_reference = o.transactionReference;
      if (!o.transaction_reference && o.transactionRef) o.transaction_reference = o.transactionRef;
      if (!o.verification_source && o.verificationSource) o.verification_source = o.verificationSource;
      if (!o.completed_at && o.completedAt) o.completed_at = o.completedAt;
      if (!o.reference_note && o.referenceNote) o.reference_note = o.referenceNote;
      if (!o.idempotency_key && o.idempotencyKey) o.idempotency_key = o.idempotencyKey;
      if (!o.failure_reason && o.failureReason) o.failure_reason = o.failureReason;
      if (!o.provider_response_json && typeof o.providerResponseJson === 'string') {
        o.provider_response_json = o.providerResponseJson;
      } else if (!o.provider_response_json && typeof o.providerResponse === 'object' && o.providerResponse) {
        try { o.provider_response_json = JSON.stringify(o.providerResponse); } catch {}
      }
      if (!o.status) o.status = 'COMPLETED';
      if (typeof o.created_at !== 'number') o.created_at = typeof o.createdAt === 'number' ? o.createdAt : now;
      if (typeof o.updated_at !== 'number') o.updated_at = typeof o.updatedAt === 'number' ? o.updatedAt : now;
      // Dollar → cent conversion: server sometimes sends amount as a dollar
      // scalar; POS always stores cents in INTEGER amount_cents column.
      const ensureCents = (camel: string, snake: string, centsKey: string) => {
        if (typeof o[centsKey] === 'number') return;
        const val =
          typeof o[camel] === 'number' ? o[camel] :
          typeof o[snake] === 'number' ? o[snake] : null;
        if (val === null || val === undefined) return;
        o[centsKey] = Math.round(Number(val) * 100);
      };
      ensureCents('amount', 'amount_value', 'amount_cents');
      ensureCents('tipAmount', 'tip_amount', 'tip_cents');
      ensureCents('changeDueAmount', 'change_due_amount', 'change_due_cents');
      if (typeof o.amount_cents !== 'number' && typeof o.amount === 'number') {
        o.amount_cents = Math.round(Number(o.amount) * 100);
      }
      return o;
    });
    const stmt = this.db['prepare'](`
      INSERT INTO payments (
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
        COALESCE(@synced, 1), @failure_reason, @provider_response_json,
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )
      ON CONFLICT(id) DO UPDATE SET
        order_id = excluded.order_id,
        employee_id = excluded.employee_id,
        shift_id = excluded.shift_id,
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        method = excluded.method,
        provider = excluded.provider,
        transaction_reference = excluded.transaction_reference,
        amount_cents = excluded.amount_cents,
        tip_cents = excluded.tip_cents,
        change_due_cents = excluded.change_due_cents,
        status = excluded.status,
        verification_source = excluded.verification_source,
        completed_at = excluded.completed_at,
        reference_note = excluded.reference_note,
        server_version = excluded.server_version,
        local_version = excluded.local_version,
        synced = excluded.synced,
        failure_reason = excluded.failure_reason,
        provider_response_json = excluded.provider_response_json,
        updated_at = ${now}
    `);
    this.db.transaction(() => {
      for (const r of normalized) stmt.run(r);
    })();
  }

  private rawUpsertShifts(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const now = Date.now();
    const stmt = this.db['prepare'](`
      INSERT INTO shifts (
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
        @opened_at, @closed_at,
        @idempotency_key,
        COALESCE(@server_version, 0),
        COALESCE(@local_version, 1),
        COALESCE(@synced, 1),
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )
      ON CONFLICT(id) DO UPDATE SET
        device_id = excluded.device_id,
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        employee_id = excluded.employee_id,
        status = excluded.status,
        opening_cash_cents = excluded.opening_cash_cents,
        expected_cash_cents = excluded.expected_cash_cents,
        closing_cash_cents = excluded.closing_cash_cents,
        variance_cents = excluded.variance_cents,
        cash_sales_cents = excluded.cash_sales_cents,
        card_sales_cents = excluded.card_sales_cents,
        other_sales_cents = excluded.other_sales_cents,
        refunds_cents = excluded.refunds_cents,
        payout_cents = excluded.payout_cents,
        note = excluded.note,
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        server_version = excluded.server_version,
        local_version = excluded.local_version,
        synced = excluded.synced,
        updated_at = ${now}
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertCashAdjustments(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO cash_adjustments (
        id, shift_id, employee_id, branch_id, amount_cents, type, reason,
        reference, created_at
      ) VALUES (
        @id, @shift_id, @employee_id, @branch_id, @amount_cents, @type,
        @reason, @reference,
        COALESCE(@created_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        shift_id = excluded.shift_id,
        employee_id = excluded.employee_id,
        branch_id = excluded.branch_id,
        amount_cents = excluded.amount_cents,
        type = excluded.type,
        reason = excluded.reason,
        reference = excluded.reference
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertKitchenOrders(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const now = Date.now();
    const stmt = this.db['prepare'](`
      INSERT INTO kitchen_orders (
        id, order_id, branch_id, station, status, priority, started_at,
        ready_at, completed_at, served_by, created_at, updated_at
      ) VALUES (
        @id, @order_id, @branch_id, @station,
        COALESCE(@status, 'NEW'),
        COALESCE(@priority, 'NORMAL'),
        @started_at, @ready_at, @completed_at, @served_by,
        COALESCE(@created_at, ${now}),
        COALESCE(@updated_at, ${now})
      )
      ON CONFLICT(id) DO UPDATE SET
        order_id = excluded.order_id,
        branch_id = excluded.branch_id,
        station = excluded.station,
        status = excluded.status,
        priority = excluded.priority,
        started_at = excluded.started_at,
        ready_at = excluded.ready_at,
        completed_at = excluded.completed_at,
        served_by = excluded.served_by,
        updated_at = ${now}
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawBulkInsertKitchenOrderItems(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO kitchen_order_items (
        id, kitchen_order_id, order_item_id, menu_item_id, menu_item_name,
        qty, special_instructions, status
      ) VALUES (
        @id, @kitchen_order_id, @order_item_id, @menu_item_id,
        @menu_item_name, @qty, @special_instructions,
        COALESCE(@status, 'NEW')
      )
      ON CONFLICT(id) DO UPDATE SET
        kitchen_order_id = excluded.kitchen_order_id,
        order_item_id = excluded.order_item_id,
        menu_item_id = excluded.menu_item_id,
        menu_item_name = excluded.menu_item_name,
        qty = excluded.qty,
        special_instructions = excluded.special_instructions,
        status = excluded.status
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertInventoryTransactions(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO inventory_transactions (
        id, inventory_item_id, branch_id, reference_id, reference_type, type,
        qty, unit_cost_cents, reason, performed_by, performed_at
      ) VALUES (
        @id, @inventory_item_id, @branch_id, @reference_id, @reference_type,
        @type, @qty, @unit_cost_cents, @reason, @performed_by,
        COALESCE(@performed_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        inventory_item_id = excluded.inventory_item_id,
        branch_id = excluded.branch_id,
        reference_id = excluded.reference_id,
        reference_type = excluded.reference_type,
        type = excluded.type,
        qty = excluded.qty,
        unit_cost_cents = excluded.unit_cost_cents,
        reason = excluded.reason,
        performed_by = excluded.performed_by,
        performed_at = excluded.performed_at
    `);
    this.db.transaction(() => {
      for (const r of rows) stmt.run(r);
    })();
  }

  private rawUpsertQrCodes(rows: SnapshotRow[]): void {
    if (!this.db || rows.length === 0) return;
    const now = Date.now();
    try {
      const stmt = this.db['prepare'](`
        INSERT INTO qr_codes (
          id, branch_id, table_id, code, url, is_active, created_at, updated_at
        ) VALUES (
          @id, @branch_id, @table_id, @code, @url,
          COALESCE(@is_active, 1),
          COALESCE(@created_at, ${now}),
          COALESCE(@updated_at, ${now})
        )
        ON CONFLICT(id) DO UPDATE SET
          branch_id = excluded.branch_id,
          table_id = excluded.table_id,
          code = excluded.code,
          url = excluded.url,
          is_active = excluded.is_active,
          updated_at = ${now}
      `);
      this.db.transaction(() => {
        for (const r of rows) stmt.run(r);
      })();
    } catch {
    }
  }
}
