import type { IpcMain } from 'electron';
import type { ReposBundle } from './db';
import bcrypt from 'bcryptjs';

type HandlerFn = (...args: unknown[]) => unknown;

function logError(channel: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[IPC DB] ${channel} error:`, msg);
}

function getActiveBranchId(repos: ReposBundle): string {
  const auth = repos.meta.getLastAuth();
  return auth?.branchId ? String(auth.branchId) : '';
}

function getActiveRestaurantId(repos: ReposBundle): string {
  const auth = repos.meta.getLastAuth();
  return auth?.restaurantId ? String(auth.restaurantId) : '';
}

function toEpochMillis(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

// Convert a SQLite table-sessions row (snake_case, cents) to the server Mongo
// TableSession document payload (camelCase, same numeric units as client-side
// numeric fields, matching the server applyTableSessionCommand $set passthrough).
function buildTableSessionSyncPayload(sess: any): Record<string, unknown> {
  const now = new Date();
  const openedAt = typeof (sess as any).opened_at === 'number'
    ? new Date((sess as any).opened_at)
    : now;
  const closedAt = typeof (sess as any).closed_at === 'number'
    ? new Date((sess as any).closed_at)
    : undefined;
  const currentOrderId = (sess as any).current_order_id
    ? String((sess as any).current_order_id)
    : null;
  return {
    restaurantId: String((sess as any).restaurant_id ?? ''),
    branchId: String((sess as any).branch_id ?? ''),
    tableId: String((sess as any).table_id ?? ''),
    qrCodeId: String((sess as any).table_id ?? ''),
    status: String((sess as any).status ?? 'OPEN'),
    openedAt,
    openedBy: (sess as any).opened_by ? String((sess as any).opened_by) : undefined,
    customerIds: [],
    orderIds: currentOrderId ? [currentOrderId] : [],
    totalAmount: Number((sess as any).total_cents ?? 0),
    paidAmount: Number((sess as any).paid_amount_cents ?? 0),
    balanceDue: Number((sess as any).balance_due_cents ?? 0),
    closedAt,
    closedBy: (sess as any).closed_by ? String((sess as any).closed_by) : undefined,
    orderRefs: currentOrderId
      ? [{ orderId: currentOrderId, addedAt: openedAt, addedBy: (sess as any).opened_by ? String((sess as any).opened_by) : undefined }]
      : [],
    splitGroups: [],
  };
}

function wrap(channel: string, fn: HandlerFn) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const result = await Promise.resolve(fn(...args));
      return { success: true as const, result };
    } catch (err) {
      logError(channel, err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false as const, error: message };
    }
  };
}

export function registerAllDbIpc(ipcMain: IpcMain, repos: ReposBundle): void {
  ipcMain.handle(
    'db:employees:findAll',
    wrap('db:employees:findAll', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.employees.findAllByBranch(b);
    })
  );

  ipcMain.handle(
    'db:employees:findByPin',
    wrap('db:employees:findByPin', (branchId: unknown, pin: unknown) => {
      // ——— Defensive argument normalisation ———
      // The preload cashier exposes findByPin(PIN, branchId?) — PIN first.
      // The mock shim exposes findByPin(pinOrBranchId, pin?) with either order.
      // So on this main-process side we MUST accept both conventions and
      // disambiguate by content: if ONLY one arg is set and it looks like a
      // 4–6 digit PIN, treat it as pin=... with cross-branch lookup.
      const isPinLike = (v: unknown) =>
        typeof v === 'string' && /^\d{4,6}$/.test(v);
      let actualPin: string | undefined;
      let actualBranch: string | undefined;
      if (pin !== undefined && isPinLike(pin)) {
        actualPin = String(pin);
        actualBranch =
          typeof branchId === 'string' && branchId ? branchId : undefined;
      } else if (pin === undefined && isPinLike(branchId)) {
        // Single-arg PIN mode: caller passed PIN-only via first positional
        // (or preload only forwarded PIN because branchId was undefined).
        // Cross-branch global search.
        actualPin = String(branchId);
        actualBranch = undefined;
      } else if (typeof branchId === 'string' && typeof pin === 'string') {
        // Fallback: both strings, neither PIN-like — accept as-is (defensive).
        actualBranch = branchId || undefined;
        actualPin = pin || undefined;
      }
      if (!actualPin) return null;

      // Resolve branch filter. Prefer: (1) explicit branch from caller, (2)
      // active-branch from meta.getLastAuth, (3) empty '' = cross-branch SQL.
      let resolvedBranch = actualBranch ?? getActiveBranchId(repos);
      // If still empty — cross-branch global lookup in SQL.
      return repos.employees.findByPin(String(resolvedBranch ?? ''), actualPin);
    })
  );

  ipcMain.handle(
    'db:employees:count',
    wrap('db:employees:count', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.employees.countActive(b);
    })
  );

  ipcMain.handle(
    'db:employees:applySnapshot',
    wrap('db:employees:applySnapshot', (employees: unknown) => {
      const list = Array.isArray(employees) ? employees : [];
      const branchId = getActiveBranchId(repos);
      const restaurantId = getActiveRestaurantId(repos);
      const isBcryptHash = (s: unknown) =>
        typeof s === 'string' && /^\$2[abxy]?\$/.test(s);

      // Pre-read existing pin_hashes for every employee id we're about to
      // overwrite. This prevents the "every login is slow even after first"
      // bug that happened because:
      //   1. upsertWithPin stores bcrypt(pin) → pin_hash = "$2a$10$..."
      //   2. 100ms later applySnapshot(bootstrap.employees) runs and writes
      //      pin_hash = NULL (no pinHash field from server) → SQL filter
      //      `WHERE pin_hash IS NOT NULL` drops the employee from findByPin
      //      candidates on the NEXT login → always fast-path miss → slow
      //      45s Render wake on every login.
      const ids = list
        .map((e: any) => String(e?.id || e?._id || ''))
        .filter((x: string) => !!x);
      const existingPinHash = new Map<string, string>();
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        try {
          // NOTE: repos.employees.db is a raw PosDatabase handle exposed via
          // a direct property — we cast out of the generic instead of using
          // all<T>() to keep tsc happy on an untyped intermediate reference.
          const rows = (repos.employees as any).db.all(
            `SELECT id, pin_hash FROM employees WHERE id IN (${placeholders}) AND pin_hash IS NOT NULL`,
            ...ids
          ) as Array<{ id: string; pin_hash: string }> | undefined;
          for (const r of rows || []) {
            if (r?.id && r.pin_hash && isBcryptHash(r.pin_hash)) {
              existingPinHash.set(String(r.id), String(r.pin_hash));
            }
          }
        } catch {
          /* ignore — not fatal if we can't read prior; upsertMany defaults below */
        }
      }

      repos.employees.upsertMany(
        list
          .map((e: any) => {
            const id = String(e.id || e._id || '');
            // Resolve pin_hash preserving precedence (from highest to lowest):
            //   1. Prior row's bcrypt pin_hash (if we stored one from a real
            //      cashier login upsertWithPin on this terminal in the past).
            //      Admin server response almost NEVER carries a bcrypt
            //      pin_hash over REST (security), so this preserves the only
            //      real local credential we have.
            //   2. e.pinHash / e.pin_hash from the incoming payload, BUT
            //      ONLY if it is a structurally valid bcrypt hash. Otherwise
            //      it's probably a plaintext leak (server accident) and we
            //      hash it to avoid storing raw or — on null — falling
            //      through to (3).
            //   3. e.pin plaintext from payload → bcrypt-hash for storage
            //      (same semantics as upsertWithPin), so employee rosters
            //      with inline demo pins also get offline-verifiable.
            //   4. Nothing → set to NULL / undefined so SQL's
            //      `pin_hash IS NOT NULL` filter skips rows that genuinely
            //      have no local pin (we never saw them login).
            let finalPinHash: string | null | undefined;
            const prior = id ? existingPinHash.get(id) : undefined;
            if (prior && isBcryptHash(prior)) {
              finalPinHash = prior;
            } else {
              const rawServerPinHash =
                e.pinHash != null ? String(e.pinHash) :
                e.pin_hash != null ? String(e.pin_hash) : undefined;
              if (rawServerPinHash && isBcryptHash(rawServerPinHash)) {
                finalPinHash = rawServerPinHash;
              } else if (typeof e.pin === 'string' && e.pin.length >= 4) {
                finalPinHash = bcrypt.hashSync(e.pin, 10);
              } else if (rawServerPinHash) {
                // Fallback: non-bcrypt-looking string from server that is
                // still set — hash it anyway so it's store-compatible.
                finalPinHash = bcrypt.hashSync(rawServerPinHash, 10);
              } else {
                finalPinHash = null; // no pin info available; SQL filter will skip
              }
            }
            return {
              id,
              user_id: e.userId ? String(e.userId) : null,
              restaurant_id: e.restaurantId ? String(e.restaurantId) : restaurantId || null,
              branch_id: e.branchId ? String(e.branchId) : branchId || null,
              first_name: e.firstName != null ? String(e.firstName) : e.first_name != null ? String(e.first_name) : null,
              last_name: e.lastName != null ? String(e.lastName) : e.last_name != null ? String(e.last_name) : null,
              email: e.email != null ? String(e.email) : null,
              phone: e.phone != null ? String(e.phone) : null,
              role: String(e.role || 'CASHIER'),
              position_title: e.positionTitle || e.position_title || null,
              employee_number: e.employeeNumber || e.employee_number || null,
              pin_hash: finalPinHash,
              is_active: e.isActive === false ? 0 : 1,
              joined_at: toEpochMillis(e.joinedAt || e.joined_at) ?? null,
              created_at: toEpochMillis(e.createdAt || e.created_at) ?? Date.now(),
              updated_at: toEpochMillis(e.updatedAt || e.updated_at) ?? Date.now(),
            };
          })
          .filter((r: any) => r.id)
      );
      return true;
    })
  );

  ipcMain.handle(
    'db:employees:upsertWithPin',
    wrap('db:employees:upsertWithPin', (employee: unknown, pin: unknown) => {
      const e = (employee || {}) as any;
      const rawPin = String(pin ?? '');
      if (!rawPin) throw new Error('pin required');
      const branchId = String(e.branchId || e.branch_id || getActiveBranchId(repos) || '');
      const restaurantId = String(e.restaurantId || e.restaurant_id || getActiveRestaurantId(repos) || '');
      const employeeId = String(e.id || e.employeeId || e._id || '');
      const userId = String(e.userId || e.user_id || '');
      if (!employeeId) throw new Error('employee.id required');
      if (!branchId) throw new Error('branchId required');
      if (!restaurantId) throw new Error('restaurantId required');
      const pinHash = bcrypt.hashSync(rawPin, 10);
      repos.employees.upsertMany([{
        id: employeeId,
        user_id: userId,
        restaurant_id: restaurantId,
        branch_id: branchId,
        first_name: e.firstName != null ? String(e.firstName) : e.first_name != null ? String(e.first_name) : null,
        last_name: e.lastName != null ? String(e.lastName) : e.last_name != null ? String(e.last_name) : null,
        email: e.email != null ? String(e.email) : null,
        phone: e.phone != null ? String(e.phone) : null,
        role: String(e.role || 'CASHIER'),
        position_title: e.positionTitle || e.position_title || null,
        employee_number: e.employeeNumber || e.employee_number || null,
        pin_hash: pinHash,
        is_active: 1,
        joined_at: toEpochMillis(e.joinedAt || e.joined_at) ?? null,
        created_at: toEpochMillis(e.createdAt || e.created_at) ?? Date.now(),
        updated_at: toEpochMillis(e.updatedAt || e.updated_at) ?? Date.now(),
      } as any]);
      return true;
    })
  );

  ipcMain.handle(
    'db:menu-categories:listAll',
    wrap('db:menu-categories:listAll', () => {
      return repos.menuCategories.list(getActiveBranchId(repos));
    })
  );

  ipcMain.handle(
    'db:menu-categories:upsert',
    wrap('db:menu-categories:upsert', (payload: unknown) => {
      const c = (payload ?? {}) as any;
      const fallbackBranchId = getActiveBranchId(repos);
      const fallbackRestaurantId = getActiveRestaurantId(repos);
      const now = Date.now();
      repos.menuCategories.upsertOne({
        id: String(c.id ?? c._id ?? ''),
        branch_id: String(c.branchId ?? c.branch_id ?? fallbackBranchId),
        restaurant_id: String(c.restaurantId ?? c.restaurant_id ?? fallbackRestaurantId),
        name: c.name != null ? String(c.name) : null,
        description: c.description != null ? String(c.description) : null,
        image_url: c.imageUrl != null ? String(c.imageUrl) : c.image_url != null ? String(c.image_url) : null,
        sort_order: typeof c.sortOrder === 'number' ? c.sortOrder : typeof c.sort_order === 'number' ? c.sort_order : 0,
        is_active: c.isActive === false || c.is_active === 0 ? 0 : 1,
        created_at: toEpochMillis(c.createdAt ?? c.created_at) ?? now,
        updated_at: toEpochMillis(c.updatedAt ?? c.updated_at) ?? now,
      });
      return true;
    })
  );

  ipcMain.handle(
    'db:menu-categories:deleteById',
    wrap('db:menu-categories:deleteById', (id: unknown) => {
      repos.menuCategories.deleteById(String(id ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:menu-items:list',
    wrap('db:menu-items:list', (filters: unknown) => {
      return repos.menuItems.list(
        getActiveBranchId(repos),
        filters as { status?: string; categoryId?: string } | undefined
      );
    })
  );

  ipcMain.handle(
    'db:menu-items:findById',
    wrap('db:menu-items:findById', (id: unknown) => {
      return repos.menuItems.findById(String(id ?? ''));
    })
  );

  ipcMain.handle(
    'db:menu-items:search',
    wrap('db:menu-items:search', (query: unknown) => {
      return repos.menuItems.searchFts(getActiveBranchId(repos), String(query ?? ''));
    })
  );

  ipcMain.handle(
    'db:menu-items:listByCategory',
    wrap('db:menu-items:listByCategory', (categoryId: unknown) => {
      return repos.menuItems.listByCategory(getActiveBranchId(repos), String(categoryId ?? ''));
    })
  );

  ipcMain.handle(
    'db:menu-items:upsert',
    wrap('db:menu-items:upsert', (payload: unknown) => {
      const it = (payload ?? {}) as any;
      const fallbackBranchId = getActiveBranchId(repos);
      const fallbackRestaurantId = getActiveRestaurantId(repos);
      const now = Date.now();
      const taxIds = Array.isArray(it.taxIds) ? it.taxIds : Array.isArray(it.tax_ids) ? it.tax_ids : [];
      const modifierIds = Array.isArray(it.modifierIds) ? it.modifierIds : Array.isArray(it.modifier_ids) ? it.modifier_ids : [];
      const scheduled = it.scheduledAvailability ?? it.scheduled_availability;
      repos.menuItems.upsertOne({
        id: String(it.id ?? it._id ?? ''),
        category_id: it.categoryId != null ? String(it.categoryId) : it.category_id != null ? String(it.category_id) : null,
        branch_id: String(it.branchId ?? it.branch_id ?? fallbackBranchId),
        restaurant_id: String(it.restaurantId ?? it.restaurant_id ?? fallbackRestaurantId),
        sku: it.sku != null ? String(it.sku) : null,
        name: it.name != null ? String(it.name) : null,
        description: it.description != null ? String(it.description) : null,
        image_url: it.imageUrl != null ? String(it.imageUrl) : it.image_url != null ? String(it.image_url) : null,
        price_cents: typeof it.price === 'number' ? it.price : typeof it.priceCents === 'number' ? it.priceCents : typeof it.price_cents === 'number' ? it.price_cents : 0,
        cost_cents: typeof it.cost === 'number' ? it.cost : typeof it.costCents === 'number' ? it.costCents : typeof it.cost_cents === 'number' ? it.cost_cents : null,
        status: it.status != null ? String(it.status) : null,
        allergen_tags: Array.isArray(it.allergenTags)
          ? JSON.stringify(it.allergenTags)
          : typeof it.allergen_tags === 'string'
            ? it.allergen_tags
            : null,
        tax_ids: Array.isArray(taxIds) ? JSON.stringify(taxIds) : null,
        modifier_ids: Array.isArray(modifierIds) ? JSON.stringify(modifierIds) : null,
        preparation_needed: it.preparationNeeded === false || it.preparation_needed === 0 ? 0 : 1,
        kitchen_station: it.kitchenStation != null ? String(it.kitchenStation) : it.kitchen_station != null ? String(it.kitchen_station) : null,
        version: typeof it.version === 'number' ? it.version : 1,
        last_modified_at: toEpochMillis(it.lastModifiedAt ?? it.last_modified_at) ?? now,
        last_modified_by: it.lastModifiedBy != null ? String(it.lastModifiedBy) : it.last_modified_by != null ? String(it.last_modified_by) : null,
        scheduled_availability: scheduled != null ? JSON.stringify(scheduled) : null,
        is_tax_inclusive: it.isTaxInclusive === true || it.is_tax_inclusive === 1 ? 1 : 0,
        max_per_order: typeof it.maxPerOrder === 'number' ? it.maxPerOrder : typeof it.max_per_order === 'number' ? it.max_per_order : 99,
        is_active: it.isActive === false || it.is_active === 0 ? 0 : 1,
        created_at: toEpochMillis(it.createdAt ?? it.created_at) ?? now,
        updated_at: toEpochMillis(it.updatedAt ?? it.updated_at) ?? now,
      });
      return true;
    })
  );

  ipcMain.handle(
    'db:menu-items:deleteById',
    wrap('db:menu-items:deleteById', (id: unknown) => {
      repos.menuItems.deleteById(String(id ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:menu:applySnapshot',
    wrap('db:menu:applySnapshot', (snapshot: unknown) => {
      const s = (snapshot ?? {}) as {
        categories?: unknown;
        items?: unknown;
        modifiers?: unknown;
      };

      const fallbackBranchId = getActiveBranchId(repos);
      const fallbackRestaurantId = getActiveRestaurantId(repos);
      const now = Date.now();

      const categories = Array.isArray(s.categories) ? (s.categories as any[]) : [];
      const items = Array.isArray(s.items) ? (s.items as any[]) : [];
      const modifiers = Array.isArray(s.modifiers) ? (s.modifiers as any[]) : [];

      if (categories.length > 0) {
        repos.menuCategories.upsertMany(
          categories.map((c) => ({
            id: String(c.id ?? c._id ?? ''),
            branch_id: String(c.branchId ?? c.branch_id ?? fallbackBranchId),
            restaurant_id: String(c.restaurantId ?? c.restaurant_id ?? fallbackRestaurantId),
            name: c.name != null ? String(c.name) : null,
            description: c.description != null ? String(c.description) : null,
            image_url: c.imageUrl != null ? String(c.imageUrl) : c.image_url != null ? String(c.image_url) : null,
            sort_order: typeof c.sortOrder === 'number' ? c.sortOrder : typeof c.sort_order === 'number' ? c.sort_order : 0,
            is_active: c.isActive === false || c.is_active === 0 ? 0 : 1,
            created_at: toEpochMillis(c.createdAt ?? c.created_at) ?? now,
            updated_at: toEpochMillis(c.updatedAt ?? c.updated_at) ?? now,
          }))
        );
      }

      if (items.length > 0) {
        repos.menuItems.upsertMany(
          items.map((it) => {
            const taxIds = Array.isArray(it.taxIds) ? it.taxIds : Array.isArray(it.tax_ids) ? it.tax_ids : [];
            const modifierIds = Array.isArray(it.modifierIds) ? it.modifierIds : Array.isArray(it.modifier_ids) ? it.modifier_ids : [];
            const scheduled = it.scheduledAvailability ?? it.scheduled_availability;
            return {
              id: String(it.id ?? it._id ?? ''),
              category_id: it.categoryId != null ? String(it.categoryId) : it.category_id != null ? String(it.category_id) : null,
              branch_id: String(it.branchId ?? it.branch_id ?? fallbackBranchId),
              restaurant_id: String(it.restaurantId ?? it.restaurant_id ?? fallbackRestaurantId),
              sku: it.sku != null ? String(it.sku) : null,
              name: it.name != null ? String(it.name) : null,
              description: it.description != null ? String(it.description) : null,
              image_url: it.imageUrl != null ? String(it.imageUrl) : it.image_url != null ? String(it.image_url) : null,
              price_cents: typeof it.price === 'number' ? it.price : typeof it.priceCents === 'number' ? it.priceCents : typeof it.price_cents === 'number' ? it.price_cents : 0,
              cost_cents: typeof it.cost === 'number' ? it.cost : typeof it.costCents === 'number' ? it.costCents : typeof it.cost_cents === 'number' ? it.cost_cents : null,
              status: it.status != null ? String(it.status) : null,
              allergen_tags: Array.isArray(it.allergenTags)
                ? JSON.stringify(it.allergenTags)
                : typeof it.allergen_tags === 'string'
                  ? it.allergen_tags
                  : null,
              tax_ids: Array.isArray(taxIds) ? JSON.stringify(taxIds) : null,
              modifier_ids: Array.isArray(modifierIds) ? JSON.stringify(modifierIds) : null,
              preparation_needed: it.preparationNeeded === false || it.preparation_needed === 0 ? 0 : 1,
              kitchen_station: it.kitchenStation != null ? String(it.kitchenStation) : it.kitchen_station != null ? String(it.kitchen_station) : null,
              version: typeof it.version === 'number' ? it.version : 1,
              last_modified_at: toEpochMillis(it.lastModifiedAt ?? it.last_modified_at) ?? now,
              last_modified_by: it.lastModifiedBy != null ? String(it.lastModifiedBy) : it.last_modified_by != null ? String(it.last_modified_by) : null,
              scheduled_availability: scheduled != null ? JSON.stringify(scheduled) : null,
              is_tax_inclusive: it.isTaxInclusive === true || it.is_tax_inclusive === 1 ? 1 : 0,
              max_per_order: typeof it.maxPerOrder === 'number' ? it.maxPerOrder : typeof it.max_per_order === 'number' ? it.max_per_order : 99,
              // Default is_active to 1 for admin-sourced menu items (public.menu
              // and sync pull snapshots only contain the admin-configured menu)
              // — but allow soft-delete markers (isActive=false/is_active=0) from
              // sync DELETE ops to flow through so deleted rows stay hidden.
              is_active:
                it.isActive === false || it.is_active === 0 || (it as any).__op === 'DELETE'
                  ? 0
                  : 1,
              created_at: toEpochMillis(it.createdAt ?? it.created_at) ?? now,
              updated_at: toEpochMillis(it.updatedAt ?? it.updated_at) ?? now,
            };
          })
        );
      }

      if (modifiers.length > 0) {
        const modifierRows: any[] = [];
        const optionRows: any[] = [];
        for (const m of modifiers) {
          const modifierId = String(m.id ?? m._id ?? '');
          modifierRows.push({
            id: modifierId,
            branch_id: String(m.branchId ?? m.branch_id ?? fallbackBranchId),
            name: m.name != null ? String(m.name) : null,
            description: m.description != null ? String(m.description) : null,
            is_required: m.required === true || m.is_required === 1 ? 1 : 0,
            min_select: typeof m.minSelections === 'number' ? m.minSelections : typeof m.min_select === 'number' ? m.min_select : 0,
            max_select: typeof m.maxSelections === 'number' ? m.maxSelections : typeof m.max_select === 'number' ? m.max_select : 1,
            is_active: m.isActive === false || m.is_active === 0 ? 0 : 1,
            created_at: toEpochMillis(m.createdAt ?? m.created_at) ?? now,
            updated_at: toEpochMillis(m.updatedAt ?? m.updated_at) ?? now,
          });

          const options = Array.isArray(m.options) ? m.options : [];
          for (let i = 0; i < options.length; i++) {
            const o = options[i];
            optionRows.push({
              id: String(o.id ?? ''),
              modifier_id: modifierId,
              name: o.name != null ? String(o.name) : null,
              price_delta_cents:
                typeof o.priceDelta === 'number' ? o.priceDelta : typeof o.priceDeltaCents === 'number' ? o.priceDeltaCents : typeof o.price_delta_cents === 'number' ? o.price_delta_cents : 0,
              is_default: o.isDefault === true || o.is_default === 1 ? 1 : 0,
              sort_order: typeof o.sortOrder === 'number' ? o.sortOrder : typeof o.sort_order === 'number' ? o.sort_order : i,
              is_active: o.isActive === false || o.is_active === 0 ? 0 : 1,
              created_at: toEpochMillis(o.createdAt ?? o.created_at) ?? now,
              updated_at: toEpochMillis(o.updatedAt ?? o.updated_at) ?? now,
            });
          }
        }
        repos.menuModifiers.upsertMany({ modifiers: modifierRows, options: optionRows });
      }

      return {
        categories: categories.length,
        items: items.length,
        modifiers: modifiers.length,
      };
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:listForItemId',
    wrap('db:menu-modifiers:listForItemId', (itemId: unknown) => {
      return repos.menuModifiers.listForItem(String(itemId ?? ''));
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:listByIds',
    wrap('db:menu-modifiers:listByIds', (ids: unknown) => {
      return repos.menuModifiers.listByIds(Array.isArray(ids) ? ids.map(String) : []);
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:listAll',
    wrap('db:menu-modifiers:listAll', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.menuModifiers.listAll(b);
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:listOptionsByModifierIds',
    wrap('db:menu-modifiers:listOptionsByModifierIds', (ids: unknown) => {
      return repos.menuModifiers.listAllOptions(Array.isArray(ids) ? ids.map(String) : []);
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:upsert',
    wrap('db:menu-modifiers:upsert', (payload: unknown) => {
      const p = (payload ?? {}) as { modifier?: unknown; options?: unknown };
      const m = (p.modifier ?? {}) as any;
      const opts = Array.isArray(p.options) ? (p.options as any[]) : [];
      const fallbackBranchId = getActiveBranchId(repos);
      const now = Date.now();
      const modifierId = String(m.id ?? m._id ?? '');
      const modifierRow = {
        id: modifierId,
        branch_id: String(m.branchId ?? m.branch_id ?? fallbackBranchId),
        name: m.name != null ? String(m.name) : null,
        description: m.description != null ? String(m.description) : null,
        is_required: m.required === true || m.is_required === 1 ? 1 : 0,
        min_select: typeof m.minSelections === 'number' ? m.minSelections : typeof m.min_select === 'number' ? m.min_select : 0,
        max_select: typeof m.maxSelections === 'number' ? m.maxSelections : typeof m.max_select === 'number' ? m.max_select : 1,
        is_active: m.isActive === false || m.is_active === 0 ? 0 : 1,
        created_at: toEpochMillis(m.createdAt ?? m.created_at) ?? now,
        updated_at: toEpochMillis(m.updatedAt ?? m.updated_at) ?? now,
      };
      const optionRows = opts.map((o: any, i: number) => ({
        id: String(o.id ?? ''),
        modifier_id: modifierId,
        name: o.name != null ? String(o.name) : null,
        price_delta_cents:
          typeof o.priceDelta === 'number' ? o.priceDelta : typeof o.priceDeltaCents === 'number' ? o.priceDeltaCents : typeof o.price_delta_cents === 'number' ? o.price_delta_cents : 0,
        is_default: o.isDefault === true || o.is_default === 1 ? 1 : 0,
        sort_order: typeof o.sortOrder === 'number' ? o.sortOrder : typeof o.sort_order === 'number' ? o.sort_order : i,
        is_active: o.isActive === false || o.is_active === 0 ? 0 : 1,
        created_at: toEpochMillis(o.createdAt ?? o.created_at) ?? now,
        updated_at: toEpochMillis(o.updatedAt ?? o.updated_at) ?? now,
      }));
      repos.menuModifiers.upsertOneWithOptions({ modifier: modifierRow, options: optionRows });
      return true;
    })
  );

  ipcMain.handle(
    'db:menu-modifiers:deleteById',
    wrap('db:menu-modifiers:deleteById', (id: unknown) => {
      repos.menuModifiers.deleteById(String(id ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:taxes:listActiveDefaults',
    wrap('db:taxes:listActiveDefaults', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.taxes.listActiveDefaults(b);
    })
  );

  ipcMain.handle(
    'db:discounts:listActive',
    wrap('db:discounts:listActive', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.discounts.listActive(b);
    })
  );

  ipcMain.handle(
    'db:tables:list',
    wrap('db:tables:list', (branchId: unknown, filters: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && filters !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredFilters =
        filters !== undefined
          ? filters
          : branchId && typeof branchId === 'object'
            ? branchId
            : undefined;
      return repos.tables.list(
        String(inferredBranchId ?? ''),
        inferredFilters as { status?: string; zone?: string } | undefined
      );
    })
  );

  ipcMain.handle(
    'db:tables:applySnapshot',
    wrap('db:tables:applySnapshot', (tables: unknown) => {
      const list = Array.isArray(tables) ? tables : [];
      const branchId = getActiveBranchId(repos);
      const restaurantId = getActiveRestaurantId(repos);
      repos.tables.upsertMany(
        list
          .map((t: any) => ({
            id: String(t.id || t._id || ''),
            branch_id: t.branchId ? String(t.branchId) : branchId || null,
            restaurant_id: t.restaurantId ? String(t.restaurantId) : restaurantId || null,
            name: t.name ?? null,
            zone: t.zone ?? null,
            capacity: typeof t.capacity === 'number' ? t.capacity : null,
            status: t.status ?? null,
            qr_code_id: t.qrCodeId ? String(t.qrCodeId) : (t.qr_code_id ? String(t.qr_code_id) : null),
            created_at: toEpochMillis(t.createdAt || t.created_at) ?? Date.now(),
            updated_at: toEpochMillis(t.updatedAt || t.updated_at) ?? Date.now(),
          }))
          .filter((r: any) => r.id)
      );
      return true;
    })
  );

  ipcMain.handle(
    'db:customers:list',
    wrap('db:customers:list', (branchId: unknown, opts: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && opts !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredOpts =
        opts !== undefined
          ? opts
          : branchId && typeof branchId === 'object'
            ? branchId
            : {};
      const o = (inferredOpts ?? {}) as { limit?: number; cursor?: string };
      return repos.customers.list(String(inferredBranchId ?? ''), o.limit ?? 50, o.cursor);
    })
  );

  ipcMain.handle(
    'db:customers:create',
    wrap('db:customers:create', (branchId: unknown, data: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && data !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredData =
        data !== undefined
          ? data
          : branchId && typeof branchId === 'object'
            ? branchId
            : {};
      return repos.customers.findOrCreate(String(inferredBranchId ?? ''), inferredData as Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:customers:findOrCreate',
    wrap('db:customers:findOrCreate', (branchId: unknown, data: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && data !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredData =
        data !== undefined
          ? data
          : branchId && typeof branchId === 'object'
            ? branchId
            : {};
      return repos.customers.findOrCreate(String(inferredBranchId ?? ''), inferredData as Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:orders:create',
    wrap('db:orders:create', (draft: unknown) => {
      return repos.orders.create(draft as { id: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:orders:updateStatus',
    wrap('db:orders:updateStatus', (payload: unknown) => {
      const p = (payload ?? {}) as { id?: unknown; status?: unknown };
      repos.orders.updateStatus(String(p.id ?? ''), String(p.status ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:orders:listRecent',
    wrap('db:orders:listRecent', (branchId: unknown, limit: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && limit !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredLimit = limit !== undefined ? limit : branchId;
      return repos.orders.listRecent(String(inferredBranchId ?? ''), Number(inferredLimit ?? 50));
    })
  );

  ipcMain.handle(
    'db:orders:getById',
    wrap('db:orders:getById', (id: unknown) => {
      return repos.orders.getById(String(id ?? ''));
    })
  );

  ipcMain.handle(
    'db:orders:listHeld',
    wrap('db:orders:listHeld', (employeeId: unknown) => {
      return repos.orders.listHeld(employeeId ? String(employeeId) : undefined);
    })
  );

  ipcMain.handle(
    'db:orders:setHeld',
    wrap('db:orders:setHeld', (payload: unknown) => {
      const p = (payload ?? {}) as { id?: unknown; by?: unknown; at?: unknown };
      repos.orders.setHeld(String(p.id ?? ''), String(p.by ?? ''), p.at ? Number(p.at) : null);
      return true;
    })
  );

  ipcMain.handle(
    'db:orders:listByTableId',
    wrap('db:orders:listByTableId', (tableId: unknown) => {
      return repos.orders.listByTable(String(tableId ?? ''), true);
    })
  );

  // --- Orders visible for a shift: direct shift_id match OR implicit via
  // payments INNER JOIN (repos.orders.listByShiftId uses the latter).
  // Prefer the ShiftModal backend-level `db:payments:getShiftTotals` for
  // reconciliation; this channel is used by the ShiftModal LEGACY fallback
  // path when the getShiftTotals handler is unavailable on older installs.
  ipcMain.handle(
    'db:orders:listByShiftId',
    wrap('db:orders:listByShiftId', (shiftId: unknown) => {
      const id = String(shiftId ?? '');
      const primary = repos.orders.listByShiftId(id, 2000);

      // `repos.orders.listByShiftId` does INNER JOIN payments ON p.shift_id.
      // That misses orders where order.shift_id is filled but no payment
      // (e.g. ON_HOLD / PARTIALLY_PAID / held tabs). Augment with direct
      // shift_id SELECT and dedupe by id. Generic SELECT cast via unknown
      // first to satisfy TS's shape-sufficiency rule.
      const direct = repos.db.all<{ id: string } & Record<string, unknown>>(
        `SELECT * FROM orders WHERE COALESCE(shift_id, '') = ? ORDER BY created_at DESC LIMIT 2000`,
        id
      ) as unknown as typeof primary;
      const seen = new Map<string, (typeof primary)[number]>();
      for (const r of primary) seen.set(String(r.id), r);
      for (const r of direct) {
        const k = String(r.id);
        if (!seen.has(k)) seen.set(k, r);
      }
      return Array.from(seen.values()).slice(0, 2000);
    })
  );

  ipcMain.handle(
    'db:orders:addItem',
    wrap('db:orders:addItem', (payload: unknown) => {
      const p = (payload ?? {}) as { orderId?: unknown; item?: unknown };
      repos.orders.addItem(String(p.orderId ?? ''), (p.item ?? {}) as { id: string } & Record<string, unknown>);
      return true;
    })
  );

  ipcMain.handle(
    'db:orders:removeItem',
    wrap('db:orders:removeItem', (payload: unknown) => {
      const p = (payload ?? {}) as { orderId?: unknown; itemId?: unknown };
      repos.orders.removeItem(String(p.itemId ?? ''));
      void p.orderId;
      return true;
    })
  );

  // --- Counter / Attendant manual "Mark as Paid" (for QR-table Pay-at-Counter
  // and Website online orders where customer pays cash or at POS terminal).
  // Atomic: order patch + Payment ledger row inside the same synchronous DB
  // transaction so reconciliation never sees a half-written state.
  ipcMain.handle(
    'db:orders:updatePaymentStatus',
    wrap('db:orders:updatePaymentStatus', (envelope: unknown) => {
      const env = (envelope ?? {}) as { id?: unknown; payload?: unknown };
      const orderId = String(env.id ?? '');
      if (!orderId) throw new Error('order id required');
      const p = (env.payload ?? {}) as {
        paymentStatus?: unknown;
        method?: unknown;
        paidAmountCents?: unknown;
        note?: unknown;
        employeeId?: unknown;
        employeeName?: unknown;
        shiftId?: unknown;
        referenceId?: unknown;
      };
      const method = String(p.method ?? 'CASH');
      if (!method) throw new Error('payment method required');

      const now = Date.now();
      const auth = repos.meta.getLastAuth();
      const branchId = getActiveBranchId(repos);
      const restaurantId = getActiveRestaurantId(repos);
      const employeeId = p.employeeId ? String(p.employeeId) : auth?.employeeId ?? null;

      // Run the order + payment writes as one SQLite transaction so either
      // both persist or neither does.
      const txn = repos.db.transaction(() => {
        const current = repos.orders.getById(orderId);
        if (!current) throw new Error(`order ${orderId} not found`);
       const totalCents = Number(
  current.total_cents ??
    (typeof (current as any).totalAmount === 'number'
      ? (current as any).totalAmount * 100
      : 0)
);
       const priorPaid = Number(
  current.paid_amount_cents ??
    (typeof (current as any).paidAmount === 'number'
      ? (current as any).paidAmount * 100
      : 0)
);
        const incremental = p.paidAmountCents != null ? Number(p.paidAmountCents) : Math.max(0, totalCents - priorPaid);
        const newTotalPaid = priorPaid + incremental;
        const balanceDueCents = Math.max(0, totalCents - newTotalPaid);
        const desiredStatus = p.paymentStatus ? String(p.paymentStatus) : 'PAID';
        // Auto-demote PAID → PARTIALLY_PAID when balance remains.
        const effectiveStatus =
          balanceDueCents <= 0
            ? desiredStatus
            : desiredStatus === 'PAID'
              ? 'PARTIALLY_PAID'
              : desiredStatus;

        const patched = repos.orders.patchPaymentAndReturn(orderId, {
          payment_status: effectiveStatus,
          payment_method: method,
          paid_amount_cents: newTotalPaid,
          balance_due_cents: balanceDueCents,
        });

        const paymentId = `pay-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        repos.payments.create({
          id: paymentId,
          order_id: orderId,
          employee_id: employeeId,
          shift_id: p.shiftId ? String(p.shiftId) : null,
          branch_id: current.branch_id ?? branchId ?? null,
          restaurant_id: current.restaurant_id ?? restaurantId ?? null,
          method,
          provider: 'LOCAL_POS',
          transaction_reference: p.referenceId ? String(p.referenceId) : null,
          amount_cents: incremental,
          tip_cents: 0,
          change_due_cents: 0,
          status: effectiveStatus === 'FAILED' ? 'FAILED' : 'PAID',
          verification_source: 'LOCAL',
          completed_at: now,
          reference_note: p.note ? String(p.note) : null,
          idempotency_key: `markpaid-${orderId}-${now}`,
          local_version: 1,
          server_version: 0,
          synced: 0,
          created_at: now,
          updated_at: now,
        } as any);

        // Return freshly read payment row + patched order.
        const payments = repos.payments.listByOrderId(orderId);
        const latestPayment = payments[payments.length - 1] ?? null;
        return { order: patched ?? null, payment: latestPayment };
      });

      return txn();
    })
  );

  ipcMain.handle(
    'db:order-items:listForOrderId',
    wrap('db:order-items:listForOrderId', (orderId: unknown) => {
      return repos.orderItems.listByOrderId(String(orderId ?? ''));
    })
  );

  ipcMain.handle(
    'db:order-item-modifiers:bulkInsert',
    wrap('db:order-item-modifiers:bulkInsert', (rows: unknown) => {
      const safe = Array.isArray(rows) ? (rows as Array<{ id: string } & Record<string, unknown>>) : [];
      repos.orderItemModifierOptions.bulkInsert(safe);
      return true;
    })
  );

  ipcMain.handle(
    'db:order-item-modifiers:listForOrderId',
    wrap('db:order-item-modifiers:listForOrderId', (orderId: unknown) => {
      return repos.orderItemModifierOptions.listByOrderId(String(orderId ?? ''));
    })
  );

  ipcMain.handle(
    'db:payments:create',
    wrap('db:payments:create', (payment: unknown) => {
      return repos.payments.create(payment as { id: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:payments:listByOrderId',
    wrap('db:payments:listByOrderId', (orderId: unknown) => {
      return repos.payments.listByOrderId(String(orderId ?? ''));
    })
  );

  ipcMain.handle(
    'db:payments:listByShiftId',
    wrap('db:payments:listByShiftId', (shiftId: unknown) => {
      return repos.payments.listByShiftId(String(shiftId ?? ''));
    })
  );

  // Broad payment scan used by the ShiftModal LEGACY fallback when shift_id
  // isn't set on rows (QR sync, Mark Paid later, first sale pre-open-shift).
  // Signature mirrors orders.listRecent: 1 arg = limit, 2 args = (branchId, limit).
  ipcMain.handle(
    'db:payments:listRecent',
    wrap('db:payments:listRecent', (branchId: unknown, limit: unknown) => {
      const hasBoth =
        typeof branchId === 'string' &&
        branchId &&
        (typeof limit === 'number' || typeof limit === 'string');
      const inferredBranchId = hasBoth ? String(branchId) : getActiveBranchId(repos);
      const inferredLimit =
        limit !== undefined
          ? limit
          : typeof branchId === 'number' || typeof branchId === 'string'
            ? branchId
            : 1000;
      return repos.payments.listRecent(
        inferredBranchId ? String(inferredBranchId) : null,
        Number(inferredLimit ?? 1000)
      );
    })
  );

  ipcMain.handle(
    'db:payments:getShiftTotals',
    wrap('db:payments:getShiftTotals', (shiftId: unknown) => {
      return repos.payments.getShiftTotals(String(shiftId ?? ''));
    })
  );

  ipcMain.handle(
    'db:shifts:open',
    wrap('db:shifts:open', (data: unknown) => {
      return repos.shifts.open(data as { id: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:shifts:close',
    wrap('db:shifts:close', (payload: unknown) => {
      const p = (payload ?? {}) as {
        id?: unknown;
        closing_cash_cents?: unknown;
        variance_cents?: unknown;
        note?: unknown;
        closed_at?: unknown;
      };
      repos.shifts.close(String(p.id ?? ''), {
        closing_cash_cents: Number(p.closing_cash_cents ?? 0),
        variance_cents: Number(p.variance_cents ?? 0),
        note: p.note ? String(p.note) : null,
        closed_at: p.closed_at ? Number(p.closed_at) : null,
      });
      return true;
    })
  );

  ipcMain.handle(
    'db:shifts:getOpen',
    wrap('db:shifts:getOpen', (deviceId: unknown, employeeId: unknown) => {
      const auth = repos.meta.getLastAuth();

      // The renderer may pass either:
      //   1. Legacy positional args: (deviceId, employeeId)
      //   2. A single filter object:  ({ deviceId?, employeeId?, branchId?, restaurantId? })
      // Detect case #2 and unwrap the ids so the downstream scoped lookup
      // continues to work regardless of calling convention.
      const isFilterObject =
        deviceId !== null &&
        typeof deviceId === 'object' &&
        !Array.isArray(deviceId) &&
        ('employeeId' in deviceId || 'branchId' in deviceId || 'restaurantId' in deviceId || 'deviceId' in deviceId);
      const filter: { deviceId?: unknown; employeeId?: unknown; branchId?: unknown; restaurantId?: unknown } =
        isFilterObject ? (deviceId as any) : {};

      const filterDeviceId = typeof filter.deviceId === 'string' && filter.deviceId ? filter.deviceId : '';
      const inferredDeviceId =
        filterDeviceId
          ? filterDeviceId
          : !isFilterObject && typeof deviceId === 'string' && deviceId
            ? deviceId
            : auth?.deviceId
              ? String(auth.deviceId)
              : '';

      // Prefer explicit ids from the caller (filter object or positional arg)
      // over meta's last-auth snapshot. This ensures shift scoping is correct
      // immediately after a login → logout → re-login cycle, where the meta
      // table may still be catching up.
      const explicitEmployeeId =
        employeeId !== undefined
          ? employeeId
          : typeof filter.employeeId === 'string' && filter.employeeId
            ? filter.employeeId
            : undefined;

      const inferredEmployeeId =
        explicitEmployeeId !== undefined
          ? explicitEmployeeId
          : auth?.employeeId
            ? auth.employeeId
            : undefined;

      return repos.shifts.getOpen(
        String(inferredDeviceId ?? ''),
        inferredEmployeeId ? String(inferredEmployeeId) : undefined
      );
    })
  );

  ipcMain.handle(
    'db:shifts:listByEmployee',
    wrap('db:shifts:listByEmployee', (employeeId: unknown, limit: unknown) => {
      return repos.shifts.listByEmployee(String(employeeId ?? ''), Number(limit ?? 50));
    })
  );

  ipcMain.handle(
    'db:shifts:listByDate',
    wrap('db:shifts:listByDate', (branchId: unknown, from: unknown, to: unknown) => {
      const inferredBranchId =
        typeof branchId === 'string' && branchId && from !== undefined
          ? branchId
          : getActiveBranchId(repos);
      const inferredFrom = from !== undefined ? from : 0;
      const inferredTo = to !== undefined ? to : Date.now();
      return repos.shifts.listByDate(String(inferredBranchId ?? ''), Number(inferredFrom ?? 0), Number(inferredTo ?? Date.now()));
    })
  );

  ipcMain.handle(
    'db:cash-adjustments:create',
    wrap('db:cash-adjustments:create', (shiftId: unknown, data: unknown) => {
      return repos.cashAdjustments.create(String(shiftId ?? ''), data as { id: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:cash-adjustments:listByShiftId',
    wrap('db:cash-adjustments:listByShiftId', (shiftId: unknown) => {
      return repos.cashAdjustments.listByShiftId(String(shiftId ?? ''));
    })
  );

  ipcMain.handle(
    'db:kitchen-orders:create',
    wrap('db:kitchen-orders:create', (orderId: unknown, items: unknown) => {
      return repos.kitchenOrders.createFromOrder(
        String(orderId ?? ''),
        Array.isArray(items) ? (items as Array<{ id: string; order_item_id: string }>) : []
      );
    })
  );

  ipcMain.handle(
    'db:kitchen-orders:updateStatus',
    wrap('db:kitchen-orders:updateStatus', (payload: unknown) => {
      const p = (payload ?? {}) as { id?: unknown; status?: unknown };
      repos.kitchenOrders.updateStatus(String(p.id ?? ''), String(p.status ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:kitchen-orders:listByStatus',
    wrap('db:kitchen-orders:listByStatus', (branchId: unknown, statuses: unknown) => {
      return repos.kitchenOrders.listByStatus(
        String(branchId ?? ''),
        Array.isArray(statuses) ? statuses.map(String) : []
      );
    })
  );

  ipcMain.handle(
    'db:kitchen-orders:bump',
    wrap('db:kitchen-orders:bump', (orderId: unknown) => {
      repos.kitchenOrders.bumpByOrder(String(orderId ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:inventory-items:list',
    wrap('db:inventory-items:list', (branchId: unknown, filters: unknown) => {
      return repos.inventoryItems.list(
        String(branchId ?? ''),
        filters as { lowStockOnly?: boolean; supplierId?: string } | undefined
      );
    })
  );

  ipcMain.handle(
    'db:inventory-items:listLowStock',
    wrap('db:inventory-items:listLowStock', (branchId: unknown) => {
      return repos.inventoryItems.listLowStock(String(branchId ?? ''));
    })
  );

  ipcMain.handle(
    'db:inventory-items:updateStock',
    wrap('db:inventory-items:updateStock', (payload: unknown) => {
      const p = (payload ?? {}) as { id?: unknown; quantity?: unknown; note?: unknown };
      repos.inventoryItems.updateStock(String(p.id ?? ''), Number(p.quantity ?? 0));
      void p.note;
      return true;
    })
  );

  ipcMain.handle(
    'db:recipes:listByMenuItemId',
    wrap('db:recipes:listByMenuItemId', (menuItemId: unknown) => {
      return repos.recipes.listByMenuItemId(String(menuItemId ?? ''));
    })
  );

  ipcMain.handle(
    'db:recipes:getFullRecipesCache',
    wrap('db:recipes:getFullRecipesCache', (branchId: unknown) => {
      const map = repos.recipes.getFullCache(String(branchId ?? ''));
      return Object.fromEntries(map.entries());
    })
  );

  ipcMain.handle(
    'db:settings:get',
    wrap('db:settings:get', (payload: unknown) => {
      const p = (payload ?? {}) as {
        key?: unknown;
        scope?: unknown;
        restaurantId?: unknown;
        branchId?: unknown;
      };
      return repos.settings.get(
        String(p.scope ?? 'global'),
        String(p.key ?? ''),
        {
          restaurantId: p.restaurantId ? String(p.restaurantId) : null,
          branchId: p.branchId ? String(p.branchId) : null,
        }
      );
    })
  );

  ipcMain.handle(
    'db:settings:set',
    wrap('db:settings:set', (payload: unknown) => {
      const p = (payload ?? {}) as {
        key?: unknown;
        value?: unknown;
        scope?: unknown;
        restaurantId?: unknown;
        branchId?: unknown;
      };
      repos.settings.set(
        String(p.scope ?? 'global'),
        String(p.key ?? ''),
        String(p.value ?? ''),
        {
          restaurantId: p.restaurantId ? String(p.restaurantId) : null,
          branchId: p.branchId ? String(p.branchId) : null,
        }
      );
      return true;
    })
  );

  ipcMain.handle(
    'db:settings:getAllByScope',
    wrap('db:settings:getAllByScope', (scope: unknown, filters: unknown) => {
      const f = (filters ?? {}) as { restaurantId?: unknown; branchId?: unknown };
      return repos.settings.getAllByScope(String(scope ?? ''), {
        restaurantId: f.restaurantId !== undefined ? (f.restaurantId ? String(f.restaurantId) : null) : undefined,
        branchId: f.branchId !== undefined ? (f.branchId ? String(f.branchId) : null) : undefined,
      });
    })
  );

  ipcMain.handle(
    'db:sync-queue:push',
    wrap('db:sync-queue:push', (item: unknown) => {
      return repos.syncQueue.push(item as { op_id: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:sync-queue:peek',
    wrap('db:sync-queue:peek', (limit: unknown) => {
      return repos.syncQueue.peek('QUEUED', Number(limit ?? 10));
    })
  );

  ipcMain.handle(
    'db:sync-queue:claimBatch',
    wrap('db:sync-queue:claimBatch', (batchSize: unknown, deviceId: unknown) => {
      return repos.syncQueue.claimBatch(Number(batchSize ?? 10), String(deviceId ?? ''));
    })
  );

  ipcMain.handle(
    'db:sync-queue:markDone',
    wrap('db:sync-queue:markDone', (opId: unknown) => {
      repos.syncQueue.markDone(String(opId ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:sync-queue:markFailed',
    wrap('db:sync-queue:markFailed', (payload: unknown) => {
      const p = (payload ?? {}) as { opId?: unknown; error?: unknown; nextAttemptAt?: unknown };
      repos.syncQueue.markFailed(
        String(p.opId ?? ''),
        String(p.error ?? ''),
        p.nextAttemptAt ? Number(p.nextAttemptAt) : null
      );
      return true;
    })
  );

  ipcMain.handle(
    'db:sync-queue:getCounts',
    wrap('db:sync-queue:getCounts', () => {
      return repos.syncQueue.getCounts();
    })
  );

  ipcMain.handle(
    'db:sync-queue:resetByOpId',
    wrap('db:sync-queue:resetByOpId', (opId: unknown) => {
      repos.syncQueue.resetByOpId(String(opId ?? ''));
      return true;
    })
  );

  ipcMain.handle(
    'db:sync-records:listByEntity',
    wrap('db:sync-records:listByEntity', (payload: unknown) => {
      const p = (payload ?? {}) as { entityType?: unknown; entityId?: unknown; limit?: unknown };
      return repos.syncRecords.listByEntity(
        String(p.entityType ?? ''),
        String(p.entityId ?? ''),
        Number(p.limit ?? 50)
      );
    })
  );

  ipcMain.handle(
    'db:sync-records:insert',
    wrap('db:sync-records:insert', (record: unknown) => {
      return repos.syncRecords.insert(record as { device_id: string; idempotency_key: string } & Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:sync-records:markStatus',
    wrap('db:sync-records:markStatus', (payload: unknown) => {
      const p = (payload ?? {}) as {
        id?: unknown;
        status?: unknown;
        responseSnapshot?: unknown;
        lastError?: unknown;
      };
      repos.syncRecords.markStatus(
        Number(p.id ?? 0),
        String(p.status ?? ''),
        p.responseSnapshot ? String(p.responseSnapshot) : null,
        p.lastError ? String(p.lastError) : null
      );
      return true;
    })
  );

  ipcMain.handle(
    'db:audit-logs:listByDate',
    wrap('db:audit-logs:listByDate', (branchId: unknown, from: unknown, to: unknown, filters: unknown) => {
      const f = (filters ?? {}) as { limit?: unknown; cursor?: unknown };
      return repos.auditLogs.list(String(branchId ?? ''), {
        from: from ? Number(from) : undefined,
        to: to ? Number(to) : undefined,
        limit: f.limit ? Number(f.limit) : undefined,
        cursor: f.cursor ? Number(f.cursor) : undefined,
      });
    })
  );

  ipcMain.handle(
    'db:audit-logs:insert',
    wrap('db:audit-logs:insert', (log: unknown) => {
      return repos.auditLogs.insert(log as Record<string, unknown>);
    })
  );

  ipcMain.handle(
    'db:inventory-transactions:listByItem',
    wrap('db:inventory-transactions:listByItem', (payload: unknown) => {
      const p = (payload ?? {}) as { itemId?: unknown; limit?: unknown };
      return repos.inventoryTransactions.listByItemId(String(p.itemId ?? ''), {
        limit: p.limit ? Number(p.limit) : undefined,
      });
    })
  );

  ipcMain.handle(
    'db:inventory-transactions:listByShift',
    wrap('db:inventory-transactions:listByShift', (shiftId: unknown) => {
      return repos.inventoryTransactions.listByShiftId(String(shiftId ?? ''));
    })
  );

  ipcMain.handle(
    'db:meta:setSyncCursor',
    wrap('db:meta:setSyncCursor', (payload: unknown) => {
      const obj = (payload ?? {}) as Record<string, unknown>;
      for (const [entityType, cursor] of Object.entries(obj)) {
        repos.meta.setSyncCursor(entityType, String(cursor ?? ''));
      }
      return true;
    })
  );

  ipcMain.handle(
    'db:meta:getSyncCursor',
    wrap('db:meta:getSyncCursor', () => {
      const entityTypes = [
        'menu_item', 'menu_category', 'menu_modifier', 'tax', 'discount',
        'employee', 'table', 'customer', 'shift', 'inventory_item',
        'inventory_transaction', 'recipe', 'setting', 'loyalty_account',
        'promotion',
      ];
      const result: Record<string, string | null> = {};
      for (const t of entityTypes) result[t] = repos.meta.getSyncCursor(t);
      return result;
    })
  );

  ipcMain.handle(
    'db:meta:setLastAuth',
    wrap('db:meta:setLastAuth', (auth: unknown) => {
      repos.meta.setLastAuth((auth ?? null) as Parameters<typeof repos.meta.setLastAuth>[0]);
      return true;
    })
  );

  ipcMain.handle(
    'db:meta:getLastAuth',
    wrap('db:meta:getLastAuth', () => {
      return repos.meta.getLastAuth();
    })
  );

  // --- Table Sessions (Professional Dine-in Running Tabs) ---

  ipcMain.handle(
    'db:table-sessions:openOrGet',
    wrap('db:table-sessions:openOrGet', (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const branchId =
        typeof p.branchId === 'string'
          ? p.branchId
          : getActiveBranchId(repos);
      const restaurantId =
        typeof p.restaurantId === 'string'
          ? p.restaurantId
          : getActiveRestaurantId(repos);
      const auth = repos.meta.getLastAuth();
      const result = repos.tableSessionService.openOrGet({
        tableId: String(p.tableId ?? ''),
        tableName: typeof p.tableName === 'string' ? p.tableName : undefined,
        branchId,
        restaurantId,
        openedBy:
          typeof p.openedBy === 'string'
            ? p.openedBy
            : auth?.employeeId ?? undefined,
        openedByName:
          typeof p.openedByName === 'string'
            ? p.openedByName
            : (auth as any)?.cashier?.displayName ??
              (auth as any)?.cashier?.firstName ??
              undefined,
        serverId:
          typeof p.serverId === 'string'
            ? p.serverId
            : auth?.employeeId ?? undefined,
        serverName:
          typeof p.serverName === 'string' ? p.serverName : undefined,
        covers: typeof p.covers === 'number' ? p.covers : undefined,
      });
      // Sync to server: push CREATE (new session) or UPDATE (re-opened existing)
      // into sync_queue so reconnect sync picks it up. Non-blocking best-effort.
      try {
        const sess = result.session;
        if (sess?.id) {
          const op = result.wasCreated ? 'CREATE' : 'UPDATE';
          repos.syncQueue.push({
            op_id: `tablesess_${sess.id}_${Date.now()}`,
            entity_type: 'TABLE_SESSION',
            operation: op,
            entity_id: String(sess.id),
            payload: JSON.stringify(buildTableSessionSyncPayload(sess)),
            idempotency_key: `tablesess_${sess.id}_${op}`,
            local_entity_version: Number((sess as any).local_version ?? 1),
          });
        }
      } catch (syncErr) {
        console.warn('[IPC DB] openOrGet sync_queue push failed:', syncErr);
      }
      return result;
    })
  );

  ipcMain.handle(
    'db:table-sessions:getById',
    wrap('db:table-sessions:getById', (id: unknown) => {
      return repos.tableSessions.getById(String(id ?? ''));
    })
  );

  ipcMain.handle(
    'db:table-sessions:getOpenForTable',
    wrap('db:table-sessions:getOpenForTable', (tableId: unknown) => {
      return repos.tableSessions.getOpenForTable(String(tableId ?? ''));
    })
  );

  ipcMain.handle(
    'db:table-sessions:listOpen',
    wrap('db:table-sessions:listOpen', (branchId: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.tableSessions.listOpen(b);
    })
  );

  ipcMain.handle(
    'db:table-sessions:listRecent',
    wrap('db:table-sessions:listRecent', (branchId: unknown, limit: unknown) => {
      const b =
        typeof branchId === 'string' && branchId
          ? branchId
          : getActiveBranchId(repos);
      return repos.tableSessions.listRecent(
        b,
        typeof limit === 'number' ? limit : undefined
      );
    })
  );

  ipcMain.handle(
    'db:table-sessions:replaceCartItems',
    wrap('db:table-sessions:replaceCartItems', (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const items = Array.isArray(p.items) ? p.items : [];
      const auth = repos.meta.getLastAuth();
      const sessUpdated = repos.tableSessionService.replaceAllItems({
        sessionId: String(p.sessionId ?? ''),
        items: items.map((it: any) => ({
          id: String(it.id ?? it.lineId ?? ''),
          menuItemId: String(it.menuItemId ?? ''),
          name: String(it.name ?? ''),
          unitPriceCents: Number(it.unitPriceCents ?? it.price ?? 0),
          quantity: Number(it.quantity ?? 0),
          subtotalCents: Number(it.subtotalCents ?? it.subtotal ?? 0),
          specialInstructions:
            typeof it.specialInstructions === 'string'
              ? it.specialInstructions
              : undefined,
        })),
        actorId:
          typeof p.actorId === 'string'
            ? p.actorId
            : auth?.employeeId ?? undefined,
        actorName:
          typeof p.actorName === 'string'
            ? p.actorName
            : (auth as any)?.cashier?.displayName ??
              (auth as any)?.cashier?.firstName ??
              undefined,
        taxRates: Array.isArray(p.taxRates) ? p.taxRates : [],
      });
      // Push an UPDATE row to sync_queue so Admin sees running tab totals
      // even when offline -> back online.
      try {
        if (sessUpdated?.id) {
          repos.syncQueue.push({
            op_id: `tablesess_${sessUpdated.id}_cart_${Date.now()}`,
            entity_type: 'TABLE_SESSION',
            operation: 'UPDATE',
            entity_id: String(sessUpdated.id),
            payload: JSON.stringify(buildTableSessionSyncPayload(sessUpdated)),
            idempotency_key: `tablesess_${sessUpdated.id}_UPDATE`,
            local_entity_version: Number((sessUpdated as any).local_version ?? 1),
          });
        }
      } catch (syncErr) {
        console.warn('[IPC DB] replaceCartItems sync_queue push failed:', syncErr);
      }
      return sessUpdated;
    })
  );

  ipcMain.handle(
    'db:table-sessions:updateStatus',
    wrap('db:table-sessions:updateStatus', (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      repos.tableSessions.updateStatus(
        String(p.id ?? ''),
        (p.status as any) ?? 'OPEN',
        {
          closedAt: typeof p.closedAt === 'number' ? p.closedAt : undefined,
          closedBy:
            typeof p.closedBy === 'string' ? p.closedBy : undefined,
        }
      );
      const ledgerNote =
        typeof p.ledgerNote === 'string' ? p.ledgerNote : undefined;
      const auth = repos.meta.getLastAuth();
      const sess = repos.tableSessions.getById(String(p.id ?? ''));
      if (sess) {
        const entryType =
          p.status === 'CLOSED'
            ? 'CLOSED'
            : p.status === 'AWAITING_PAYMENT'
              ? 'AWAITING_PAYMENT'
              : p.status === 'VOIDED'
                ? 'VOIDED'
                : 'NOTE';
        repos.tableSessionService.appendLedger({
          session_id: sess.id,
          branch_id: sess.branch_id,
          restaurant_id: sess.restaurant_id,
          entry_type: entryType as any,
          actor_id: auth?.employeeId ?? null,
          actor_name:
            (auth as any)?.cashier?.displayName ??
            (auth as any)?.cashier?.firstName ??
            null,
          label: `Status → ${String(p.status ?? '')}`,
          amount_after_cents: Number(sess.total_cents ?? 0),
          note: ledgerNote ?? null,
        });
        // Sync status change (e.g. PAID/CLOSED) so Admin sees settlement
        // on the floor plan revenue dashboard.
        try {
          const finalSess = repos.tableSessions.getById(sess.id);
          if (finalSess?.id) {
            repos.syncQueue.push({
              op_id: `tablesess_${finalSess.id}_status_${Date.now()}`,
              entity_type: 'TABLE_SESSION',
              operation: 'UPDATE',
              entity_id: String(finalSess.id),
              payload: JSON.stringify(buildTableSessionSyncPayload(finalSess)),
              idempotency_key: `tablesess_${finalSess.id}_status_${String(p.status ?? '')}`,
              local_entity_version: Number((finalSess as any).local_version ?? 1),
            });
          }
        } catch (syncErr) {
          console.warn('[IPC DB] updateStatus sync_queue push failed:', syncErr);
        }
      }
      return true;
    })
  );

  ipcMain.handle(
    'db:table-session-ledger:listForSession',
    wrap('db:table-session-ledger:listForSession', (sessionId: unknown) => {
      return repos.tableSessionLedger.listForSession(String(sessionId ?? ''));
    })
  );

  ipcMain.handle(
    'db:table-session-ledger:appendNote',
    wrap('db:table-session-ledger:appendNote', (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const auth = repos.meta.getLastAuth();
      const sess = repos.tableSessions.getById(String(p.sessionId ?? ''));
      if (!sess) throw new Error(`Session not found: ${p.sessionId}`);
      return repos.tableSessionService.appendLedger({
        session_id: sess.id,
        branch_id: sess.branch_id,
        restaurant_id: sess.restaurant_id,
        entry_type: 'NOTE',
        reference_id:
          typeof p.referenceId === 'string' ? p.referenceId : null,
        actor_id: auth?.employeeId ?? null,
        actor_name:
          (auth as any)?.cashier?.displayName ??
          (auth as any)?.cashier?.firstName ??
          null,
        label:
          typeof p.label === 'string' && p.label
            ? p.label
            : 'Note added to tab',
        amount_after_cents: Number(sess.total_cents ?? 0),
        note: typeof p.note === 'string' ? p.note : null,
        metadata_json:
          typeof p.metadata === 'object' && p.metadata
            ? JSON.stringify(p.metadata)
            : null,
      });
    })
  );

  // --- Offline Reports Aggregation ---

  ipcMain.handle(
    'db:reports:periodSales',
    wrap('db:reports:periodSales', (opts: unknown) => {
      const o = (opts ?? {}) as Record<string, unknown>;
      return repos.reports.periodSales({
        period: (o.period as any) ?? 'DAY',
        year: o.year != null ? Number(o.year) : undefined,
        month: o.month != null ? Number(o.month) : undefined,
        weekStartTs: o.weekStartTs != null ? Number(o.weekStartTs) : undefined,
        dayTs: o.dayTs != null ? Number(o.dayTs) : undefined,
        branchId: o.branchId != null ? (o.branchId as string | null) : undefined,
        restaurantId: o.restaurantId != null ? (o.restaurantId as string | null) : undefined,
      });
    })
  );

  ipcMain.handle(
    'db:reports:availableYears',
    wrap('db:reports:availableYears', (scope: unknown) => {
      const s = (scope ?? {}) as Record<string, unknown>;
      return repos.reports.listAvailableYears({
        branchId: s.branchId != null ? (s.branchId as string | null) : undefined,
        restaurantId: s.restaurantId != null ? (s.restaurantId as string | null) : undefined,
      });
    })
  );
}
