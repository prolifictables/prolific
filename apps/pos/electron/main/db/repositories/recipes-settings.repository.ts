import type { PosDatabase } from '../database';
import type {
  RecipeRow,
  RecipeIngredientRow,
  SettingRow,
} from '../types';

export interface RecipeFull extends RecipeRow {
  ingredients: RecipeIngredientRow[];
}

export class RecipesRepository {
  constructor(private db: PosDatabase) {}

  listByMenuItemId(menuItemId: string): RecipeFull | undefined {
    const recipe = this.db.get<RecipeRow>(
      'SELECT * FROM recipes WHERE menu_item_id = ?',
      menuItemId
    );
    if (!recipe) return undefined;
    const ingredients = this.db.all<RecipeIngredientRow>(
      'SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY rowid ASC',
      recipe.id
    );
    return { ...recipe, ingredients };
  }

  getFullCache(branchId: string): Map<string, RecipeFull> {
    const recipes = this.db.all<RecipeRow>(
      'SELECT * FROM recipes WHERE branch_id = ?',
      branchId
    );
    const ingredients = this.db.all<RecipeIngredientRow>(
      `SELECT ri.* FROM recipe_ingredients ri
       INNER JOIN recipes r ON r.id = ri.recipe_id
       WHERE r.branch_id = ?`,
      branchId
    );
    const byRecipe = new Map<string, RecipeIngredientRow[]>();
    for (const ing of ingredients) {
      if (!ing.recipe_id) continue;
      const arr = byRecipe.get(ing.recipe_id) ?? [];
      arr.push(ing);
      byRecipe.set(ing.recipe_id, arr);
    }
    const map = new Map<string, RecipeFull>();
    for (const r of recipes) {
      if (r.menu_item_id) {
        map.set(r.menu_item_id, {
          ...r,
          ingredients: byRecipe.get(r.id) ?? [],
        });
      }
    }
    return map;
  }

  upsertMany(data: {
    recipes: Partial<RecipeRow>[];
    ingredients?: Partial<RecipeIngredientRow>[];
  }): void {
    if (!data.recipes || data.recipes.length === 0) return;
    const recipeStmt = this.db['prepare'](`
      INSERT INTO recipes (
        id, menu_item_id, branch_id, restaurant_id, name, portion_yield,
        cost_at_recipe_time_cents, created_at, updated_at
      ) VALUES (
        @id, @menu_item_id, @branch_id, @restaurant_id, @name, @portion_yield,
        COALESCE(@cost_at_recipe_time_cents, 0),
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        menu_item_id = excluded.menu_item_id,
        branch_id = excluded.branch_id,
        restaurant_id = excluded.restaurant_id,
        name = excluded.name,
        portion_yield = excluded.portion_yield,
        cost_at_recipe_time_cents = excluded.cost_at_recipe_time_cents,
        updated_at = unixepoch('now')*1000
    `);
    const ingStmt = this.db['prepare'](`
      INSERT INTO recipe_ingredients (
        id, recipe_id, inventory_item_id, ingredient_name, qty, unit,
        cost_snapshot_cents
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
      for (const r of data.recipes) recipeStmt.run(r);
      if (data.ingredients) {
        for (const i of data.ingredients) ingStmt.run(i);
      }
    })();
  }
}

export class SettingsRepository {
  constructor(private db: PosDatabase) {}

  get(
    scope: string,
    key: string,
    context: { restaurantId?: string | null; branchId?: string | null } = {}
  ): string | null {
    const row = this.db.get<SettingRow>(
      `SELECT value FROM settings
       WHERE scope = ? AND key = ?
         AND (restaurant_id IS ? OR restaurant_id = ?)
         AND (branch_id IS ? OR branch_id = ?)
       ORDER BY id DESC LIMIT 1`,
      scope,
      key,
      null,
      context.restaurantId ?? null,
      null,
      context.branchId ?? null
    );
    return row?.value ?? null;
  }

  set(
    scope: string,
    key: string,
    value: string,
    context: { restaurantId?: string | null; branchId?: string | null } = {}
  ): void {
    this.db.run(
      `INSERT INTO settings (scope, key, value, restaurant_id, branch_id, updated_at)
       VALUES (?, ?, ?, ?, ?, unixepoch('now')*1000)
       ON CONFLICT(scope, key, restaurant_id, branch_id) DO UPDATE SET
         value = excluded.value,
         updated_at = unixepoch('now')*1000`,
      scope,
      key,
      value,
      context.restaurantId ?? null,
      context.branchId ?? null
    );
  }

  getAllByScope(
    scope: string,
    filters: { restaurantId?: string | null; branchId?: string | null } = {}
  ): SettingRow[] {
    const clauses: string[] = ['scope = ?'];
    const params: unknown[] = [scope];
    if (filters.restaurantId !== undefined) {
      clauses.push('(restaurant_id IS ? OR restaurant_id = ?)');
      params.push(null, filters.restaurantId);
    }
    if (filters.branchId !== undefined) {
      clauses.push('(branch_id IS ? OR branch_id = ?)');
      params.push(null, filters.branchId);
    }
    return this.db.all<SettingRow>(
      `SELECT * FROM settings WHERE ${clauses.join(' AND ')} ORDER BY key ASC`,
      ...params
    );
  }
}
