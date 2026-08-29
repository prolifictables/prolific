import type { IpcMain } from 'electron';
import type { PosDatabase } from '../db/database';
import type { ReposBundle } from '../db';
import type {
  ConnectionStatus,
  SyncEntityType,
} from './types';
import { SyncHttpClient } from './client-http';
import { QueueReader } from './command-queue-reader';
import { PullWorker } from './cloud-pull-worker';
import { ConnectionMonitor } from './connection-monitor';

export * from './types';
export { SyncHttpClient, NetworkError, ApiError } from './client-http';
export { calculateExponentialBackoff, retryableStatusCodes, isRetryableStatusCode } from './retry';
export { QueueReader } from './command-queue-reader';
export { PullWorker } from './cloud-pull-worker';
export { ConnectionMonitor } from './connection-monitor';

type GetAuthFn = () => {
  accessToken?: string;
  deviceId?: string;
  branchId?: string;
  restaurantId?: string;
};

type BroadcastFn = (channel: string, payload: unknown) => void;

export interface SyncEngineStatus {
  status: ConnectionStatus;
  pendingCount: number;
  lastSuccessfulAt: number | null;
  failedCount: number;
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
  consecutiveErrors: number;
  syncCursorsPreview: Partial<Record<SyncEntityType, string>>;
}

export interface SyncEngineOptions {
  repos: ReposBundle;
  db?: PosDatabase;
  httpBaseUrl: string;
  getAuthFn: GetAuthFn;
  ipcMain: IpcMain;
  onStatusChange?: (status: ConnectionStatus) => void;
  deviceId: string;
  broadcastToRenderers?: BroadcastFn;
}

export class SyncEngine {
  private readonly repos: ReposBundle;
  private readonly db?: PosDatabase;
  private readonly httpClient: SyncHttpClient;
  private readonly deviceId: string;
  private readonly getAuthFn: GetAuthFn;
  private readonly onStatusChange?: (status: ConnectionStatus) => void;
  private readonly broadcastToRenderers?: BroadcastFn;
  private readonly ipcMain: IpcMain;

  private readonly monitor: ConnectionMonitor;
  private readonly queueReader: QueueReader;
  private readonly pullWorker: PullWorker;

  private started = false;
  private ipcRegistered = false;

  constructor(options: SyncEngineOptions) {
    this.repos = options.repos;
    this.db = options.db;
    this.deviceId = options.deviceId;
    this.getAuthFn = options.getAuthFn;
    this.onStatusChange = options.onStatusChange;
    this.broadcastToRenderers = options.broadcastToRenderers;
    this.ipcMain = options.ipcMain;

    this.httpClient = new SyncHttpClient(options.httpBaseUrl, () => {
      const auth = this.getAuthFn();
      return {
        accessToken: auth.accessToken,
        deviceId: auth.deviceId ?? this.deviceId,
      };
    });

    this.monitor = new ConnectionMonitor(
      this.repos.connectionEvents,
      this.deviceId,
      this.httpClient,
      (payload) => {
        this.broadcastToRenderers?.('sync:status-changed', payload);
        this.onStatusChange?.(payload.status);
      }
    );

    this.queueReader = new QueueReader(
      this.repos,
      this.db,
      this.httpClient,
      this.deviceId,
      this.getAuthFn,
      (s) => this.handleReaderStatusChange(s),
      (cmd, result) => {
        this.broadcastToRenderers?.('sync:conflict', { cmd, result });
      }
    );

    this.queueReader.onBatchSuccess = () => {
      this.monitor.markSyncSuccess();
      this.pullWorker.requestNow();
    };

    this.pullWorker = new PullWorker(
      this.repos,
      this.db,
      this.httpClient,
      this.getAuthFn,
      (s) => this.handleReaderStatusChange(s)
    );
  }

  private handleReaderStatusChange(status: ConnectionStatus): void {
    if (status === 'OFFLINE') {
      this.monitor.setStatus('OFFLINE');
    } else if (status === 'SYNC_ERROR') {
      this.monitor.setStatus('SYNC_ERROR');
    } else if (status === 'SYNCHRONIZING') {
      if (this.monitor.status !== 'OFFLINE' && this.monitor.status !== 'SYNC_ERROR') {
        this.monitor.setStatus('SYNCHRONIZING');
      }
    } else if (status === 'ONLINE') {
      if (this.monitor.status === 'SYNCHRONIZING') {
        this.monitor.setStatus('ONLINE');
      }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.registerIpc();
    this.monitor.start();
    this.queueReader.start();
    this.pullWorker.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.queueReader.stop();
    this.pullWorker.stop();
    this.monitor.stop();
  }

  async syncNow(): Promise<void> {
    await Promise.all([
      this.queueReader.requestNow(),
      Promise.resolve(this.pullWorker.requestNow()),
    ]);
  }

  requestNow(): Promise<void> {
    return this.syncNow();
  }

  getStatus(): SyncEngineStatus {
    const counts = this.repos.syncQueue.getCounts();
    const pendingCount = counts.QUEUED + counts.RETRYING + counts.PROCESSING;
    const failedCount = counts.FAILED;
    const rawCursors = (() => {
      const raw = this.db?.getMetaValue('sync_cursors');
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    })();
    const entityTypes: SyncEntityType[] = [
      'MENU_CATEGORY', 'MENU_ITEM', 'MENU_MODIFIER', 'TAX', 'DISCOUNT', 'TABLE',
      'CUSTOMER', 'ORDER', 'ORDER_ITEM', 'ORDER_ITEM_MODIFIER_OPTION',
      'PAYMENT', 'SHIFT', 'CASH_ADJUSTMENT', 'KITCHEN_ORDER', 'KITCHEN_ORDER_ITEM',
      'INVENTORY_ITEM', 'INVENTORY_TRANSACTION', 'RECIPE', 'RECIPE_INGREDIENT',
      'SETTING', 'EMPLOYEE', 'QR_CODE',
    ];
    const syncCursorsPreview: Partial<Record<SyncEntityType, string>> = {};
    for (const et of entityTypes) {
      const c = rawCursors[et];
      if (c) syncCursorsPreview[et] = c.length > 32 ? c.slice(0, 32) + '…' : c;
    }
    return {
      status: this.monitor.status,
      pendingCount,
      lastSuccessfulAt: this.monitor.lastSuccessfulAt,
      failedCount,
      lastOnlineAt: this.monitor.lastOnlineAt,
      lastOfflineAt: this.monitor.lastOfflineAt,
      consecutiveErrors: this.monitor.consecutiveErrors,
      syncCursorsPreview,
    };
  }

  private registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    this.ipcMain.handle('sync:request-now', async () => {
      try {
        await this.syncNow();
        return { requested: true, at: Date.now(), status: this.getStatus() };
      } catch (err) {
        return {
          requested: false,
          at: Date.now(),
          error: (err as Error).message,
          status: this.getStatus(),
        };
      }
    });

    this.ipcMain.handle('sync:get-connection-status', () => {
      return this.getStatus();
    });
  }

  registerIpcHandlers(): void {
    this.registerIpc();
  }
}
