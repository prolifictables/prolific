# SQLite Schema — POS Offline Database

The local SQLite database lives **inside the Electron main process** and is
**not directly accessible by the React renderer**. The renderer communicates
via a strict whitelist of IPC channels (see 07-electron).

All `TEXT PRIMARY KEY` columns use our nanoid string IDs — the same values
that will eventually live in MongoDB. This lets us sync without re-keying.

## Database file location

| OS       | Path                                                                 |
|----------|----------------------------------------------------------------------|
| macOS    | `~/Library/Application Support/Prolific POS/prolific-pos-<branchId>.db` |
| Windows  | `%APPDATA%/Prolific POS/prolific-pos-<branchId>.db`                  |
| Linux    | `$XDG_CONFIG_HOME/Prolific POS/prolific-pos-<branchId>.db`           |

Using a per-branch filename ensures that if a single POS device is ever
re-provisioned for a different branch, the databases don't collide. The
file is opened with `better-sqlite3` using WAL + a busy timeout.

All schema creation and migration is performed inside
`packages/database/src/sqlite/migrations.ts` with a `PRAGMA user_version`
migration chain.

---

## Pragmas

```sql
PRAGMA journal_mode  = WAL;
PRAGMA busy_timeout  = 5000;
PRAGMA foreign_keys  = ON;
PRAGMA user_version  = 1;
```

---

## SQLite vs MongoDB — what lives where?

| Data domain          | SQLite stores…        |  Why  |
|----------------------|------------------------|-------|
| Menu                 | Full copy (CATS, ITEMS, MODIFIERS, TAXES, DISCOUNTS) | Needed for offline ordering |
| Employees            | Only this branch's     | PIN verification offline |
| Tables / QR          | Only this branch's     | QR sessions offline |
| Customers            | Only customers touched by this POS | Searchable locally |
| Orders / Items       | Orders created on this POS + orders received from web (if synced) |  |
| Payments             | Payments recorded on this POS |  |
| Shifts               | Only shifts opened on this POS device | One open shift per device |
| Cash adjustments     | Belonging to this shift |  |
| Kitchen orders       | For this branch, recent N days | Offline kitchen flow |
| Inventory items      | Full branch copy | Recipe deduction offline |
| Inventory txns       | Those triggered locally (sales, manual adjustments) |  |
| Settings             | Per-branch copy | Receipt formatting, PIN gates |
| SYNC_QUEUE           | All pending + failed sync operations |  |
| SYNC_RECORDS         | Processed items (log) | Idempotency lookup |

---

## Tables

### 1. `meta` — single-row configuration for this local DB instance

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES
  ('schema_version', '1'),
  ('device_id',      NULL),    -- populated after first auth
  ('branch_id',      NULL),
  ('restaurant_id',  NULL),
  ('last_sync_at',   NULL),    -- ISO datetime string
  ('last_sync_cursor', NULL);  -- highest cloud createdAt synced
```

### 2. `employees` — cached subset (only id, name, role, pin hash)

```sql
CREATE TABLE employees (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
    'SUPER_ADMIN','ADMIN','MANAGER','SUPERVISOR',
    'CASHIER','KITCHEN','WAITER','ACCOUNTANT')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  full_name     TEXT NOT NULL,           -- redundant for search
  pin_hash      TEXT,                     -- bcrypt of PIN
  employee_number TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  cloud_version INTEGER,                  -- last synced cloud doc version
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_employees_branch_role ON employees(branch_id, role);
CREATE INDEX idx_employees_name       ON employees(full_name);
```

### 3. `menu_categories`

```sql
CREATE TABLE menu_categories (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  image_url     TEXT,
  cloud_version INTEGER,
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_menu_categories_branch ON menu_categories(branch_id, is_active, sort_order);
```

### 4. `menu_modifiers` — options stored as JSON blob

```sql
CREATE TABLE menu_modifiers (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  required      INTEGER NOT NULL DEFAULT 0,
  multi_select  INTEGER NOT NULL DEFAULT 0,
  min_selections INTEGER NOT NULL DEFAULT 0,
  max_selections INTEGER NOT NULL DEFAULT 1,
  options_json  TEXT NOT NULL,  -- JSON: [{id,name,priceDelta,isDefault}]
  cloud_version INTEGER,
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
```

### 5. `menu_items`

```sql
CREATE TABLE menu_items (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  category_id   TEXT NOT NULL REFERENCES menu_categories(id),
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL,
  image_url     TEXT,
  status        TEXT NOT NULL CHECK (status IN
               ('AVAILABLE','OUT_OF_STOCK','DISABLED','SCHEDULED'))
               DEFAULT 'AVAILABLE',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_taxable    INTEGER NOT NULL DEFAULT 1,
  tax_ids_json  TEXT NOT NULL DEFAULT '[]',   -- JSON [taxId,...]
  modifier_ids_json TEXT NOT NULL DEFAULT '[]',  -- JSON [modId,...]
  recipe_id     TEXT,
  sched_avail_json TEXT, -- {daysOfWeek:[], startTime, endTime} or NULL
  cloud_version INTEGER,
  last_modified_at TEXT NOT NULL,
  last_modified_by TEXT,
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_menu_items_branch_cat ON menu_items(branch_id, category_id, status, sort_order);
CREATE INDEX idx_menu_items_search     ON menu_items(branch_id, name);  -- FTS5 below
```

For substring search the POS also maintains a FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE menu_items_fts USING fts5(
  name, description, content='menu_items', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

Triggers keep it in sync. This is the secret sauce for a fast cashier —
typing "jol" instantly highlights Jollof Rice variants.

### 6. `taxes`

```sql
CREATE TABLE taxes (
  id                    TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  name                  TEXT NOT NULL,
  rate_pct              REAL NOT NULL,
  is_included_in_price  INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  cloud_version         INTEGER,
  updated_at, created_at TEXT NOT NULL
);
```

### 7. `discounts`

```sql
CREATE TABLE discounts (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PERCENTAGE','FIXED')),
  value_cents_or_pct INTEGER NOT NULL,   -- cents if FIXED, bps if %
  max_amount_cents INTEGER,
  min_order_amount_cents INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  requires_manager_approval INTEGER NOT NULL DEFAULT 0,
  approval_threshold_cents INTEGER,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
```

### 8. `tables`

```sql
CREATE TABLE tables (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  floor TEXT,
  zone  TEXT,
  position_json TEXT, -- {x,y}
  is_active INTEGER NOT NULL DEFAULT 1,
  qr_code_id TEXT NOT NULL,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
CREATE INDEX idx_tables_branch_zone ON tables(branch_id, zone, is_active);
```

### 9. `qr_codes`

```sql
CREATE TABLE qr_codes (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES tables(id),
  token TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  printed_at TEXT,
  last_scanned_at TEXT,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
```

### 10. `table_sessions`

```sql
CREATE TABLE table_sessions (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES tables(id),
  qr_code_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('OPEN','AWAITING_PAYMENT','PARTIALLY_PAID','PAID','CLOSED')),
  opened_at TEXT NOT NULL,
  opened_by TEXT,                       -- employee id
  customer_ids_json TEXT NOT NULL DEFAULT '[]',
  total_amount_cents INTEGER NOT NULL DEFAULT 0,
  paid_amount_cents  INTEGER NOT NULL DEFAULT 0,
  balance_due_cents  INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closed_by TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'LOCAL_ONLY',  -- see sync
  cloud_version INTEGER,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_branch_status ON table_sessions(branch_id, status, opened_at DESC);
CREATE INDEX idx_sessions_table        ON table_sessions(table_id, status);
```

### 11. `customers`

```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  first_name TEXT,
  last_name  TEXT,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  notes      TEXT,
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,
  cloud_version INTEGER,
  sync_dirty INTEGER NOT NULL DEFAULT 1,   -- 1 = needs upload
  updated_at, created_at TEXT NOT NULL
);
CREATE INDEX idx_customers_phone ON customers(restaurant_id, phone);
```

### 12. `orders`

```sql
CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  order_number  TEXT NOT NULL,
  order_type    TEXT NOT NULL CHECK (order_type IN
    ('DINE_IN','TAKEAWAY','PICKUP','DELIVERY','QR_ORDER','ONLINE')),
  status        TEXT NOT NULL CHECK (status IN (
    'PENDING','AWAITING_PAYMENT','RECEIVED','ACCEPTED','PREPARING',
    'READY','SERVED','COMPLETED','CANCELLED','REFUNDED','VOIDED','ON_HOLD')),
  customer_id   TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  table_id      TEXT,
  table_session_id TEXT,
  table_name    TEXT,
  employee_id   TEXT,
  device_id     TEXT,
  source_channel TEXT NOT NULL DEFAULT 'POS' CHECK (source_channel IN
    ('POS','QR','WEBSITE','APP','PHONE')),
  subtotal_cents   INTEGER NOT NULL,
  discount_cents   INTEGER NOT NULL DEFAULT 0,
  discount_id      TEXT,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL,
  paid_cents       INTEGER NOT NULL DEFAULT 0,
  balance_due_cents INTEGER NOT NULL,
  tip_cents        INTEGER,
  notes            TEXT,
  payment_status   TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN (
    'UNPAID','PENDING','PARTIALLY_PAID','PAID','FAILED',
    'REFUNDED','PARTIALLY_REFUNDED')),
  estimated_ready_at TEXT,
  accepted_at TEXT, started_preparing_at TEXT,
  ready_at TEXT, served_at TEXT, completed_at TEXT,
  cancelled_at TEXT, cancelled_by TEXT, cancel_reason TEXT,
  refunded_amount_cents TEXT,
  voided_at TEXT, voided_by TEXT, void_reason TEXT,
  held_at TEXT, on_hold_reason TEXT,
  -- Idempotency & sync
  idempotency_key TEXT NOT NULL UNIQUE,
  originating_device_id TEXT,
  local_version INTEGER NOT NULL DEFAULT 1,
  cloud_version INTEGER,                 -- NULL until first upload
  sync_status   TEXT NOT NULL DEFAULT 'LOCAL_ONLY'
            CHECK (sync_status IN (
              'LOCAL_ONLY','QUEUED','UPLOADING','SYNCED','CONFLICT','ERROR')),
  last_sync_attempt TEXT,
  last_sync_error   TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_orders_branch_recent ON orders(branch_id, created_at DESC);
CREATE INDEX idx_orders_branch_status ON orders(branch_id, status, created_at DESC);
CREATE INDEX idx_orders_session        ON orders(table_session_id);
CREATE INDEX idx_orders_needs_sync     ON orders(branch_id, sync_status)
              WHERE sync_status IN ('LOCAL_ONLY','QUEUED','ERROR','CONFLICT');
```

### 13. `order_items`

```sql
CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL,
  name        TEXT NOT NULL,          -- snapshot
  description TEXT,
  unit_price_cents INTEGER NOT NULL,
  quantity    INTEGER NOT NULL,
  modifiers_json TEXT NOT NULL DEFAULT '[]',
        -- [{modifierId,name,optionIds,optionNames,totalPriceDelta}]
  special_instructions TEXT,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL,
  discount_id    TEXT,
  kitchen_status TEXT NOT NULL DEFAULT 'NEW' CHECK (kitchen_status IN
    ('NEW','PREPARING','READY','COMPLETED','CANCELLED')),
  prepared_at TEXT, served_at TEXT,
  refunded INTEGER NOT NULL DEFAULT 0,
  refunded_amount_cents INTEGER,
  refund_reason TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_kitchen_status ON order_items(kitchen_status, created_at);
```

### 14. `payments`

```sql
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT,
  employee_id TEXT,
  device_id   TEXT,
  amount_cents INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  method      TEXT NOT NULL CHECK (method IN (
    'CASH','CARD_POS','BANK_TRANSFER','PAYSTACK',
    'FLUTTERWAVE','WALLET','LOYALTY_POINTS','VOUCHER')),
  status      TEXT NOT NULL CHECK (status IN (
    'UNPAID','PENDING','PARTIALLY_PAID','PAID','FAILED',
    'REFUNDED','PARTIALLY_REFUNDED')),
  verification_type TEXT NOT NULL DEFAULT 'LOCAL'
              CHECK (verification_type IN ('LOCAL','PROVIDER','SPLIT')),
  provider_transaction_id TEXT,
  provider_reference TEXT,
  terminal_id TEXT,
  receipt_number TEXT,
  authorization_code TEXT,
  last4_digits TEXT,
  card_brand TEXT,
  notes TEXT,
  processed_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  refunded_amount_cents INTEGER,
  refunded_at TEXT,
  refund_reference TEXT,
  -- sync + idempotency
  idempotency_key TEXT NOT NULL UNIQUE,
  originating_device_id TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  cloud_version INTEGER,
  last_sync_error TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_order ON payments(order_id, created_at);
CREATE INDEX idx_payments_method_date ON payments(branch_id, method, processed_at DESC);
```

### 15. `kitchen_orders`

```sql
CREATE TABLE kitchen_orders (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  order_item_ids_json TEXT NOT NULL,
  station_id TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('NEW','PREPARING','READY','COMPLETED','CANCELLED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN
    ('NORMAL','URGENT','LATE')),
  notes TEXT,
  assigned_cook_id TEXT,
  started_at TEXT, ready_at TEXT, completed_at TEXT,
  cloud_version INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  updated_at, created_at TEXT NOT NULL
);
CREATE INDEX idx_kitchen_branch_status ON kitchen_orders(branch_id, status, created_at);
```

### 16. `shifts`

```sql
CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED','MISMATCH')),
  opening_cash_cents INTEGER NOT NULL,
  expected_cash_cents INTEGER NOT NULL DEFAULT 0,
  actual_cash_cents   INTEGER NOT NULL DEFAULT 0,
  cash_variance_cents INTEGER NOT NULL DEFAULT 0,
  card_sales_cents    INTEGER NOT NULL DEFAULT 0,
  transfer_sales_cents INTEGER NOT NULL DEFAULT 0,
  online_sales_cents   INTEGER NOT NULL DEFAULT 0,
  total_sales_cents    INTEGER NOT NULL DEFAULT 0,
  total_refunds_cents  INTEGER NOT NULL DEFAULT 0,
  total_voids_cents    INTEGER NOT NULL DEFAULT 0,
  total_discounts_cents INTEGER NOT NULL DEFAULT 0,
  total_tips_cents     INTEGER NOT NULL DEFAULT 0,
  cash_paid_in_cents   INTEGER NOT NULL DEFAULT 0,
  cash_paid_out_cents  INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  closing_notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  cloud_version INTEGER,
  last_sync_error TEXT,
  updated_at, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_shifts_one_open_per_device
  ON shifts(device_id) WHERE status = 'OPEN';
CREATE INDEX idx_shifts_employee_recent ON shifts(branch_id, employee_id, opened_at DESC);
```

### 17. `cash_adjustments`

```sql
CREATE TABLE cash_adjustments (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  branch_id, restaurant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PAID_IN','PAID_OUT')),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  approved_by TEXT,
  sync_status TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cash_adj_shift ON cash_adjustments(shift_id, created_at);
```

### 18. `inventory_items`

```sql
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit TEXT NOT NULL,
  current_stock REAL NOT NULL,
  minimum_stock REAL NOT NULL,
  optimal_stock REAL,
  cost_price_cents INTEGER NOT NULL,
  supplier_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_restocked_at TEXT,
  last_counted_at TEXT,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
CREATE INDEX idx_inv_branch_name ON inventory_items(branch_id, name);
```

### 19. `recipes`

```sql
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  servings INTEGER NOT NULL,
  ingredients_json TEXT NOT NULL,
      -- [{inventoryItemId,inventoryItemName,quantity,unit,costAtRecipeTime}]
  instructions TEXT,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
```

### 20. `inventory_transactions` — append only

```sql
CREATE TABLE inventory_transactions (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'PURCHASE','WASTAGE','ADJUSTMENT','PRODUCTION',
    'SALE_DEDUCTION','TRANSFER_IN','TRANSFER_OUT')),
  quantity REAL NOT NULL,
  unit_cost_cents INTEGER,
  total_cost_cents INTEGER,
  reference_id TEXT,
  reference_type TEXT CHECK (reference_type IN
    ('ORDER','PURCHASE','WASTAGE','ADJUSTMENT')),
  notes TEXT,
  employee_id TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  cloud_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_inv_tx_item ON inventory_transactions(inventory_item_id, created_at DESC);
CREATE INDEX idx_inv_tx_ref  ON inventory_transactions(reference_id, reference_type);
```

### 21. `audit_logs` — append only

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  performed_by_role TEXT NOT NULL,
  device_id TEXT,
  timestamp TEXT NOT NULL,
  ip_address TEXT,
  changes_json TEXT,
  metadata_json TEXT,
  sync_status TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  cloud_version INTEGER
);
CREATE INDEX idx_audit_branch_time ON audit_logs(branch_id, timestamp DESC);
```

### 22. `settings`

```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  restaurant_id, branch_id TEXT NOT NULL UNIQUE,
  receipt_header TEXT,
  receipt_footer TEXT,
  logo_url_for_receipt TEXT,
  enable_tips INTEGER NOT NULL DEFAULT 1,
  tip_options_json TEXT NOT NULL DEFAULT '[5,10,15]',
  default_tax_rate_id TEXT,
  default_service_charge_cents INTEGER NOT NULL DEFAULT 0,
  auto_print_kitchen_tickets INTEGER NOT NULL DEFAULT 1,
  auto_print_receipts INTEGER NOT NULL DEFAULT 0,
  require_customer_name INTEGER NOT NULL DEFAULT 0,
  require_manager_pin_for_json TEXT NOT NULL DEFAULT '[]',
  low_stock_alert_threshold_days INTEGER NOT NULL DEFAULT 3,
  cloud_version INTEGER,
  updated_at, created_at TEXT NOT NULL
);
```

---

## SYNC INFRASTRUCTURE TABLES (SQLite only)

### 23. `sync_queue` — durable work queue (the heart of offline sync)

```sql
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,                      -- nanoid
  entity_type TEXT NOT NULL,                -- enum SyncEntityType
  entity_id   TEXT NOT NULL,                -- local row id
  payload_json TEXT NOT NULL,               -- full snapshot for upload
  direction   TEXT NOT NULL                 -- 'LOCAL_TO_CLOUD' | 'CLOUD_TO_LOCAL'
            CHECK (direction IN ('LOCAL_TO_CLOUD','CLOUD_TO_LOCAL')),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL                      -- see SyncRecordStatus
       DEFAULT 'PENDING'
       CHECK (status IN
         ('PENDING','IN_PROGRESS','COMPLETED','FAILED','CONFLICT','SKIPPED')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,                       -- NULL = immediate
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_sync_queue_next ON sync_queue(status, next_retry_at, created_at)
    WHERE status IN ('PENDING','FAILED','CONFLICT');
CREATE UNIQUE INDEX idx_sync_queue_dedup
    ON sync_queue(entity_type, entity_id, direction, status)
    WHERE status <> 'COMPLETED';
```

Rules for the queue:
- Only one in-flight entry per `(entity, direction)` at a time (the
  partial unique index handles this — new `PENDING` inserts for the
  same entity UPDATE the existing pending row's payload instead).
- `next_retry_at` uses exponential backoff: `now + 2^(attempts) * 5s`,
  capped at 10 min.
- `status='CONFLICT'` rows are hidden from the worker and shown to the
  manager UI for manual resolution.

### 24. `connection_events` — small ring buffer for diagnostics

```sql
CREATE TABLE connection_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL,
  status     TEXT NOT NULL, -- ONLINE | OFFLINE | SYNCHRONIZING | SYNC_ERROR
  message    TEXT,
  pending_count INTEGER
);
-- Keep only last 1000 rows via trigger
```

---

## Migration strategy

Each schema bump ships a `migrate_vX_to_vY(db)` function inside
`packages/database/src/sqlite/migrations.ts`. The migration runner:

1. Begins an exclusive transaction.
2. Reads `PRAGMA user_version`.
3. Applies each sequential migration script.
4. Updates `PRAGMA user_version`.
5. Commits.

If any step fails, the entire migration rolls back and the POS shows a
fatal error dialog instead of running against a half-migrated DB.
