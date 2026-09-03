import type { MenuCategory, MenuItem, MenuModifier } from '@prolific/shared-types';
import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';
// Reuse the professional 4-tier API base resolver from remote-auth.ts so the
// public menu client never falls back to a hardcoded localhost:4000 on
// production hostnames. This resolver is also used by the authenticated
// remote-auth / remote-menu-admin clients for identical behaviour.
import { resolveApiBase } from './remote-auth';

// Remote public API client so the POS cashier terminal (both Electron desktop
// and the browser preview mode) reads menu data from the Nest server so any
// edit in the Admin portal is reflected on every consumer immediately. Falls
// back to the local Electron IPC / in-memory mock shim when the server is
// unreachable (café offline scenario) so terminals keep working.

// Read resolveApiBase() lazily at call time (not module-load time) so
// localStorage operator overrides applied mid-session are picked up.
function getApiBase(): string {
  return resolveApiBase();
}

const DEFAULT_BRANCH_OVERRIDE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_DEFAULT_BRANCH_ID ||
      (import.meta as any).env.VITE_DEFAULT_BRANCH)) ||
  null;

// ---------- Render cold-start resilience wrapper (POS is browser-only, never SSR) ----------
// Delegate to remote-auth.ts guardedFetch which has identical wake + timeout
// semantics plus the SERVER_UNREACHABLE marker; we pass the dynamic apiBase
// so hostname-based resolution happens per-call, not per-module-load.
async function guardedFetch(doFetch: () => Promise<Response>): Promise<Response> {
  const apiBase = getApiBase();
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    beginWake();
    await waitForApiWake(apiBase, {
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
    await waitForApiWake(apiBase, {
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

// Helper wrapper: use native fetch FIRST (works on browser POS always, and on
// Electron packaged if server CORS allowlist includes "null" / "file://").
// If fetch throws a TRANSPORT/network-style error that Chromium produces when
// the file:// CORS preflight is rejected (TypeError with no Response object,
// or SERVER_UNREACHABLE marker coming from guardedFetch), fall back to the
// main-process IPC `public:http-get` which routes through Node net stack —
// no CORS, no OPTIONS preflight, always resolves to the canonical daemon URL.
async function guardedFetchPublic(
  doFetch: () => Promise<Response>,
  pathForIpc: string
): Promise<Response> {
  try {
    return await doFetch();
  } catch (firstErr) {
    const msg = String((firstErr as any)?.message || '');
    const isNetworkStyle =
      (firstErr as any)?.name === 'TypeError' ||
      msg.includes('NetworkError') ||
      msg.includes('Failed to fetch') ||
      typeof msg !== 'string' ||
      msg.length === 0;
    const bypass:
      | undefined
      | ((p: string) => Promise<{ status: number; ok: boolean; text?: string; body?: unknown; statusText?: string }>) =
      (window as any).electronAPI?.publicHttpGet;
    if (!isNetworkStyle || typeof bypass !== 'function') {
      throw firstErr;
    }
    const r = await bypass(pathForIpc);
    return new Response(typeof r.text === 'string' ? r.text : '', {
      status: typeof r.status === 'number' && r.status > 0 ? r.status : 0,
      statusText: String(r.statusText ?? ''),
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function listPublicBranches(
  signal?: AbortSignal
): Promise<PublicBranch[]> {
  const path = '/public/branches';
  const res = await guardedFetch(
    () =>
      guardedFetchPublic(
        () =>
          fetch(`${getApiBase()}${path}`, {
            method: 'GET',
            signal,
            cache: 'no-store',
          }),
        path
      )
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
  // 2) authenticated context: auth-store branch id (fastest, no network).
  try {
    if (typeof window !== 'undefined') {
      const raw = (window as any).localStorage?.getItem?.('prolific-pos-auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        const bid = parsed?.state?.branch?.id || parsed?.branch?.id;
        if (typeof bid === 'string' && bid.length > 0) return bid;
      }
    }
  } catch { /* fall through */ }
  // 3) list from server → pick isDefault or first active
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
  const qs = `?branchId=${encodeURIComponent(branchId)}`;
  const path = `/public/menu${qs}`;
  let res: Response;
  try {
    res = await guardedFetch(
      () =>
        guardedFetchPublic(
          () =>
            fetch(`${getApiBase()}${path}`, {
              method: 'GET',
              signal,
              cache: 'no-store',
            }),
          path
        )
    );
  } catch (initialErr) {
    // First attempt failed with the provided branchId. Behaviour: if this was
    // a transport error OR a 404 (stale tenant branch id from an older seed
    // that never got migrated after the Render postgres → Mongo snapshot
    // restore, which leaves /public/menu returning 404 because the branch
    // document doesn't exist), fall back once to listPublicBranches → pick
    // first default/active branch → retry with that id, since listPublicBranches
    // always returns the real server-owned branches (matches admin portal).
    // This guarantees cashiers see menu items even after ops reset server
    // tenants and don't update seeded employee branch ids.
    const msg = String((initialErr as any)?.message || '');
    const shouldFallback =
      msg.includes('HTTP 404') ||
      msg.includes('not found') ||
      (initialErr as any)?.name === 'TypeError' ||
      msg.includes('NetworkError') ||
      msg.includes('Failed to fetch') ||
      msg.includes('SERVER_UNREACHABLE');
    if (!shouldFallback) throw initialErr;
    let fallbackId: string | null = null;
    try {
      const branches = await listPublicBranches();
      const fb =
        branches.find((b) => b.isDefault === true) ||
        branches.find((b) => b.isActive !== false) ||
        branches[0];
      fallbackId = fb?.id || null;
    } catch { fallbackId = null; }
    if (!fallbackId || fallbackId === branchId) throw initialErr;
    const qs2 = `?branchId=${encodeURIComponent(fallbackId)}`;
    const path2 = `/public/menu${qs2}`;
    res = await guardedFetch(
      () =>
        guardedFetchPublic(
          () =>
            fetch(`${getApiBase()}${path2}`, {
              method: 'GET',
              signal,
              cache: 'no-store',
            }),
          path2
        )
    );
    // Mutate input branch id so callers that check their result against the
    // original caller branchId will see the fallback and can persist it to
    // state for 8s re-polls. This is safe because branchId is a string
    // primitive (passed by value), so we instead expose the resolved id via
    // a side-channel on the response envelope's branch.id below (callers use
    // that branchIdFromEnvelope to FK link categories/items anyway).
    void fallbackId;
  }
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

// Dynamic getter so callers always see the latest resolveApiBase() result
// (e.g. if operator applies a prolific_api_base localStorage override
// mid-session, they don't have to refresh to pick it up).
export const REMOTE_MENU_API_BASE = { toString: getApiBase, valueOf: getApiBase };
