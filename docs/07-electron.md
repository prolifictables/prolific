# Electron Two-Monitor Architecture

## 1. Windows layout

A single Electron app instance creates **two BrowserWindows**:

| Window              | Display    | Role            | DevTools? | Menu |
|---------------------|------------|-----------------|-----------|------|
| **Cashier POS**     | `primary`  | Order entry     | 🟢 DEV   | Full |
| **Customer Display**| `external` | Customer facing | 🔴 PROD  | None |

If there is only one display available, we still create the customer
window as a floating, always-on-top, frameless panel positioned in the
corner (configurable via admin). The cashier can minimize/dismiss it
until a second monitor is attached.

## 2. Process topology

```
                ┌─ Electron MAIN ──────────────────────────────────────┐
                │                                                     │
                │  main.ts (entry)                                    │
                │  ├── app.whenReady()                                │
                │  │     ├─ detectMonitors()                          │
                │  │     ├─ createSecuritySession()                  │
                │  │     ├─ startSQLite()                            │
                │  │     ├─ startSyncEngine()                        │
                │  │     ├─ startPrintManager()                      │
                │  │     ├─ startSocketManager()                     │
                │  │     ├─ openCashierWindow(primaryDisplay)        │
                │  │     └─ openCustomerWindow(externalDisplay?)     │
                │  │                                                   │
                │  ├── ipc-main.ts (channel whitelist)                │
                │  ├── print-manager.ts                               │
                │  ├── window-manager.ts                              │
                │  └── screen-observer.ts (display plug/unplug)      │
                └────────────────────┬────────────────────────────────┘
                                     │ IPC (contextBridge)
              ┌──────────────────────┴──────────────────────┐
              ▼                                             ▼
┌─ Cashier Renderer (React, Vite HMR) ───┐  ┌─ Customer Renderer (React) ───────┐
│                                          │  │                                      │
│  routes:                                 │  │  pages:                              │
│    /login                                │  │    /idle       (promo/branding)     │
│    /pos/cart                             │  │    /active     (order in progress)  │
│    /pos/orders                           │  │    /paid       (thank-you screen)   │
│    /pos/history                          │  │                                      │
│    /tables                               │  │  state:                             │
│    /customers                            │  │    zustand: useCustomerDisplayStore │
│    /shifts                               │  │    subscribed to IPC broadcasts      │
│    /kitchen-tickets                      │  │                                      │
│                                          │  │  NEVER:                              │
│  state:                                  │  │    - no node integration            │
│    zustand stores                        │  │    - no IPC write channels          │
│      useAuthStore (from main via IPC)    │  │    - only READ-ONLY broadcast data  │
│      useCartStore                        │  │                                      │
│      useMenuStore (prefetched SQLite)    │  │                                      │
│      useOrdersStore                      │  │                                      │
│      useShiftsStore                      │  │                                      │
│                                          │  │                                      │
└──────────────────────────────────────────┘  └──────────────────────────────────────┘
```

## 3. Security — non-negotiable

Both BrowserWindows are created with:

```ts
{
  webPreferences: {
    contextIsolation:         true,
    nodeIntegration:          false,
    sandbox:                  true,
    nodeIntegrationInWorker: false,
    webSecurity:              true,
    allowRunningInsecureContent: false,
    experimentalFeatures:     false,
    enableRemoteModule:       false,
    preload:                  path.join(__dirname, 'preload.js'),
  },
  autoHideMenuBar: true,
}
```

Only the main process loads `better-sqlite3`, `electron-store`,
socket.io client, receipt printing libraries, and any node APIs.
Renderer windows can only call methods exposed through the preload
`contextBridge.exposeInMainWorld('posAPI', { … })` whitelist.

### 3.1 Preload whitelist

```ts
// apps/pos/electron/preload.ts
contextBridge.exposeInMainWorld('posAPI', {
  // AUTH
  login:            (email, pw, branchId)  => ipcRenderer.invoke('auth:login', …),
  pinVerify:        (pin, action, ctx)     => ipcRenderer.invoke('auth:pin', …),
  getConnectionState: ()                   => ipcRenderer.invoke('connection:get'),

  // READS
  menu: {
    listCategories:   ()                 => invoke('menu:categories:list'),
    listItems:        (filters?)         => invoke('menu:items:list', filters),
    search:           (query)            => invoke('menu:items:search', query),
  },
  orders: {
    list:             (filters?)         => invoke('orders:list', filters),
    get:              (id)               => invoke('orders:get', id),
    create:           (draft, idemKey)   => invoke('orders:create', {…}),
    update:           (id, patch)        => invoke('orders:update', …),
    setStatus:        (id, status)       => invoke('orders:status', …),
    hold:             (id, reason?)      => invoke('orders:hold', …),
    unhold:           (id)               => invoke('orders:unhold', …),
    void:             (id, approvalJWT)  => invoke('orders:void', …),
  },
  cart: {
    addItem:          (…)                => invoke('cart:add'),
    removeItem:       (…)                => invoke('cart:remove'),
    setQuantity:      (…)                => invoke('cart:qty'),
    applyDiscount:    (id, approval?)    => invoke('cart:discount'),
    computeTotals:    ()                 => invoke('cart:totals'),
  },
  tables: { list: () => invoke('tables:list'), … },
  shifts: { open: (cash) => …, close:(actual,notes) => …, current: () => … },
  payments: {
    record: (orderId, method, amount, idemKey, opts) => invoke('payments:record', …),
  },
  print: {
    receipt:          (orderId, opts?)   => invoke('print:receipt'),
    kitchenTicket:    (orderId)          => invoke('print:kitchen'),
    testPage:         ()                 => invoke('print:test'),
    listPrinters:     ()                 => invoke('print:list'),
  },

  // Event subscriptions — renderer subscribes, main pushes
  on:               (channel, handler)   => on(channel, handler),
  off:              (channel, handler)   => off(channel, handler),
});
```

Every `invoke` handler in main performs:
1. Permission check against the current role (stored in main, not in renderer).
2. Input validation via Zod schemas from `@prolific/validation`.
3. A DB transaction.
4. A sync-queue enqueue (if the entity is syncable).
5. A broadcast to all subscriber renderers (cashier + customer).
6. Return of the new state.

### 3.2 Customer-display preload — even stricter

```ts
contextBridge.exposeInMainWorld('customerAPI', {
  getInitialState:  () => invoke('customer:getState'),
  onActiveOrder:    (handler) => on('customer:order', handler),
  onPromoContent:   (handler) => on('customer:promo', handler),
  onConnection:     (handler) => on('connection:changed', handler),
});
// NO WRITE CHANNELS.
```

The customer display renderer is **100% read-only**. A compromised
customer display can never submit orders or move money because no
mutating IPC channel is exposed on that window's preload.

## 4. Display detection & window placement

```ts
// apps/pos/electron/screen-observer.ts
export function detectMonitors() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const external = all.find(d => d.id !== primary.id &&
                            d.bounds.x !== primary.bounds.x || d.bounds.y !== primary.bounds.y);
  return { primary, external, count: all.length };
}
```

### 4.1 Boot sequence

```
app.whenReady()
  │
  ├── detectMonitors()
  │     └─ save result in AppState.monitors
  │
  ├── openCashierWindow(primary)
  │     { bounds: primary.workArea, fullscreen: true, kiosk: PROD }
  │
  └── if external exists:
        openCustomerWindow(external)
          { bounds: external.workArea,
            fullscreen: true,
            frame: false,
            alwaysOnTop: true,
            focusable: false }   -- cannot accidentally steal focus from cashier
      else:
        openCustomerWindow(primary, mode='floating-corner')
          { x: right-520, y: top+80, w: 500, h: 400,
            frame: false, alwaysOnTop: true, resizable: false }
```

### 4.2 Hotplug

`squareelectron.screen.on('display-added' | 'display-removed', …)`
re-evaluates window positions. A prompt is shown only on the cashier
window: "New monitor detected — move customer display to it?" with
`[Yes] [Later]`.

## 5. Renderer-to-renderer communication

**Rule:** renderer processes NEVER talk directly to each other. All
cross-window messages flow through the main process via a typed
`broadcast()` helper:

```ts
export function broadcast(channel: BroadcastChannel, payload: unknown) {
  for (const win of [cashierWin, customerWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
```

Broadcast channels:

| Channel                       | Payload shape                 | Triggered by                      |
|-------------------------------|-------------------------------|-----------------------------------|
| `customer:order:new`          | Order (sanitized, no internal fields) | Cashier pressed "Send to Display" or order.idle time > 0 |
| `customer:order:updated`      | Order                         | Any order edit                    |
| `customer:order:paid`         | { orderId, total, receiptNo, thankYouMsg } | Successful payment   |
| `customer:return:idle`        | { reason, promoContentId? }   | 20s after thank-you, or void/cancel |
| `pos:cart:updated`            | Cart totals snapshot          | Cashier cart change               |
| `connection:changed`          | SyncStatusPayload             | SyncEngine state transitions      |
| `shift:changed`               | Shift \| null                 | Open/close shift                  |

### 5.1 Customer display page state machine (in renderer)

```
               ┌──────────────────┐
               │      IDLE        │   show promo carousel, restaurant branding
               │  (promo loop)    │   + clock + wifi status + queue length
               └────────┬─────────┘
                        │ on `customer:order:new`
                        ▼
               ┌──────────────────┐
               │      ACTIVE      │   render Order view:
               │   (live order)   │   items, qty, price, subtotal,
               └────────┬─────────┘   discount, tax, total, paymentStatus
                        │
          ┌─────────────┼──────────────────┐
          │             │                  │
          ▼             ▼                  ▼
 on:paid    on:void/cancel     on:20s no updates
          ┌──────────┐   ┌──────────┐     ┌────────┐
          │  PAID    │   │ VOIDED   │────►│  IDLE  │
          │ thank-you│   │ + reason │     └────────┘
          │ screen   │   └──────────┘           ▲
          └────┬─────┘                            │
               │ show for 5 seconds then ─────────┘
               ▼
           back to IDLE
```

## 6. Receipt printing

Runs in main process only. Uses a Node.js ESC/POS driver
(`node-thermal-printer` + `usb` detection for USB printers, and a
network-tcp path for LAN printers). Admin UI configures per-branch
printer list (saved in BranchSettings → synced to POS).

```
Cashier: "Pay (Cash)"
  ├── main.payments.record()  → commit + sync enqueue
  ├── print.queueReceipt()    → ESC/POS bytes → printer
  ├── broadcast('customer:order:paid', …)
  └── if order.source=DINE_IN: print.queueKitchenTicket() for each station
```

When a printer is offline, main queues receipts in SQLite `print_jobs`
(another durable queue) and retries with a 2s tick. Failed print jobs
are visible in POS → Settings → Print Queue for retry/manual print.

## 7. Data for offline customer display

Because the customer display is a React page loaded from the same
renderer bundle, it reads broadcast data only. When the POS is offline:

- The customer display still receives `customer:order:*` events from
  the main process (they go via local IPC, not over the network).
- Promo content is cached in a `promo_assets` table in SQLite (images
  saved as BLOBs or file paths to `userData/promo/`) so the idle
  screen is pretty even without internet.

## 8. Auto-update & kiosk hardening (prod)

For production deploy (Electron Builder / NSIS):

- Cashier window runs in `kiosk: true`. `F11`/ESC only work with a
  manager PIN challenge (caught via `before-quit` + global shortcut).
- Auto-update uses `electron-updater`, but **never downloads or applies
  an update during an open shift** — checks run, but install is
  deferred until "No active shift" + manager approval.
- USB storage is restricted via OS-level policy (not Electron). The
  app never accesses arbitrary file paths — only `userData` + the
  configured backup path.
- Daily local SQLite backup to `userData/backups/YYYY-MM-DD.db.gz`,
  retention 30 days, triggered by a scheduler on shift close.
