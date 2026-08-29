# Development Phases

We build incrementally. Each phase must pass: (1) typecheck, (2) lint,
(3) its own integration tests, (4) manual QA checklist BEFORE we start
the next phase. Phases are designed so a restaurant owner could
hypothetically deploy at the end of any phase (with reduced scope).

---

## Phase 0 — FOUNDATION (current) ✅ in progress

**Deliverables**
- Monorepo structure (apps/, packages/, server/, docs/), Turborepo, root TS base.
- `@prolific/shared-types`: ALL enums + interfaces (done).
- `@prolific/ui`, `@prolific/validation`, `@prolific/database`, `@prolific/utils` — package skeletons + package.json wiring.
- Architecture documents 01–09 (done).
- Phase definition doc (this file).
- App-level package.jsons for `apps/pos`, `customer-display`, `website`, `admin`, `kitchen-display`, `server` — with correct dep pins.

**Out of scope** (we do NOT build UIs, Electron main, or DB logic yet).

---

## Phase 1 — SERVER CORE (NestJS + MongoDB + Auth + RBAC + Menu + Orders CRUD)

**Goal:** Deployable backend API that a Postman collection can exercise end-
to-end: super admin logs in → creates restaurant/branch → onboards
manager/cashier → builds a menu (category + items + taxes) → cashier
creates an order → records a cash payment → sees order history.

**Deliverables**

Server modules (`server/src/…`):
1. `main.ts` — Nest entry, global pipes, helmet, CORS, graceful shutdown.
2. `config/` — ConfigModule env validation (JWT_SECRET, MONGO_URI, etc.).
3. `auth/` — JWT access + refresh token rotation, refreshTokens collection,
   login/refresh/logout, pin verification, Passport strategies.
4. `rbac/` — PermissionsGuard + RolesBuilder + seed the 8 roles with
   permission arrays per §03-mongodb-schema.md roles.
5. `users/`, `employees/`, `restaurants/`, `branches/`, `devices/`,
   `settings/` — CRUD services + controllers + Mongoose schemas.
6. `audit/` — AuditLogsModule; a decorator `@Audit(Action)` that appends
   the row around controller handlers via interceptor.
7. `menu/` — categories, items, modifiers, recipes, taxes, discounts CRUD
   + status change endpoint (for POS OOS) + search filter.
8. `tables/`, `qr-codes/`, `customers/`, `table-sessions/` (basic OPEN
   and CLOSE; no splits yet; for initial dine-in).
9. `orders/`, `payments/` — create order (with server-side recompute of
   totals), status transitions per state machine (09-state-machines),
   record CASH/CARD_POS/BANK_TRANSFER payments with idempotency.
10. `sync/` — minimal `/sync/batch` upload endpoint for one entity type
    (`ORDER`): processes payload, upserts, returns per-item result, writes
    `syncRecords` with unique idempotency-key index. Pull endpoint skeleton.
11. `reports/` — sales dashboard endpoint (basic).
12. Socket.IO gateway v1: JWT guard, room join on connect, broadcasts on
    every order/payment/status mutation. Emits for: `order:new`,
    `order:status:changed`, `order:payment:received`,
    `menu:item:status:changed`, `device:connected`, `sync:*`.

`packages/database/src/mongodb/`:
- Mongoose schemas for all entities listed above (indexes per §03).
- Seed script: `npm run seed` → inserts one SUPER_ADMIN user, one
  restaurant, one branch, one CASHIER employee, sample menu of 20 items
  across 4 categories, 8 tables with QR codes, default taxes.

Testing:
- `POST /auth/login` → returns valid JWT.
- Flow test: cashiers creates 5 orders, pays cash, list works.
- Idempotency test: replay a `POST /orders` with same `X-Idempotency-Key`
  → returns the same orderId, does NOT create duplicate.
- RBAC test: a `KITCHEN` role user calls `DELETE /menu/items/:id` → 403.

**Phase 1 exit criteria:** Postman smoke test run passes. Dev DB seed
script works from clean `MONGO_URI`.

---

## Phase 2 — ADMIN DASHBOARD (Next.js)

**Goal:** Manager/admin can log in, manage menu, view orders, view
reports, manage employees, approve devices.

Deliverables (`apps/admin/`):
1. Next.js App Router, Tailwind theme (brand palette: deep indigo +
   warm orange accent, data-dense professional).
2. Auth pages: `/login`, protected by `withRole` middleware.
3. Layout: sidebar + topbar with role badge, logout, notification bell
   (Socket.IO connection status + pending approvals).
4. Pages:
   - `/dashboard` — cards for Today's Sales, Orders Today, AOV, Best
     Sellers (simple bar chart via recharts).
   - `/menu/categories`, `/menu/items`, `/menu/modifiers`, `/taxes`,
     `/discounts` — full CRUD with form validations.
   - `/tables`, `/qr-codes` — list + create + "download PDF" for QR pack.
   - `/orders` — filters, click to order detail, cancel/void with PIN
     approval modal.
   - `/employees`, `/roles` — employee onboarding, role assign, reset PIN.
   - `/reports/sales`, `/reports/payments`, `/reports/inventory/low-stock`.
   - `/settings/branch` — receipt header/footer, tips config, auto-print.

All mutations go through REST. No optimistic writes — UI shows spinner
until 200, then refresh. Admin UI is the canonical reference data UI —
POS relies on it being correct.

---

## Phase 3 — WEBSITE + QR ORDERING (Next.js)

**Goal:** Customer phone path works end-to-end (online payment provider
test mode + pay-at-pos option).

Deliverables (`apps/website/`):
1. Home page with restaurant branding, hero, "Order Online" CTA.
2. Menu browse page (public): categories nav, search, modifiers.
3. QR landing page `/t/[token]` (per §08-qr-ordering): resolve table →
   welcome → join/start session → menu → cart → submit order → pay
   online via Paystack/Flutterwave OR "Pay at Counter".
4. Cart page, checkout page, order status page (live via Socket.IO
   subscription to `table:<id>`).
5. Customer account (optional, Phase 3b): order history.
6. Payment provider integration: server-side initialize + verify +
   webhook handlers for Paystack. Flutterwave as second provider,
   switched via config. Both go through `PaymentProvider` interface.

Test: scan a seeded QR (URL `/t/ABC123`) on a mobile device → start
session → add 2 items → pay with Paystack test card → order appears
in Admin → `orders.status=ACCEPTED`.

---

## Phase 4 — POS DESKTOP (Electron + React + SQLite + Sync v1)

**Goal:** Electron desktop app starts up, detects displays, shows login,
cashier creates orders offline + records cash payments, all sync back
when online. No refunds/voids/kitchen offline yet.

Deliverables (`apps/pos/electron/` + renderer + `packages/database/sqlite`):
1. Electron main process with secure settings (contextIsolation, sandbox).
2. `preload.ts` with IPC whitelist per §07.
3. `window-manager.ts` → opens 2 windows on 2 displays or 1 + floating.
4. SQLite init + migrations (tables: employees, menu_categories,
   menu_items, menu_modifiers, taxes, discounts, tables, qr_codes,
   customers, orders, order_items, payments, shifts, cash_adjustments,
   inventory_items, recipes, settings, sync_queue, sync_records,
   connection_events, audit_logs, inventory_transactions,
   kitchen_orders, meta).
5. SyncEngine v1:
   - QueueReader (FIFO, 25 items batch), 5 retries, backoff.
   - `/sync/batch` upload for ORDERS + PAYMENTS + SHIFTS only.
   - Idempotency key applied client side.
   - Status emitter → IPC → connection status pill (4 states).
6. PrintManager v1: ESC/POS for single USB printer, print test page
   + receipt on payment + print queue durability.

Renderer (`apps/pos/src/`):
1. Login page (email + pw → server auth; OR offline PIN login against
   cached SQLite employees if last-seen server auth was valid ≤ 7d).
2. `/pos` layout:
   - Header: logo, shift status, sync pill, device clock, cashier name.
   - Left: categories nav + search.
   - Center: menu items grid (touch tiles ≥ 56 px, price, image, status
     badge OOS).
   - Right: cart panel.
   - Footer: numeric tender buttons for cash.
3. Cart operations: add/remove item, qty +/-, modifiers modal,
   discount (with PIN gate if large), customer selection (search),
   table selection (floor plan or list), order type (DINE-IN/TAKEAWAY).
4. Payments: tender CASH or CARD_POS → print receipt → thank-you on
   customer display.
5. Order history tab: recent orders list (paginated SQLite).
6. Shift open/close: opening cash entry, close report with variance.

Customer display renderer (`apps/customer-display/`, embedded in window
#2):
1. Idle screen: restaurant branding + rotating promo images + clock.
2. Active order: items, qty, prices, subtotal, tax, total, payment
   status bar.
3. Paid screen: thank you + receipt number + next-order CTA.

**Phase 4 exit criteria:** Pull Ethernet cable. Create 5 orders on POS
→ pay cash → all persisted (restart the POS, reopen, data still
there). Re-attach Ethernet → all 5 orders appear in Admin dashboard
within 60 s, no duplicates. Customer display correctly tracks cart →
active → paid → idle.

---

## Phase 5 — KITCHEN DISPLAY + HOLD/RETRIEVE + REFUNDS/VOIDS

**Goal:** Kitchen orders flow; manager can void/refund with PIN;
hold/retrieve orders on POS.

Deliverables (`apps/kitchen-display/`):
1. Large-button Next.js UI: columns NEW | PREPARING | READY | COMPLETED.
2. Each kitchen order card: order number, table, time-ago, items list,
   special instructions.
3. Buttons: [Start] [Ready] [Done]. Color/time severity.
4. Socket.IO subscription to `kitchen:branch:X:station`.
5. Runs offline? Phase 5a: needs internet (connects to server). Phase
   5b (bonus): direct LAN P2P WS connection to the POS Electron main
   running a local socket server fallback.

POS extensions:
1. Hold / retrieve orders (tab with held orders).
2. Void order with manager PIN approval flow.
3. Refund order (full or per-item) with manager PIN + reason.
4. Manager approval modal for void/refund/large discount → call
   `/auth/pin/verify` → attach signed approval token.

Server:
- Dedicated approval-request Socket.IO flow: cashier requests, all
  on-duty MANAGERs receive `approval:requested`, one responds, result
  broadcast back to requesting POS.

---

## Phase 6 — INVENTORY, SYNC v2, REPORTS FINAL

Goal: recipe-based stock deduction works; inventory reports, purchases,
wastage, low-stock alerts. Sync engine supports all bidirectional
entities with conflict UI.

Deliverables:
1. Server modules: `inventory/` (items, transactions, suppliers, POs).
2. Recipes module fully hooks into `order.status=COMPLETED` → deduct
   stock (server side). POS mirrors this locally so stock drops even
   offline.
3. Sync engine v2: PullWorker per cursors, conflict detection for all
   bidirectional entities, conflict-UI on Admin + POS.
4. Reports pages fleshed out:
   - `/reports/inventory/usage`, `/reports/inventory/wastage`.
   - `/reports/shifts/performance`.
   - `/reports/customers/top`.
5. Low-stock in-app banner + daily digest email (optional SMTP hook).

---

## Phase 7 — PAYMENT PROVIDER v2, LOYALTY, PROMOTIONS, AUDIT BROWSER

Goal: flutterwave provider parity, loyalty tiers, customer-facing
promotions, audit log browser, export to accounting (CSV/Quickbooks).

Phase 7 is the "polish & extra features" phase. All core systems are
already production-quality by end of Phase 6.

---

## Success Criteria per phase (general)

- [ ] `npm run build` at the root succeeds (all packages + apps that are
      in scope for this phase).
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run lint` passes.
- [ ] Manual QA checklist for the phase completed and documented in
      `docs/phase-N-qa.md`.
- [ ] Seed script for backend produces a demo environment usable by the
      next phase's UI developer.
- [ ] Architectural decisions affecting later phases are appended to the
      relevant `docs/*.md` BEFORE merging.

---

## THIS SESSION: What we do today

After finishing Phase 0 (docs + skeletons), we begin **Phase 1**
implementation in order:

1. Scaffold NestJS server: main.ts, app.module, config, env.
2. Mongoose connection + MongoDB schemas for users, employees,
   restaurants, branches, roles, audit logs.
3. Auth: login/refresh/logout, JWT strategies, refresh tokens.
4. RBAC guards + role seeding.
5. Menu CRUD + tables + customers + basic sessions.
6. Orders + payments CRUD with state transitions + idempotency.
7. Sync batch upload for orders.
8. Socket.IO gateway v1 + basic broadcasts.

We stop here for this session. Everything after this (Electron POS,
admin UI, website, kitchen, advanced sync, inventory) is Phase 2+.
