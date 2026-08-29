# Prolific POS — System Architecture

## 1. OVERVIEW

Prolific POS is a multi-tenant, multi-branch, offline-first Restaurant POS and Online
Ordering Platform. The design goals, in order of priority, are:

1. **Reliability** — The POS MUST function 100% offline. No lost orders, no data
   corruption on reconnection.
2. **Data Integrity** — Double-entry safety between SQLite (local) and MongoDB
   (cloud) via strong idempotency keys and a sync-queue log.
3. **Security** — Locked-down Electron, JWT + refresh tokens, RBAC with
   manager-PIN gates for sensitive actions, full audit logs.
4. **Real-time** — Socket.IO rooms per branch/table so that every device in a
   venue converges within ~1s on order state.
5. **Scalability** — All primary keys are globally unique. Multi-tenant queries
   always include `restaurantId` + `branchId` as the leading index columns.
6. **UX** — Premium, professional UI tailored to each surface (POS, admin,
   kitchen, customer website, customer display).

---

## 2. HIGH-LEVEL ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────────────┐
│                           CLOUD (AWS / DO)                           │
│                                                                      │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐  │
│   │   MongoDB    │◄────►│  NESTJS API  │◄────►│  SOCKET.IO GW    │  │
│   │    Atlas     │      │  (REST + RPC)│      │  (rooms + events)│  │
│   └──────────────┘      └──────┬───────┘      └────────┬─────────┘  │
│                                │                        │            │
│                                ├────────────────────────┘            │
│                                │                                     │
│                 ┌──────────────▼───────────────┐                     │
│                 │   Payment Provider Adapters  │                     │
│                 │  (Paystack │ Flutterwave)    │                     │
│                 └──────────────────────────────┘                     │
│                                                                      │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │  HTTPS / WSS (TLS)
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
    ┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
    │  Website    │             │   Admin     │             │  Kitchen    │
    │  (Next.js)  │             │  (Next.js)  │             │  (Next.js)  │
    │  port 3001  │             │  port 3002  │             │  port 3003  │
    └─────────────┘             └─────────────┘             └─────────────┘

==== RESTAURANT (LOCAL NETWORK, MAY BE OFFLINE) ==========================

  ┌──────────────────────────── Electron App ────────────────────────────┐
  │  @prolific/pos + @prolific/customer-display                          │
  │                                                                      │
  │   ┌────────────────────┐     IPC      ┌────────────────────┐        │
  │   │  CASHIER WINDOW    │◄────────────►│  CUSTOMER DISPLAY  │        │
  │   │  (primary display) │              │  (2nd display)     │        │
  │   │  React + Zustand   │              │  React + Zustand   │        │
  │   └─────────┬──────────┘              └────────────────────┘        │
  │             │                                                         │
  │      ┌──────▼──────┐          ┌──────────────┐                      │
  │      │   ZUSTAND   │          │  PRINT       │                      │
  │      │   STORES    │          │  (ESC/POS)   │                      │
  │      └──────┬──────┘          └──────────────┘                      │
  │             │                                                         │
  │   ┌─────────▼─────────────────────────────────────────────────┐     │
  │   │              Electron MAIN / Preload                        │     │
  │   │  contextIsolation=true, nodeIntegration=false, IPC only    │     │
  │   └──────┬──────────────────────────┬──────────────────────────┘     │
  │          │                          │                                │
  │   ┌──────▼──────┐          ┌────────▼─────────┐                     │
  │   │   SQLite    │◄────────►│  SYNC ENGINE     │                     │
  │   │  (offline)  │          │  queue + retry   │◄──────────┐         │
  │   │             │          │  conflict detect │           │         │
  │   │  tables:    │          │  idempotency     │     WSS   │         │
  │   │   orders    │          │  sync_records    │     to    │         │
  │   │   payments  │          └──────────────────┘   Cloud   │         │
  │   │   shifts    │                                         │         │
  │   │   inventory │                                         │         │
  │   │   sync_queue│                                         │         │
  │   └─────────────┘                                         │         │
  └───────────────────────────────────────────────────────────┼─────────┘
                                                              │
                                                              └──────┐
                                                                     │
                                                    (when ONLINE, reconnects)
```

---

## 3. MONOREPO LAYOUT

```
prolific/
├─ package.json           (root workspaces, turbo scripts)
├─ turbo.json             (build pipeline)
├─ tsconfig.base.json     (shared TS config)
├─ apps/
│  ├─ pos/                (Electron POS terminal — main + renderer)
│  ├─ customer-display/   (shared render entry used by Electron window #2)
│  ├─ website/            (Next.js public-facing + QR menu)
│  ├─ admin/              (Next.js admin dashboard + menu mgmt)
│  └─ kitchen-display/    (Next.js kitchen KDS)
├─ server/                (NestJS REST + Socket.IO gateway)
├─ packages/
│  ├─ shared-types/       (ALL shared enums, interfaces, type aliases)
│  ├─ ui/                 (shared React components + cn() helper)
│  ├─ validation/         (Zod schemas for API + POS)
│  ├─ database/           (MongoDB schemas + SQLite migrations/repos)
│  └─ utils/              (id gen, money, retry, idempotency helpers)
└─ docs/                  (architecture + operational runbooks)
```

### 3.1 Boundary rules

- `@prolific/shared-types` has **zero runtime deps** except TS stdlib. Every
  app and the server import types from here. This is the single source of
  truth.
- `@prolific/validation` depends only on `shared-types` + Zod. Server and
  POS share the same schemas.
- `@prolific/database` is the ONLY package that imports `mongoose` or
  `better-sqlite3`. Apps never import DB drivers directly.
- `@prolific/ui` contains ONLY presentational primitives (Button, Card,
  Badge, Input, Modal, Toast). It must not contain business logic.
- `server/` is the only deployable that talks directly to MongoDB. The POS
  only ever talks to the server via HTTPS REST + Socket.IO and to its
  local SQLite via the Electron main process.

---

## 4. TENANT MODEL & IDENTIFIERS

Every row/document is owned by:
- `restaurantId` — top-level tenant. One paying customer = one Restaurant.
- `branchId`   — a physical location.

**All queries, socket rooms, sync streams are scoped by branchId first.**
Even if you have the `orderId`, you may not read it without also holding
the correct `restaurantId` + `branchId` context (enforced in NestJS
guards).

### 4.1 Primary key strategy

- Every entity uses string IDs generated at creation time with `nanoid(16)`
  (packages/utils/src `generateId()`), optionally prefixed:
  `ord_xxx`, `pay_xxx`, `kit_xxx`, `shf_xxx`, `emp_xxx`, etc.
- The POS generates the ID locally BEFORE saving to SQLite — the same ID
  is then upserted to MongoDB during sync. This eliminates a round-trip
  and guarantees offline ordering works.
- Human-readable identifiers (order number, PO number) are a SEPARATE
  field — never to be used as a key.

### 4.2 Idempotency key strategy

Every mutation that flows through the sync engine (or any payment call)
carries an `idempotencyKey = sha256(entityType:uniqueInput:timestamp)`.
The server stores `idempotencyKey → createdEntityId` in a dedicated
collection (`syncRecords` on the cloud side and `sync_queue` locally)
with a unique index. Replays return the same result without side
effects. This is the PRIMARY line of defence against duplicate orders
during bad-network retries.

---

## 5. TRUST BOUNDARIES

```
Internet ←── TLS ──► NestJS Server (AWS)
                        │
          ┌─────────────┴───────────────┐
      RBAC + JWT                   Audit logger
   (Role + Permission               every write
    guards on every endpoint)

       HTTPS/WSS (TLS only — WS is never plain)
          ▲
          │
   Electron POS (restaurant)
     ├─ Main process — runs SQLite, sync engine, printer, FS
     │   ALL privileged ops happen HERE.
     ├─ Preload — exposes whitelisted IPC channel names only.
     └─ Renderer (React) — nodeIntegration=false, contextIsolation=true.
          Renderer CANNOT read the file system, cannot load Node modules,
          cannot hit the DB directly. Everything goes through IPC.
```

No secrets live in the renderer. The JWT refresh token lives in
`electron-store` (encrypted) and is only attached to requests by the main
process.

---

## 6. SOCKET.IO ROOM TOPOLOGY

Socket.IO rooms are the backbone of real-time convergence. When a device
connects it joins:

```
`restaurant:${restaurantId}`        — broadcast, rarely used
`branch:${branchId}`                — MOST events go here (orders, menu, shifts)
`device:${deviceId}`                — device-specific commands (restart sync)
`employee:${employeeId}`            — per-user approval requests
`table:${tableId}`                  — table session + QR customer updates
`kitchen:${branchId}:${stationId}`  — kitchen orders per station
```

The NestJS gateway uses guards to verify a device may only join the rooms
that its JWT permits. A cashier device with `branchId=B1` cannot join
`branch:B2`.

---

## 7. PAYMENT ABSTRACTION LAYER (server)

```ts
interface PaymentProvider {
  initializePayment(InitializePaymentRequest): Promise<InitializePaymentResponse>;
  verifyPayment(reference: string): Promise<VerifyPaymentResponse>;
  refundPayment(RefundRequest): Promise<RefundResponse>;
  validateWebhookSignature(sig, body): boolean;
  parseWebhookEvent(body): WebhookEventPayload;
}
```

- `PaystackProvider` and `FlutterwaveProvider` implement this.
- `PaymentService` selects a provider by reading `branch.settings.defaultPaymentProvider`.
- Webhooks are validated against each provider's signature scheme BEFORE
  any DB mutation.
- All verified payments flow through the same idempotency-protected
  handler: `handleVerifiedPayment(reference, payload)` so that neither
  manual REST `verify` calls nor webhook delivery create duplicates.
- POS-LOCAL payments (CASH, CARD_POS, BANK_TRANSFER) carry
  `verificationType=LOCAL` — they are trusted only within the shift, and
  a manager PIN is required to mark a high-value local payment as
  received if configured.

---

## 8. SCALABILITY NOTES (for later)

- All writes go through NestJS services; there is no direct MongoDB
  access. This makes a later move to read replicas or an event bus
  straightforward.
- The sync engine is designed so that MongoDB is the source of truth for
  menu/employees/settings, while the POS's SQLite is the source of truth
  for `orders`, `payments`, and `shifts` while offline. The server
  NEVER overwrites an order that a POS created locally without winning
  an explicit conflict resolution. See `docs/06-sync.md`.
- The Socket.IO gateway is stateless (rooms + Redis adapter) so that you
  can horizontally scale to N gateway pods behind a sticky LB.

---

## 9. NON-FUNCTIONALS

| Aspect                | Target                                      |
|-----------------------|---------------------------------------------|
| Offline availability  | POS works with 0 internet for ≥ 7 days      |
| Order latency         | Scan barcode → cart → pay → receipt < 45 s  |
| UI response (click)   | ≤ 100 ms visual feedback on POS             |
| Sync replay           | 1000 orders sync back in ≤ 60 s on return   |
| Duplicate order rate  | 0 (guaranteed by idempotency key uniq idx)  |
| Auth expiry           | Access token 15 min, refresh token 7 days   |
| Audit retention       | 7 years (compliance default)                |

---

## 10. SECURITY PRINCIPLES (living list)

1. **Default deny.** Every NestJS route is guarded by `JwtAuthGuard` +
   `PermissionsGuard`. Only `/auth/login`, webhooks, and `/t/:qrToken`
   are public.
2. **No SQL injection.** Mongoose + `better-sqlite3` parameterized
   statements (the repositories ONLY expose safe methods).
3. **No XSS.** React escapes by default. All dangerouslySetInnerHTML is
   banned by lint rule except the receipt preview (which only renders
   data from the local DB, never from the network).
4. **No secrets in repos.** Env vars only. `.env*` in `.gitignore`.
5. **Audit everything sensitive.** Refund, void, price change, PIN entry
   attempt, shift open/close, cash pay-in/payout, employee role change
   — all land in `auditLogs`.
6. **Brute force protection.** Login + PIN entries are tracked and
   rate-limited (in-memory sliding window per branch + device, plus
   DB-level failed attempt counter with lockout).
