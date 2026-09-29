import type { PosDatabase } from '../db/database';
import type { ReposBundle } from '../db';
import type { SyncQueueRow } from '../db/types';
import type {
  ConnectionStatus,
  SyncCommand,
  SyncCommandResult,
  SyncEntityType,
  SyncConflictResolution,
} from './types';
import { SyncHttpClient, NetworkError, ApiError } from './client-http';
import { calculateExponentialBackoff, isRetryableStatusCode } from './retry';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
// H3 PERF FIX: idle poll interval reduced from 1500ms to 5000ms to reduce
// main-thread pressure from synchronously running resetStaleClaims + claim
// queries every 1.5 seconds. On-demand flushes via requestNow() still fire
// immediately for: (1) OFFLINE→ONLINE reconnects (sync/index.ts status
// callback), (2) user tapping Sync button, (3) after PaymentModal pushes
// ORDER + PAYMENT to the queue. This change only slows the idle "check for
// new work" heartbeat — the critical hot paths still flush instantly.
const POLL_INTERVAL_MS = 5000;
const CLAIM_TIMEOUT_MS = 60_000;

type GetAuthFn = () => { accessToken?: string; deviceId?: string; branchId?: string; restaurantId?: string; employeeId?: string };

export class QueueReader {
  private readonly repos: ReposBundle;
  private readonly db: PosDatabase | undefined;
  private readonly httpClient: SyncHttpClient;
  private readonly deviceId: string;
  private readonly getAuthFn: GetAuthFn;
  private readonly onChangeStatus?: (s: ConnectionStatus) => void;
  private readonly onConflict?: (
    cmd: SyncCommand,
    result: SyncCommandResult
  ) => void;
  private readonly phpStagingSync: boolean;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycleInProgress = false;
  private immediateRequested = false;
  // H6 PERF FIX: rate-limit resetStaleClaims() to at most once every
  // CLAIM_TIMEOUT_MS (60_000). Stale PROCESSING rows only become eligible for
  // reclaim after CLAIM_TIMEOUT_MS anyway; running `db.run(UPDATE...)` more
  // frequently than once per 60s is pure waste and synchronously blocks the
  // main event loop on every idle cycle (causing small but repeated freezes
  // even when the sync queue is empty).
  private _lastResetStaleClaimsAt = 0;

  onBatchSuccess?: () => void;

  constructor(
    repos: ReposBundle,
    db: PosDatabase | undefined,
    httpClient: SyncHttpClient,
    deviceId: string,
    getAuthFn: GetAuthFn,
    onChangeStatus?: (s: ConnectionStatus) => void,
    onConflict?: (cmd: SyncCommand, result: SyncCommandResult) => void,
    phpStagingSync = false
  ) {
    this.repos = repos;
    this.db = db;
    this.httpClient = httpClient;
    this.deviceId = deviceId;
    this.getAuthFn = getAuthFn;
    this.onChangeStatus = onChangeStatus;
    this.onConflict = onConflict;
    this.phpStagingSync = phpStagingSync;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.cycle();
    }, POLL_INTERVAL_MS);
    void this.cycle();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async requestNow(): Promise<void> {
    this.immediateRequested = true;
    await this.cycle();
  }

  private setStatus(s: ConnectionStatus): void {
    this.onChangeStatus?.(s);
  }

  private resetStaleClaims(): void {
    if (!this.db) return;
    const cutoff = Date.now() - CLAIM_TIMEOUT_MS;
    this.db.run(
      `UPDATE sync_queue
       SET status = 'QUEUED',
           claimed_at = NULL,
           attempts = MIN(attempts + 1, ?)
       WHERE status = 'PROCESSING'
         AND claimed_at IS NOT NULL
         AND claimed_at < ?`,
      MAX_ATTEMPTS,
      cutoff
    );
  }

  private resetProcessingToQueued(ids: number[]): void {
    if (ids.length === 0) return;
    if (!this.db) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE sync_queue SET
         status = 'QUEUED',
         claimed_at = NULL,
         next_attempt_at = NULL,
         error_message = NULL
       WHERE id IN (${placeholders})`,
      ...ids
    );
  }

  private permanentlyFail(opId: string, errorMessage: string): void {
    this.db?.run(
      `UPDATE sync_queue SET
         status = 'FAILED',
         error_message = ?,
         claimed_at = NULL,
         next_attempt_at = NULL,
         completed_at = unixepoch('now')*1000
       WHERE op_id = ?`,
      errorMessage,
      opId
    );
  }

  private markSourceEntitySynced(
    entityType: SyncEntityType,
    entityId: string,
    serverEntityVersion?: number
  ): void {
    if (!this.db) return;
    const version = serverEntityVersion ?? 0;
    switch (entityType) {
      case 'ORDER':
        this.db.run(
          `UPDATE orders SET synced = 1, server_version = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
          version,
          entityId
        );
        break;
      case 'PAYMENT':
        this.db.run(
          `UPDATE payments SET synced = 1, server_version = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
          version,
          entityId
        );
        break;
      case 'SHIFT':
        this.db.run(
          `UPDATE shifts SET synced = 1, server_version = ?, updated_at = unixepoch('now')*1000 WHERE id = ?`,
          version,
          entityId
        );
        break;
    }
  }

  private rowToCommand(row: SyncQueueRow): SyncCommand | null {
    let payload: any = null;
    if (row.payload) {
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = row.payload;
      }
    }
    return {
      opId: row.op_id ?? `op_${row.id}`,
      entityType: (row.entity_type as SyncEntityType) ?? 'ORDER',
      operation: (row.operation as SyncCommand['operation']) ?? 'UPSERT',
      entityId: row.entity_id ?? '',
      payload,
      idempotencyKey: row.idempotency_key ?? row.op_id ?? `idem_${row.id}`,
      localEntityVersion: row.local_entity_version ?? 1,
      clientTimestamp: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    };
  }

  private dependencyDone(cmd: SyncCommand): boolean {
    if (!this.phpStagingSync || !this.db) return true;
    const auth = this.getAuthFn();
    const orderId = cmd.entityType === 'ORDER' ? cmd.entityId : cmd.payload?.orderId;
    const local = orderId ? this.db.get<any>('SELECT * FROM orders WHERE id = ?', orderId) : null;
    const scope = local || (cmd.entityType === 'SHIFT' ? this.db.get<any>('SELECT * FROM shifts WHERE id = ?', cmd.entityId) : null);
    if (scope && (scope.branch_id !== auth.branchId || scope.restaurant_id !== auth.restaurantId || (auth.employeeId && scope.employee_id !== auth.employeeId))) return false;
    if (cmd.entityType === 'SHIFT' && cmd.operation === 'CREATE') {
      // A later offline shift cannot open server-side until the earlier one closes.
      const blocked = this.db.get<any>("SELECT id FROM sync_queue WHERE entity_type = 'SHIFT' AND id < (SELECT id FROM sync_queue WHERE op_id = ?) AND status != 'DONE' LIMIT 1", cmd.opId);
      if (blocked) return false;
    }
    if (cmd.entityType === 'SHIFT' && cmd.operation === 'UPDATE') {
      const serverShiftId = this.repos.shifts.getById(cmd.entityId)?.serverShiftId;
      if (!serverShiftId) return false;
      cmd.payload = { ...cmd.payload, serverShiftId };
    }
    let predecessor: string | null = null;
    if (cmd.entityType === 'PAYMENT' && cmd.operation === 'CREATE') {
      predecessor = String(cmd.payload?.orderId || '');
      if (!predecessor) return false;
      const create = this.db.get<{ status: string }>("SELECT status FROM sync_queue WHERE op_id = ?", `order_${predecessor}`);
      if (create?.status !== 'DONE') return false;
      // Only new commands explicitly record this association. Do not reinterpret
      // historical payloads: a previously attempted command has a fixed fingerprint.
      const { localShiftId, ...payload } = cmd.payload;
      if (!localShiftId && !payload.shiftId) {
        const recorded = this.db.get<{ shift_id: string | null }>('SELECT shift_id FROM payments WHERE id = ?', cmd.entityId);
        // Older queued commands did not carry their shift. Hold them for review:
        // changing an already attempted payload would change its replay fingerprint.
        if (recorded?.shift_id) return false;
      }
      if (localShiftId) {
        const shift = this.repos.shifts.getById(String(localShiftId));
        if (!shift?.serverShiftId || shift.device_id !== this.deviceId ||
            shift.restaurant_id !== auth.restaurantId || shift.branch_id !== auth.branchId ||
            shift.employee_id !== auth.employeeId) return false;
        cmd.payload = { ...payload, shiftId: shift.serverShiftId };
      }
      return true;
    }
    if (cmd.entityType === 'ORDER' && cmd.operation === 'UPDATE') {
      if (cmd.payload?.status === 'READY') {
        const payments = this.db.all<{ status: string }>("SELECT status FROM sync_queue WHERE entity_type = 'PAYMENT' AND operation = 'CREATE' AND json_valid(payload) AND json_extract(payload, '$.orderId') = ?", cmd.entityId);
        return payments.length > 0 && payments.every((p) => p.status === 'DONE');
      }
      if (cmd.payload?.status === 'COMPLETED') {
        const ready = this.db.get<{ status: string }>('SELECT status FROM sync_queue WHERE op_id = ?', `phpstg_ready_${cmd.entityId}`);
        return ready?.status === 'DONE';
      }
    }
    return true;
  }

  private queueLocalCompletionAfterPayment(cmd: SyncCommand): void {
    if (!this.phpStagingSync || !this.db || cmd.entityType !== 'PAYMENT' || cmd.operation !== 'CREATE') return;
    const orderId = String(cmd.payload?.orderId || '');
    const local = this.db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', orderId);
    if (local?.status !== 'COMPLETED') return;
    for (const [status, version] of [['READY', 2], ['COMPLETED', 3]] as const) {
      this.repos.syncQueue.push({
        op_id: `phpstg_${status.toLowerCase()}_${orderId}`,
        entity_type: 'ORDER', operation: 'UPDATE', entity_id: orderId,
        payload: JSON.stringify({ status }),
        idempotency_key: `phpstg_${status.toLowerCase()}_${orderId}`,
        local_entity_version: version,
      });
    }
  }

  private queueHasWork(): boolean {
    const counts = this.repos.syncQueue.getCounts();
    return (
      counts.QUEUED > 0 ||
      counts.RETRYING > 0 ||
      counts.PROCESSING > 0
    );
  }

  private async cycle(): Promise<void> {
    if (!this.running) return;
    if (this.cycleInProgress) return;
    this.cycleInProgress = true;
    try {
      // H6 PERF FIX: check for pending work BEFORE any DB mutations. Most
      // idle cycles have an empty queue; we exit immediately here without
      // touching the DB at all (previously resetStaleClaims ran a sync
      // UPDATE every cycle, wasting 1-20 ms on main thread).
      if (this.phpStagingSync && !this.getAuthFn().accessToken) {
        this.setStatus('OFFLINE');
        return; // Keep durable commands untouched until a server-authenticated session exists.
      }
      const hasWork = this.immediateRequested || this.queueHasWork();
      if (!hasWork) {
        // H6 PERF FIX: resetStaleClaims is rate-limited to once per
        // CLAIM_TIMEOUT_MS (60s) even when queue is empty; on-demand flush
        // calls (immediateRequested === true) reset it immediately.
        const now = Date.now();
        if (now - this._lastResetStaleClaimsAt >= CLAIM_TIMEOUT_MS) {
          this.resetStaleClaims();
          this._lastResetStaleClaimsAt = now;
        }
        return;
      }
      // Reset stale claims immediately whenever there IS pending work (so
      // rows stuck in PROCESSING after a previous crash can be reclaimed
      // before this cycle's claimBatch runs).
      this.resetStaleClaims();
      this._lastResetStaleClaimsAt = Date.now();
      this.immediateRequested = false;

      const claimedRows = this.repos.syncQueue.claimBatch(BATCH_SIZE, this.deviceId, this.phpStagingSync);
      if (claimedRows.length === 0) return;

      const commands: SyncCommand[] = [];
      const rowByOpId = new Map<string, { row: SyncQueueRow; cmd: SyncCommand }>();
      for (const row of claimedRows) {
        const cmd = this.rowToCommand(row);
        if (!cmd) continue;
        if (!this.dependencyDone(cmd)) {
          this.db?.run("UPDATE sync_queue SET status = 'QUEUED', claimed_at = NULL, next_attempt_at = ? WHERE id = ?", Date.now() + 1000, row.id);
          continue;
        }
        commands.push(cmd);
        rowByOpId.set(cmd.opId, { row, cmd });
      }

      if (commands.length === 0) return;

      this.setStatus('SYNCHRONIZING');

      try {
        const batchResult = await this.httpClient.postBatch(commands);
        await this.processResults(commands, batchResult.results, rowByOpId);
      } catch (err) {
        const processingIds = [...rowByOpId.values()].map(({ row }) => row.id).filter(Boolean) as number[];
        if (this.phpStagingSync && err instanceof ApiError && [400, 401, 403].includes(err.statusCode)) {
          for (const cmd of commands) this.permanentlyFail(cmd.opId, `HTTP ${err.statusCode}: authentication or request rejected`);
        } else if (this.phpStagingSync) {
          for (const { row, cmd } of rowByOpId.values()) {
            const delay = calculateExponentialBackoff(Math.min(row.attempts, MAX_ATTEMPTS));
            this.repos.syncQueue.markFailed(cmd.opId, 'Temporary network/server failure; retry with the same key', Date.now() + delay);
          }
        } else {
          this.resetProcessingToQueued(processingIds);
        }
        const isNetError =
          err instanceof NetworkError ||
          (err instanceof ApiError && isRetryableStatusCode(err.statusCode));
        if (isNetError) {
          this.setStatus('OFFLINE');
        } else {
          this.setStatus('SYNC_ERROR');
        }
      }
    } finally {
      this.cycleInProgress = false;
    }
  }

  private processResults(
    commands: SyncCommand[],
    results: SyncCommandResult[],
    rowByOpId: Map<string, { row: SyncQueueRow; cmd: SyncCommand }>
  ): void {
    let successCount = 0;
    let nonRetriableFailCount = 0;
    let retriableFailCount = 0;
    const answered = new Set<string>();

    for (const result of results) {
      const entry = rowByOpId.get(result.opId);
      if (!entry) continue;
      answered.add(result.opId);
      const { row, cmd } = entry;

      switch (result.status) {
        case 'SUCCESS':
        case 'IDEMPOTENT_HIT': {
          this.repos.db.transaction(() => {
            this.queueLocalCompletionAfterPayment(cmd);
            if (!this.repos.syncRecords.find(this.deviceId, cmd.idempotencyKey)) this.repos.syncRecords.insert({
              device_id: this.deviceId,
              idempotency_key: cmd.idempotencyKey,
              entity_type: cmd.entityType,
              operation: cmd.operation,
              entity_id: cmd.entityId,
              status: result.status,
              attempt_count: row.attempts,
              response_snapshot: result.responseSnapshot
                ? JSON.stringify(result.responseSnapshot)
                : null,
              applied_at: Date.now(),
            });
            if (!this.phpStagingSync || cmd.entityType !== 'ORDER' || (cmd.operation === 'UPDATE' && cmd.payload?.status === 'COMPLETED')) {
              this.markSourceEntitySynced(cmd.entityType, cmd.entityId, result.serverEntityVersion);
            }
            this.repos.syncQueue.markDone(cmd.opId);
          })();
          successCount++;
          break;
        }
        case 'RETRYING': {
          const delay = Math.max(1000, Math.min(300000, result.retryAfterMs || calculateExponentialBackoff(row.attempts)));
          this.repos.syncQueue.markFailed(cmd.opId, `${result.resultCode || 'RETRY'}: ${result.errorMessage || 'Temporary server failure'}`, Date.now() + delay);
          retriableFailCount++;
          break;
        }
        case 'CONFLICT': {
          const resolution: SyncConflictResolution =
            result.conflictResolution ?? 'MANUAL';
          const currentAttempts = row.attempts;
          const canRetry = !this.phpStagingSync && resolution !== 'MANUAL' && currentAttempts < MAX_ATTEMPTS;
          const nextAttemptAt = canRetry
            ? Date.now() + calculateExponentialBackoff(currentAttempts + 1)
            : null;
          this.repos.syncQueue.markFailed(
            cmd.opId,
            result.errorMessage ?? 'CONFLICT',
            nextAttemptAt
          );
          if (!this.repos.syncRecords.find(this.deviceId, cmd.idempotencyKey)) this.repos.syncRecords.insert({
            device_id: this.deviceId,
            idempotency_key: cmd.idempotencyKey,
            entity_type: cmd.entityType,
            operation: cmd.operation,
            entity_id: cmd.entityId,
            status: 'CONFLICT',
            conflict_resolution: resolution,
            attempt_count: currentAttempts,
            response_snapshot: result.responseSnapshot
              ? JSON.stringify(result.responseSnapshot)
              : null,
            last_error: result.errorMessage ?? null,
          });
          this.onConflict?.(cmd, result);
          if (canRetry) {
            retriableFailCount++;
          } else {
            this.permanentlyFail(cmd.opId, result.errorMessage ?? 'CONFLICT: manual resolution required');
            nonRetriableFailCount++;
          }
          break;
        }
        case 'FAILED': {
          const currentAttempts = row.attempts;
          const canRetry = !this.phpStagingSync && currentAttempts < MAX_ATTEMPTS;
          const nextAttemptAt = canRetry
            ? Date.now() + calculateExponentialBackoff(currentAttempts + 1)
            : null;
          this.repos.syncQueue.markFailed(
            cmd.opId,
            result.errorMessage ?? 'FAILED',
            nextAttemptAt
          );
          if (!this.repos.syncRecords.find(this.deviceId, cmd.idempotencyKey)) this.repos.syncRecords.insert({
            device_id: this.deviceId,
            idempotency_key: cmd.idempotencyKey,
            entity_type: cmd.entityType,
            operation: cmd.operation,
            entity_id: cmd.entityId,
            status: 'FAILED',
            attempt_count: currentAttempts,
            response_snapshot: result.responseSnapshot
              ? JSON.stringify(result.responseSnapshot)
              : null,
            last_error: result.errorMessage ?? null,
          });
          if (canRetry) {
            retriableFailCount++;
          } else {
            this.permanentlyFail(cmd.opId, result.errorMessage ?? `Max attempts (${MAX_ATTEMPTS}) exceeded`);
            nonRetriableFailCount++;
          }
          break;
        }
      }
    }

    if (this.phpStagingSync) {
      for (const cmd of commands) {
        if (answered.has(cmd.opId)) continue;
        const row = rowByOpId.get(cmd.opId)?.row;
        this.repos.syncQueue.markFailed(cmd.opId, 'Missing command result; retry with the same key', Date.now() + calculateExponentialBackoff(row?.attempts || 1));
        retriableFailCount++;
      }
    }

    if (nonRetriableFailCount > 0) {
      this.setStatus('SYNC_ERROR');
    } else if (retriableFailCount > 0) {
      this.setStatus('SYNC_ERROR');
    } else if (successCount === commands.length && successCount > 0) {
      this.setStatus('ONLINE');
      this.onBatchSuccess?.();
    } else {
      this.setStatus('ONLINE');
    }
  }
}
