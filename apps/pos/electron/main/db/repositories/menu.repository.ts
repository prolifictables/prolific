import type { PosDatabase } from '../database';
import type { MenuCategoryRow, MenuItemRow } from '../types';

export class MenuCategoriesRepository {
  constructor(private db: PosDatabase) {}

  list(branchId: string): MenuCategoryRow[] {
    return this.db.all<MenuCategoryRow>(
      'SELECT * FROM menu_categories WHERE branch_id = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC',
      branchId
    );
  }

  upsertOne(row: Partial<MenuCategoryRow>): void {
    this.upsertMany([row]);
  }

  upsertMany(rows: Partial<MenuCategoryRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO menu_categories (
        id, branch_id, restaurant_id, name, description, image_url,
        sort_order, is_active, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @restaurant_id, @name, @description, @image_url,
        @sort_order, @is_active,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        name = excluded.name,
        description = excluded.description,
        image_url = excluded.image_url,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  deleteById(id: string): void {
    this.db.run(
      `UPDATE menu_categories SET is_active = 0, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      id
    );
  }
}

export class MenuItemsRepository {
  constructor(private db: PosDatabase) {}

  private static readonly VISIBLE_STATUSES = new Set<string>([
    'AVAILABLE',
    'OUT_OF_STOCK',
    'OOS',
    'SCHEDULED',
  ]);

  list(branchId: string, filters?: { status?: string; categoryId?: string }): MenuItemRow[] {
    // Always hide deleted/disabled rows and limit to admin-configured
    // visibility statuses (matches server public.menu logic: AVAILABLE,
    // SCHEDULED, OUT_OF_STOCK shown; DISABLED + deleted items hidden).
    const clauses: string[] = ['branch_id = ?', 'is_active = 1', 'status IN (?, ?, ?, ?)'];
    const params: unknown[] = [
      branchId,
      'AVAILABLE',
      'OUT_OF_STOCK',
      'OOS',
      'SCHEDULED',
    ];
    if (filters?.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.categoryId) {
      clauses.push('category_id = ?');
      params.push(filters.categoryId);
    }
    return this.db.all<MenuItemRow>(
      `SELECT * FROM menu_items WHERE ${clauses.join(' AND ')} ORDER BY name ASC`,
      ...params
    );
  }

  listByCategory(branchId: string, categoryId: string): MenuItemRow[] {
    return this.db.all<MenuItemRow>(
      `SELECT * FROM menu_items
       WHERE branch_id = ?
         AND category_id = ?
         AND is_active = 1
         AND status IN ('AVAILABLE', 'OUT_OF_STOCK', 'OOS', 'SCHEDULED')
       ORDER BY name ASC`,
      branchId,
      categoryId
    );
  }

  findById(id: string): MenuItemRow | undefined {
    // findById is called from historical order/cart lookups so keep it
    // permissive (no status/is_active filter) — otherwise re-printing old
    // orders / recalling carts could fail.
    return this.db.get<MenuItemRow>('SELECT * FROM menu_items WHERE id = ?', id);
  }

  searchFts(branchId: string, query: string): MenuItemRow[] {
    const sanitized = `%${query}%`;
    return this.db.all<MenuItemRow>(
      `SELECT mi.* FROM menu_items mi
       WHERE mi.branch_id = ?
         AND mi.is_active = 1
         AND mi.status IN ('AVAILABLE', 'OUT_OF_STOCK', 'OOS', 'SCHEDULED')
         AND (mi.name LIKE ? OR mi.description LIKE ? OR mi.sku LIKE ?)
       ORDER BY mi.name ASC`,
      branchId,
      sanitized,
      sanitized,
      sanitized
    );
  }

  upsertMany(rows: Partial<MenuItemRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO menu_items (
        id, category_id, branch_id, restaurant_id, sku, name, description,
        image_url, price_cents, cost_cents, status, allergen_tags, tax_ids,
        modifier_ids, preparation_needed, kitchen_station, version,
        last_modified_at, last_modified_by, scheduled_availability,
        is_tax_inclusive, max_per_order, is_active, created_at, updated_at
      ) VALUES (
        @id, @category_id, @branch_id, @restaurant_id, @sku, @name, @description,
        @image_url, @price_cents, @cost_cents, @status, @allergen_tags, @tax_ids,
        @modifier_ids, @preparation_needed, @kitchen_station, @version,
        @last_modified_at, @last_modified_by, @scheduled_availability,
        @is_tax_inclusive, @max_per_order,
        COALESCE(@is_active, 1),
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        category_id = excluded.category_id,
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        sku = excluded.sku,
        name = excluded.name,
        description = excluded.description,
        image_url = excluded.image_url,
        price_cents = excluded.price_cents,
        cost_cents = excluded.cost_cents,
        status = excluded.status,
        allergen_tags = excluded.allergen_tags,
        tax_ids = excluded.tax_ids,
        modifier_ids = excluded.modifier_ids,
        preparation_needed = excluded.preparation_needed,
        kitchen_station = excluded.kitchen_station,
        version = excluded.version,
        last_modified_at = excluded.last_modified_at,
        last_modified_by = excluded.last_modified_by,
        scheduled_availability = excluded.scheduled_availability,
        is_tax_inclusive = excluded.is_tax_inclusive,
        max_per_order = excluded.max_per_order,
        is_active = excluded.is_active,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  updateStatus(id: string, status: string): void {
    this.db.run(
      `UPDATE menu_items SET status = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
      status,
      id
    );
  }

  upsertOne(row: Partial<MenuItemRow>): void {
    this.upsertMany([row]);
  }

  deleteById(id: string): void {
    this.db.run(
      `UPDATE menu_items SET is_active = 0, status = 'DISABLED', updated_at = unixepoch('now')*1000 WHERE id = ?`,
      id
    );
  }

  bulkSetInStock(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE menu_items SET status = 'AVAILABLE', updated_at = unixepoch('now')*1000 WHERE id IN (${placeholders})`,
      ...ids
    );
  }
}
