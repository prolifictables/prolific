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
  private readonly getAuth: () => { accessToken?: string; deviceId?: string; branchId?: string; restaurantId?: string };
  private readonly phpStaging: boolean;

  constructor(
    apiBase: string,
    getAuth: () => { accessToken?: string; deviceId?: string; branchId?: string; restaurantId?: string },
    phpStaging = false
  ) {
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.getAuth = getAuth;
    this.phpStaging = phpStaging;
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
    if (this.phpStaging) {
      const auth = this.getAuth();
      if (!auth.accessToken || !auth.deviceId || !auth.branchId || !auth.restaurantId) throw new ApiError('Server authentication and terminal scope are required', 401);
      const shifts = commands.filter(c => c.entityType === 'SHIFT');
      if (shifts.length) {
        const results: SyncBatchResult['results'] = [];
        for (const cmd of shifts) {
          const opening = cmd.operation === 'CREATE';
          const p = cmd.payload || {};
          if (p.deviceId && p.deviceId !== auth.deviceId) {
            results.push({ opId: cmd.opId, status: 'FAILED', errorMessage: 'Shift device differs from the authenticated terminal.' });
            continue;
          }
          if (!opening && !p.serverShiftId) {
            results.push({ opId: cmd.opId, status: 'CONFLICT', errorMessage: 'Shift OPEN must sync before CLOSE.' });
            continue;
          }
          try {
            const response = await this.request<any>(`${this.apiBase}/shifts/${opening ? 'open' : `${encodeURIComponent(p.serverShiftId)}/close`}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
              body: JSON.stringify({ idempotencyKey: cmd.idempotencyKey, restaurantId: auth.restaurantId, branchId: auth.branchId,
                ...(opening ? { deviceId: auth.deviceId, openingCash: p.openingCash ?? p.openingCashCents } : { closingCash: p.closingCash ?? p.closingCashCents }) }),
            });
            const shift = response?.data?.shift;
            if (!shift?._id && !shift?.id) throw new NetworkError('Missing shift response; retry with the same key');
            results.push({ opId: cmd.opId, status: 'SUCCESS', responseSnapshot: shift });
          } catch (err) {
            results.push({ opId: cmd.opId, status: err instanceof NetworkError ? 'RETRYING' : 'FAILED', errorMessage: err instanceof Error ? err.message : 'Shift sync failed' });
          }
        }
        const rest = commands.filter(c => c.entityType !== 'SHIFT');
        if (rest.length) results.push(...(await this.postBatch(rest)).results);
        return { results };
      }
      const unsupported = commands.filter(c => c.entityType === 'ORDER' && c.operation === 'CREATE' && c.payload?.items?.some((i: any) => i.modifierOptions?.length));
      if (unsupported.length) {
        const results: SyncBatchResult['results'] = unsupported.map(c => ({ opId: c.opId, status: 'CONFLICT', errorMessage: 'PHP does not support modifier pricing. Review this queued sale.' }));
        const rest = commands.filter(c => !unsupported.includes(c));
        if (rest.length) results.push(...(await this.postBatch(rest)).results);
        return { results };
      }
    }
    const idemKey = this.phpStaging ? undefined : this.buildIdempotencyKey(commands);
    // The JWT-guarded endpoint (`/sync/batch`) is the primary destination —
    // works great once a POS user has authenticated via pin (accessToken set).
    // When there is no valid JWT (401/403 from server), fall back to the same
    // PUBLIC endpoint the browser POS uses (`/public/pos-sync-batch`) which
    // accepts ORDER / PAYMENT CREATE operations without authentication. This
    // ensures POS sales are never silently dropped on first-day deployments
    // where the cashier hasn't yet completed a full JWT pin-login cycle.
    const primaryUrl = `${this.apiBase}/sync/batch`;
    const fallbackUrl = `${this.apiBase}/public/pos-sync-batch`;
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
      ...(this.phpStaging && c.clientTimestamp ? { clientTimestamp: c.clientTimestamp } : {}),
    }));

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(idemKey ? { 'X-Idempotency-Key': idemKey } : {}),
    };
    const authHeaders = this.authHeaders();
    const body = JSON.stringify({
      deviceId,
      ...(this.phpStaging ? { restaurantId: auth.restaurantId, branchId: auth.branchId } : {}),
      commands: serverCommands,
    });

    const parseResponse = (resp: unknown): SyncBatchResult => {
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
                : this.phpStaging && statusRaw === 'RETRYING'
                  ? 'RETRYING'
                : 'FAILED';
          return {
            opId,
            status,
            resultCode: this.phpStaging ? String(r.resultCode || '') : undefined,
            retryAfterMs: this.phpStaging && Number.isFinite(Number(r.retryAfterMs)) ? Number(r.retryAfterMs) : undefined,
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
    };

    // (1) Try JWT-guarded /sync/batch first.
    try {
      const resp = await this.request<{ data?: any[]; results?: any[] }>(primaryUrl, {
        method: 'POST',
        headers: { ...baseHeaders, ...authHeaders },
        body,
        timeoutMs: this.phpStaging ? 120_000 : DEFAULT_TIMEOUT_MS,
      });
      return parseResponse(resp);
    } catch (primaryErr) {
      const needsFallback =
        primaryErr instanceof ApiError &&
        (primaryErr.statusCode === 401 || primaryErr.statusCode === 403);
      if (!needsFallback || this.phpStaging) throw primaryErr;

      // (2) Auth failed / no JWT present → retry against the public endpoint
      // without the Authorization header. This mirrors the browser POS path.
      const resp = await this.request<{ data?: any[]; results?: any[] }>(fallbackUrl, {
        method: 'POST',
        headers: baseHeaders,
        body,
      });
      return parseResponse(resp);
    }
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
