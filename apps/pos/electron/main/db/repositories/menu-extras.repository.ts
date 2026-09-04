import type { PosDatabase } from '../database';
import type {
  MenuModifierRow,
  MenuModifierOptionRow,
  TaxRow,
  DiscountRow,
} from '../types';

export class MenuModifiersRepository {
  constructor(private db: PosDatabase) {}

  listForItem(menuItemId: string): (MenuModifierRow & { options: MenuModifierOptionRow[] })[] {
    const item = this.db.get<{ modifier_ids: string | null }>(
      'SELECT modifier_ids FROM menu_items WHERE id = ?',
      menuItemId
    );
    if (!item?.modifier_ids) return [];
    let ids: string[] = [];
    try {
      ids = JSON.parse(item.modifier_ids) as string[];
    } catch {
      return [];
    }
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const modifiers = this.db.all<MenuModifierRow>(
      `SELECT * FROM menu_modifiers WHERE id IN (${placeholders}) AND is_active = 1`,
      ...ids
    );
    const allOptions = this.db.all<MenuModifierOptionRow>(
      `SELECT * FROM menu_modifier_options WHERE modifier_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order ASC`,
      ...ids
    );
    const optionsByModifier = new Map<string, MenuModifierOptionRow[]>();
    for (const opt of allOptions) {
      if (!opt.modifier_id) continue;
      const arr = optionsByModifier.get(opt.modifier_id) ?? [];
      arr.push(opt);
      optionsByModifier.set(opt.modifier_id, arr);
    }
    return modifiers.map((m) => ({
      ...m,
      options: optionsByModifier.get(m.id) ?? [],
    }));
  }

  listByIds(ids: string[]): MenuModifierRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.all<MenuModifierRow>(
      `SELECT * FROM menu_modifiers WHERE id IN (${placeholders})`,
      ...ids
    );
  }

  upsertManyModifierRows(rows: Partial<MenuModifierRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO menu_modifiers (
        id, branch_id, name, description, is_required, min_select,
        max_select, is_active, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @name, @description, @is_required, @min_select,
        @max_select, @is_active,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        name = excluded.name,
        description = excluded.description,
        is_required = excluded.is_required,
        min_select = excluded.min_select,
        max_select = excluded.max_select,
        is_active = excluded.is_active,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  upsertManyOptionRows(rows: Partial<MenuModifierOptionRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO menu_modifier_options (
        id, modifier_id, name, price_delta_cents, is_default, sort_order,
        is_active, created_at, updated_at
      ) VALUES (
        @id, @modifier_id, @name, @price_delta_cents, @is_default, @sort_order,
        @is_active,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        modifier_id = excluded.modifier_id,
        name = excluded.name,
        price_delta_cents = excluded.price_delta_cents,
        is_default = excluded.is_default,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  upsertMany(data: {
    modifiers?: Partial<MenuModifierRow>[];
    options?: Partial<MenuModifierOptionRow>[];
  }): void {
    this.db.transaction(() => {
      if (data.modifiers) this.upsertManyModifierRows(data.modifiers);
      if (data.options) this.upsertManyOptionRows(data.options);
    })();
  }

  upsertOneWithOptions(data: {
    modifier: Partial<MenuModifierRow>;
    options: Partial<MenuModifierOptionRow>[];
  }): void {
    this.db.transaction(() => {
      this.upsertManyModifierRows([data.modifier]);
      this.upsertManyOptionRows(data.options);
    })();
  }

  listAll(branchId: string): MenuModifierRow[] {
    return this.db.all<MenuModifierRow>(
      `SELECT * FROM menu_modifiers WHERE branch_id = ? AND is_active = 1 ORDER BY name ASC`,
      branchId
    );
  }

  listAllOptions(modifierIds: string[]): MenuModifierOptionRow[] {
    if (modifierIds.length === 0) return [];
    const placeholders = modifierIds.map(() => '?').join(',');
    return this.db.all<MenuModifierOptionRow>(
      `SELECT * FROM menu_modifier_options WHERE modifier_id IN (${placeholders}) AND is_active = 1 ORDER BY modifier_id ASC, sort_order ASC`,
      ...modifierIds
    );
  }

  deleteById(id: string): void {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE menu_modifiers SET is_active = 0, updated_at = unixepoch('now')*1000 WHERE id = ?`,
        id
      );
      this.db.run(
        `UPDATE menu_modifier_options SET is_active = 0, updated_at = unixepoch('now')*1000 WHERE modifier_id = ?`,
        id
      );
    })();
  }
}

export class TaxesRepository {
  constructor(private db: PosDatabase) {}

  listActiveDefaults(branchId: string): TaxRow[] {
    return this.db.all<TaxRow>(
      `SELECT * FROM taxes WHERE branch_id = ? AND is_active = 1 AND is_default = 1 ORDER BY name ASC`,
      branchId
    );
  }

  upsertMany(rows: Partial<TaxRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO taxes (
        id, branch_id, name, rate_percent, is_compound, is_inclusive,
        is_active, is_default, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @name, @rate_percent, @is_compound, @is_inclusive,
        @is_active, @is_default,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        name = excluded.name,
        rate_percent = excluded.rate_percent,
        is_compound = excluded.is_compound,
        is_inclusive = excluded.is_inclusive,
        is_active = excluded.is_active,
        is_default = excluded.is_default,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }
}

export class DiscountsRepository {
  constructor(private db: PosDatabase) {}

  listActive(branchId: string): DiscountRow[] {
    return this.db.all<DiscountRow>(
      'SELECT * FROM discounts WHERE branch_id = ? AND is_active = 1 ORDER BY name ASC',
      branchId
    );
  }

  findById(id: string): DiscountRow | undefined {
    return this.db.get<DiscountRow>('SELECT * FROM discounts WHERE id = ?', id);
  }

  upsertMany(rows: Partial<DiscountRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO discounts (
        id, branch_id, name, type, value_cents, value_percent,
        max_amount_cents, min_order_cents, is_active, valid_times,
        created_at, updated_at
      ) VALUES (
        @id, @branch_id, @name, @type, @value_cents, @value_percent,
        @max_amount_cents, @min_order_cents, @is_active, @valid_times,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        name = excluded.name,
        type = excluded.type,
        value_cents = excluded.value_cents,
        value_percent = excluded.value_percent,
        max_amount_cents = excluded.max_amount_cents,
        min_order_cents = excluded.min_order_cents,
        is_active = excluded.is_active,
        valid_times = excluded.valid_times,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }
}
