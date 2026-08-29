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
const POLL_INTERVAL_MS = 1500;
const CLAIM_TIMEOUT_MS = 60_000;

type GetAuthFn = () => { accessToken?: string; deviceId?: string; branchId?: string };

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

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycleInProgress = false;
  private immediateRequested = false;

  onBatchSuccess?: () => void;

  constructor(
    repos: ReposBundle,
    db: PosDatabase | undefined,
    httpClient: SyncHttpClient,
    deviceId: string,
    getAuthFn: GetAuthFn,
    onChangeStatus?: (s: ConnectionStatus) => void,
    onConflict?: (cmd: SyncCommand, result: SyncCommandResult) => void
  ) {
    this.repos = repos;
    this.db = db;
    this.httpClient = httpClient;
    this.deviceId = deviceId;
    this.getAuthFn = getAuthFn;
    this.onChangeStatus = onChangeStatus;
    this.onConflict = onConflict;
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
    };
  }

  private queueHasWork(): boolean {
    const counts = this.repos.syncQueue.getCounts();
    return (
      counts.QUEUED > 0 ||
      counts.RETRYING > 0 ||
      counts.PROCESSING > 0 ||
      counts.FAILED > 0
    );
  }

  private async cycle(): Promise<void> {
    if (!this.running) return;
    if (this.cycleInProgress) return;
    this.cycleInProgress = true;
    try {
      this.resetStaleClaims();

      if (!this.queueHasWork() && !this.immediateRequested) {
        return;
      }
      this.immediateRequested = false;

      this.setStatus('SYNCHRONIZING');

      const claimedRows = this.repos.syncQueue.claimBatch(BATCH_SIZE, this.deviceId);
      if (claimedRows.length === 0) {
        this.setStatus('ONLINE');
        return;
      }

      const commands: SyncCommand[] = [];
      const rowByOpId = new Map<string, { row: SyncQueueRow; cmd: SyncCommand }>();
      for (const row of claimedRows) {
        const cmd = this.rowToCommand(row);
        if (!cmd) continue;
        commands.push(cmd);
        rowByOpId.set(cmd.opId, { row, cmd });
      }

      if (commands.length === 0) {
        this.setStatus('ONLINE');
        return;
      }

      try {
        const batchResult = await this.httpClient.postBatch(commands);
        await this.processResults(commands, batchResult.results, rowByOpId);
      } catch (err) {
        const processingIds = claimedRows.map((r) => r.id).filter(Boolean) as number[];
        this.resetProcessingToQueued(processingIds);
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

    for (const result of results) {
      const entry = rowByOpId.get(result.opId);
      if (!entry) continue;
      const { row, cmd } = entry;

      switch (result.status) {
        case 'SUCCESS':
        case 'IDEMPOTENT_HIT': {
          this.repos.syncQueue.markDone(cmd.opId);
          this.repos.syncRecords.insert({
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
          this.markSourceEntitySynced(
            cmd.entityType,
            cmd.entityId,
            result.serverEntityVersion
          );
          successCount++;
          break;
        }
        case 'CONFLICT': {
          const resolution: SyncConflictResolution =
            result.conflictResolution ?? 'MANUAL';
          const currentAttempts = row.attempts;
          const canRetry = resolution !== 'MANUAL' && currentAttempts < MAX_ATTEMPTS;
          const nextAttemptAt = canRetry
            ? Date.now() + calculateExponentialBackoff(currentAttempts + 1)
            : null;
          this.repos.syncQueue.markFailed(
            cmd.opId,
            result.errorMessage ?? 'CONFLICT',
            nextAttemptAt
          );
          this.repos.syncRecords.insert({
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
          const canRetry = currentAttempts < MAX_ATTEMPTS;
          const nextAttemptAt = canRetry
            ? Date.now() + calculateExponentialBackoff(currentAttempts + 1)
            : null;
          this.repos.syncQueue.markFailed(
            cmd.opId,
            result.errorMessage ?? 'FAILED',
            nextAttemptAt
          );
          this.repos.syncRecords.insert({
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
