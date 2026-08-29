# REST API Structure & Socket.IO Events

All APIs are versioned under `/api/v1`. NestJS prefixes + global guards
enforce this. Every write endpoint accepts an optional
`X-Idempotency-Key` header. The POS always sends one; the server stores
it on the resource AND in a 24h TTL `idempotency_cache` collection so
that a retried POST /orders with the same key returns the 201 (or 409)
it returned the first time — **before** touching the DB.

## Universal conventions

| Concern             | Rule                                                     |
|---------------------|----------------------------------------------------------|
| URL base            | `https://api.prolific.app/v1`                            |
| Auth                | `Authorization: Bearer <accessJWT>`                      |
| Request body        | JSON, validated with Zod (see packages/validation)       |
| Response envelope   | `{ success, data, meta, error }`                         |
| Money               | Always integer cents in JSON; currency in parent resource|
| Timestamps          | ISO 8601 UTC, millisecond precision                      |
| Pagination          | `?cursor=<ts:id>&limit=50` (cursor-based)                |
| Sorting             | `?sort=-createdAt` (dash = DESC)                         |
| Tenant isolation    | Every service reads `restaurantId+branchId` from the JWT — clients NEVER pass them as query params for list endpoints |
| Errors              | 400 validation, 401 expired token, 403 permission, 404 not found, 409 conflict, 422 business rule, 429 rate limit, 500 crash |
| Error body shape    | `{ code: string, message: string, details?: any, requestId: string }` |

Every response includes `X-Request-Id` for tracing.

---

## 1. AUTHENTICATION ENDPOINTS (public)

### `POST /auth/login`

```ts
body: { email, password, branchId? }
→ 200: {
    accessToken: string;       // JWT, 15 min
    refreshToken: string;      // opaque, 7 days, rotation family
    tokenType: 'Bearer';
    expiresIn: 900;
    user: UserDto;
    employee: EmployeeDto;     -- iff branchId was provided
    restaurant: RestaurantDto;
    branch: BranchDto;
    device: { id, hardwareId, type } | null;
  }
```

The login handler:
1. Validates password.
2. If `branchId` is given, looks up the employee row.
3. If no device exists for this (branchId, hardwareId) → auto-provision
   a device row (status `PENDING_APPROVAL` until a manager approves it
   in admin, OR a device-pairing flow runs).
4. Emits `auditLogs` → `LOGIN_SUCCESS | LOGIN_FAIL`.

### `POST /auth/refresh`

```ts
body: { refreshToken: string }
→ 200: { accessToken, refreshToken: NEW, expiresIn }
```

Refresh tokens are **single-use rotation**. Using a revoked or already-
spent token invalidates the entire family (theft detection).

### `POST /auth/logout`

```ts
body: { refreshToken?: string }  -- optional, revokes that token
→ 204
```

### `POST /auth/pin/verify`

Cashier → manager approvals (refund/void/large discount) use this
instead of passing full credentials.

```ts
body: { pin, action: AuditAction, entityType, entityId, employeeId? }
→ 200: { approved: boolean, signedApproval: string }  -- short-lived JWT
```

The returned approval JWT (1 min TTL, single use) is the only thing
accepted by `/orders/:id/void`, `/payments/refund`, etc. The approval
JWT includes `{ approverRole, approverId, scopedTo: { entityType, entityId }}`.

---

## 2. RESTAURANT / BRANCH / DEVICE (Admin scoped mostly)

```
GET    /restaurants/:id
PATCH  /restaurants/:id                              ADMIN+
GET    /branches                                     SUPER_ADMIN sees all
POST   /branches                                     ADMIN+
GET    /branches/:id
PATCH  /branches/:id
GET    /branches/:id/settings                        MANAGER+
PATCH  /branches/:id/settings                        ADMIN+
GET    /devices                                      MANAGER+
POST   /devices/:id/approve                          ADMIN+
POST   /devices/:id/revoke                           ADMIN+
```

---

## 3. EMPLOYEES / USERS

```
POST   /employees                                    ADMIN+
GET    /employees?role=X&q=name                      MANAGER+
GET    /employees/:id
PATCH  /employees/:id                                ADMIN+ (SUPER_ADMIN edits own role only via 2-person rule)
DELETE /employees/:id                                ADMIN+
POST   /employees/:id/reset-pin                      MANAGER+
POST   /users/:id/reset-password                     SUPER_ADMIN+
```

---

## 4. MENU MANAGEMENT

```
GET    /menu/categories                              MENU_VIEW
POST   /menu/categories                              MENU_CREATE
PATCH  /menu/categories/:id                          MENU_EDIT
DELETE /menu/categories/:id                          MENU_DELETE

GET    /menu/items?categoryId=&status=&q=            MENU_VIEW
POST   /menu/items                                   MENU_CREATE
PATCH  /menu/items/:id                               MENU_EDIT
DELETE /menu/items/:id                               MENU_DELETE

PATCH  /menu/items/:id/status                        MENU_MARK_OOS
         body: { status: MenuItemStatus }            -- used by POS too

GET    /menu/modifiers                               MENU_VIEW
POST   /menu/modifiers                               MENU_CREATE
PATCH  /menu/modifiers/:id                           MENU_EDIT

GET    /recipes                                      MANAGER+
POST   /recipes                                      INVENTORY_CREATE
PATCH  /recipes/:id                                  INVENTORY_EDIT

GET    /taxes                                        SETTINGS_VIEW
POST   /taxes                                        SETTINGS_EDIT
PATCH  /taxes/:id                                    SETTINGS_EDIT

GET    /discounts                                    MANAGER+
POST   /discounts                                    MANAGER+
PATCH  /discounts/:id                                MANAGER+
```

---

## 5. TABLES / QR / SESSIONS

```
GET    /tables                                       TABLE_VIEW
POST   /tables                                       MANAGER+
PATCH  /tables/:id                                   MANAGER+
DELETE /tables/:id                                   MANAGER+

GET    /qr-codes                                     MANAGER+
POST   /qr-codes/generate?tableId=                   MANAGER+
POST   /qr-codes/:id/regenerate                      MANAGER+

-- PUBLIC (for QR website, no JWT)
GET    /public/t/:qrToken
         → resolves token → returns branchId, tableId, tableName,
                               restaurant branding, and active session
                               (or nothing) if no session yet.

POST   /public/t/:qrToken/session                    (cookie-based anon session id)
         body: { join?: boolean, customerName?, customerPhone? }
         → 201 TableSession with customerIds + session token

POST   /public/t/:qrToken/session/close              MANAGER only
```

---

## 6. ORDERS

Core endpoints. POS also uses these **OR** the offline path.

```
GET    /orders?status=&type=&tableId=&q=             ORDER_VIEW
         cursor pagination

POST   /orders                                       ORDER_CREATE
         body: CreateOrderInput (see validation package)
         headers: X-Idempotency-Key: <mandatory for POS sync>
         → 201 Order + enqueues Socket.IO broadcasts

GET    /orders/:id                                   ORDER_VIEW
PATCH  /orders/:id                                   ORDER_EDIT
         body: { items?, tableId?, notes?, discountId?, tip? }

POST   /orders/:id/hold                              ORDER_HOLD
         body: { reason? }
POST   /orders/:id/unhold                            ORDER_HOLD

POST   /orders/:id/cancel                            ORDER_CANCEL
         body: { reason }
POST   /orders/:id/void                              ORDER_VOID
         body: { reason, approvalToken }  -- manager signed approval

POST   /orders/:id/refund                            ORDER_REFUND
         body: { amount, reason, approvalToken, itemIds? }

PATCH  /orders/:id/status                            ORDER_EDIT
         body: { status: OrderStatus, estimatedReadyAt? }
         Triggers Socket.IO → kitchen + customer website + POS

GET    /orders/:id/ticket                            ORDER_VIEW
         → printable ticket data (for kitchen/customer)
```

---

## 7. PAYMENTS

```
GET    /payments?orderId=&method=&from=&to=          VIEW_REPORTS

POST   /payments                                     PAYMENT_ACCEPT
         body: RecordPaymentInput
         header: X-Idempotency-Key (MANDATORY)
         Triggers: order.paymentStatus update,
                   inventory deduction,
                   Socket.IO broadcast

POST   /payments/initialize-online                   (public / QR)
         body: { orderId, method: 'PAYSTACK'|'FLUTTERWAVE',
                  customerEmail?, customerName?, returnUrl }
         → { authorizationUrl, reference }
         Called by website/Next.js → server → provider initialize.

GET    /payments/verify?reference=                   (public, provider callback hits this)
         Server-side: server calls provider.verify(reference)
         → 303 back to website/:orderId?status=PAID

POST   /payments/:id/refund                          PAYMENT_REFUND
         body: { amount, reason, approvalToken }
         Server calls provider refund API for online methods.

-- Provider webhooks (public, signature-verified)
POST   /webhooks/paystack
POST   /webhooks/flutterwave
```

---

## 8. KITCHEN DISPLAY

```
GET    /kitchen/orders?station=X&status=NEW          KITCHEN_VIEW

PATCH  /kitchen/orders/:id/status                    KITCHEN_UPDATE_STATUS
         body: { status: KitchenStatus, assignedCookId? }
```

POS can also PATCH individual order item kitchen status via:
```
PATCH  /orders/:orderId/items/:itemId/kitchen-status
```

Both paths emit the same `kitchen:order:status` Socket.IO event so that
all kitchen displays converge.

---

## 9. INVENTORY

```
GET    /inventory/items?q=&category=&lowStock=1      INVENTORY_VIEW
POST   /inventory/items                              INVENTORY_CREATE
PATCH  /inventory/items/:id                          INVENTORY_EDIT

POST   /inventory/adjust                             INVENTORY_ADJUST
         body: [{ itemId, qty, unitCost?, reason, approvedBy? }]

GET    /inventory/transactions?itemId=&type=&from=   INVENTORY_VIEW

GET    /suppliers                                    INVENTORY_VIEW
POST   /suppliers                                    INVENTORY_CREATE
PATCH  /suppliers/:id                                INVENTORY_EDIT

GET    /purchase-orders                              INVENTORY_PURCHASE
POST   /purchase-orders                              INVENTORY_PURCHASE
POST   /purchase-orders/:id/receive                  INVENTORY_PURCHASE
         body: [{ itemId, receivedQty }]
```

---

## 10. CUSTOMERS

```
GET    /customers?q=phone_or_name                    CUSTOMER_VIEW
POST   /customers                                    CUSTOMER_CREATE
PATCH  /customers/:id                                CUSTOMER_EDIT
GET    /customers/:id/orders                         CUSTOMER_VIEW
```

---

## 11. SHIFTS & CASH

```
GET    /shifts?employeeId=&status=                   SHIFT_VIEW_ALL
POST   /shifts/open                                  SHIFT_OPEN
         body: { openingCash, deviceId }
         -- enforces "only one open shift per device"

POST   /shifts/:id/close                             SHIFT_CLOSE
         body: { actualCash, notes }
         Server independently recomputes expectedCash based on all
         payments recorded for this shift → returns cashVariance.

GET    /shifts/:id/report                            VIEW_FINANCIALS

POST   /cash/adjustments                             CASH_PAYIN | CASH_PAYOUT
         body: { shiftId, type, amount, reason, approvalToken? }
```

---

## 12. REPORTS / DASHBOARD

All report endpoints support `?from&to&branchId=` (default: caller's
branch only). Super admins can cross branches.

```
GET    /reports/sales/dashboard?granularity=hour|day|month
           → sales, orders, AOV, best-sellers over period

GET    /reports/sales/by-category
GET    /reports/sales/by-employee                    cashier performance
GET    /reports/payments/methods                     mix by method
GET    /reports/inventory/low-stock                  low stock alert list
GET    /reports/inventory/usage                      top used ingredients
GET    /reports/inventory/wastage                    wastage by type+period
GET    /reports/shifts/performance                   shift summary list
GET    /reports/customers/top                        top spenders

GET    /audit-logs?entityType=&performedBy=&action=  AUDIT_VIEW
```

---

## 13. SYNC ENDPOINTS (POS → server)

These are the ONLY endpoints used by the sync engine during upload:

```
POST   /sync/batch                                    (POS → cloud)
         body: {
           deviceId,
           cursor: string | null,
           items: [
             {
               id,            -- syncQueue row id locally
               entityType,
               entityId,
               direction: 'LOCAL_TO_CLOUD',
               payload,
               idempotencyKey,
               version,       -- local version
               timestamp,
             }
           ]
         }
         → 200 {
             perItem: [ { id, status, cloudVersion?, conflict?, message? } ],
             serverTimestamp,
           }
```

For download (cloud → POS pull):

```
POST   /sync/pull
         body: {
           deviceId,
           cursors: { ORDER: ts, PAYMENT: ts, SHIFT: ts, ... } -- per-entity last synced timestamp
           includeEntities: [ ORDER, PAYMENT, MENU_ITEM, ... ]
         }
         → 200 {
             cursors: { /* next cursors */ },
             entities: {
               ORDER: [ ... ],
               PAYMENT: [ ... ],
               ...
             },
             hasMore: boolean,
           }
```

Batch size is capped at 200 per upload and 500 per pull per entity.

---

## Socket.IO Gateway (`socket.prolific.app`, same server pod)

Namespace: `/`. The gateway ONLY emits events — it never commits DB
writes directly. Client messages are validated and forwarded to the
relevant NestJS service via DI method calls (or turned into HTTP
requests internally via a local in-memory transport so the same guards
run).

### Connection / auth

Client → Server on connect: `auth: { token: accessJWT, deviceId, branchId }`.
The gateway's `WsJwtGuard` validates and joins the rooms listed in §01.

### Server → Client events (see `ServerEventMap` in shared-types)

```
order:new                    (room: branch)
order:status:changed         (room: branch + table + device)
order:item:kitchen:status    (room: branch + table)
order:payment:received       (room: branch + table + employee/customer)
order:updated                (room: branch)
order:held                   (room: branch)
order:voided                 (room: branch)
order:refunded               (room: branch)

kitchen:order:new            (room: kitchen:branch:station)
kitchen:order:status         (room: kitchen:branch:station + branch)

table:session:opened         (room: table + branch)
table:session:updated        (room: table + branch)
table:session:closed         (room: table + branch)

menu:item:status:changed     (room: branch)
menu:item:price:changed      (room: branch)

sync:status                  (room: device)
sync:completed               (room: device)
sync:error                   (room: device)

device:connected             (room: branch)
device:disconnected          (room: branch)

shift:opened                 (room: branch + employee)
shift:closed                 (room: branch + employee)

approval:requested           (room: employee [managers on duty])
```

### Client → Server events (see `ClientEventMap` in shared-types)

```
pos:order:create
pos:order:status
pos:order:kitchen:status
pos:payment:record
pos:order:hold
pos:order:unhold
pos:order:void
pos:order:refund

kitchen:order:status

device:presence              heartbeat, every 30s
shift:open
shift:close

approval:response

customer:display:order:active
customer:display:promo
```

Every client event handler wraps its call with idempotency key +
permission checks before mutating anything.

---

## Rate limiting

| Class                   | Limit                          |
|-------------------------|--------------------------------|
| `/auth/*` per IP        | 10 req / min                   |
| PIN verify per device   | 5 attempts / 5 min, then lock  |
| Webhooks by signature   | allow, signature must match    |
| Everything else (JWT)   | 500 req / min per device       |
| Sync batch              | 120 req / min per device       |

Rate limiter uses in-memory store for a single-pod deploy; swap to
Redis when scaling gateway pods.
