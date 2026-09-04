import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  up: (db: Database) => void;
  down?: (db: Database) => void;
}

export const TABLES_WITH_UPDATED_AT = [
  'employees',
  'menu_categories',
  'menu_items',
  'menu_modifiers',
  'menu_modifier_options',
  'taxes',
  'discounts',
  'tables',
  'customers',
  'orders',
  'payments',
  'shifts',
  'kitchen_orders',
  'inventory_items',
  'recipes',
  'settings',
  'sync_records',
  'loyalty_accounts',
  'promotions',
];

export const migrations: Migration[] = [
  {
    version: 1,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          id TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);

      const cols = db.prepare(`PRAGMA table_info(meta)`).all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      const updatedAt = cols.find((c) => c.name === 'updated_at');
      if (!updatedAt || !updatedAt.dflt_value) {
        db.exec(`ALTER TABLE meta RENAME TO meta_old;`);
        db.exec(`
          CREATE TABLE meta (
            id TEXT PRIMARY KEY,
            value TEXT,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
          );
        `);
        const oldCols = db.prepare(`PRAGMA table_info(meta_old)`).all() as Array<{
          name: string;
        }>;
        const hasOldUpdatedAt = oldCols.some((c) => c.name === 'updated_at');
        if (hasOldUpdatedAt) {
          db.exec(`
            INSERT INTO meta (id, value, updated_at)
            SELECT id, value, COALESCE(updated_at, unixepoch('now')*1000)
            FROM meta_old;
          `);
        } else {
          db.exec(`
            INSERT INTO meta (id, value, updated_at)
            SELECT id, value, unixepoch('now')*1000
            FROM meta_old;
          `);
        }
        db.exec(`DROP TABLE meta_old;`);
      }

      db.exec(`
        INSERT OR IGNORE INTO meta (id, value, updated_at) VALUES
          ('schema_version', '1', unixepoch('now')*1000),
          ('sync_cursors', '{}', unixepoch('now')*1000),
          ('last_auth', NULL, unixepoch('now')*1000),
          ('device_id', NULL, unixepoch('now')*1000);
      `);
    },
  },
  {
    version: 2,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS employees (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          restaurant_id TEXT,
          branch_id TEXT,
          role TEXT,
          position_title TEXT,
          employee_number TEXT,
          pin_hash TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          joined_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_employees_branch_active
          ON employees(branch_id, is_active);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user_branch
          ON employees(user_id, branch_id);
      `);
    },
  },
  {
    version: 3,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS menu_categories (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          restaurant_id TEXT,
          name TEXT,
          description TEXT,
          image_url TEXT,
          sort_order INTEGER,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_menu_categories_branch_sort
          ON menu_categories(branch_id, sort_order);
      `);
    },
  },
  {
    version: 4,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS menu_items (
          id TEXT PRIMARY KEY,
          category_id TEXT,
          branch_id TEXT,
          restaurant_id TEXT,
          sku TEXT,
          name TEXT,
          description TEXT,
          image_url TEXT,
          price_cents INTEGER,
          cost_cents INTEGER,
          status TEXT,
          allergen_tags TEXT,
          tax_ids TEXT,
          modifier_ids TEXT,
          preparation_needed INTEGER NOT NULL DEFAULT 1,
          kitchen_station TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          last_modified_at INTEGER,
          last_modified_by TEXT,
          scheduled_availability TEXT,
          is_tax_inclusive INTEGER NOT NULL DEFAULT 0,
          max_per_order INTEGER NOT NULL DEFAULT 99,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_menu_items_branch_status
          ON menu_items(branch_id, status);
        CREATE INDEX IF NOT EXISTS idx_menu_items_category
          ON menu_items(category_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS menu_items_fts USING fts5(
          name, description, sku,
          content='menu_items',
          content_rowid='rowid'
        );
      `);
    },
  },
  {
    version: 5,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS menu_modifiers (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          name TEXT,
          description TEXT,
          is_required INTEGER NOT NULL DEFAULT 0,
          min_select INTEGER NOT NULL DEFAULT 0,
          max_select INTEGER NOT NULL DEFAULT 1,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);
    },
  },
  {
    version: 6,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS menu_modifier_options (
          id TEXT PRIMARY KEY,
          modifier_id TEXT,
          name TEXT,
          price_delta_cents INTEGER,
          is_default INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);
    },
  },
  {
    version: 7,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS taxes (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          name TEXT,
          rate_percent REAL,
          is_compound INTEGER NOT NULL DEFAULT 0,
          is_inclusive INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);
    },
  },
  {
    version: 8,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS discounts (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          name TEXT,
          type TEXT,
          value_cents INTEGER,
          value_percent REAL,
          max_amount_cents INTEGER,
          min_order_cents INTEGER,
          is_active INTEGER NOT NULL DEFAULT 1,
          valid_times TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);
    },
  },
  {
    version: 9,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tables (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          restaurant_id TEXT,
          name TEXT,
          zone TEXT,
          capacity INTEGER,
          status TEXT,
          qr_code_id TEXT,
          permanent_qr_id TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_branch_name
          ON tables(branch_id, name);
      `);
    },
  },
  {
    version: 10,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          restaurant_id TEXT,
          branch_id TEXT,
          first_name TEXT,
          last_name TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          loyalty_level INTEGER,
          total_visits INTEGER NOT NULL DEFAULT 0,
          total_spent_cents INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_customers_branch_phone
          ON customers(branch_id, phone);
        CREATE INDEX IF NOT EXISTS idx_customers_email
          ON customers(email);
      `);
    },
  },
  {
    version: 11,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          restaurant_id TEXT,
          order_number TEXT,
          source TEXT,
          order_type TEXT,
          table_id TEXT,
          table_session_id TEXT,
          customer_id TEXT,
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          employee_id TEXT,
          held_by TEXT,
          held_at INTEGER,
          status TEXT,
          payment_status TEXT,
          payment_method TEXT,
          paid_amount_cents INTEGER NOT NULL DEFAULT 0,
          balance_due_cents INTEGER NOT NULL DEFAULT 0,
          subtotal_cents INTEGER,
          discount_cents INTEGER,
          tax_cents INTEGER,
          total_cents INTEGER,
          tip_cents INTEGER,
          change_due_cents INTEGER,
          discount_id TEXT,
          note TEXT,
          split_group_id TEXT,
          idempotency_key TEXT,
          server_version INTEGER NOT NULL DEFAULT 0,
          local_version INTEGER NOT NULL DEFAULT 1,
          synced INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
          ON orders(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_orders_branch_created
          ON orders(branch_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_table_status
          ON orders(table_id, status);
        CREATE INDEX IF NOT EXISTS idx_orders_synced_status
          ON orders(synced, status);
      `);
    },
  },
  {
    version: 12,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT,
          menu_item_id TEXT,
          name_snapshot TEXT,
          price_snapshot_cents INTEGER,
          quantity INTEGER,
          subtotal_cents INTEGER,
          tax_cents INTEGER,
          discount_cents INTEGER,
          total_cents INTEGER,
          special_instructions TEXT,
          preparation_status TEXT
        );
      `);
    },
  },
  {
    version: 13,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_item_modifier_options (
          id TEXT PRIMARY KEY,
          order_item_id TEXT,
          modifier_id TEXT,
          modifier_name TEXT,
          option_id TEXT,
          option_name TEXT,
          price_delta_cents INTEGER
        );
      `);
    },
  },
  {
    version: 14,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          order_id TEXT,
          employee_id TEXT,
          shift_id TEXT,
          branch_id TEXT,
          restaurant_id TEXT,
          method TEXT,
          provider TEXT,
          transaction_reference TEXT,
          amount_cents INTEGER,
          tip_cents INTEGER,
          change_due_cents INTEGER,
          status TEXT,
          verification_source TEXT,
          completed_at INTEGER,
          reference_note TEXT,
          idempotency_key TEXT,
          server_version INTEGER NOT NULL DEFAULT 0,
          local_version INTEGER NOT NULL DEFAULT 1,
          synced INTEGER NOT NULL DEFAULT 0,
          failure_reason TEXT,
          provider_response_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
          ON payments(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_payments_order
          ON payments(order_id);
        CREATE INDEX IF NOT EXISTS idx_payments_shift
          ON payments(shift_id);
        CREATE INDEX IF NOT EXISTS idx_payments_created_branch
          ON payments(created_at, branch_id);
      `);
    },
  },
  {
    version: 15,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shifts (
          id TEXT PRIMARY KEY,
          device_id TEXT,
          branch_id TEXT,
          restaurant_id TEXT,
          employee_id TEXT,
          status TEXT,
          opening_cash_cents INTEGER,
          expected_cash_cents INTEGER,
          closing_cash_cents INTEGER,
          variance_cents INTEGER,
          cash_sales_cents INTEGER,
          card_sales_cents INTEGER,
          other_sales_cents INTEGER,
          refunds_cents INTEGER,
          payout_cents INTEGER,
          note TEXT,
          opened_at INTEGER,
          closed_at INTEGER,
          idempotency_key TEXT,
          server_version INTEGER NOT NULL DEFAULT 0,
          local_version INTEGER NOT NULL DEFAULT 1,
          synced INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_device_open
          ON shifts(device_id) WHERE status = 'OPEN';
      `);
    },
  },
  {
    version: 16,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cash_adjustments (
          id TEXT PRIMARY KEY,
          shift_id TEXT,
          employee_id TEXT,
          branch_id TEXT,
          amount_cents INTEGER,
          type TEXT,
          reason TEXT,
          reference TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_cash_adjustments_shift
          ON cash_adjustments(shift_id);
      `);
    },
  },
  {
    version: 17,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kitchen_orders (
          id TEXT PRIMARY KEY,
          order_id TEXT,
          branch_id TEXT,
          station TEXT,
          status TEXT,
          priority TEXT,
          started_at INTEGER,
          ready_at INTEGER,
          completed_at INTEGER,
          served_by TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_orders_order
          ON kitchen_orders(order_id);
        CREATE INDEX IF NOT EXISTS idx_kitchen_orders_branch_status
          ON kitchen_orders(branch_id, status);
      `);
    },
  },
  {
    version: 18,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kitchen_order_items (
          id TEXT PRIMARY KEY,
          kitchen_order_id TEXT,
          order_item_id TEXT,
          menu_item_id TEXT,
          menu_item_name TEXT,
          qty INTEGER,
          special_instructions TEXT,
          status TEXT
        );
      `);
    },
  },
  {
    version: 19,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_items (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          sku TEXT,
          name TEXT,
          unit TEXT,
          supplier_id TEXT,
          current_stock_level REAL,
          min_stock_level REAL,
          unit_cost_cents INTEGER,
          last_counted_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_items_low_stock
          ON inventory_items(branch_id)
          WHERE current_stock_level <= min_stock_level;
      `);
    },
  },
  {
    version: 20,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_transactions (
          id TEXT PRIMARY KEY,
          inventory_item_id TEXT,
          branch_id TEXT,
          reference_id TEXT,
          reference_type TEXT,
          type TEXT,
          qty REAL,
          unit_cost_cents INTEGER,
          reason TEXT,
          performed_by TEXT,
          performed_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_tx_item_performed
          ON inventory_transactions(inventory_item_id, performed_at);
      `);
    },
  },
  {
    version: 21,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY,
          menu_item_id TEXT,
          branch_id TEXT,
          restaurant_id TEXT,
          name TEXT,
          portion_yield INTEGER,
          cost_at_recipe_time_cents INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_menu_item
          ON recipes(menu_item_id);
      `);
    },
  },
  {
    version: 22,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recipe_ingredients (
          id TEXT PRIMARY KEY,
          recipe_id TEXT,
          inventory_item_id TEXT,
          ingredient_name TEXT,
          qty REAL,
          unit TEXT,
          cost_snapshot_cents INTEGER NOT NULL DEFAULT 0
        );
      `);
    },
  },
  {
    version: 23,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT,
          key TEXT,
          value TEXT,
          restaurant_id TEXT,
          branch_id TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_scope_key_rest_branch
          ON settings(scope, key, restaurant_id, branch_id);
      `);
    },
  },
  {
    version: 24,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          op_id TEXT UNIQUE,
          entity_type TEXT,
          operation TEXT,
          entity_id TEXT,
          payload TEXT,
          idempotency_key TEXT,
          local_entity_version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'QUEUED',
          attempts INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          next_attempt_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          claimed_at INTEGER,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status_next
          ON sync_queue(status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_entity
          ON sync_queue(entity_type, entity_id);
      `);
    },
  },
  {
    version: 25,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT,
          idempotency_key TEXT,
          entity_type TEXT,
          operation TEXT,
          entity_id TEXT,
          status TEXT,
          conflict_resolution TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          response_snapshot TEXT,
          applied_at INTEGER,
          last_error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_records_device_idempotency
          ON sync_records(device_id, idempotency_key);
      `);
    },
  },
  {
    version: 26,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          restaurant_id TEXT,
          branch_id TEXT,
          entity_type TEXT,
          entity_id TEXT,
          action TEXT,
          actor_id TEXT,
          actor_role TEXT,
          ip_address TEXT,
          device_id TEXT,
          changes_json TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_audit_logs_branch_created
          ON audit_logs(branch_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
          ON audit_logs(actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
          ON audit_logs(entity_type, entity_id);
      `);
    },
  },
  {
    version: 27,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS connection_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT,
          status TEXT,
          from_status TEXT,
          to_status TEXT,
          reason TEXT,
          ip_address TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE INDEX IF NOT EXISTS idx_connection_events_device_created
          ON connection_events(device_id, created_at);
      `);
    },
  },
  {
    version: 28,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS loyalty_accounts (
          id TEXT PRIMARY KEY,
          restaurant_id TEXT,
          customer_id TEXT,
          points INTEGER NOT NULL DEFAULT 0,
          tier TEXT,
          joined_at INTEGER,
          last_activity_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_restaurant_customer
          ON loyalty_accounts(restaurant_id, customer_id);
      `);
    },
  },
  {
    version: 29,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS promotions (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          name TEXT,
          description TEXT,
          type TEXT,
          discount_id TEXT,
          min_order_cents INTEGER,
          start_at INTEGER,
          end_at INTEGER,
          uses_per_customer INTEGER NOT NULL DEFAULT 1,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now')*1000)
        );
      `);
    },
  },
  {
    version: 30,
    up: (db: Database) => {
      db.exec(`
        ALTER TABLE employees ADD COLUMN first_name TEXT;
        ALTER TABLE employees ADD COLUMN last_name TEXT;
        ALTER TABLE employees ADD COLUMN email TEXT;
        ALTER TABLE employees ADD COLUMN phone TEXT;
      `);
    },
  },
  {
    // Adds `is_active` to menu_items so the sync DELETE op can soft-delete
    // items (match menu_categories / menu_modifiers pattern). Without this
    // column, deleted rows would still appear in offline menu listings.
    version: 31,
    up: (db: Database) => {
      try {
        db.prepare('ALTER TABLE menu_items ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1').run();
      } catch (_e) {
        // Column may already exist on DBs that were bootstrapped after the
        // CREATE TABLE definition was updated — benign.
      }
    },
  },
  {
    // Professional dine-in running-tab system:
    // * table_sessions = the open "tab" for a table visit with totals
    // * table_session_ledger = immutable audit log of every mutation
    //   (ADD_ITEM / VOID / PAYMENT / NOTE / status transitions, etc.)
    // Together these guarantee: every menu item assigned to a table is
    // immediately persisted as a transaction on that table's tab, with
    // full audit trail for management.
    version: 32,
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS table_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          branch_id TEXT,
          restaurant_id TEXT,
          table_id TEXT,
          tab_number TEXT,
          status TEXT,
          covers INTEGER NOT NULL DEFAULT 0,
          opened_by TEXT,
          opened_by_name TEXT,
          server_id TEXT,
          server_name TEXT,
          opened_at INTEGER,
          closed_at INTEGER,
          closed_by TEXT,
          subtotal_cents INTEGER NOT NULL DEFAULT 0,
          discount_cents INTEGER NOT NULL DEFAULT 0,
          tax_cents INTEGER NOT NULL DEFAULT 0,
          tip_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL DEFAULT 0,
          paid_amount_cents INTEGER NOT NULL DEFAULT 0,
          balance_due_cents INTEGER NOT NULL DEFAULT 0,
          customer_count INTEGER NOT NULL DEFAULT 0,
          customer_name TEXT,
          note TEXT,
          current_order_id TEXT,
          server_version INTEGER NOT NULL DEFAULT 0,
          local_version INTEGER NOT NULL DEFAULT 1,
          synced INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ts_table_status
          ON table_sessions(table_id, status);
        CREATE INDEX IF NOT EXISTS idx_ts_branch_status
          ON table_sessions(branch_id, status);
        CREATE INDEX IF NOT EXISTS idx_ts_opened
          ON table_sessions(opened_at DESC);

        CREATE TABLE IF NOT EXISTS table_session_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          branch_id TEXT,
          restaurant_id TEXT,
          entry_type TEXT NOT NULL,
          reference_id TEXT,
          actor_id TEXT,
          actor_name TEXT,
          label TEXT,
          quantity INTEGER NOT NULL DEFAULT 0,
          amount_delta_cents INTEGER NOT NULL DEFAULT 0,
          amount_after_cents INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tsl_session_created
          ON table_session_ledger(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tsl_actor
          ON table_session_ledger(actor_id, created_at DESC);
      `);
    },
  },
  {
    // v33: Add counter-payment columns to the `orders` table so the new
    // "Mark as Paid" POS flow (for QR Pay-at-Counter and Website online
    // orders) can persist payment method, cumulative paid amount, and
    // remaining balance without recomputing from the payments table each
    // render. ALTER TABLE ADD COLUMN is safe for existing rows — defaults
    // of NULL / 0 are used so historical orders remain readable.
    version: 33,
    up: (db: Database) => {
      const existingCols = new Set(
        db
          .prepare("PRAGMA table_info(orders)")
          .all()
          .map((r: any) => String(r.name || ''))
      );
      const addIfMissing = (col: string, def: string) => {
        if (!existingCols.has(col)) {
          db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
        }
      };
      addIfMissing('payment_method', 'TEXT');
      addIfMissing('paid_amount_cents', 'INTEGER NOT NULL DEFAULT 0');
      addIfMissing('balance_due_cents', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    // v34: Add customer phone + email columns to the `orders` table. Needed so
    // POS attendants can quickly call/email customers who placed website or
    // QR table orders (e.g. to confirm a takeout order, notify them their
    // food is ready, or request payment confirmation for Pay-at-Counter).
    version: 34,
    up: (db: Database) => {
      const existingCols = new Set(
        db
          .prepare("PRAGMA table_info(orders)")
          .all()
          .map((r: any) => String(r.name || ''))
      );
      const addIfMissing = (col: string, def: string) => {
        if (!existingCols.has(col)) {
          db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
        }
      };
      addIfMissing('customer_phone', 'TEXT');
      addIfMissing('customer_email', 'TEXT');
    },
  },
  {
    version: 35,
    up: (db: Database) => {
      const existingCols = new Set(
        db
          .prepare("PRAGMA table_info(tables)")
          .all()
          .map((r: any) => String(r.name || ''))
      );
      if (!existingCols.has('permanent_qr_id')) {
        db.exec('ALTER TABLE tables ADD COLUMN permanent_qr_id TEXT');
      }
    },
  },
];
