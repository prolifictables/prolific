/**
 * Authenticated admin-level menu client for the POS terminal.
 *
 * This client is used by the Manager Tools tab in CashierScreenLayout. It calls
 * the same /menu/* endpoints used by the Admin portal so edits made from the POS
 * terminal by a logged-in MANAGER / SUPER_ADMIN are:
 *   (a) committed to Mongo DB → Admin portal reads same source (cross-surface tally:
 *       POS + Admin + Website all see the same data within their refresh cycle.
 *   (b) audited via the server's @Audit() decorator.
 *
 * Unlike the public menu client (remote-menu.ts) this client requires a valid JWT
 * accessToken obtained during PIN login because it performs writes.
 *
 * Offline editing note (v1):
 *   Because menu writes CREATE/PATCH/DELETE create new Mongo ObjectIds in the
 *   server, edits offline require complex conflict resolution. For the v1
 *   professional implementation we DISABLE save buttons when the connection
 *   status is not 'ONLINE' and throw a clear error. A future v2 can integrate
 *   with the existing sync queue for deferred push + merge.
 *
 * Token management (v2 — fixes "Invalid or expired token" on Manager tab):
 *   Cashier flow logs in via PIN → POS navigates immediately to /pos via offline
 *   verify (< 50ms) → access token may NOT be set yet if Render was cold or the
 *   background warm never completed. Manager tab's API calls therefore need a
 *   transparent refresh layer:
 *     1. If the caller provides a custom `reauth` callback (set by CashierScreen)
 *        and we hit HTTP 401 → callback runs to refresh credentials → the EXACT
 *        same fetch is retried exactly ONCE with the new token.
 *     2. If the refresh callback is not provided, 401s fall through to the
 *        normal error throw so old callers behave identically.
 */
import type { MenuCategory, MenuItem, MenuModifier } from '@prolific/shared-types';
import { resolveApiBase, guardedFetch, SERVER_UNREACHABLE_MARKER } from './remote-auth';

const API_BASE = resolveApiBase();

export type ApiListResult<T> = { data: T[] } | T[];

/**
 * Optional callback used by `call<T>` to refresh credentials on 401.
 * Returns a FRESH access token string (never the stale input). If the callback
 * throws, the original 401 response error is re-thrown to the caller.
 */
export type ReauthCallback = (
  failedAccessToken: string,
  lastError: string | Error | unknown
) => Promise<string>;

// Unwrap either { data: [...] } or plain [...] responses consistently.
function unwrapList<T>(raw: unknown): T[] {
  const arr = Array.isArray(raw)
    ? (raw as T[])
    : raw && typeof raw === 'object' && Array.isArray((raw as any).data)
      ? ((raw as any).data as T[])
      : [];
  // Every returned doc might be a raw Mongoose document that serializes with
  // `_id` but NOT the virtual `id`. Normalize so all consumers (ManagerTools
  // editors, CategoryRail, write-through snapshots, MenuGrid equality checks)
  // can rely on `id` being a consistent string and never hunt for `_id` fallback
  // or compare ObjectId instance === string equality incorrectly.
  return arr.map((doc) => normalizeDocIds(doc as any)) as T[];
}

// Single-doc normalization (used for create/update/delete returns).
function unwrapSingle<T>(raw: any): T {
  const doc = raw && raw.data !== undefined ? raw.data : raw;
  return normalizeDocIds(doc) as T;
}

// Normalize Mongoose-style identifiers:
//   - ensure `id` is a string (use _id if id missing)
//   - ensure all foreign ID fields (categoryId, branchId, restaurantId,
//     modifierIds[], taxIds[], recipeId, menuItemId etc.) are plain strings
//     (never a leftover ObjectId from a lean() call or a mismatched serialize)
//   - strip the raw _id field so there's no ambiguity after this point
function normalizeDocIds<T extends Record<string, any>>(doc: T | null | undefined): T {
  if (!doc || typeof doc !== 'object') return doc as unknown as T;
  const cloned: Record<string, any> = Array.isArray(doc) ? [...doc] : { ...doc };
  const rawId = cloned.id ?? cloned._id;
  cloned.id = rawId == null ? undefined : String(rawId);
  delete cloned._id;
  for (const key of Object.keys(cloned)) {
    const v = cloned[key];
    if (v == null) continue;
    if (key.endsWith('Id') && typeof v !== 'string') cloned[key] = String(v);
    if (Array.isArray(v) && (key === 'modifierIds' || key === 'taxIds' || key === 'options')) {
      cloned[key] = v.map((x: any) => {
        if (x && typeof x === 'object' && (x.id || x._id)) {
          const n = { ...x };
          const oid = n.id ?? n._id;
          if (oid != null) n.id = String(oid);
          delete n._id;
          return n;
        }
        return typeof x !== 'string' ? String(x) : x;
      });
    }
  }
  return cloned as T;
}

async function callOnce<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<{ res: Response; json: any }> {
  const url = `${API_BASE}${path}`;
  const fetchInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  };
  if (body !== undefined) {
    fetchInit.body = JSON.stringify(body);
  }
  const res = await guardedFetch(() => fetch(url, fetchInit), 'reactive', {
    timeoutMs: opts?.timeoutMs ?? 30_000,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // empty body — no problem (e.g. DELETE 204/200 with no payload)
  }
  return { res, json };
}

async function call<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number; reauth?: ReauthCallback },
): Promise<T> {
  let token = accessToken;
  let result = await callOnce<T>(token, method, path, body, opts);
  let threw401: Error | null = null;
  if (!result.res.ok && result.res.status === 401 && opts?.reauth) {
    const msg =
      (result.json && (result.json.error?.message || result.json.message || JSON.stringify(result.json.error))) ||
      `HTTP ${result.res.status}`;
    threw401 = new Error(msg);
    try {
      // Caller-provided refresh (normally auth-store.refreshAccessToken()).
      // Returns the new token string; we retry the EXACT same request once.
      token = await opts.reauth(token, threw401);
      result = await callOnce<T>(token, method, path, body, opts);
      threw401 = null;
    } catch (refreshErr) {
      // Refresh failed → fall through to the original 401 error so the user
      // sees the server-provided message (e.g. "Invalid or expired token")
      // rather than a refresh-internal message.
      console.warn('[admin-menu] 401 refresh attempt failed', refreshErr);
    }
  }
  const { res, json } = result;
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || JSON.stringify(json.error))) ||
      `HTTP ${res.status}`;
    if (res.status >= 500) {
      throw new Error(`${SERVER_UNREACHABLE_MARKER}: ${msg}`);
    }
    // If a 401 path just went through a failed refresh, throw the server's
    // error but prepend context so CashierScreen can render a better message
    // than the generic "Invalid or expired token".
    if (threw401) throw threw401;
    throw new Error(msg);
  }
  // Some endpoints return { data: <doc } envelope, others return the doc raw.
  // Normalize IDs for all single-doc responses uniformly.
  return unwrapSingle<T>(json);
}

// ============================ Categories =============================================

export interface AdminCategoryInput {
  name: string;
  description?: string;
  sortOrder?: number;
  imageUrl?: string;
  isActive?: boolean;
}

export async function listAdminCategories(accessToken: string, opts?: { reauth?: ReauthCallback; timeoutMs?: number }): Promise<MenuCategory[]> {
  const raw = await call<ApiListResult<MenuCategory>>(accessToken, 'GET', '/menu/categories', undefined, opts);
  return unwrapList<MenuCategory>(raw);
}

export async function createAdminCategory(
  accessToken: string,
  input: AdminCategoryInput,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'POST', '/menu/categories', input, opts);
}

export async function updateAdminCategory(
  accessToken: string,
  categoryId: string,
  patch: Partial<AdminCategoryInput>,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'PATCH', `/menu/categories/${encodeURIComponent(categoryId)}`, patch, opts);
}

export async function deleteAdminCategory(
  accessToken: string,
  categoryId: string,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'DELETE', `/menu/categories/${encodeURIComponent(categoryId)}`, undefined, opts);
}

// ============================ Menu Items =======================================

export interface AdminMenuItemInput {
  categoryId: string;
  name: string;
  description?: string;
  /** Price in minor units (e.g. NGN kobo) matching internal `price` field; same as
   *  Admin portal CreateMenuItemInput.price). */
  price: number;
  imageUrl?: string;
  status?: 'AVAILABLE' | 'OUT_OF_STOCK' | 'SCHEDULED' | 'DISABLED';
  sortOrder?: number;
  isTaxable?: boolean;
  taxIds?: string[];
  modifierIds?: string[];
  scheduledAvailability?: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
}

export interface ListAdminItemsFilters {
  status?: string;
  categoryId?: string;
  /** Omit cursor for default (server returns first page up to limit 100 for manager speed). */
  limit?: number;
}

export async function listAdminMenuItems(
  accessToken: string,
  filters: ListAdminItemsFilters = {},
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuItem[]> {
  const qp = new URLSearchParams();
  if (filters.status) qp.set('status', filters.status);
  if (filters.categoryId) qp.set('categoryId', filters.categoryId);
  qp.set('limit', String(filters.limit ?? 200));
  const raw = await call<ApiListResult<MenuItem>>(
    accessToken,
    'GET',
    `/menu/items${qp.toString() ? `?${qp.toString()}` : ''}`,
    undefined,
    opts,
  );
  return unwrapList<MenuItem>(raw);
}

export async function createAdminMenuItem(
  accessToken: string,
  input: AdminMenuItemInput,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'POST', '/menu/items', input, opts);
}

export async function updateAdminMenuItem(
  accessToken: string,
  itemId: string,
  patch: Partial<AdminMenuItemInput>,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'PATCH', `/menu/items/${encodeURIComponent(itemId)}`, patch, opts);
}

export async function deleteAdminMenuItem(
  accessToken: string,
  itemId: string,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'DELETE', `/menu/items/${encodeURIComponent(itemId)}`, undefined, opts);
}

// ============================ Modifiers ========================================

export interface AdminModifierOptionInput {
  id?: string;
  name: string;
  /** Option price delta in minor units — matches server CreateModifierInput.options[].priceDelta. */
  priceDelta: number;
  isDefault?: boolean;
}

export interface AdminModifierInput {
  name: string;
  description?: string;
  required: boolean;
  multiSelect: boolean;
  minSelections?: number;
  maxSelections?: number;
  options: AdminModifierOptionInput[];
}

export async function listAdminModifiers(accessToken: string, opts?: { reauth?: ReauthCallback; timeoutMs?: number }): Promise<MenuModifier[]> {
  const raw = await call<ApiListResult<MenuModifier>>(accessToken, 'GET', '/menu/modifiers', undefined, opts);
  return unwrapList<MenuModifier>(raw);
}

export async function createAdminModifier(
  accessToken: string,
  input: AdminModifierInput,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'POST', '/menu/modifiers', input, opts);
}

export async function updateAdminModifier(
  accessToken: string,
  modifierId: string,
  patch: Partial<AdminModifierInput>,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'PATCH', `/menu/modifiers/${encodeURIComponent(modifierId)}`, patch, opts);
}

export async function deleteAdminModifier(
  accessToken: string,
  modifierId: string,
  opts?: { reauth?: ReauthCallback; timeoutMs?: number },
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'DELETE', `/menu/modifiers/${encodeURIComponent(modifierId)}`, undefined, opts);
}

export const REMOTE_MENU_ADMIN_API_BASE = API_BASE;
