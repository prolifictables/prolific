import type { MenuCategory, MenuItem, MenuModifier } from '@prolific/shared-types';
import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

// Remote public API client so the POS cashier terminal (both Electron desktop
// and the browser preview mode) reads menu data from the Nest server so any
// edit in the Admin portal is reflected on every consumer immediately. Falls
// back to the local Electron IPC / in-memory mock shim when the server is
// unreachable (café offline scenario) so terminals keep working.

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_PUBLIC_API_URL ||
      (import.meta as any).env.API_BASE_URL)) ||
  'http://localhost:4000/api/v1';

const DEFAULT_BRANCH_OVERRIDE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_DEFAULT_BRANCH_ID ||
      (import.meta as any).env.VITE_DEFAULT_BRANCH)) ||
  null;

// ---------- Render cold-start resilience wrapper (POS is browser-only, never SSR) ----------
async function guardedFetch(doFetch: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    beginWake();
    await waitForApiWake(API_BASE, {
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    });
    return doFetch();
  }
  const ct = res.headers.get('content-type');
  let bodyStart = '';
  try {
    if (res.status >= 500 || !!ct?.toLowerCase().includes('text/html')) {
      const cloned = res.clone();
      bodyStart = (await cloned.text()).slice(0, 300);
    }
  } catch {
    // ignore clone/text failures — detection best-effort
  }
  if (isApiWakingResponse(res.status, ct, bodyStart)) {
    beginWake();
    await waitForApiWake(API_BASE, {
      onProgress: (p) =>
        publishApiWake({ attempt: p.attempt, elapsedMs: p.elapsedMs, etaMs: p.etaMs }),
      onWakeResolved: endWake,
    });
    return doFetch();
  }
  return res;
}

// ---------- Shape helpers: public API → shared-types ----------
// The Nest public/menu endpoint returns `priceCents` / `priceDeltaCents` to
// be unambiguous, while @prolific/shared-types uses `price` / `priceDelta`
// (already-documented cents in the shared type comments). Map back so the
// whole POS component tree keeps working unchanged.

type PublicBranch = {
  id: string;
  name: string;
  city: string;
  timezone: string;
  restaurantId: string;
  isActive: boolean;
  isDefault?: boolean;
};

type PublicCategory = {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  imageUrl?: string;
};

type PublicItem = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  priceCents: number;
  imageUrl?: string;
  status: MenuItem['status'];
  sortOrder: number;
  isTaxable: boolean;
  taxIds: string[];
  modifierIds: string[];
};

type PublicModifierOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  isDefault?: boolean;
};

type PublicModifier = {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  multiSelect: boolean;
  minSelections?: number;
  maxSelections?: number;
  options: PublicModifierOption[];
};

export type PublicMenuEnvelope = {
  restaurant: { id: string; name: string; currency: string; locale: string; logoUrl?: string };
  branch: { id: string; name: string; timezone: string };
  categories: PublicCategory[];
  items: PublicItem[];
  modifiers: PublicModifier[];
  defaultTax: { id: string; name: string; rate: number; isIncludedInPrice: boolean } | null;
};

export async function listPublicBranches(
  signal?: AbortSignal
): Promise<PublicBranch[]> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}/public/branches`, {
      method: 'GET',
      signal,
      cache: 'no-store',
    })
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return (json?.data as PublicBranch[]) || [];
}

export async function resolveDefaultBranchId(
  signal?: AbortSignal
): Promise<string | null> {
  // 1) explicit env override
  if (DEFAULT_BRANCH_OVERRIDE) return DEFAULT_BRANCH_OVERRIDE;
  // 2) list from server → pick isDefault or first active
  try {
    const branches = await listPublicBranches(signal);
    if (branches.length === 0) return null;
    return branches.find((b) => b.isDefault)?.id || branches[0]?.id || null;
  } catch {
    return null;
  }
}

export async function fetchPublicMenu(
  branchId: string,
  signal?: AbortSignal
): Promise<{
  envelope: PublicMenuEnvelope;
  categories: MenuCategory[];
  items: MenuItem[];
  modifiers: MenuModifier[];
}> {
  const res = await guardedFetch(() =>
    fetch(`${API_BASE}/public/menu?branchId=${encodeURIComponent(branchId)}`, {
      method: 'GET',
      signal,
      cache: 'no-store',
    })
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  const envelope = (json?.data || json) as PublicMenuEnvelope;
  if (!envelope) throw new Error('Empty menu envelope from API');

  const restaurantId = envelope.restaurant?.id || '';
  const branchIdFromEnvelope = envelope.branch?.id || branchId;

  // PublicCategory → MenuCategory (fill required restaurantId/branchId/isActive fields)
  const nowISO = new Date().toISOString();
  const categories: MenuCategory[] = (envelope.categories || []).map((c, i) => ({
    id: c.id,
    restaurantId,
    branchId: branchIdFromEnvelope,
    name: c.name,
    description: c.description,
    sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : i,
    isActive: true,
    imageUrl: c.imageUrl,
    createdAt: (c as any).createdAt || nowISO,
    updatedAt: (c as any).updatedAt || nowISO,
  }));

  // PublicItem → MenuItem (priceCents → price; required fields defaulted)
  const items: MenuItem[] = (envelope.items || []).map((it, i) => ({
    id: it.id,
    restaurantId,
    branchId: branchIdFromEnvelope,
    categoryId: it.categoryId,
    name: it.name,
    description: it.description,
    price: typeof it.priceCents === 'number' ? it.priceCents : 0,
    imageUrl: it.imageUrl,
    status: it.status || 'AVAILABLE',
    sortOrder: typeof it.sortOrder === 'number' ? it.sortOrder : i,
    isTaxable: typeof it.isTaxable === 'boolean' ? it.isTaxable : true,
    taxIds: Array.isArray(it.taxIds) ? it.taxIds : [],
    modifierIds: Array.isArray(it.modifierIds) ? it.modifierIds : [],
    createdAt: (it as any).createdAt || nowISO,
    updatedAt: (it as any).updatedAt || nowISO,
  }));

  // PublicModifier → MenuModifier (priceDeltaCents → priceDelta)
  const modifiers: MenuModifier[] = (envelope.modifiers || []).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    required: !!m.required,
    multiSelect: !!m.multiSelect,
    minSelections: typeof m.minSelections === 'number' ? m.minSelections : 0,
    maxSelections: typeof m.maxSelections === 'number' ? m.maxSelections : 1,
    options: (m.options || []).map((o) => ({
      id: o.id,
      name: o.name,
      priceDelta: typeof o.priceDeltaCents === 'number' ? o.priceDeltaCents : 0,
      isDefault: o.isDefault,
    })),
    createdAt: (m as any).createdAt || nowISO,
    updatedAt: (m as any).updatedAt || nowISO,
  }));

  return { envelope, categories, items, modifiers };
}

export const REMOTE_MENU_API_BASE = API_BASE;
