# Order & Payment State Machines

A buggy state transition is how restaurants lose money. Every transition
documented below has a corresponding Guard inside NestJS + Electron
main; any attempt to move between non-adjacent states is rejected with
HTTP 422 and logged to `audit_logs`.

## 1. Order Status State Machine

```
                                    QR / Web / POS submit (pay now → go to AWAITING_PAYMENT)
                                              │
                                              ▼
                                       ┌───────────┐
                                       │  PENDING  │  (initial, cart draft – client-side only briefly)
                                       └─────┬─────┘
                                             │ submit persisted
                                             ▼
          pay at POS                  ┌───────────────────┐                pay online chosen
        ┌─────────────────────────────┤ AWAITING_PAYMENT  │───────────────────────────┐
        │                             └─────────┬─────────┘                           │
        │                                       │                                     │
        │                                 ONLINE PAY                               │
        │                              (verified provider                           │
        │                                callback or verify)                         │
        │                                       │                                     │
        │                                       ▼                                     │
        │          ┌──────────────────────────────┐                                  │
        │          │          RECEIVED            │◄─────────────────────────────────┘
        │          │   (new on POS kitchen list)  │
        │          └───────────────┬──────────────┘
        │                          │ cashier/auto-accept (POS + QR)
        │                          ▼
        │                   ┌───────────┐
        │                   │ ACCEPTED  │
        │                   └─────┬─────┘
        │                         │ kitchen starts
        │                         ▼
        │                   ┌─────────────┐
        │                   │ PREPARING   │────── void()
        │                   └──────┬──────┘       │
        │                          │              ▼
        │                          │       ┌───────────┐
        │                    ready │       │ CANCELLED │ (permitted w/ approval UNTIL PREPARING started;
        │                          │       └───────────┘   after kitchen starts, refund path instead)
        │                          ▼
        │                   ┌───────────┐
        │                   │   READY   │
        │                   └─────┬─────┘
        │                         │ waiter serves
        │                         ▼
        │   dine-in only    ┌───────────┐
        └──────────────────►│  SERVED   │
                            └─────┬─────┘
                                  │ all items paid
                                  ▼
                            ┌─────────────┐
                            │  COMPLETED  │ (terminal – invoice final)
                            └──────┬──────┘
                                   │
     ┌─────────────────────────────┼─────────────────────────────┐
     │                             │                             │
     ▼                             ▼                             ▼
  REFUNDED (full)             VOIDED (no items    These are terminal states.
     via refund()              served, void       Once set, order.status is
                              before close)       immutable. AuditLog captures
                                                  the operator + approver.
```

## 2. Order Status Transition Rules

`Transition(current, target): { allowed, requiresRole, sideEffects }`

| # | From             | To               | Allowed role     | Requires approval? | Side effects                                                                                                                                                  |
|---|------------------|------------------|------------------|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | any initial      | PENDING          | system           | —                  | Draft order created client-side (not persisted yet)                                                                                                           |
| 2 | PENDING          | AWAITING_PAYMENT | system           | —                  | Persist order + emit `order:new`. If source=QR/POS/ONLINE and pay online → show payment.                                                                      |
| 3 | PENDING          | RECEIVED         | system           | —                  | Pay-at-POS path: persist, emit to kitchen + POS                                                                                                               |
| 4 | AWAITING_PAYMENT | RECEIVED         | system/webhook   | —                  | Provider verified the payment; deduct inventory, emit kitchen                                                                                                |
| 5 | AWAITING_PAYMENT | CANCELLED        | system           | —                  | Payment failed or 15-min timeout                                                                                                                              |
| 6 | RECEIVED         | ACCEPTED         | CASHIER,MANAGER  | no                 | Set acceptedAt. Emits: `kitchen:order:new` per station                                                                                                       |
| 7 | ACCEPTED         | PREPARING        | KITCHEN          | no                 | Set startedPreparingAt; emit per-item `kitchen:status`                                                                                                       |
| 8 | PREPARING        | READY            | KITCHEN          | no                 | Set readyAt; emit `order:status:READY` to customer + waiter                                                                                                  |
| 9 | READY            | SERVED           | WAITER,CASHIER   | no                 | Set servedAt per item or all-at-once                                                                                                                          |
|10 | READY/SERVED     | COMPLETED        | CASHIER          | if fully paid      | Set completedAt; trigger loyalty accrual; finalize inventory txns                                                                                            |
|11 | RECEIVED/ACCEPTED| ON_HOLD          | CASHIER          | no                 | Set heldAt + reason; remove from kitchen view                                                                                                                 |
|12 | ON_HOLD          | RECEIVED         | CASHIER          | no                 | Unhold                                                                                                                                                        |
|13 | PENDING…READY    | CANCELLED        | CASHIER,MANAGER  | yes if ≥ 1 item sent to kitchen | Set cancelledAt + reason. If payments exist, auto-initiate refund flow. Stock-returned to inventory if deducted.                                            |
|14 | COMPLETED        | REFUNDED         | MANAGER only     | YES (PIN)          | Full refund OR per-item refund. Creates `refund` payment row. Emits `order:refunded`.                                                                       |
|15 | any before COMPLETED | VOIDED      | MANAGER only     | YES (PIN)          | Void: an order that is erased from daily sales for accounting reasons (different from refund). Void only if ≤ 1 day old. Creates void audit log.            |

### 2.1 Terminal state immutability

`OrderStatus ∈ { COMPLETED, REFUNDED, VOIDED, CANCELLED }` ⇒ the
`status` column becomes read-only. Any further mutation must go
through dedicated refund/void endpoints that add rows (payments →
refunds, voids, adjustments) instead of rewriting history.

### 2.2 Payment Status Matrix

`PaymentStatus` and `OrderStatus` are parallel state machines that
**agree but never overwrite**. The following invariants hold and are
checked every time either is updated:

```ts
assert(order.paidAmount + sum(refunded.amount for order.refunds) <= order.totalAmount);
assert(order.balanceDue == order.totalAmount - order.paidAmount);
assert(all payments for order have verificationType ∈ expected for their method);
```

```
Order.paymentStatus values:
  UNPAID           balanceDue == totalAmount
  PENDING          online payment submitted but not yet verified
  PARTIALLY_PAID   0 < paidAmount < totalAmount
  PAID             balanceDue == 0 (or within rounding)
  FAILED           last payment attempt failed
  REFUNDED         full refund, paidAmount == refundedAmount
  PARTIALLY_REFUNDED 0 < refundedAmount < paidAmount
```

## 3. Payment State Machine

Per payment row (not per order):

```
initialize()
    │
    ├─ method ∈ {CASH, CARD_POS, BANK_TRANSFER}
    │   └────►  PAID immediately (verificationType = LOCAL)
    │            └─ timestamp processedAt = now
    │
    └─ method ∈ {PAYSTACK, FLUTTERWAVE, WALLET}
        ├─ success callback / webhook verified
        │    └──► PAID (verificationType = PROVIDER,
        │                 + providerTransactionId)
        ├─ timeout (30 min or provider expiry)
        │    └──► FAILED + failureReason="timeout"
        └─ explicit failure
             └──► FAILED + failureReason from provider
```

After PAID, a payment can be partially or fully refunded:

```
                     PAID
                      │
                      ├─ refund(partial) → PARTIALLY_REFUNDED + refundedAmount
                      └─ refund(full)    → REFUNDED         + refundedAmount = amount
```

### 3.1 Sensitive payment approvals

Per branch `requireManagerPinFor[]`, if the action permission is
listed, the POS must present a modal: "Manager approval required" →
the manager enters their 4–6 digit PIN (never stored in the renderer).
The main process calls `/auth/pin/verify` and, on success, attaches
the returned short-lived `approvalToken` JWT to the payment/void/refund
request. The server decodes the JWT again and validates the approver
role before allowing the mutation. Actions gated by default:

| Action                           | Default gate   |
|----------------------------------|----------------|
| Void an order                    | ≥ SUPERVISOR   |
| Refund any amount                | ≥ MANAGER      |
| Discount > 10% OR > threshold    | ≥ SUPERVISOR   |
| Price change                     | ≥ MANAGER      |
| Cash pay-out any amount          | ≥ SUPERVISOR   |
| Cash pay-in ≥ threshold          | ≥ SUPERVISOR   |
| Open a shift for another cashier | ≥ MANAGER      |

## 4. Kitchen Status State Machine (per OrderItem + per KitchenOrder)

```
    NEW (when order accepted)
      │ kitchen: tap "Start" or auto-start on print
      ▼
  PREPARING
      │ tap "Ready" / auto-timer complete
      ▼
    READY
      │ waiter pickup + POS mark served
      ▼
 COMPLETED
      │
      │ (any time before COMPLETED) cancel via void/cancel
      └────► CANCELLED + cancelled reason
```

The Kitchen Display uses color coding + time badges:
- ≤ 5 min in state: green
- 5–15 min: amber
- ≥ 15 min: red, and `priority` bumps to `LATE` + alert tone per branch config.

## 5. Table Session Status State Machine

```
scan QR (customer 1): START_NEW → OPEN
scan QR (customer n): JOIN_EXISTING
       │
       │ orders accumulate, balance grows
       ▼
     OPEN ───────────► AWAITING_PAYMENT  (manager or customer taps "Request Bill")
       │                       │
       │                       ├── some splits paid → PARTIALLY_PAID
       │                       │
       │                       └── all splits + remainder paid → PAID ──► CLOSED
       │                                                                      ▲
       │ manager "Force Close Table", balance=0                           │
       └──────────────────────────────────────────────────────────────────┘
```

### 5.1 Split rules

When splitting, the sum of `splitGroup.amount` across all groups MUST equal
`tableSession.totalAmount`. If a discrepancy exists (tax rounding), the
first group is assigned the extra cent deterministically.

### 5.2 Inventory & Loyalty side-effects

On `order.status → COMPLETED`:

1. Deduct each `OrderItem.quantity × recipe.ingredients[i].quantity`
   from `inventoryItems.currentStock`.
2. Append `inventoryTransactions` rows with type `SALE_DEDUCTION`.
3. If a resulting ingredient drops below `minimumStock`, append to
   low-stock alert list + emit `inventory:low-stock` to room
   `branch:X` (manager dashboard banner + in-app notification + daily
   email digest if configured).
4. Accrue loyalty points: `points += floor(total / 100) * multiplier`
   (multiplier per tier).

If the order is later REFUNDED (full), these side effects are reversed
— inventory stock is incremented back, points are deducted.
