import type { PosDatabase } from '../database';
import type {
  SyncQueueRow,
  SyncRecordRow,
  AuditLogRow,
  ConnectionEventRow,
  LoyaltyAccountRow,
  PromotionRow,
  LastAuthPayload,
} from '../types';

export class SyncQueueRepository {
  constructor(private db: PosDatabase) {}

  push(row: Partial<SyncQueueRow> & { op_id: string }): number {
    const now = Date.now();
    // Pre-check: if the same op_id already exists in sync_queue, treat the
    // push as idempotent and return the existing row's INTEGER id instead of
    // throwing. Why: migrations v24 L634 declares op_id TEXT UNIQUE. The
    // PaymentModal handler always pushes `op_id: order_${orderId}`. If this
    // handler runs twice (StrictMode double-invoke, user double-click on
    // confirm button, restarted POS while the offline queue still holds the
    // row as QUEUED), the plain INSERT throws SQLITE_CONSTRAINT_UNIQUE →
    // PaymentModal's catch block fires the generic toast "Payment not
    // recorded. Try again." even though the order + payments rows were
    // already persisted successfully.
    const exists = this.db.get<{ id: number }>(
      'SELECT id FROM sync_queue WHERE op_id = ? LIMIT 1',
      row.op_id
    );
    if (exists && typeof exists.id === 'number') return exists.id;
    const result = this.db.run(
      `INSERT OR IGNORE INTO sync_queue (
        op_id, entity_type, operation, entity_id, payload, idempotency_key,
        local_entity_version, status, attempts, error_message, next_attempt_at,
        created_at, claimed_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'QUEUED'), COALESCE(?, 0), ?, ?, ?, NULL, NULL)`,
      row.op_id,
      row.entity_type ?? null,
      row.operation ?? null,
      row.entity_id ?? null,
      row.payload ?? null,
      row.idempotency_key ?? null,
      row.local_entity_version ?? 1,
      row.status,
      row.attempts,
      row.error_message ?? null,
      row.next_attempt_at ?? null,
      now
    );
    // Fallthrough: INSERT OR IGNORE inserted 0 rows because op_id arrived
    // after our pre-check SELECT but before the insert (race). Re-read the
    // existing row so we always return a valid integer id regardless.
    if (result && typeof result.lastInsertRowid === 'number' && (result.changes ?? 1) > 0) {
      return result.lastInsertRowid as number;
    }
    const fallback = this.db.get<{ id: number }>(
      'SELECT id FROM sync_queue WHERE op_id = ? LIMIT 1',
      row.op_id
    );
    if (fallback && typeof fallback.id === 'number') return fallback.id;
    return 0;
  }

  peek(status = 'QUEUED', limit = 10): SyncQueueRow[] {
    const now = Date.now();
    if (status === 'QUEUED') {
      return this.db.all<SyncQueueRow>(
        `SELECT * FROM sync_queue
         WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY COALESCE(next_attempt_at, created_at) ASC
         LIMIT ?`,
        now,
        limit
      );
    }
    return this.db.all<SyncQueueRow>(
      `SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
      status,
      limit
    );
  }

  claimBatch(batchSize: number, deviceId: string): SyncQueueRow[] {
    const now = Date.now();
    const rows = this.db.all<{ id: number }>(
      `SELECT id FROM sync_queue
       WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY COALESCE(next_attempt_at, created_at) ASC
       LIMIT ?`,
      now,
      batchSize
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE sync_queue SET status = 'PROCESSING', claimed_at = ?, attempts = attempts + 1 WHERE id IN (${placeholders})`,
      now,
      ...ids
    );
    void deviceId;
    return this.db.all<SyncQueueRow>(
      `SELECT * FROM sync_queue WHERE id IN (${placeholders})`,
      ...ids
    );
  }

  markDone(opId: string): void {
    this.db.run(
      `UPDATE sync_queue SET status = 'DONE', completed_at = unixepoch('now')*1000 WHERE op_id = ?`,
      opId
    );
  }

  markFailed(opId: string, errorMessage: string, nextAttemptAt: number | null): void {
    this.db.run(
      `UPDATE sync_queue SET
        status = 'RETRYING',
        error_message = ?,
        next_attempt_at = ?,
        claimed_at = NULL
       WHERE op_id = ?`,
      errorMessage,
      nextAttemptAt,
      opId
    );
  }

  getCounts(): {
    QUEUED: number;
    RETRYING: number;
    PROCESSING: number;
    FAILED: number;
    DONE: number;
  } {
    const rows = this.db.all<{ status: string; c: number }>(
      `SELECT status, COUNT(*) c FROM sync_queue GROUP BY status`
    );
    const counts = { QUEUED: 0, RETRYING: 0, PROCESSING: 0, FAILED: 0, DONE: 0 };
    for (const r of rows) {
      const key = r.status as keyof typeof counts;
      if (key in counts) counts[key] = r.c;
    }
    return counts;
  }

  resetByOpId(opId: string): void {
    this.db.run(
      `UPDATE sync_queue SET
        status = 'QUEUED',
        attempts = 0,
        error_message = NULL,
        next_attempt_at = NULL,
        claimed_at = NULL,
        completed_at = NULL
       WHERE op_id = ?`,
      opId
    );
  }
}

export class SyncRecordsRepository {
  constructor(private db: PosDatabase) {}

  find(deviceId: string, idempotencyKey: string): SyncRecordRow | undefined {
    return this.db.get<SyncRecordRow>(
      'SELECT * FROM sync_records WHERE device_id = ? AND idempotency_key = ?',
      deviceId,
      idempotencyKey
    );
  }

  insert(record: Partial<SyncRecordRow> & { device_id: string; idempotency_key: string }): number {
    const now = Date.now();
    const result = this.db.run(
      `INSERT INTO sync_records (
        device_id, idempotency_key, entity_type, operation, entity_id, status,
        conflict_resolution, attempt_count, response_snapshot, applied_at,
        last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.device_id,
      record.idempotency_key,
      record.entity_type ?? null,
      record.operation ?? null,
      record.entity_id ?? null,
      record.status ?? null,
      record.conflict_resolution ?? null,
      record.attempt_count ?? 1,
      record.response_snapshot ?? null,
      record.applied_at ?? now,
      record.last_error ?? null,
      record.created_at ?? now,
      record.updated_at ?? now
    );
    return result.lastInsertRowid as number;
  }

  markStatus(
    recordId: number,
    status: string,
    responseSnapshot: string | null = null,
    lastError: string | null = null
  ): void {
    this.db.run(
      `UPDATE sync_records SET
        status = ?,
        response_snapshot = COALESCE(?, response_snapshot),
        last_error = ?,
        updated_at = unixepoch('now')*1000
       WHERE id = ?`,
      status,
      responseSnapshot,
      lastError,
      recordId
    );
  }

  listByEntity(entityType: string, entityId: string, limit = 50): SyncRecordRow[] {
    return this.db.all<SyncRecordRow>(
      'SELECT * FROM sync_records WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?',
      entityType,
      entityId,
      limit
    );
  }
}

export class AuditLogsRepository {
  constructor(private db: PosDatabase) {}

  list(
    branchId: string,
    filters: { from?: number; to?: number; limit?: number; cursor?: number } = {}
  ): AuditLogRow[] {
    const clauses: string[] = ['branch_id = ?'];
    const params: unknown[] = [branchId];
    if (filters.from) {
      clauses.push('created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push('created_at <= ?');
      params.push(filters.to);
    }
    if (filters.cursor) {
      clauses.push('id < ?');
      params.push(filters.cursor);
    }
    const limit = filters.limit ?? 100;
    return this.db.all<AuditLogRow>(
      `SELECT * FROM audit_logs WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      ...params,
      limit
    );
  }

  insert(row: Partial<AuditLogRow>): number {
    const result = this.db.run(
      `INSERT INTO audit_logs (
        restaurant_id, branch_id, entity_type, entity_id, action, actor_id,
        actor_role, ip_address, device_id, changes_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch('now')*1000)`,
      row.restaurant_id ?? null,
      row.branch_id ?? null,
      row.entity_type ?? null,
      row.entity_id ?? null,
      row.action ?? null,
      row.actor_id ?? null,
      row.actor_role ?? null,
      row.ip_address ?? null,
      row.device_id ?? null,
      row.changes_json ?? null,
      row.metadata_json ?? null
    );
    return result.lastInsertRowid as number;
  }
}

export class ConnectionEventsRepository {
  constructor(private db: PosDatabase) {}

  insert(row: Partial<ConnectionEventRow> & { device_id: string }): number {
    const result = this.db.run(
      `INSERT INTO connection_events (
        device_id, status, from_status, to_status, reason, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, unixepoch('now')*1000)`,
      row.device_id,
      row.status ?? null,
      row.from_status ?? null,
      row.to_status ?? null,
      row.reason ?? null,
      row.ip_address ?? null
    );
    return result.lastInsertRowid as number;
  }

  listByDevice(deviceId: string, limit = 100): ConnectionEventRow[] {
    return this.db.all<ConnectionEventRow>(
      'SELECT * FROM connection_events WHERE device_id = ? ORDER BY id DESC LIMIT ?',
      deviceId,
      limit
    );
  }
}

export class MetaRepository {
  constructor(private db: PosDatabase) {}

  getSyncCursor(entityType: string): string | null {
    const raw = this.db.getMetaValue('sync_cursors');
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw) as Record<string, string>;
      return obj[entityType] ?? null;
    } catch {
      return null;
    }
  }

  setSyncCursor(entityType: string, cursor: string): void {
    const raw = this.db.getMetaValue('sync_cursors');
    let obj: Record<string, string> = {};
    if (raw) {
      try {
        obj = JSON.parse(raw) as Record<string, string>;
      } catch {
        obj = {};
      }
    }
    obj[entityType] = cursor;
    this.db.setMetaValue('sync_cursors', JSON.stringify(obj));
  }

  getLastAuth(): LastAuthPayload | null {
    const raw = this.db.getMetaValue('last_auth');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LastAuthPayload;
    } catch {
      return null;
    }
  }

  setLastAuth(auth: LastAuthPayload | null): void {
    this.db.setMetaValue('last_auth', auth ? JSON.stringify(auth) : null);
  }
}

export class LoyaltyAccountsRepository {
  constructor(private db: PosDatabase) {}

  upsertMany(rows: Partial<LoyaltyAccountRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO loyalty_accounts (
        id, restaurant_id, customer_id, points, tier, joined_at,
        last_activity_at, created_at, updated_at
      ) VALUES (
        @id, @restaurant_id, @customer_id, COALESCE(@points, 0), @tier,
        @joined_at, @last_activity_at,
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        restaurant_id = excluded.restaurant_id,
        customer_id = excluded.customer_id,
        points = excluded.points,
        tier = excluded.tier,
        joined_at = excluded.joined_at,
        last_activity_at = excluded.last_activity_at,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }

  findByCustomer(restaurantId: string, customerId: string): LoyaltyAccountRow | undefined {
    return this.db.get<LoyaltyAccountRow>(
      'SELECT * FROM loyalty_accounts WHERE restaurant_id = ? AND customer_id = ?',
      restaurantId,
      customerId
    );
  }
}

export class PromotionsRepository {
  constructor(private db: PosDatabase) {}

  listActive(branchId: string, at = Date.now()): PromotionRow[] {
    return this.db.all<PromotionRow>(
      `SELECT * FROM promotions
       WHERE branch_id = ? AND is_active = 1
         AND (start_at IS NULL OR start_at <= ?)
         AND (end_at IS NULL OR end_at >= ?)
       ORDER BY name ASC`,
      branchId,
      at,
      at
    );
  }

  upsertMany(rows: Partial<PromotionRow>[]): void {
    if (rows.length === 0) return;
    const stmt = this.db['prepare'](`
      INSERT INTO promotions (
        id, branch_id, name, description, type, discount_id, min_order_cents,
        start_at, end_at, uses_per_customer, is_active, created_at, updated_at
      ) VALUES (
        @id, @branch_id, @name, @description, @type, @discount_id,
        @min_order_cents, @start_at, @end_at,
        COALESCE(@uses_per_customer, 1), COALESCE(@is_active, 1),
        COALESCE(@created_at, unixepoch('now')*1000),
        COALESCE(@updated_at, unixepoch('now')*1000)
      )
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        name = excluded.name,
        description = excluded.description,
        type = excluded.type,
        discount_id = excluded.discount_id,
        min_order_cents = excluded.min_order_cents,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        uses_per_customer = excluded.uses_per_customer,
        is_active = excluded.is_active,
        updated_at = unixepoch('now')*1000
    `);
    this.db.transaction(() => {
      for (const row of rows) stmt.run(row);
    })();
  }
}
