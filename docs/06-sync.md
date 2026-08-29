# Offline Synchronization Engine Strategy

## 1. Principles

The sync engine is a **durable, retryable, ordered** pipe between each POS
device's SQLite DB and the MongoDB cloud. It lives **100% inside the
Electron main process**. The renderer only reads the connection status
badge + a pending count.

**Non-negotiable rules:**

1. **No lost writes.** A locally-created order is never lost, even if the
   device hard-crashes mid-sync. The SQLite commit of the business row
   and the enqueue of the sync row happen in one DB transaction.
2. **No duplicate writes.** Every sync operation carries an
   `idempotencyKey` that the server stores in a unique-indexed column.
   Replays of the same key return the saved response without touching
   data again.
3. **POS is authoritative for operational data.** Orders, payments,
   shifts, inventory transactions created on the POS win any conflict
   with the cloud (see §3). The cloud is authoritative for reference
   data (menu, employees, tables, settings, taxes, discounts, modifiers).
4. **Bounded retries with backoff.** A failing operation retries 5
   times with exponential backoff (5 s → 10 s → 20 s → 40 s → 80 s),
   then is marked `FAILED` with the last error. Failed operations are
   retried on every network reconnect + every 10 min by a sweeper, and
   stay visible in the manager UI forever until manually dismissed or
   retried.
5. **Operator-visible status at all times.** The POS header shows a
   4-state pill: `ONLINE | OFFLINE | SYNCHRONIZING | SYNC ERROR` with
   hover-text showing pending count + the last error if any. The tray
   menu shows the same.

---

## 2. Architecture

```
┌─ Electron Main ───────────────────────────────────────────────────────┐
│                                                                       │
│  ┌─────────────────────── SyncEngine ──────────────────────────────┐  │
│  │                                                                 │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │  │
│  │  │ QueueReader  │───►│ HTTP Batch   │───►│ ConflictResolver │   │  │
│  │  │ (SQLite)     │    │ Uploader     │    │ & Upserter       │   │  │
│  │  └──────────────┘    └──────────────┘    └────────┬─────────┘   │  │
│  │                                                    │             │  │
│  │  ┌──────────────┐    ┌──────────────┐              │             │  │
│  │  │ PullWorker   │───►│ Entity Upser │◄─────────────┘             │  │
│  │  │ (pull cursor)│    │ into SQLite  │                            │  │
│  │  └──────────────┘    └──────────────┘                            │  │
│  │                                                                   │  │
│  │  ┌──────────────┐    ┌──────────────┐                            │  │
│  │  │ Sweeper      │    │ StatusEmitter│─── IPC → Renderer pill     │  │
│  │  │ (retry FAILED│    │ + Socket.IO  │─── Socket.io → server      │  │
│  │  │  + CONFLICT) │    │              │                            │  │
│  │  └──────────────┘    └──────────────┘                            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────── SQLite ─────────────────────────────────────────┐   │
│  │ orders, payments, shifts, … + sync_queue + sync_records +     │   │
│  │ connection_events                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
                                    │
                            HTTPS / WSS (online only)
                                    ▼
                ┌─ NestJS /sync/batch + /sync/pull ──────┐
                │  SyncController                        │
                │  ├── IdempotencyGuard (unique idx)     │
                │  ├── PermissionGuard                   │
                │  ├── EntityWriters → MongoDB           │
                │  └── ConflictDetector (version check)  │
                └────────────────────────────────────────┘
```

### 2.1 Writers

When a feature inside Electron main commits a business row (e.g., the
cashier "completes payment"), the same `BEGIN IMMEDIATE` transaction
also:

1. Inserts/updates the business row (order, payment, shift, …).
2. Increments the row's `local_version`.
3. **Upserts** a row into `sync_queue` with status `PENDING` for that
   entity + direction `LOCAL_TO_CLOUD`. If a row already exists with
   status ≠ COMPLETED, we just update its payload and bump
   `next_retry_at = now` so the QueueReader picks it up immediately.
4. Appends a row to `sync_records` with the `idempotencyKey`.

This means **there is no race** between commit and enqueue. If step 3
fails, step 1 is rolled back.

### 2.2 QueueReader (local upload)

A singleton worker runs as a setInterval loop (1 s tick, 0 work if
`connectionStatus = OFFLINE`).

Pseudo:
```ts
while (true) {
  const batch = db.prepare(`
    SELECT * FROM sync_queue
    WHERE status IN ('PENDING','FAILED','CONFLICT')
      AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY created_at ASC
    LIMIT 25
  `).all(nowISO());
  if (batch.length === 0) { sleep(1s); continue; }

  mark batch.status = 'IN_PROGRESS' in same tx.
  emit connectionStatus = SYNCHRONIZING.

  try {
    const responses = await api.post('/sync/batch', batch).perItem;
    for (const item of batch) {
      applyResponse(item, responses[item.id]);
    }
  } catch (networkErr) {
    // mark entire batch back to PENDING, bump attempts,
    // set next_retry_at per-item. do not mark failed;
    // network errors are transient.
    batch.forEach((item, i) => retry(item, i, 'network ' + networkErr));
  }
}
```

### 2.3 applyResponse per item

| Server response                | Locally                                                              |
|--------------------------------|----------------------------------------------------------------------|
| 200 + `status=COMPLETED` + `cloudVersion` | `sync_queue.status=COMPLETED`. Mark business row `sync_status=SYNCED, cloud_version=v`. Append `sync_records` COMPLETED row.
| 409 + `status=CONFLICT`        | `sync_queue.status=CONFLICT`, store server payload. **Do not overwrite local business data.** Raise a manager-notification toast. Manager resolves from "sync conflicts" screen.
| 422 + `status=SKIPPED`         | `sync_queue.status=SKIPPED` (business rule — e.g., void on already-voided). Log and hide from pending.
| 5xx / 401-refresh-fail         | Retry per exponential backoff. `attempts++; status = FAILED` when attempts ≥ 5.

### 2.4 PullWorker (cloud → local)

Runs on a slower cadence (every 15 s when ONLINE, plus once
immediately when connection goes ONLINE, plus whenever a Socket.IO
`menu:item:*` event arrives we schedule an immediate MENU pull).

Pull is per-entity cursor-based to stay bounded in memory. Pseudo:

```ts
for (const entity of PULL_ENTITIES) {
  while (true) {
    const res = await api.post('/sync/pull', {
      cursors: { [entity]: meta['last_sync_cursor_' + entity] },
      includeEntities: [entity],
    });
    const rows = res.entities[entity];
    if (rows.length === 0) break;

    tx_begin();
    for (const row of rows) upsertEntityLocal(entity, row);
    meta['last_sync_cursor_' + entity] = nextCursor;
    tx_commit();

    if (!res.hasMore) break;
  }
}
```

`upsertEntityLocal` per entity type:

| Entity                    | Strategy                                                                                        |
|---------------------------|-------------------------------------------------------------------------------------------------|
| menu_categories/items/…   | cloud_version > local_cloud_version → overwrite. Else NOOP.                                     |
| menu_items.status (OOS)   | POS can also set OOS locally. Conflict rule: if POS marked OOS after server's lastUpdatedAt → POS wins (POS cashier knows the kitchen is out). Else server wins.
| employees / tables / settings | cloud is authoritative — always overwrite when version advances.                                |
| orders                    | SKIP any order we originated (originating_device_id = thisDevice.id). For orders originated elsewhere, only overwrite if status has advanced and no local edit happened. On any ambiguity → conflict row + manager UI.
| payments                  | Same as orders. For a locally-recorded CASH payment we ignore all cloud updates — cash recorded locally is truth.

### 2.5 Idempotency key (how the server de-duplicates)

Each `sync_queue` row has an `idempotencyKey = sha256(entityType + ':' +
entityLocalId + ':' + local_version + ':' + deviceId)`.

On the server, a single MongoDB collection `syncRecords` has:
```
  unique index on (deviceId, idempotencyKey)
```

When a `/sync/batch` item comes in, the server first does a findOne by
`(deviceId, idempotencyKey)`. If found, it returns the **saved** result
as if the mutation ran again, without touching business collections. If
not found, it runs the actual write, then inserts a row into
`syncRecords` atomically, so that a retry on the same key returns the
same saved result.

This is the **only** mechanism that guarantees no duplicate orders are
created during synchronization. Not optimistic locking, not timestamps
— a unique index on an application-controlled key.

---

## 3. Conflict detection & resolution

Conflicts arise only on bidirectional entities. The detector runs on
the server inside /sync/batch:

```
IF cloud_row IS NOT NULL:
  IF (row.cloud_version IS NULL) → first sync of existing row → MERGE by field rules.
  IF (row.cloud_version == cloud_row.version) → no conflict. Advance version.
  IF (row.cloud_version < cloud_row.version) → server saw writes we missed → CONFLICT.
```

### 3.1 Field-level merge for ORDER

When a cloud and local version both exist, we merge by field:

| Field                    | Wins                              | Reason                                      |
|--------------------------|-----------------------------------|---------------------------------------------|
| status                   | later timestamp, but NEVER revert a terminal status (COMPLETED/VOIDED/REFUNDED/CANCELLED never go backwards) |
| paymentStatus            | server if provider payment came in; local if local cash recorded |
| paidAmount / balanceDue  | sum of both sides' payments       | server reconciles payments collection |
| items                    | union by item.id; each item's kitchenStatus = max(local,server) by lifecycle order |
| kitchenStatus per item   | max by lifecycle order (NEW < PREPARING < READY < COMPLETED)     |
| voidedAt, refundedAmount | immutable once set                |

If the resulting merge produces a state the server considers invalid
(e.g., status = CANCELLED but payments exist), the item is marked
`CONFLICT` and escalated.

### 3.2 Manager conflict UI

Shown in Admin → Devices → Sync Conflicts and in POS → hamburger →
Sync → Conflicts (PIN required). Each row displays:

- Entity type + id
- Local fields (green diff) vs. Cloud fields (red diff)
- Buttons: `Keep Local`, `Keep Cloud`, `Merge (custom)`
- After picking → immediate retry of the sync_queue row with the chosen
  resolution and a `conflictResolution` field saved on both sides.

---

## 4. Connection status state machine

```
                  start
                    │
                    ▼
               ┌─────────┐              WSS connected & health
               │ OFFLINE │◄──────────────────────────────────────┐
               └────┬────┘                                       │
                    │ 1st WSS + REST health OK                   │
                    ▼                                            │
               ┌─────────┐   any /sync route fails               │
               │ ONLINE  │────────────────────────────────┐     │
               └────┬────┘                                │     │
                    │ batch queue has work → start tick    │     │
                    ▼                                     │     │
            ┌───────────────┐     queue empty (250 ms idle)│     │
            │ SYNCHRONIZING │──────────────────────────────┘     │
            └──────┬────────┘                                    │
                   │ per-item CONFLICT or retries=5 on a row     │
                   ▼                                             │
            ┌───────────────┐    manager resolves last conflict  │
            │  SYNC ERROR   │────────────────────────────────────┘
            └───────────────┘
```

State transitions are emitted over:
- IPC → POS header pill + customer display corner badge.
- Socket.IO room `device:<id>` for manager dashboards.
- Insert into SQLite `connection_events` (last 1000 rows).

### 4.1 Health check

A lightweight GET `/health/device?deviceId=X` runs every 3 s. If 3
consecutive checks miss, or the TCP connection drops, status drops to
OFFLINE and the QueueReader stops.

### 4.2 On reconnect (ONLINE → ONLINE again)

Immediately:
1. Run PullWorker for everything (catch up on menu/orders from other
   devices in the restaurant).
2. QueueReader wakes up and drains the queue FIFO.
3. Push a `sync:status` event to Socket.IO so the rest of the branch
   knows this device is back.

---

## 5. Data-integrity invariants (the 10 commandments)

Write these as DB assertions — run inside every POS startup health
check and daily on the server by a scheduled task:

1. `sum(payments.amount for order) = order.paidAmount + sum(refunds on order)`.
2. `shift.expectedCash = openingCash + sum(CASH payments in shift) − sum(CASH refunds in shift) − cashPaidOut + cashPaidIn`.
3. `shift.status = OPEN ⇒ exactly one open row per deviceId`.
4. `order.idempotencyKey ∩ (order.idempotencyKey)` → unique (server uniq idx).
5. Every `sync_queue` non-COMPLETED row has a matching business row (no orphaned syncs).
6. Every completed payment has a matching inventory transaction per item recipe, unless flagged `inventoryNotDeducted`.
7. `tableSession.balanceDue = sum(orders for session).balanceDue combined per session split rules`.
8. `auditLog` exists for every `void`, `refund`, `price_change`, `cash_payout`, `role_assign`.
9. Local and cloud `order.totalAmount` match once both are synced (COMPLETED status on both sides).
10. No `status = VOIDED | REFUNDED | CANCELLED` order rows have `paidAmount > refundedAmount` with non-zero balance after 1 h of being voided/refunded (cashier must have refunded — check + alert).
