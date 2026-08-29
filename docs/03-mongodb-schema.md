# MongoDB Collections & Schema Design

All collections are tenant-isolated by `restaurantId` (top-level) + `branchId`
(location). Every list-style query **must** include at least `restaurantId`;
the NestJS service layer enforces this by injecting it from the JWT.

Money is stored as INTEGER cents in every table to avoid float drift.

---

## Collection Matrix

| #   | Collection               | Write origin         | Sync direction* |
|-----|--------------------------|----------------------|-----------------|
| 1   | `users`                  | Server (admin)       | C2L only        |
| 2   | `employees`              | Server               | C2L only        |
| 3   | `restaurants`            | Server               | C2L only        |
| 4   | `branches`               | Server               | C2L only        |
| 5   | `settings`               | Server + POS (rare)  | Bidirectional   |
| 6   | `devices`                | Server + POS         | Bidirectional   |
| 7   | `roles`                  | Server (static)      | C2L only        |
| 8   | `menuCategories`         | Server (admin)       | C2L only        |
| 9   | `menuItems`              | Server + POS (OOS)   | Bidirectional   |
| 10  | `menuModifiers`          | Server               | C2L only        |
| 11  | `recipes`                | Server               | C2L only        |
| 12  | `taxes`                  | Server               | C2L only        |
| 13  | `discounts`              | Server               | C2L only        |
| 14  | `tables`                 | Server               | C2L only        |
| 15  | `tableSessions`          | Server + POS + Web   | Bidirectional   |
| 16  | `qrCodes`                | Server               | C2L only        |
| 17  | `orders`                 | POS + Web + POS      | Bidirectional   |
| 18  | `orderItems`             | POS + Web (embedded) | —               |
| 19  | `payments`               | POS + Web            | Bidirectional   |
| 20  | `kitchenOrders`          | POS + Kitchen UI     | Bidirectional   |
| 21  | `kitchenDisplayStations` | Server               | C2L only        |
| 22  | `inventoryItems`         | Server + POS         | Bidirectional   |
| 23  | `inventoryTransactions`  | Server + POS         | POS→C           |
| 24  | `suppliers`              | Server               | C2L only        |
| 25  | `purchaseOrders`         | Server (admin)       | C2L only        |
| 26  | `customers`              | POS + Web            | Bidirectional   |
| 27  | `loyaltyAccounts`        | Server               | C2L only        |
| 28  | `shifts`                 | POS                  | POS→C           |
| 29  | `cashAdjustments`        | POS                  | POS→C           |
| 30  | `auditLogs`              | Everywhere           | All→C           |
| 31  | `syncRecords`            | POS + Server         | (meta)          |
| 32  | `promotions`             | Server               | C2L only        |

*`C2L` = cloud-to-local (server authoritative). `POS→C` = local POS is the
 write authority; cloud is a copy. `Bidirectional` = last-writer-wins with
 conflict detection keys. See 06-sync.md.

---

## 1. `users`

```
{
  _id:          ObjectId,   (or string nanoid; WE USE STRING)
  id:           string,     nanoid(16) — our own id, stable
  email:        string,     UNIQUE, lowercase
  hashedPassword: string,   bcrypt
  firstName:    string,
  lastName:     string,
  phone:        string|null,
  avatarUrl:    string|null,
  isActive:     bool,       default true
  isEmailVerified: bool,
  emailVerifiedAt: Date|null,
  lastLoginAt:  Date|null,
  failedLoginAttempts: int, default 0
  lockedUntil:   Date|null,
  createdAt:     Date,
  updatedAt:     Date,
}
Indexes:
  unique { email: 1 }
  { isActive: 1 }
```

---

## 2. `employees`

```
{
  id:           string PK,
  userId:       string FK → users.id,
  restaurantId: string,
  branchId:     string,        --- note: an employee belongs to one branch;
                                cross-branch admins have multiple rows
  role:         enum Role      (SUPER_ADMIN lives in users.roles[])
  pin:          string|null,   bcrypt of 4–6 digit numeric PIN
  employeeNumber: string|null,
  positionTitle: string|null,
  assignedZoneIds: string[],   -- floor zones for waiters
  joinedAt:     Date|null,
  createdAt:    Date,
  updatedAt:    Date,
}
Indexes:
  unique { userId: 1, branchId: 1 }
  { branchId: 1, role: 1 }
```

---

## 3. `restaurants`

```
{
  id: string PK,
  name: string,
  legalName: string|null,
  logoUrl: string|null,
  bannerUrl: string|null,
  address: string,
  city: string,
  country: string,
  phone: string,
  email: string,
  currency: string (ISO 4217),
  locale:   string,
  taxId:    string|null,
  registrationNumber: string|null,
  createdAt: Date,
  updatedAt: Date,
}
```

---

## 4. `branches`

```
{
  id:          string PK,
  restaurantId:string,
  name:        string,
  address:     string,
  city:        string,
  country:     string,
  phone:       string,
  email:       string,
  timezone:    string (IANA, e.g. "Africa/Lagos"),
  openingHours:[{ dayOfWeek:int 0-6, openTime:"HH:mm", closeTime:"HH:mm",
                  isClosed:bool }],
  isActive:    bool,
  createdAt:   Date,
  updatedAt:   Date,
}
Indexes: { restaurantId: 1, isActive: 1 }
```

---

## 5. `settings` (per-branch)

```
{
  id: string PK,
  restaurantId: string,
  branchId:     string,     UNIQUE(restaurantId, branchId)
  receiptHeader: string,
  receiptFooter: string,
  logoUrlForReceipt: string|null,
  enableTips:    bool,
  tipOptions:    number[],   e.g. [5,10,15] %
  defaultTaxRateId: string|null → taxes.id,
  defaultServiceCharge: number cents,
  autoPrintKitchenTickets: bool,
  autoPrintReceipts:      bool,
  requireCustomerName:    bool,
  requireManagerPinFor:   Permission[],  (enum from shared-types)
  lowStockAlertThreshold: int (days),
  createdAt, updatedAt,
}
```

---

## 6. `devices`

```
{
  id:           string PK,
  restaurantId: string,
  branchId:     string,
  name:         string,
  type:         enum DeviceType (POS_TERMINAL | KITCHEN_DISPLAY | ...)
  hardwareId:   string,       (MAC or hash; unique index for re-auth)
  terminalNumber: string|null, ("POS-01")
  lastConnectedAt: Date|null,
  lastSyncAt:   Date|null,
  currentSyncStatus: enum ConnectionStatus,
  isActive:     bool,
  createdAt, updatedAt,
}
Indexes:
  unique { hardwareId: 1, branchId: 1 }
  { branchId: 1, type: 1 }
```

---

## 7. `roles` (seed collection; rarely changes)

```
{
  role:         enum Role PK,
  permissions:  Permission[],     see shared-types
  description:  string,
  createdAt, updatedAt
}
seed:
  SUPER_ADMIN → ALL
  ADMIN      → almost all except SUPER_ADMIN-only actions
  MANAGER    → day-to-day ops + approval rights
  SUPERVISOR → like MANAGER but no role/price change
  CASHIER    → order create, pay, hold, view
  KITCHEN    → view kitchen orders, update status
  WAITER     → open/close table, take order, view assigned tables
  ACCOUNTANT → read financials + inventory reports only
```

---

## 8. `menuCategories`

```
{
  id: string PK,
  restaurantId: string,
  branchId:     string,
  name:         string,
  description:  string|null,
  sortOrder:    int,     --- ascending
  isActive:     bool,
  imageUrl:     string|null,
  createdAt, updatedAt
}
Index: { branchId: 1, isActive: 1, sortOrder: 1 }
```

---

## 9. `menuItems`

```
{
  id: string PK,
  restaurantId: string,
  branchId:     string,
  categoryId:   string → menuCategories.id,
  name:         string,
  description:  string|null,
  price:        int cents,
  imageUrl:     string|null,
  status:       enum MenuItemStatus (AVAILABLE | OUT_OF_STOCK | DISABLED | SCHEDULED)
  sortOrder:    int,
  isTaxable:    bool,
  taxIds:       string[] → taxes.id[],
  modifierIds:  string[] → menuModifiers.id[],
  recipeId:     string|null → recipes.id,
  scheduledAvailability: { daysOfWeek:[0-6], startTime, endTime } | null,
  -- Version fields used by sync conflict detector
  version:      int,  --- increment on every write
  lastModifiedAt: Date,
  lastModifiedBy: string,  --- employeeId or "admin" or "pos-<deviceId>"
  createdAt, updatedAt
}
Indexes:
  { branchId: 1, categoryId: 1, status: 1, sortOrder: 1 }
  { branchId: 1, "name": "text" }  --- for search
  unique { id: 1, version: 1 }
```

---

## 10. `menuModifiers`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  description: string|null,
  required: bool,
  multiSelect: bool,
  minSelections: int,
  maxSelections: int,
  options: [{ id: string, name: string, priceDelta: int cents, isDefault: bool }],
  createdAt, updatedAt
}
```

---

## 11. `recipes`

```
{
  id: string PK,
  restaurantId, branchId,
  menuItemId: string UNIQUE → menuItems.id,
  name: string,
  servings: int,
  ingredients: [{
    inventoryItemId: string → inventoryItems.id,
    inventoryItemName: string,  --- snapshot
    quantity: number,
    unit: enum Unit,
    costAtRecipeTime: int cents|null,
  }],
  instructions: string|null,
  prepTimeMinutes: int|null,
  cookTimeMinutes: int|null,
  createdAt, updatedAt
}
```

---

## 12. `taxes`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  rate: number,                 -- percentage, e.g. 7.5
  isIncludedInPrice: bool,
  isActive: bool,
  createdAt, updatedAt
}
```

---

## 13. `discounts`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  type: "PERCENTAGE" | "FIXED",
  value: number,                -- % or cents
  maxAmount: int cents|null,
  minOrderAmount: int cents|null,
  isActive: bool,
  requiresManagerApproval: bool,
  approvalThreshold: int|null,  -- amount above this needs PIN
  createdAt, updatedAt
}
```

---

## 14. `tables`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,          -- e.g. "Table 12", "VIP 1"
  capacity: int,
  floor: string|null,
  zone:  string|null,
  position: { x:number, y:number }|null, -- for floor plan
  isActive: bool,
  qrCodeId: string UNIQUE → qrCodes.id,
  createdAt, updatedAt
}
Index: { branchId: 1, zone: 1, isActive: 1 }
```

---

## 15. `tableSessions` — critical for QR flow

```
{
  id: string PK,
  restaurantId, branchId,
  tableId:    string,
  qrCodeId:   string,
  status:     enum TableSessionStatus
                (OPEN|AWAITING_PAYMENT|PARTIALLY_PAID|PAID|CLOSED)
  openedAt:   Date,
  openedBy:   string|null → employees.id
  customerIds: string[],  --- people who joined via QR
  orderIds:   string[],   --- all orders for this session
  totalAmount: int cents,
  paidAmount:  int cents,
  balanceDue:  int cents,
  closedAt:   Date|null,
  closedBy:   string|null,
  -- sync metadata
  version: int,
  lastModifiedAt, createdAt, updatedAt
}
Indexes:
  { branchId: 1, status: 1, openedAt: -1 }
  { tableId: 1, status: 1 }
  { qrCodeId: 1, status: 1 }
```

---

## 16. `qrCodes`

```
{
  id: string PK,
  restaurantId, branchId,
  tableId:    string,
  token:      string(6-12) UPPERCASE,    UNIQUE(restaurantId, token)
  isActive:   bool,
  printedAt:  Date|null,
  lastScannedAt: Date|null,
  createdAt, updatedAt
}
Indexes:
  unique { token: 1 }   -- global unique; the public QR uses token only
  { branchId: 1, isActive: 1 }
```

---

## 17. `orders` + embedded `orderItems`

The `orderItems` array is stored embedded inside the `orders` document for
two reasons: (a) orders are write-once-update-few, (b) POS queries always
need the complete order graph together. Separate collection `orderItems`
is not used — see §01 architecture "Data Integrity" rationale.

```
orders: {
  id:           string PK,        -- generated on POS, syncs to server
  restaurantId, branchId,
  orderNumber:  string,           -- human readable, per-branch seq
  orderType:    enum OrderType,
  status:       enum OrderStatus,
  customerId:   string|null → customers.id,
  customerName: string|null,
  customerPhone:string|null,
  tableId:      string|null,
  tableSessionId:string|null,
  tableName:    string|null,     -- snapshot
  employeeId:   string|null → employees.id (cashier/server)
  deviceId:     string|null → devices.id
  sourceChannel: enum (POS|QR|WEBSITE|APP|PHONE)
  items: [
    {
      id: string,                         --- per-item id (nanoid)
      orderId: string,
      menuItemId: string,
      name: string,            --- snapshot at order time
      description: string|null,
      unitPrice: int cents,
      quantity: int,
      selectedModifiers: [{
        modifierId: string,
        name: string,
        optionIds: string[],
        optionNames: string[],
        totalPriceDelta: int cents,
      }],
      specialInstructions: string|null,
      subtotal: int cents,
      discountAmount: int cents,
      taxAmount: int cents,
      totalAmount: int cents,
      discountId: string|null,
      kitchenStatus: enum KitchenStatus (NEW|PREPARING|READY|COMPLETED|CANCELLED)
      preparedAt: Date|null,
      servedAt: Date|null,
      refunded: bool,
      refundedAmount: int cents|null,
      refundReason: string|null,
      createdAt: Date,
      updatedAt: Date,
    }
  ],
  subtotal:      int cents,
  discountAmount:int cents,
  discountId:    string|null,
  taxAmount:     int cents,
  totalAmount:   int cents,
  paidAmount:    int cents,
  balanceDue:    int cents,
  tipAmount:     int cents|null,
  notes:         string|null,
  paymentStatus: enum PaymentStatus,
  estimatedReadyAt: Date|null,
  -- status timestamps
  acceptedAt: Date|null,
  startedPreparingAt: Date|null,
  readyAt: Date|null,
  servedAt: Date|null,
  completedAt: Date|null,
  cancelledAt: Date|null,
  cancelledBy: string|null,
  cancelReason: string|null,
  refundedAmount: int cents|null,
  voidedAt: Date|null,
  voidedBy: string|null,
  voidReason: string|null,
  heldAt: Date|null,
  onHoldReason: string|null,
  -- sync metadata
  idempotencyKey: string,         -- UNIQUE globally
  originatingDeviceId: string|null,
  version: int,
  createdAt, updatedAt
}
Indexes:
  unique { idempotencyKey: 1 }        --- DEFENCE AGAINST DUPLICATE ORDERS
  { branchId: 1, createdAt: -1 }      --- list recent
  { branchId: 1, status: 1, createdAt: -1 }
  { branchId: 1, orderNumber: "text" }
  { tableSessionId: 1 }
  { customerId: 1, createdAt: -1 }
  { employeeId: 1, createdAt: -1 }
```

---

## 18. `payments` (separate collection — 1 order → N payments)

```
{
  id: string PK,
  restaurantId, branchId,
  orderId:    string → orders.id,
  customerId: string|null,
  employeeId: string|null,
  deviceId:   string|null,
  amount:     int cents,
  currency:   string,
  method:     enum PaymentMethod,
  status:     enum PaymentStatus,
  verificationType: enum PaymentVerificationType (LOCAL | PROVIDER | SPLIT)
  -- online payment fields
  providerTransactionId: string|null,
  providerReference: string|null,
  authorizationCode: string|null,
  last4Digits: string|null,
  cardBrand: string|null,
  -- local payment fields
  terminalId: string|null,   --- physical POS terminal id
  receiptNumber: string|null,
  notes: string|null,
  processedAt: Date|null,
  failedAt: Date|null,
  failureReason: string|null,
  refundedAmount: int cents|null,
  refundedAt: Date|null,
  refundReference: string|null,
  -- sync / idempotency
  idempotencyKey: string UNIQUE,
  originatingDeviceId: string|null,
  createdAt, updatedAt
}
Indexes:
  unique { idempotencyKey: 1 }
  { orderId: 1, createdAt: 1 }
  { branchId: 1, method: 1, processedAt: -1 }
  { providerTransactionId: 1 }   --- partial, sparse
```

---

## 19. `kitchenOrders` (many per order — one per item group)

```
{
  id: string PK,
  restaurantId, branchId,
  orderId: string → orders.id,
  orderItemIds: string[],
  stationId: string|null → kitchenDisplayStations.id,
  status: enum KitchenStatus,
  priority: "NORMAL"|"URGENT"|"LATE",
  notes: string|null,
  assignedCookId: string|null → employees.id,
  startedAt: Date|null,
  readyAt: Date|null,
  completedAt: Date|null,
  version: int,
  createdAt, updatedAt
}
Indexes:
  { branchId: 1, status: 1, createdAt: 1 }
  { stationId: 1, status: 1, createdAt: 1 }
  { orderId: 1 }
```

---

## 20. `kitchenDisplayStations`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  categoryIds: string[],
  isActive: bool,
  createdAt, updatedAt
}
```

---

## 21. `inventoryItems`

```
{
  id: string PK,
  restaurantId, branchId,
  sku: string,
  name: string,
  description: string|null,
  category: string|null,
  unit: enum Unit,
  currentStock: number,
  minimumStock: number,
  optimalStock: number|null,
  costPrice: int cents,
  supplierId: string|null → suppliers.id,
  isActive: bool,
  lastRestockedAt: Date|null,
  lastCountedAt: Date|null,
  version: int,
  createdAt, updatedAt
}
Indexes:
  { branchId: 1, isActive: 1, name: 1 }
  { branchId: 1, category: 1 }
  -- low-stock alert
  partial { branchId: 1, currentStock: 1 } where currentStock <= minimumStock
```

---

## 22. `inventoryTransactions` — append only, immutable after 72h

```
{
  id: string PK,
  restaurantId, branchId,
  inventoryItemId: string,
  type: enum InventoryTransactionType,
  quantity: number,   -- positive or negative
  unitCost: int cents|null,
  totalCost: int cents|null,
  referenceId: string|null,   -- orderId, purchaseOrderId, ...
  referenceType: "ORDER"|"PURCHASE"|"WASTAGE"|"ADJUSTMENT"|null,
  notes: string|null,
  employeeId: string|null,
  -- once confirmed, a tx should be immutable
  confirmed: bool,
  confirmedAt: Date|null,
  createdAt, updatedAt
}
Indexes:
  { inventoryItemId: 1, createdAt: -1 }
  { branchId: 1, type: 1, createdAt: -1 }
  { referenceId: 1, referenceType: 1 }
```

---

## 23. `suppliers`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  contactName: string|null,
  phone: string,
  email: string|null,
  address: string|null,
  isActive: bool,
  createdAt, updatedAt
}
```

---

## 24. `purchaseOrders`

```
{
  id: string PK,
  restaurantId, branchId,
  supplierId: string,
  orderNumber: string,
  status: enum PurchaseOrderStatus,
  items: [{
    inventoryItemId: string,
    quantity: number,
    unitCost: int cents,
    receivedQuantity: number,
  }],
  subtotal: int cents,
  taxAmount: int cents,
  totalAmount: int cents,
  expectedDate: Date|null,
  notes: string|null,
  createdBy: string,
  approvedBy: string|null,
  receivedBy: string|null,
  receivedAt: Date|null,
  createdAt, updatedAt
}
```

---

## 25. `customers`

```
{
  id: string PK,
  restaurantId,
  firstName: string|null,
  lastName: string|null,
  email: string|null,
  phone: string|null,
  address: string|null,
  notes: string|null,
  loyaltyAccountId: string|null,
  totalVisits: int,
  totalSpent: int cents,
  lastVisitAt: Date|null,
  createdAt, updatedAt
}
Indexes:
  { restaurantId: 1, phone: 1 }
  { restaurantId: 1, email: 1 }
```

---

## 26. `loyaltyAccounts`

```
{
  id: string PK,
  customerId: string,
  restaurantId: string,
  points: int,
  tier: "BRONZE"|"SILVER"|"GOLD"|"PLATINUM",
  pointsToNextTier: int|null,
  lastPointsEarnedAt: Date|null,
  createdAt, updatedAt
}
```

---

## 27. `shifts` — POS writes; cloud never edits (only reads)

```
{
  id: string PK,
  restaurantId, branchId,
  employeeId: string,
  deviceId:   string,
  status:     enum ShiftStatus (OPEN | CLOSED | MISMATCH)
  openingCash: int cents,
  expectedCash: int cents,   -- computed at close
  actualCash:   int cents,   -- entered by cashier at close
  cashVariance: int cents,   -- actual - expected
  cardSales: int cents,
  transferSales: int cents,
  onlineSales: int cents,
  totalSales: int cents,
  totalRefunds: int cents,
  totalVoids: int cents,
  totalDiscounts: int cents,
  totalTips: int cents,
  cashPaidIn: int cents,
  cashPaidOut: int cents,
  openedAt: Date,
  closedAt: Date|null,
  closedBy: string|null,
  closingNotes: string|null,
  idempotencyKey: string UNIQUE,
  originatingDeviceId: string,
  createdAt, updatedAt
}
Indexes:
  { branchId: 1, employeeId: 1, openedAt: -1 }
  { branchId: 1, status: 1 }
  unique { deviceId: 1, status: 1 } partial: status = 'OPEN'
    -- only one open shift per device
```

---

## 28. `cashAdjustments`

```
{
  id: string PK,
  shiftId: string,
  branchId, restaurantId,
  type: "PAID_IN" | "PAID_OUT",
  amount: int cents,
  reason: string,
  employeeId: string,
  approvedBy: string|null,
  createdAt: Date
}
Index: { shiftId: 1, createdAt: 1 }
```

---

## 29. `auditLogs` — append only

```
{
  id: string PK,
  restaurantId, branchId,
  entityType: string,       -- "ORDER","PAYMENT","SHIFT","MENU_ITEM", ...
  entityId: string|null,
  action: enum AuditAction,
  performedBy: string → employees.id or users.id
  performedByRole: enum Role,
  deviceId: string|null,
  timestamp: Date,
  ipAddress: string|null,
  changes: [ { field, oldValue, newValue } ] | null,
  metadata: {} | null,
}
Indexes:
  { branchId: 1, timestamp: -1 }
  { performedBy: 1, timestamp: -1 }
  { entityType: 1, entityId: 1 }
  TTL: expireAfterSeconds = 220752000 (7 years) — optional, per compliance
```

---

## 30. `syncRecords`

```
{
  id: string PK,
  deviceId: string,
  entityType: enum SyncEntityType,
  entityId: string,            -- local or cloud id
  externalEntityId: string|null, -- the matching id on the other side
  direction: enum SyncDirection,
  status: enum SyncRecordStatus,
  attemptCount: int,
  lastAttemptAt: Date|null,
  completedAt: Date|null,
  conflictResolution: "LOCAL_WINS"|"CLOUD_WINS"|"MANUAL"|"MERGED"|null,
  errorMessage: string|null,
  idempotencyKey: string UNIQUE,
  createdAt, updatedAt
}
Indexes:
  { deviceId: 1, status: 1 }
  { entityType: 1, entityId: 1 }
```

---

## 31. `promotions`

```
{
  id: string PK,
  restaurantId, branchId,
  name: string,
  type: "BANNER"|"CUSTOMER_DISPLAY"|"QR_SPLASH",
  content: string (markdown/plain) | null,
  imageUrl: string|null,
  linkUrl: string|null,
  isActive: bool,
  validFrom: Date|null,
  validUntil: Date|null,
  priority: int,
  createdAt, updatedAt
}
```

---

## 32. `refreshTokens` (dedicated collection for revocation)

Not in the original list but **required** for JWT refresh-flow security.

```
{
  id: string PK,
  userId: string,
  employeeId: string|null,
  tokenHash: string UNIQUE,  -- SHA256 of the refresh token
  family: string,            -- rotation family id (see 05-api)
  expiresAt: Date,
  revoked: bool,
  revokedAt: Date|null,
  createdAt: Date
}
Indexes:
  { userId: 1, revoked: 1, createdAt: -1 }
  TTL expireAfterSeconds=0 on expiresAt   --- automatic purge
```
