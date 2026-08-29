import crypto from 'node:crypto';
import type {
  SyncCommand,
  SyncBatchResult,
  SyncEntityType,
  PullParams,
  PullResponse,
} from './types';

export class NetworkError extends Error {
  override name = 'NetworkError';
  readonly statusCode: number;
  constructor(message: string, statusCode = 0) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class ApiError extends Error {
  override name = 'ApiError';
  readonly statusCode: number;
  readonly responseBody?: unknown;
  constructor(message: string, statusCode: number, responseBody?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

export class SyncHttpClient {
  private readonly apiBase: string;
  private readonly getAuth: () => { accessToken?: string; deviceId?: string };

  constructor(
    apiBase: string,
    getAuth: () => { accessToken?: string; deviceId?: string }
  ) {
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.getAuth = getAuth;
  }

  private buildIdempotencyKey(commands: SyncCommand[]): string {
    const sorted = [...commands].sort((a, b) => a.opId.localeCompare(b.opId));
    const stable = JSON.stringify(sorted.map((c) => ({
      opId: c.opId,
      entityType: c.entityType,
      operation: c.operation,
      entityId: c.entityId,
      idempotencyKey: c.idempotencyKey,
      localEntityVersion: c.localEntityVersion,
      payload: c.payload,
    })));
    return crypto.createHash('sha256').update(stable).digest('hex');
  }

  private authHeaders(): HeadersInit {
    const auth = this.getAuth();
    const headers: Record<string, string> = {};
    if (auth.accessToken) {
      headers['Authorization'] = `Bearer ${auth.accessToken}`;
    }
    if (auth.deviceId) {
      headers['X-Device-Id'] = auth.deviceId;
    }
    return headers;
  }

  private async request<T>(
    input: RequestInfo | URL,
    init: RequestInit & { timeoutMs?: number } = {}
  ): Promise<T> {
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const text = await res.text();
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!res.ok) {
        if (res.status === 0 || res.status >= 500 || res.status === 408 || res.status === 429) {
          throw new NetworkError(
            `HTTP ${res.status}: ${res.statusText}`,
            res.status
          );
        }
        throw new ApiError(
          `HTTP ${res.status}: ${res.statusText}`,
          res.status,
          body
        );
      }
      return body as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError || err instanceof NetworkError) {
        throw err;
      }
      const e = err as Error;
      if (
        e.name === 'AbortError' ||
        e.message.includes('timed out') ||
        e.message.includes('Timeout') ||
        e.message.includes('Failed to fetch') ||
        e.message.includes('ENOTFOUND') ||
        e.message.includes('ECONNREFUSED') ||
        e.message.includes('ECONNRESET') ||
        e.message.includes('network')
      ) {
        throw new NetworkError(e.message, 0);
      }
      throw new NetworkError(e.message, 0);
    }
  }

  async postBatch(commands: SyncCommand[]): Promise<SyncBatchResult> {
    const idemKey = this.buildIdempotencyKey(commands);
    const url = `${this.apiBase}/sync/batch`;
    const auth = this.getAuth();
    const deviceId = auth.deviceId;
    if (!deviceId) {
      throw new NetworkError('Missing deviceId', 0);
    }

    const serverCommands = commands.map((c) => ({
      idempotencyKey: c.idempotencyKey,
      entityType: c.entityType,
      operation: c.operation === 'UPSERT' ? 'UPDATE' : c.operation,
      entityId: c.entityId,
      payload: c.payload,
      localEntityVersion: c.localEntityVersion,
    }));

    const resp = await this.request<{ data?: any[]; results?: any[] }>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idemKey,
        ...this.authHeaders(),
      },
      body: JSON.stringify({ deviceId, commands: serverCommands }),
    });

    const data = (resp as any)?.data || (resp as any)?.results || [];
    const opIdByIdem = new Map<string, string>();
    commands.forEach((c) => opIdByIdem.set(c.idempotencyKey, c.opId));

    return {
      results: (Array.isArray(data) ? data : []).map((r: any) => {
        const opId = opIdByIdem.get(String(r.idempotencyKey || '')) || String(r.idempotencyKey || '');
        const statusRaw = String(r.status || '').toUpperCase();
        const status =
          statusRaw === 'SUCCESS'
            ? 'SUCCESS'
            : statusRaw === 'CONFLICT'
              ? 'CONFLICT'
              : 'FAILED';
        return {
          opId,
          status,
          serverEntityVersion: r.serverEntityVersion,
          errorMessage: r.errorMessage,
          responseSnapshot: r.serverSnapshot ?? null,
          conflictResolution:
            r.conflictResolution === 'SERVER_WINS'
              ? 'SERVER_WINS'
              : r.conflictResolution === 'CLIENT_WINS'
                ? 'LOCAL_WINS'
                : 'MANUAL',
        };
      }),
    } as SyncBatchResult;
  }

  async pull(params: PullParams): Promise<PullResponse> {
    const { entityTypes, cursor, limit } = params;
    const url = new URL(`${this.apiBase}/sync/pull`);
    const auth = this.getAuth();
    const deviceId = auth.deviceId;
    if (!deviceId) {
      throw new NetworkError('Missing deviceId', 0);
    }
    url.searchParams.set('deviceId', deviceId);
    url.searchParams.set('entityTypes', entityTypes.join(','));
    if (cursor) url.searchParams.set('cursor', cursor);
    if (limit != null) url.searchParams.set('limit', String(limit));
    const res = await this.request<any>(url.toString(), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    const data = Array.isArray(res?.data) ? res.data : [];
    const mapped = data.map((row: any) => ({
      __op: 'UPSERT',
      __entityType: String(row.entityType || row.__entityType || '').toUpperCase(),
      id: String(row.entity?.id || row.entity?._id || row.entityId || ''),
      ...(row.entity || {}),
    })).filter((r: any) => r.__entityType && r.id);

    return {
      data: mapped,
      meta: {
        cursor: res?.nextCursor ?? undefined,
        hasMore: Boolean(res?.hasMore),
      },
    };
  }

  async pingHealth(): Promise<boolean> {
    try {
      await this.request<{ ok?: boolean }>(`${this.apiBase}/health`, {
        method: 'HEAD',
        timeoutMs: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }
}
