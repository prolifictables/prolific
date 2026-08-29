import type { ConnectionEventsRepository } from '../db/repositories/sync-audit-meta.repository';
import type { ConnectionStatus } from './types';
import type { SyncHttpClient } from './client-http';

const HEALTH_PING_INTERVAL_MS = 10_000;

export type StatusChangeEmitter = (
  payload: {
    status: ConnectionStatus;
    lastOnlineAt: number | null;
    lastOfflineAt: number | null;
    consecutiveErrors: number;
    reason?: string;
  }
) => void;

export class ConnectionMonitor {
  status: ConnectionStatus = 'ONLINE';
  lastOnlineAt: number | null = null;
  lastOfflineAt: number | null = null;
  consecutiveErrors = 0;
  lastSuccessfulAt: number | null = null;

  private readonly connectionEvents: ConnectionEventsRepository;
  private readonly deviceId: string;
  private readonly httpClient: SyncHttpClient;
  private readonly emitStatusChange?: StatusChangeEmitter;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private previousStatus: ConnectionStatus = 'ONLINE';

  constructor(
    connectionEvents: ConnectionEventsRepository,
    deviceId: string,
    httpClient: SyncHttpClient,
    emitStatusChange?: StatusChangeEmitter
  ) {
    this.connectionEvents = connectionEvents;
    this.deviceId = deviceId;
    this.httpClient = httpClient;
    this.emitStatusChange = emitStatusChange;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.pingHealth();
    }, HEALTH_PING_INTERVAL_MS);
    void this.pingHealth();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setStatus(status: ConnectionStatus, reason?: string): void {
    if (status === this.status && !reason) return;
    const fromStatus = this.previousStatus;
    const toStatus = status;
    this.previousStatus = this.status;
    this.status = status;

    if (status === 'ONLINE' || status === 'SYNCHRONIZING') {
      this.lastOnlineAt = Date.now();
      this.consecutiveErrors = 0;
      if (status === 'ONLINE') {
        this.lastSuccessfulAt = Date.now();
      }
    } else if (status === 'OFFLINE') {
      this.lastOfflineAt = Date.now();
      this.consecutiveErrors++;
    } else if (status === 'SYNC_ERROR') {
      this.consecutiveErrors++;
    }

    try {
      this.connectionEvents.insert({
        device_id: this.deviceId,
        status,
        from_status: fromStatus,
        to_status: toStatus,
        reason: reason ?? null,
      });
    } catch {
    }

    this.emitStatusChange?.({
      status: this.status,
      lastOnlineAt: this.lastOnlineAt,
      lastOfflineAt: this.lastOfflineAt,
      consecutiveErrors: this.consecutiveErrors,
      reason,
    });
  }

  markSyncSuccess(): void {
    this.lastSuccessfulAt = Date.now();
    if (this.status === 'SYNC_ERROR' || this.status === 'OFFLINE') {
      this.setStatus('ONLINE', 'sync-success');
    }
  }

  private async pingHealth(): Promise<void> {
    if (!this.running) return;
    try {
      const ok = await this.httpClient.pingHealth();
      if (ok) {
        if (this.status === 'OFFLINE') {
          this.setStatus('ONLINE', 'health-ping-ok');
        }
        this.consecutiveErrors = 0;
        this.lastOnlineAt = Date.now();
      } else {
        this.consecutiveErrors++;
        if (this.status === 'ONLINE' || this.status === 'SYNCHRONIZING') {
          this.setStatus('OFFLINE', 'health-ping-failed');
        }
      }
    } catch {
      this.consecutiveErrors++;
      if (this.status === 'ONLINE' || this.status === 'SYNCHRONIZING') {
        this.setStatus('OFFLINE', 'health-ping-exception');
      }
      this.lastOfflineAt = Date.now();
    }
  }
}
