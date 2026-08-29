# QR Table Ordering Flow & Table Session Logic

The QR-ordering path lets a customer at a physical table order and pay
directly from their phone, without a waiter. The key abstraction that
prevents confusion when multiple customers share a table is the
**TableSession**.

## 1. Token format & URL

Each `tables.qr_code_id` points to a `qr_codes.token` (6–12 uppercase
URL-safe chars, e.g. `8H72KD`). The QR code image is a PNG that encodes:

```
https://{restaurant.website}/t/{token}
```

The admin UI has a "Print Table QR Pack" action that downloads a PDF
with one QR + table number per label sheet.

The token space is globally unique (unique index), so a customer never
lands on the wrong restaurant even if a bad QR gets reprinted.

---

## 2. Customer-facing page flow (Next.js app / website)

Page route: `apps/website/src/app/t/[token]/page.tsx` — fully public,
no auth required.

### Step 0: Resolve table (server component)

```ts
GET t/:token  →
  lookup QR code → validate active → get table + branch + restaurant
  look up table_sessions where tableId + status != CLOSED
    if session exists: is customer joining? (see §2.3)
    else: show "Welcome to [Table 12] — Tap 'Start Order'"
```

**The customer NEVER sees a field to enter the table number.** This is
the single most important UX rule of the QR flow. The table is known by
the token. If the token is invalid, the page shows "QR code not
recognised — please ask a member of staff."

### Step 1: Join or start session

Server issues an anonymous session cookie: `Set-Cookie:
prolific_qsid=<nanoid(24)>; HttpOnly; SameSite=Lax; Max-Age=8h`. This
cookie uniquely identifies **this phone/browser** for the duration of
the table visit. All future POSTs are scoped to it.

Body options:
```
POST /public/t/:token/session
  { action: 'START_NEW' | 'JOIN_EXISTING', customerName?, customerPhone? }
```

| Scenario                      | Flow                                                   |
|-------------------------------|--------------------------------------------------------|
| No session, first customer    | Create `table_sessions.status=OPEN`. Append qsid to session.customerIds. Return session. |
| Session OPEN, another phone taps | Show `This table has an active session. [Join Table] [Start New]`. Join = add this qsid to customerIds (updates session). Start New = **close old session first?** No! Instead create a NEW table_session for same table with status=OPEN? That breaks one-table-one-session invariant. Rule: a table can have exactly 1 OPEN session at a time. Thus: only START_NEW allowed if table.session.status=CLOSED or does not exist. If OPEN, only JOIN_EXISTING is allowed. |
| Customer chooses "Start New" while session is open | Not allowed. Instead, show: "A session is already open for this table. Please ask a manager to close it if you are a new party." |

### Step 2: Browse menu, add to cart

The menu is the **same active** menu the POS uses (categories → items →
modifiers), but displayed mobile-first with big tap targets, dietary
icons, and optional "call waiter" + "request bill" buttons.

Customer cart state is kept in-memory on the Next.js server per qsid
(after the session cookie is issued). No data leaks between customers
at the same table because each phone's cart is private to that qsid.

### Step 3: Submit order

```
POST /public/t/:token/session/orders
body: {
  items: [{ menuItemId, qty, modifiers[{modifierId, optionIds}], instructions? }],
  customerName?: string,
  cutlery?: number,
}
→ 201 Order (status depends on "Pay now or pay at POS?" toggle)
```

Rule: **each phone submits its own order**. The server:

1. Validates the qsid cookie → `customerIds[]` contains it.
2. Creates an `Order` with `source=QR, orderType=DINE_IN, tableSessionId, tableId, tableName=snapshot`.
3. If the customer chose online payment now → `order.status=AWAITING_PAYMENT, paymentStatus=PENDING`. Otherwise → `order.status=RECEIVED, paymentStatus=UNPAID` (pay at POS).
4. Appends order to `tableSession.orderIds[]`, increments totals.
5. Emits Socket.IO events:
   - `order:new` → room `branch:<branchId>` (all POS terminals + kitchen displays)
   - `table:session:updated` → room `table:<tableId>` (other phones at table see their combined order history)
6. For pay-at-POS: the cashier POS shows a big pill: **NEW ORDER • TABLE 12 • AWAITING PAYMENT**

### Step 4: Customer pays (online path)

```
POST /public/payments/initialize-online
body: { orderId, method: 'PAYSTACK'|'FLUTTERWAVE', email, fullName, returnUrl }
→ 200 { authorizationUrl }
```

Next.js redirects the customer to the provider. After the provider
verifies (webhook + server-side verify call), the server:

1. Sets `order.status = ACCEPTED` if kitchen needs to start cooking, or
   `COMPLETED` for a takeaway-only pickup later.
2. Sets `payment.status=PAID, verificationType=PROVIDER`.
3. Emits Socket.IO events to POS + kitchen.
4. Redirects the customer back to the table page with a success state.

### Step 5: Pay-at-POS path (customer side)

Customer taps "I'll pay at the counter". Phone shows:
- Order placed ✓
- Show this screen to the cashier to pay
- (Optional 6-character order short-code like "Table 12 • Red-7")

Cashier side: POS shows the QR-originated order exactly like any other
order. The `source: QR` badge is the only visual difference. When a
cashier records a cash payment for it, the customer's phone (subscribed
to `table:session:updated`) shows "Your bill has been paid. Thank you!"

---

## 3. Table session operations

### 3.1 Combine orders

Scenario: Table has 3 orders. Manager wants to combine them into one
"super order" for a single bill.

```
POST /table-sessions/:id/combine-orders
body: { orderIds: [...] , combinedOrderName?: "Table Total" }
→ 201: { combinedOrderId, resultingSessionTotals }
```

Rules:
- Only combine orders that are NOT already fully paid individually.
- The original orders are NOT deleted — they get `status=VOIDED, voidReason="COMBINED into <combinedOrderId>"`. A new combined order is created with `source=COMBINED, combinedFrom=[orderIds]`.
- Each order item is cloned to the combined order with references.

### 3.2 Split bill by item

Scenario: 4 friends, each wants to pay for their own dishes.

```
POST /table-sessions/:id/split
body: {
  mode: 'BY_ITEM' | 'EQUAL' | 'CUSTOM',
  splitGroups: [
    { customerLabel, itemIds: [orderItemIds], percentageOfShared?, customAmount? }
  ],
  sharedItems?: [itemIds], -- e.g., a shared bottle of wine, split evenly
}
→ 200: splits: [{label, subTotal, tax, total, orderIds}]
```

The server generates provisional "split payment" records. Each split
can be paid separately via cashier or online. When all splits are paid,
the session auto-moves to PAID.

### 3.3 Individual payment

A customer's phone taps "Pay for my items". The session page shows all
items, grouped by who ordered them (per qsid). We don't know the
customer's legal identity — but each item has an `orderedByQsid`
metadata field (stored on OrderItem.metadata). Customer QSIDs are
mapped in the session to customer names if provided.

Payments recorded for a specific customerQsid reduce that customer's
share and the overall session balance.

### 3.4 Table-level payment (default)

Cashier selects "Close Table". The POS shows a single "Pay Table Total"
flow. One payment operation sets `tableSession.status = PAID |
PARTIALLY_PAID` and settles each order accordingly. A balance due
remains if the customer paid part.

### 3.5 Closing a table session

```
POST /table-sessions/:id/close
  role required: MANAGER or per-branch config allows cashier
```

Rules:
- Only CLOSED when `balanceDue <= 0.01` (within a rounding cent).
- If any order is not COMPLETED/VOIDED: warn the cashier. Closing with
  non-terminal orders automatically voids unpaid, non-cancelled ones
  with a reason "Session closed".
- `tableSession.closedAt = now`, status = `CLOSED`.
- Emit `table:session:closed` → everyone's phones show "Table closed.
  Thank you for visiting!", a button to start a new session for the
  same table (now a fresh session), and a rating prompt.

---

## 4. Security & fraud vectors

| Vector                                    | Mitigation                                                                 |
|-------------------------------------------|---------------------------------------------------------------------------|
| Customer on phone A spoofs table B's tap  | Token is the only table identifier. No field to override it.             |
| Changing `tableId` in a request           | Server always derives tableId from the token in the URL path, never trust body/query. |
| Submitting an order for a table that's closed | Session must be OPEN + qsid must be in customerIds. A closed session → auto-reject with "New visit required, please scan again." |
| "Free" food by manipulating prices in POST | Server re-reads menuItem.price + modifiers.priceDelta at submit time. NEVER trust client-computed totals. |
| QR code is taped over by bad actor        | Restaurant branding and table number prominent on page. Customer can visually verify. Managers can regenerate tokens in Admin → QRs → Regenerate. Old token immediately disabled. |
| Session sharing across tables             | tableSession.tableId is immutable. One session can't move tables.         |
| Double-paying a split                     | idempotencyKey per split payment + server-side lock on split row during payment processing. |

---

## 5. Real-time state for customer phones

Each customer phone opens a Socket.IO connection on page load, joining
`table:<tableId>`. The server pushes:

- `table:session:updated` → refresh combined order list + balance.
- `order:status:changed` → per-order status (NEW → PREPARING → READY → SERVED).
- `order:item:kitchen:status` → per-item progress (for large tables,
  "Your Jollof Rice is now being prepared…").
- `order:payment:received` → payment thank-you screen.

For mobile Safari which may throttle socket connections when
backgrounded, the page also polls `GET /public/t/:token/session` every
15s as a fallback.

---

## 6. Offline POS handling of QR orders

When the restaurant internet is down:

- The customer phone **cannot reach the website/NestJS server**. The
  page shows "Restaurant connection is unstable. Please place your
  order with a member of staff — sorry for the inconvenience!".
- The POS still runs. The waiter takes the order manually via POS →
  DINE-IN → pick table.
- When the internet comes back, no "lost QR orders" exist because no
  QR orders were created during the outage; the fallback is staff.

The POS never acts as a web server for the QR menu (that would require
exposing a LAN IP, mDNS, and dealing with HTTPS certs for iOS Safari —
a rat hole we avoid in Phase 1). Phase 4 option: POS runs a tiny
local HTTPS server with a self-signed cert + a "LAN ordering" toggle
per branch config.
