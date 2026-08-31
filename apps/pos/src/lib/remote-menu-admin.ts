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
 */
import type { MenuCategory, MenuItem, MenuModifier } from '@prolific/shared-types';
import { resolveApiBase, guardedFetch, SERVER_UNREACHABLE_MARKER } from './remote-auth';

const API_BASE = resolveApiBase();

export type ApiListResult<T> = { data: T[] } | T[];

// Unwrap either { data: [...] } or plain [...] responses consistently.
function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).data)) {
    return (raw as any).data as T[];
  }
  return [];
}

async function call<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<T> {
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
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || JSON.stringify(json.error))) ||
      `HTTP ${res.status}`;
    if (res.status >= 500) {
      throw new Error(`${SERVER_UNREACHABLE_MARKER}: ${msg}`);
    }
    throw new Error(msg);
  }
  // Some endpoints return { data: <doc } envelope, others return the doc raw.
  return (json && json.data !== undefined ? json.data : json) as T;
}

// ============================ Categories =============================================

export interface AdminCategoryInput {
  name: string;
  description?: string;
  sortOrder?: number;
  imageUrl?: string;
  isActive?: boolean;
}

export async function listAdminCategories(accessToken: string): Promise<MenuCategory[]> {
  const raw = await call<ApiListResult<MenuCategory>>(accessToken, 'GET', '/menu/categories');
  return unwrapList<MenuCategory>(raw);
}

export async function createAdminCategory(
  accessToken: string,
  input: AdminCategoryInput,
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'POST', '/menu/categories', input);
}

export async function updateAdminCategory(
  accessToken: string,
  categoryId: string,
  patch: Partial<AdminCategoryInput>,
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'PATCH', `/menu/categories/${encodeURIComponent(categoryId)}`, patch);
}

export async function deleteAdminCategory(
  accessToken: string,
  categoryId: string,
): Promise<MenuCategory> {
  return call<MenuCategory>(accessToken, 'DELETE', `/menu/categories/${encodeURIComponent(categoryId)}`);
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
): Promise<MenuItem[]> {
  const qp = new URLSearchParams();
  if (filters.status) qp.set('status', filters.status);
  if (filters.categoryId) qp.set('categoryId', filters.categoryId);
  qp.set('limit', String(filters.limit ?? 200));
  const raw = await call<ApiListResult<MenuItem>>(
    accessToken,
    'GET',
    `/menu/items${qp.toString() ? `?${qp.toString()}` : ''}`,
  );
  return unwrapList<MenuItem>(raw);
}

export async function createAdminMenuItem(
  accessToken: string,
  input: AdminMenuItemInput,
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'POST', '/menu/items', input);
}

export async function updateAdminMenuItem(
  accessToken: string,
  itemId: string,
  patch: Partial<AdminMenuItemInput>,
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'PATCH', `/menu/items/${encodeURIComponent(itemId)}`, patch);
}

export async function deleteAdminMenuItem(
  accessToken: string,
  itemId: string,
): Promise<MenuItem> {
  return call<MenuItem>(accessToken, 'DELETE', `/menu/items/${encodeURIComponent(itemId)}`);
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

export async function listAdminModifiers(accessToken: string): Promise<MenuModifier[]> {
  const raw = await call<ApiListResult<MenuModifier>>(accessToken, 'GET', '/menu/modifiers');
  return unwrapList<MenuModifier>(raw);
}

export async function createAdminModifier(
  accessToken: string,
  input: AdminModifierInput,
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'POST', '/menu/modifiers', input);
}

export async function updateAdminModifier(
  accessToken: string,
  modifierId: string,
  patch: Partial<AdminModifierInput>,
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'PATCH', `/menu/modifiers/${encodeURIComponent(modifierId)}`, patch);
}

export async function deleteAdminModifier(
  accessToken: string,
  modifierId: string,
): Promise<MenuModifier> {
  return call<MenuModifier>(accessToken, 'DELETE', `/menu/modifiers/${encodeURIComponent(modifierId)}`);
}

export const REMOTE_MENU_ADMIN_API_BASE = API_BASE;
