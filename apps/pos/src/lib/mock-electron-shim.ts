// Mock Electron API shim for browser-based POS testing
// Installs on window.electronAPI when running outside Electron (dev browser / Vite preview)
// Provides seeded employees, menu items, tables, orders, taxes so all flows work end-to-end.

// Window.electronAPI type is defined in src/vite-env.d.ts — typed full interface + optional modifier.

import type {
  CustomerBranding,
  CustomerOrderLine,
  CustomerOrderPreview,
  CustomerPromo,
  CustomerSpecial,
  CustomerStatePayload,
} from '../vite-env';
import { isApiWakingResponse, waitForApiWake } from '@prolific/utils';
import { beginWake, endWake, publishApiWake } from './api-wake';

// ---------------------------------------------------------------------------
// Customer Display state bus (BroadcastChannel, browser-mode only)
// Real Electron uses ipcRenderer/ipcMain + window.customerWindowAPI preload.
// In browser/Vite mode the POS main window and the customer-display popup are
// same-origin SPA tabs, so we use BroadcastChannel for zero-dependency pub/sub
// plus an in-memory latestState cache so late-subscribing popups hydrate
// immediately without waiting for the next cart mutation.
// ---------------------------------------------------------------------------
const CUSTOMER_CHANNEL_NAME = 'prolific-customer-display-v1';

const DEFAULT_CUSTOMER_BRANDING: CustomerBranding = {
  name: 'Prolific Tables',
  tagline: 'Bold Flavours, Warm Welcome',
  wifi: 'Free Wi-Fi: ProlificTables_Guest',
  openingHours: 'Mon–Sun 8am – 11pm',
  branchName: 'Port Harcourt',
};

let _customerChannel: BroadcastChannel | null = null;
let _customerSubscribers: Array<(state: CustomerStatePayload) => void> = [];
let _latestCustomerState: CustomerStatePayload = {
  screen: 'idle',
  branding: { ...DEFAULT_CUSTOMER_BRANDING },
};

// Lazily create the BroadcastChannel so it works on both POS and popup windows.
function getCustomerChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (_customerChannel) return _customerChannel;
  try {
    _customerChannel = new BroadcastChannel(CUSTOMER_CHANNEL_NAME);
    _customerChannel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      // POS window replies to late-subscriber popup requests with latest state.
      if (msg.type === 'customer-latest-request') {
        const payload: CustomerStatePayload = { ..._latestCustomerState };
        try {
          _customerChannel?.postMessage({ type: 'customer-state', payload });
        } catch (_) {
          /* ignore */
        }
        return;
      }
      // Popup subscriber (or any listener) consumes customer-state broadcasts.
      if (msg.type === 'customer-state') {
        const payload: CustomerStatePayload = msg.payload || {};
        if (payload.branding) {
          _latestCustomerState.branding = {
            ...(_latestCustomerState.branding || {}),
            ...payload.branding,
          };
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'orderPreview')) {
          if (payload.orderPreview === undefined || payload.orderPreview === null) {
            delete _latestCustomerState.orderPreview;
          } else {
            _latestCustomerState.orderPreview = payload.orderPreview;
          }
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'promos')) {
          if (Array.isArray(payload.promos)) {
            _latestCustomerState.promos = payload.promos as CustomerPromo[];
          } else {
            delete (_latestCustomerState as any).promos;
          }
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'specials')) {
          if (Array.isArray(payload.specials)) {
            _latestCustomerState.specials = payload.specials as CustomerSpecial[];
          } else {
            delete (_latestCustomerState as any).specials;
          }
        }
        if (payload.screen) {
          _latestCustomerState.screen = payload.screen;
        }
        _customerSubscribers.forEach((cb) => {
          try {
            cb({ ..._latestCustomerState });
          } catch (_) {
            /* subscriber error */
          }
        });
      }
    };
  } catch (_) {
    _customerChannel = null;
  }
  return _customerChannel;
}

// Broadcasts current state on the channel AND keeps in-memory cache fresh.
function emitCustomerState(partial: Partial<CustomerStatePayload>): void {
  if (partial.branding) {
    _latestCustomerState.branding = {
      ...(_latestCustomerState.branding || {}),
      ...partial.branding,
    };
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'orderPreview')) {
    if (partial.orderPreview === undefined || partial.orderPreview === null) {
      delete _latestCustomerState.orderPreview;
    } else {
      _latestCustomerState.orderPreview = partial.orderPreview;
    }
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'promos')) {
    if (Array.isArray(partial.promos)) {
      _latestCustomerState.promos = partial.promos as CustomerPromo[];
    } else {
      delete (_latestCustomerState as any).promos;
    }
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'specials')) {
    if (Array.isArray(partial.specials)) {
      _latestCustomerState.specials = partial.specials as CustomerSpecial[];
    } else {
      delete (_latestCustomerState as any).specials;
    }
  }
  if (partial.screen) {
    _latestCustomerState.screen = partial.screen;
  }
  const payload: CustomerStatePayload = { ..._latestCustomerState };
  const ch = getCustomerChannel();
  try {
    ch?.postMessage({ type: 'customer-state', payload });
  } catch (_) {
    /* ignore closed channel */
  }
}

// =========================================================================
// Backend base URL resolution — professional grade 6-tier fallback chain
// (MUST mirror resolveApiBase in remote-auth.ts exactly so browser Web POS
// and packaged Electron desktop resolve the same URL and a fix on one
// surface is always applied to the other).
//
// Priority (highest wins):
//   -1. Electron preload IPC sync: window.electronAPI.getApiBaseUrlSync()
//       (only present on real packaged Electron, returns main-process URL).
//   -0.5. Electron packaged-production heuristic: detectElectron() && NO
//         VITE_DEV_SERVER_URL set → short-circuit to REAL Render prod URL,
//         no hostname inspection needed (file:// yields empty hostname).
//   0. localStorage operator override: key = "prolific_api_base"
//   1. Vite / Next build-time env vars
//   2. Runtime hostname: *.prolifictables.com / *.onrender.com
//      → real Render slug https://prolific-api.onrender.com/api/v1
//   3. Local dev: http://localhost:4000/api/v1 (only for localhost hostname)
//
// Used by shimGuardedFetch for every backend call in this shim.
// =========================================================================
function resolvePublicApiBase(): string {
  const REAL_PRODUCTION_API_BASE = 'https://prolific-api.onrender.com/api/v1';

  const detectElectron = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      if (typeof (window as any).electronAPI !== 'undefined' && (window as any).electronAPI !== null) {
        return true;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && /Electron\//.test(navigator.userAgent)) {
        return true;
      }
      if (
        typeof (globalThis as any).process !== 'undefined' &&
        typeof (globalThis as any).process?.versions?.electron === 'string'
      ) {
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  const isPackagedElectronDesktop = (): boolean => {
    if (!detectElectron()) return false;
    const viteDevUrl =
      (typeof import.meta !== 'undefined' && (import.meta as any).env)
        ? ((import.meta as any).env.VITE_DEV_SERVER_URL as unknown)
        : undefined;
    if (typeof viteDevUrl === 'string' && viteDevUrl.length > 0) {
      // Vite dev server running → electron vite-dev mode, not packaged → dev.
      return false;
    }
    const hn = typeof window.location?.hostname === 'string'
      ? window.location.hostname.toLowerCase()
      : '';
    return ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(hn);
  };

  // (-1) Highest priority: Electron preload IPC sync (real packaged desktop).
  if (
    typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.getApiBaseUrlSync === 'function'
  ) {
    try {
      const fromMain: unknown = (window as any).electronAPI.getApiBaseUrlSync();
      if (typeof fromMain === 'string' && fromMain.trim().length > 3) {
        const trimmed = fromMain.trim().replace(/\/+$/, '');
        if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
          return trimmed;
        }
        return `${trimmed}/api/v1`;
      }
    } catch { /* preload not ready → fall through */ }
  }

  // (-0.5) Belt + suspenders: Electron packaged production heuristic.
  if (isPackagedElectronDesktop()) {
    return REAL_PRODUCTION_API_BASE;
  }

  // (0) localStorage operator override — highest priority on browser.
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const override = window.localStorage.getItem('prolific_api_base');
      if (typeof override === 'string' && override.trim().length > 3) {
        const trimmed = override.trim().replace(/\/+$/, '');
        if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
          return trimmed;
        }
        return `${trimmed}/api/v1`;
      }
    } catch { /* storage access denied → ignore */ }
  }

  // (1) Build-time env vars.
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const viteEnv: any = (import.meta as any).env;
    const explicit =
      viteEnv.VITE_API_BASE_URL ||
      viteEnv.VITE_API_URL ||
      viteEnv.VITE_PUBLIC_API_URL ||
      viteEnv.API_BASE_URL;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  }
  if (typeof window !== 'undefined') {
    const env: any = (window as any).process?.env ?? {};
    const fromProcess =
      (env.VITE_API_BASE_URL as string) ||
      (env.NEXT_PUBLIC_API_BASE_URL as string);
    if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  }

  // (2) Production hostnames → REAL confirmed Render API slug.
  if (typeof window !== 'undefined' && typeof window.location?.hostname === 'string') {
    const hn = window.location.hostname.toLowerCase();
    const prod =
      hn === 'prolifictables.com' ||
      hn.endsWith('.prolifictables.com') ||
      hn === 'onrender.com' ||
      hn.endsWith('.onrender.com');
    if (prod) return REAL_PRODUCTION_API_BASE;
  }

  // (3) Local dev fallback.
  return 'http://localhost:4000/api/v1';
}

function resolveDefaultBranchId(): string {
  if (typeof window === 'undefined') return '6a814d299717fc01eabb6000';
  const env: any = (window as any).process?.env ?? {};
  return (
    (env.VITE_BRANCH_ID as string) ||
    (env.NEXT_PUBLIC_BRANCH_ID as string) ||
    '6a814d299717fc01eabb6000' // Port Harcourt seed default
  );
}

// ---------- Render cold-start resilience wrapper (shim-only, uses resolvePublicApiBase) ----------
async function shimGuardedFetch(doFetch: () => Promise<Response>): Promise<Response> {
  const apiBase = resolvePublicApiBase();
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

// Module-scope state for the admin-managed customer-display write-up live-poller.
// Runs once on bootstrap, then every 30 seconds so edits propagate to already-open
// customer-display popups without requiring a refresh.
let _resolvedCustomerDisplayBranchId: string | null = null;
let _customerDisplayPollHandle: any = null;

// Applies one customerDisplay payload (promos/specials + optional branding text)
// onto the shared _latestCustomerState cache and emits it on the bus.
// Rules for each key:
//   - key missing in payload (hasOwnProperty false) → DO NOT TOUCH
//   - key present with []/null/undefined → EXPLICITLY CLEAR (so idle screen uses hardcoded defaults)
//   - key present with data → USE IT
function applyCustomerDisplayPayload(cd: any) {
  if (!cd || typeof cd !== 'object') return;

  let dirty = false;

  if (Object.prototype.hasOwnProperty.call(cd, 'promos')) {
    if (Array.isArray(cd.promos)) {
      _latestCustomerState.promos = cd.promos as CustomerPromo[];
    } else {
      delete (_latestCustomerState as any).promos;
    }
    dirty = true;
  }
  if (Object.prototype.hasOwnProperty.call(cd, 'specials')) {
    if (Array.isArray(cd.specials)) {
      _latestCustomerState.specials = cd.specials as CustomerSpecial[];
    } else {
      delete (_latestCustomerState as any).specials;
    }
    dirty = true;
  }

  if (_latestCustomerState.branding) {
    if (Object.prototype.hasOwnProperty.call(cd, 'branchName')) {
      const v = typeof cd.branchName === 'string' ? cd.branchName.trim() : '';
      _latestCustomerState.branding.branchName = v || undefined;
      dirty = true;
    }
    if (Object.prototype.hasOwnProperty.call(cd, 'tagline')) {
      const v = typeof cd.tagline === 'string' ? cd.tagline.trim() : '';
      if (v) _latestCustomerState.branding.tagline = v;
      dirty = true;
    }
    if (Object.prototype.hasOwnProperty.call(cd, 'openingHours')) {
      const v = typeof cd.openingHours === 'string' ? cd.openingHours.trim() : '';
      if (v) _latestCustomerState.branding.openingHours = v;
      dirty = true;
    }
    if (Object.prototype.hasOwnProperty.call(cd, 'wifi')) {
      const v = typeof cd.wifi === 'string' ? cd.wifi.trim() : '';
      if (v) _latestCustomerState.branding.wifi = v;
      dirty = true;
    }
  }

  if (dirty) emitCustomerState({});
}

async function fetchCustomerDisplayForBranch(branchId: string): Promise<any | null> {
  try {
    const API_BASE = resolvePublicApiBase();
    const url = `${API_BASE}/public/customer-display-settings?branchId=${encodeURIComponent(String(branchId))}`;
    const resp = await shimGuardedFetch(() =>
      fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' })
    );
    if (!resp.ok) return null;
    const raw = await resp.json().catch(() => null);
    // Envelope shape: the NestJS interceptor wraps everything as {success, data, meta}.
    // Unwrap raw.data if present, else return raw (endpoint may return direct object).
    return raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object'
      ? raw.data
      : raw || {};
  } catch {
    return null;
  }
}

async function fetchPublicBranches(limit = 10): Promise<any[]> {
  try {
    const API_BASE = resolvePublicApiBase();
    const resp = await shimGuardedFetch(() =>
      fetch(`${API_BASE}/public/branches?limit=${limit}`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      })
    );
    if (!resp.ok) return [];
    const raw = await resp.json().catch(() => null);
    if (raw && typeof raw === 'object' && Array.isArray(raw.data)) return raw.data;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function startCustomerDisplayPoller(branchId: string) {
  if (_customerDisplayPollHandle) {
    clearInterval(_customerDisplayPollHandle);
    _customerDisplayPollHandle = null;
  }
  _resolvedCustomerDisplayBranchId = branchId;
  _customerDisplayPollHandle = setInterval(() => {
    if (!_resolvedCustomerDisplayBranchId) return;
    fetchCustomerDisplayForBranch(_resolvedCustomerDisplayBranchId).then((cd) => {
      if (cd) applyCustomerDisplayPayload(cd);
    });
  }, 30000);
}

// One-time bootstrap: pull real branch identity + admin-managed customer-display
// write-up from the public endpoints (POS main window only — not the popup).
// Combines: (1) /branches → real branch identity + hours/wifi defaults, then
//           (2) /customer-display-settings → admin edits (promos, specials, and
//               optional branding text overrides that take precedence over #1).
// Belt+suspenders: if /branches is unreachable for any reason, fall back to the
// env-VITE_BRANCH_ID default branch so promos still load.
let _customerBrandingBootstrapped = false;
async function bootstrapCustomerBranding(): Promise<void> {
  if (_customerBrandingBootstrapped) return;
  _customerBrandingBootstrapped = true;
  try {
    const branches: any[] = await fetchPublicBranches(10);
    const pick =
      branches.find((b) => String(b?.name || '').toLowerCase().includes('har')) ||
      branches.find((b) => String(b?.name || '').toLowerCase().includes('court')) ||
      branches[0] ||
      null;
    // Start from baked-in default base (name, tagline required; fallback
    // wifi/hours so screen is never blank even when server is unreachable).
    const base: CustomerBranding = { ...DEFAULT_CUSTOMER_BRANDING };
    if (_latestCustomerState.branding) {
      Object.assign(base, _latestCustomerState.branding);
    }
    if (pick) {
      base.branchName = pick.name || base.branchName || 'Port Harcourt';
      if (pick.wifiSsid) base.wifi = `Free Wi-Fi: ${pick.wifiSsid}`;
      if (pick.openingHours) base.openingHours = pick.openingHours;
    } else {
      // /branches unreachable → use the same env fallback the sync bridge uses
      // so customer-display at least gets promos/specials for the default branch.
      const fb = resolveDefaultBranchId();
      base.branchName = base.branchName || (fb ? 'Default Branch' : 'Port Harcourt');
    }
    _latestCustomerState.branding = base;

    // ---- Admin-managed write-up overrides ------------------------------------
    // Prefer the resolved branch ID from /branches; fall back to env default.
    const branchId: string | null = pick?.id ? String(pick.id) : resolveDefaultBranchId();
    if (branchId) {
      const cd = await fetchCustomerDisplayForBranch(branchId);
      if (cd) applyCustomerDisplayPayload(cd);
      // Install live re-fetch poller so subsequent Admin saves reach already-open
      // customer-display popups within 30 seconds.
      startCustomerDisplayPoller(branchId);
    }

    // Push the now-hydrated state to any popup that opened before we finished
    // fetching (BroadcastChannel handshake guarantees they'll re-request too,
    // but this saves them a round-trip).
    emitCustomerState({});
  } catch (_) {
    /* offline or endpoint down — keep fallback branding + defaults */
  }
}

// Seeded demo cashiers — default PINs match pattern 1234 + role suffix
const SEEDED_EMPLOYEES = [
  {
    id: 'emp-adaeze',
    userId: 'u-adaeze',
    branchId: 'br-main-01',
    firstName: 'Adaeze',
    lastName: 'Okafor',
    name: 'Adaeze Okafor',
    role: 'CASHIER',
    email: 'adaeze@prolific.app',
    pin: '1234',
    phone: '+2348010000001',
    status: 'ACTIVE',
  },
  {
    id: 'emp-tunde',
    userId: 'u-tunde',
    branchId: 'br-main-01',
    firstName: 'Tunde',
    lastName: 'Bakare',
    name: 'Tunde Bakare',
    role: 'CASHIER',
    email: 'tunde@prolific.app',
    pin: '1234',
    phone: '+2348010000002',
    status: 'ACTIVE',
  },
  {
    id: 'emp-chiamaka',
    userId: 'u-chiamaka',
    branchId: 'br-main-01',
    firstName: 'Chiamaka',
    lastName: 'Nwosu',
    name: 'Chiamaka Nwosu',
    role: 'SUPERVISOR',
    email: 'chiamaka@prolific.app',
    pin: '0000',
    phone: '+2348010000003',
    status: 'ACTIVE',
  },
  {
    id: 'emp-olu',
    userId: 'u-olu',
    branchId: 'br-main-01',
    firstName: 'Olu',
    lastName: 'Adeyemi',
    name: 'Olu Adeyemi',
    role: 'CASHIER',
    email: 'olu@prolific.app',
    pin: '1234',
    phone: '+2348010000004',
    status: 'ACTIVE',
  },
  {
    id: 'emp-fatima',
    userId: 'u-fatima',
    branchId: 'br-main-01',
    firstName: 'Fatima',
    lastName: 'Suleiman',
    name: 'Fatima Suleiman',
    role: 'CASHIER',
    email: 'fatima@prolific.app',
    pin: '1234',
    phone: '+2348010000005',
    status: 'ACTIVE',
  },
  {
    id: 'emp-ebuka',
    userId: 'u-ebuka',
    branchId: 'br-main-01',
    firstName: 'Ebuka',
    lastName: 'Obi',
    name: 'Ebuka Obi',
    role: 'CASHIER',
    email: 'ebuka@prolific.app',
    pin: '1234',
    phone: '+2348010000006',
    status: 'ACTIVE',
  },
  {
    id: 'emp-sarah',
    userId: 'u-sarah',
    branchId: 'br-main-01',
    firstName: 'Sarah',
    lastName: 'Johnson',
    name: 'Sarah Johnson',
    role: 'MANAGER',
    email: 'sarah@prolific.app',
    pin: '9999',
    phone: '+2348010000007',
    status: 'ACTIVE',
  },
  {
    id: 'emp-kachi',
    userId: 'u-kachi',
    branchId: 'br-main-01',
    firstName: 'Kachi',
    lastName: 'Eze',
    name: 'Kachi Eze',
    role: 'CASHIER',
    email: 'kachi@prolific.app',
    pin: '1234',
    phone: '+2348010000008',
    status: 'ACTIVE',
  },
];

const SEEDED_CATEGORIES = [
  { id: 'cat-signature', name: 'Signature', sortOrder: 0, emoji: '⭐', branchId: 'br-main-01' },
  { id: 'cat-rice', name: 'Rice & Grains', sortOrder: 1, emoji: '🍚', branchId: 'br-main-01' },
  { id: 'cat-soups', name: 'Soups & Swallows', sortOrder: 2, emoji: '🥘', branchId: 'br-main-01' },
  { id: 'cat-proteins', name: 'Proteins', sortOrder: 3, emoji: '🍗', branchId: 'br-main-01' },
  { id: 'cat-smallchops', name: 'Small Chops', sortOrder: 4, emoji: '🥟', branchId: 'br-main-01' },
  { id: 'cat-drinks', name: 'Drinks', sortOrder: 5, emoji: '🧋', branchId: 'br-main-01' },
  { id: 'cat-desserts', name: 'Desserts', sortOrder: 6, emoji: '🍰', branchId: 'br-main-01' },
];

const SEEDED_MODIFIERS = [
  {
    id: 'mod-size',
    name: 'Portion Size',
    required: true,
    multiSelect: false,
    minSelections: 1,
    maxSelections: 1,
    options: [
      { id: 'opt-small', name: 'Small', priceDelta: -500, isDefault: false },
      { id: 'opt-medium', name: 'Medium', priceDelta: 0, isDefault: true },
      { id: 'opt-large', name: 'Large', priceDelta: 1000, isDefault: false },
    ],
    branchId: 'br-main-01',
  },
  {
    id: 'mod-protein',
    name: 'Add Protein',
    required: false,
    multiSelect: true,
    minSelections: 0,
    maxSelections: 3,
    options: [
      { id: 'opt-chicken', name: 'Grilled Chicken', priceDelta: 1500, isDefault: false },
      { id: 'opt-beef', name: 'Beef Strips', priceDelta: 1800, isDefault: false },
      { id: 'opt-fish', name: 'Catfish Fillet', priceDelta: 2000, isDefault: false },
      { id: 'opt-prawns', name: 'Prawns', priceDelta: 2500, isDefault: false },
    ],
    branchId: 'br-main-01',
  },
  {
    id: 'mod-spice',
    name: 'Spice Level',
    required: true,
    multiSelect: false,
    minSelections: 1,
    maxSelections: 1,
    options: [
      { id: 'opt-mild', name: 'Mild 🌱', priceDelta: 0, isDefault: true },
      { id: 'opt-medium-s', name: 'Medium 🌶️', priceDelta: 0, isDefault: false },
      { id: 'opt-hot', name: 'Hot 🌶️🌶️', priceDelta: 0, isDefault: false },
      { id: 'opt-xtra', name: 'Extra Hot 🔥', priceDelta: 200, isDefault: false },
    ],
    branchId: 'br-main-01',
  },
  {
    id: 'mod-sides',
    name: 'Extra Sides',
    required: false,
    multiSelect: true,
    minSelections: 0,
    maxSelections: 4,
    options: [
      { id: 'opt-plantain', name: 'Fried Plantain', priceDelta: 700, isDefault: false },
      { id: 'opt-salad', name: 'Garden Salad', priceDelta: 500, isDefault: false },
      { id: 'opt-moi', name: 'Moi Moi', priceDelta: 600, isDefault: false },
      { id: 'opt-coleslaw', name: 'Coleslaw', priceDelta: 400, isDefault: false },
    ],
    branchId: 'br-main-01',
  },
];

const SEEDED_MENU_ITEMS = [
  { id: 'mi-jollof', name: 'Signature Jollof Rice', description: 'Party-style smoky jollof with bay leaves & tender veggies', price: 3500, categoryId: 'cat-signature', sortOrder: 0, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-size', 'mod-protein', 'mod-spice', 'mod-sides'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-size', 'mod-protein', 'mod-spice', 'mod-sides'].includes(m.id)), imageUrl: '', emoji: '🍚', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-friedrice', name: 'Golden Fried Rice', description: 'Wok-tossed with mixed veggies, eggs & sesame oil', price: 3800, categoryId: 'cat-rice', sortOrder: 1, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-size', 'mod-protein', 'mod-sides'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-size', 'mod-protein', 'mod-sides'].includes(m.id)), imageUrl: '', emoji: '🍛', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-suya', name: 'Chicken Suya Platter', description: 'Yaji-spiced grilled skewers with onion, tomato & kuli-kuli', price: 2500, categoryId: 'cat-proteins', sortOrder: 2, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-spice'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-spice'].includes(m.id)), imageUrl: '', emoji: '🍢', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-pounded', name: 'Pounded Yam & Egusi', description: 'Hand-pounded yam with melon-seed egusi soup & assorted meat', price: 4500, categoryId: 'cat-soups', sortOrder: 3, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-size', 'mod-protein'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-size', 'mod-protein'].includes(m.id)), imageUrl: '', emoji: '🥘', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-zobo', name: 'Hibiscus Zobo Drink', description: 'Chilled sorrel infusion with pineapple & ginger', price: 800, categoryId: 'cat-drinks', sortOrder: 4, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🧋', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-meatpie', name: 'Golden Meat Pie', description: 'Flaky pastry shell, minced beef, carrots & potato filling', price: 1200, categoryId: 'cat-smallchops', sortOrder: 5, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🥟', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-plantain', name: 'Crispy Sweet Plantain', description: 'Ripe golden plantain, double-fried to caramelised perfection', price: 700, categoryId: 'cat-smallchops', sortOrder: 6, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🍌', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-burger', name: 'Prolific Burger & Chips', description: '200g beef patty, brioche bun, cheddar, aioli, seasoned fries', price: 4200, categoryId: 'cat-signature', sortOrder: 7, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-spice', 'mod-sides'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-spice', 'mod-sides'].includes(m.id)), imageUrl: '', emoji: '🍔', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-okro', name: 'Okra Soup with Fufu', description: 'Slimy okra soup with smoked mackerel & crab', price: 4800, categoryId: 'cat-soups', sortOrder: 8, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-size'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-size'].includes(m.id)), imageUrl: '', emoji: '🍜', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-ofada', name: 'Ofada Rice & Ayamase', description: 'Local brown rice with designer stew & assorted meat', price: 5200, categoryId: 'cat-rice', sortOrder: 9, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-size', 'mod-protein'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-size', 'mod-protein'].includes(m.id)), imageUrl: '', emoji: '🍲', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-asun', name: 'Peppered Asun (Goat)', description: 'Smoked goat meat tossed in bell pepper & habanero sauce', price: 3200, categoryId: 'cat-proteins', sortOrder: 10, status: 'AVAILABLE', isTaxable: true, modifierIds: ['mod-spice'], modifiers: SEEDED_MODIFIERS.filter((m) => ['mod-spice'].includes(m.id)), imageUrl: '', emoji: '🍖', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-chapman', name: 'Royal Chapman', description: 'Classic mocktail with bitters, cucumber & citrus', price: 1200, categoryId: 'cat-drinks', sortOrder: 11, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🍹', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-springrolls', name: 'Crispy Spring Rolls', description: '4pc golden rolls with veggie/chicken filling & sweet chili', price: 1500, categoryId: 'cat-smallchops', sortOrder: 12, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🥠', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
  { id: 'mi-tiramisu', name: 'Gold Rush Tiramisu', description: 'Coffee-soaked ladyfingers, mascarpone, gold leaf dust', price: 1800, categoryId: 'cat-desserts', sortOrder: 13, status: 'AVAILABLE', isTaxable: true, modifierIds: [], modifiers: [], imageUrl: '', emoji: '🍰', branchId: 'br-main-01', restaurantId: 'rst-prolific' },
];

// Exactly 7 tables (T1-T7) per customer requirement. T1/T2 = 2-seater, T3-T5 = 4-seater,
// T6/T7 = 6-seater. Deterministic `qrCodeId` tokens match the 6-char format the server
// `generateRandomToken()` produces so QR scans resolve to the same table identity
// whether the POS is online (resolves via Nest public/qr/:token) or offline (shim).
const SEEDED_TABLES = [
  { id: 'tbl-t1', name: 'T1', zone: 'Main Hall', capacity: 2, status: 'AVAILABLE', shape: 'square', x: 0, y: 0, qrCodeId: 'QR-T-0001' },
  { id: 'tbl-t2', name: 'T2', zone: 'Main Hall', capacity: 2, status: 'AVAILABLE', shape: 'square', x: 1, y: 0, qrCodeId: 'QR-T-0002' },
  { id: 'tbl-t3', name: 'T3', zone: 'Main Hall', capacity: 4, status: 'AVAILABLE', shape: 'square', x: 2, y: 0, qrCodeId: 'QR-T-0003' },
  { id: 'tbl-t4', name: 'T4', zone: 'Main Hall', capacity: 4, status: 'AVAILABLE', shape: 'square', x: 3, y: 0, qrCodeId: 'QR-T-0004' },
  { id: 'tbl-t5', name: 'T5', zone: 'Main Hall', capacity: 4, status: 'AVAILABLE', shape: 'round',  x: 0, y: 1, qrCodeId: 'QR-T-0005' },
  { id: 'tbl-t6', name: 'T6', zone: 'Main Hall', capacity: 6, status: 'AVAILABLE', shape: 'round',  x: 1, y: 1, qrCodeId: 'QR-T-0006' },
  { id: 'tbl-t7', name: 'T7', zone: 'Main Hall', capacity: 6, status: 'AVAILABLE', shape: 'round',  x: 2, y: 1, qrCodeId: 'QR-T-0007' },
];

const SEEDED_TAXES = [
  { id: 'tax-vat', name: 'VAT', rate: 7.5, isIncludedInPrice: false, isDefault: true, status: 'ACTIVE', branchId: 'br-main-01' },
  { id: 'tax-service', name: 'Service Charge', rate: 5, isIncludedInPrice: false, isDefault: true, status: 'ACTIVE', branchId: 'br-main-01' },
];

// localStorage durable key for offline menu persistence. Each SAVED branch
// gets its own document so multi-branch deployments keep an independent
// offline cache per branch (which matches admin uploads per-branch).
//
// Read priority for every db.menuXxx call in this shim:
//   (1) in-memory `remoteMenuSnapshot` (warm: already set by applyRemoteMenuSnapshot)
//   (2) localStorage `OFFLINE_MENU_KEY` document for the requested branch (persists
//       across refresh / browser restart)
//   (3) Localhost-only: SEEDED_* demo data (dev preview only — production hostnames
//       never fall to SEEDED because they'd show stale demo items that never
//       correspond to the admin-uploaded menu)
const OFFLINE_MENU_KEY = 'pos_offline_menu_snapshot_v1';

type OfflineMenuStoreShape = {
  // keyed by branchId
  [branchId: string]: {
    categories: any[];
    items: any[];
    modifiers: any[];
    fetchedAt: number;
  };
};

// When the remote Nest Admin server is reachable, MenuGrid loads the live
// menu data (categories / items / modifiers) and calls `applyRemoteMenuSnapshot`
// so every subsequent db.menuXxx.listAll() / list() / search() call returns
// the server-owned admin data — source of truth for the POS UI. If this is
// null (offline / server unreachable) we fall to (a) localStorage offline
// snapshot for the branch, (b) SEEDED demo only on localhost dev.
//
// Declared BEFORE any code that reads/writes it so the IIFE below can seed it
// from localStorage without hitting a let-TDZ ReferenceError.
let remoteMenuSnapshot: {
  categories: any[];
  items: any[];
  modifiers: any[];
  fetchedAt: number;
} | null = null;

function readOfflineStore(): OfflineMenuStoreShape {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(OFFLINE_MENU_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as OfflineMenuStoreShape) : {};
  } catch {
    return {};
  }
}

function writeOfflineStore(store: OfflineMenuStoreShape): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(OFFLINE_MENU_KEY, JSON.stringify(store));
  } catch {
    // QuotaExceeded / Safari private mode / storage disabled — don't throw,
    // caller keeps using in-memory state which still works for this session.
  }
}

// Module-level hostname helper. Determines whether we are running on a
// developer localhost hostname (where SEEDED_* demo data is acceptable as a
// last-resort fallback). On ANY production hostname (prolifictables.com,
// onrender.com, etc.), we NEVER fall to SEEDED — instead we either show
// (a) server-fetched live data, (b) localStorage offline snapshot of that
// data, or (c) an empty menu so cashiers never ring up demo prices/items.
function isLocalhostHostname(): boolean {
  try {
    if (typeof window === 'undefined' || !window.location?.hostname) return true;
    const hn = window.location.hostname.toLowerCase();
    if (hn === 'localhost' || hn === '127.0.0.1' || hn === '0.0.0.0') return true;
    if (hn.endsWith('.local')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hn)) return true; // any IPv4 = dev preview
    return false;
  } catch {
    // Fail-open on any access error: if we can't tell, assume production so
    // no SEEDED items leak onto a live terminal.
    return false;
  }
}

// Resolve a reasonable "default branch id" for the localStorage lookup when
// a db.listAll() call is made without explicit branch context (e.g. during
// initial page paint before CashierScreenLayout has authenticated). Returns
// null when no such inference is possible — caller will fall to SEEDED.
function guessCurrentBranchId(): string | null {
  try {
    // First: auth-store branch (persisted by zustand createJSONStorage(localStorage))
    if (typeof localStorage !== 'undefined') {
      const authRaw = localStorage.getItem('prolific-pos-auth');
      if (authRaw) {
        const parsed: any = JSON.parse(authRaw);
        const state: any = parsed?.state ?? parsed;
        const bid: unknown = state?.branch?.id ?? state?.branchId;
        if (typeof bid === 'string' && bid.length > 0) return bid;
      }
    }
  } catch { /* malformed JSON / storage disabled — ignore */ }
  try {
    // Second: look at the currently-warmed in-memory snapshot (already set by
    // applyRemoteMenuSnapshot earlier in this session, or seeded from offline
    // localStorage IIFE below). Pulls branchId from first category/item.
    if (remoteMenuSnapshot) {
      const anyCat = (remoteMenuSnapshot.categories || [])[0];
      if (anyCat?.branchId) return String(anyCat.branchId);
      const anyItem = (remoteMenuSnapshot.items || [])[0];
      if (anyItem?.branchId) return String(anyItem.branchId);
    }
  } catch { /* ignore */ }
  return null;
}

// Read the localStorage offline doc for a given branch — used by list/listAll
// helpers when remoteMenuSnapshot is null (page just refreshed while offline).
// Always returns a DEEP copy so callers never mutate the shared in-memory one.
function readOfflineSnapshotForBranch(branchId?: string | null): typeof remoteMenuSnapshot {
  const bid = branchId || guessCurrentBranchId();
  if (!bid) return null;
  const store = readOfflineStore();
  const doc = store[bid];
  if (!doc) return null;
  return {
    categories: Array.isArray(doc.categories) ? doc.categories : [],
    items: Array.isArray(doc.items) ? doc.items : [],
    modifiers: Array.isArray(doc.modifiers) ? doc.modifiers : [],
    fetchedAt: typeof doc.fetchedAt === 'number' ? doc.fetchedAt : Date.now(),
  };
}

// On module load, attempt to seed in-memory remoteMenuSnapshot from the most
// recent localStorage offline document for the best-guess current branch.
// This ensures: "refresh + OFFLINE = same menu we had when online" — never
// fall to SEEDED_* demo items on production hostnames.
(function initializeRemoteSnapshotFromOfflineStore() {
  const bid = guessCurrentBranchId();
  if (!bid) return;
  const doc = readOfflineSnapshotForBranch(bid);
  if (!doc) return;
  remoteMenuSnapshot = doc;
})();

// Infer a branchId from the snapshot contents (every category/item has one).
// Needed so localStorage writes are correctly namespaced even when the caller
// (e.g. MenuGrid dev-mode fallback) doesn't pass branchId explicitly as a
// separate argument.
function inferBranchIdFromSnapshot(snapshot: { categories?: any[]; items?: any[] }): string | null {
  const anyCat = (snapshot.categories || [])[0];
  if (anyCat?.branchId) return String(anyCat.branchId);
  const anyItem = (snapshot.items || [])[0];
  if (anyItem?.branchId) return String(anyItem.branchId);
  return null;
}

export function applyRemoteMenuSnapshot(snapshot: {
  categories: any[];
  items: any[];
  modifiers: any[];
}): void {
  const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const modifiers = Array.isArray(snapshot.modifiers) ? snapshot.modifiers : [];
  const fetchedAt = Date.now();

  // (1) warm in-memory cache (fast path for all reads in this session)
  remoteMenuSnapshot = { categories, items, modifiers, fetchedAt };

  // (2) persist to localStorage branch-scoped so page reload + OFFLINE still
  // sees the admin-uploaded menu exactly as it was when online (no SEEDED demo)
  const bid = inferBranchIdFromSnapshot({ categories, items }) || guessCurrentBranchId();
  if (!bid) return;
  const store = readOfflineStore();
  store[bid] = { categories, items, modifiers, fetchedAt };
  writeOfflineStore(store);
}

export function hasRemoteMenuSnapshot(): boolean {
  if (remoteMenuSnapshot) return true;
  return !!readOfflineSnapshotForBranch();
}

export function getRemoteMenuSnapshotMeta(): { fetchedAt: number } | null {
  if (remoteMenuSnapshot) return { fetchedAt: remoteMenuSnapshot.fetchedAt };
  return readOfflineSnapshotForBranch() ? { fetchedAt: readOfflineSnapshotForBranch()!.fetchedAt } : null;
}

// Public helper for MenuGrid fallback block: if the Electron SQLite path is
// unavailable (browser mode) and in-memory snapshot is empty (e.g. user
// refreshed while offline before our IIFE ran), return the localStorage
// offline snapshot. Callers can render the offline menu without ever hitting
// SEEDED demo data on production hostnames.
export function readOfflineMenuSnapshotMirror(branchId?: string | null): {
  categories: any[];
  items: any[];
  modifiers: any[];
  fetchedAt: number;
} | null {
  return readOfflineSnapshotForBranch(branchId);
}

// Shared 3-tier source resolver used by every db.menuCategories / menuItems /
// menuModifiers list* / search / findById call.
//
//   (1) Warm in-memory remoteMenuSnapshot (freshly fetched this session)
//   (2) localStorage offline snapshot for the current branch (persists across
//       refresh + browser close — mirrors the admin-uploaded menu)
//   (3) Localhost ONLY: SEEDED_* demo data (for dev previews). On ANY
//       production hostname, return empty arrays so the POS never shows
//       stale demo items that don't correspond to the Admin upload.
function resolveMenuSource<TKey extends 'categories' | 'items' | 'modifiers'>(
  key: TKey,
): any[] {
  if (remoteMenuSnapshot) {
    const v = remoteMenuSnapshot[key];
    if (Array.isArray(v)) return v;
  }
  const offline = readOfflineSnapshotForBranch();
  if (offline) {
    const v = offline[key];
    if (Array.isArray(v)) return v;
  }
  if (isLocalhostHostname()) {
    switch (key) {
      case 'categories': return [...SEEDED_CATEGORIES];
      case 'items': return [...SEEDED_MENU_ITEMS];
      case 'modifiers': return [...SEEDED_MODIFIERS];
    }
  }
  return [];
}

function modifiersForItem(item: any, allModifiers: any[]): any[] {
  if (Array.isArray((item as any).modifiers) && item.modifiers.length > 0) {
    return item.modifiers;
  }
  const ids = new Set<string>(Array.isArray(item.modifierIds) ? item.modifierIds : []);
  if (ids.size === 0) return [];
  return allModifiers.filter((m) => ids.has(m.id));
}

// ---------------------------------------------------------------------------
// Shared write-side helpers for menuCategories / menuItems / menuModifiers.
// Ensures that UPSERT / DELETE operations mutate the same in-memory arrays
// that resolveMenuSource() reads from so reads immediately see the writes,
// and also persist to the branch-scoped localStorage offline document so
// page refresh + offline continues to reflect edits.
// ---------------------------------------------------------------------------
function ensureRemoteSnapshotWritable(): NonNullable<typeof remoteMenuSnapshot> {
  if (!remoteMenuSnapshot) {
    const existing = readOfflineSnapshotForBranch();
    if (existing) {
      remoteMenuSnapshot = existing;
    } else if (isLocalhostHostname()) {
      remoteMenuSnapshot = {
        categories: SEEDED_CATEGORIES.map((c) => ({ ...c })),
        items: SEEDED_MENU_ITEMS.map((m) => ({ ...m })),
        modifiers: SEEDED_MODIFIERS.map((m) => ({ ...m, options: Array.isArray(m.options) ? m.options.map((o) => ({ ...o })) : [] })),
        fetchedAt: Date.now(),
      };
    } else {
      remoteMenuSnapshot = { categories: [], items: [], modifiers: [], fetchedAt: Date.now() };
    }
  }
  return remoteMenuSnapshot!;
}

function persistRemoteSnapshotToOffline(): void {
  if (!remoteMenuSnapshot) return;
  const bid = inferBranchIdFromSnapshot(remoteMenuSnapshot) || guessCurrentBranchId();
  if (!bid) return;
  const store = readOfflineStore();
  store[bid] = {
    categories: remoteMenuSnapshot.categories,
    items: remoteMenuSnapshot.items,
    modifiers: remoteMenuSnapshot.modifiers,
    fetchedAt: remoteMenuSnapshot.fetchedAt,
  };
  writeOfflineStore(store);
}

type MenuKey = 'categories' | 'items' | 'modifiers';

function upsertIntoMenuArray<K extends MenuKey>(
  key: K,
  row: any,
  matchFn?: (existing: any, incoming: any) => boolean
): any {
  const snap = ensureRemoteSnapshotWritable();
  const arr = snap[key] as any[];
  const id = String(row?.id ?? '');
  const matcher = matchFn
    ? (e: any) => matchFn(e, row)
    : (e: any) => id && String(e.id) === id;
  const idx = arr.findIndex(matcher);
  const timestamped = { ...row, updatedAt: row?.updatedAt ?? Date.now() };
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...timestamped };
    persistRemoteSnapshotToOffline();
    return arr[idx];
  } else {
    const inserted = { createdAt: row?.createdAt ?? Date.now(), ...timestamped, isActive: row?.isActive ?? true };
    arr.push(inserted);
    persistRemoteSnapshotToOffline();
    return inserted;
  }
}

function softDeleteFromMenuArray<K extends MenuKey>(
  key: K,
  id: string,
  matchFn?: (existing: any, idStr: string) => boolean
): boolean {
  const snap = ensureRemoteSnapshotWritable();
  const arr = snap[key] as any[];
  const matcher = matchFn
    ? (e: any) => matchFn(e, id)
    : (e: any) => String(e.id) === String(id);
  const idx = arr.findIndex(matcher);
  if (idx < 0) return false;
  (arr[idx] as any).isActive = false;
  (arr[idx] as any).is_active = 0;
  (arr[idx] as any).updatedAt = Date.now();
  persistRemoteSnapshotToOffline();
  return true;
}

// In-memory stores for orders, payments, shifts
const mockOrders: any[] = [
  {
    id: 'ord-demo-101',
    orderNumber: '#10245',
    restaurantId: 'rst-prolific',
    branchId: 'br-main-01',
    tableId: 'tbl-a3',
    tableName: 'A3',
    employeeId: 'emp-adaeze',
    orderType: 'DINE_IN',
    status: 'PREPARING',
    paymentStatus: 'PAID',
    sourceChannel: 'POS',
    items: [
      { menuItemId: 'mi-jollof', name: 'Signature Jollof Rice', unitPrice: 35, quantity: 2, subtotal: 70, totalAmount: 70, selectedModifiers: [] },
      { menuItemId: 'mi-suya', name: 'Chicken Suya Platter', unitPrice: 25, quantity: 1, subtotal: 25, totalAmount: 25, selectedModifiers: [] },
    ],
    subtotal: 9500,
    discountAmount: 0,
    taxAmount: 1187,
    totalAmount: 10687,
    paidAmount: 10687,
    balanceDue: 0,
    notes: 'Extra spicy',
    createdAt: Date.now() - 8 * 60 * 1000,
    updatedAt: Date.now() - 5 * 60 * 1000,
  },
  {
    id: 'ord-demo-102',
    orderNumber: '#10246',
    restaurantId: 'rst-prolific',
    branchId: 'br-main-01',
    tableId: 'tbl-b1',
    tableName: 'B1',
    employeeId: 'emp-tunde',
    orderType: 'DINE_IN',
    status: 'NEW',
    paymentStatus: 'UNPAID',
    sourceChannel: 'POS',
    items: [
      { menuItemId: 'mi-ofada', name: 'Ofada Rice & Ayamase', unitPrice: 52, quantity: 1, subtotal: 52, totalAmount: 52, selectedModifiers: [] },
    ],
    subtotal: 5200,
    discountAmount: 0,
    taxAmount: 650,
    totalAmount: 5850,
    paidAmount: 0,
    balanceDue: 5850,
    notes: '',
    createdAt: Date.now() - 2 * 60 * 1000,
    updatedAt: Date.now() - 2 * 60 * 1000,
  },
  {
    id: 'ord-demo-103',
    orderNumber: '#10247',
    restaurantId: 'rst-prolific',
    branchId: 'br-main-01',
    tableId: 'tbl-c1',
    tableName: 'VIP 1',
    employeeId: 'emp-chiamaka',
    orderType: 'DINE_IN',
    status: 'READY',
    paymentStatus: 'PAID',
    sourceChannel: 'POS',
    items: [
      { menuItemId: 'mi-pounded', name: 'Pounded Yam & Egusi', unitPrice: 45, quantity: 3, subtotal: 135, totalAmount: 135, selectedModifiers: [] },
      { menuItemId: 'mi-chapman', name: 'Royal Chapman', unitPrice: 12, quantity: 4, subtotal: 48, totalAmount: 48, selectedModifiers: [] },
    ],
    subtotal: 18300,
    discountAmount: 0,
    taxAmount: 2288,
    totalAmount: 20588,
    paidAmount: 20588,
    balanceDue: 0,
    notes: '',
    createdAt: Date.now() - 15 * 60 * 1000,
    updatedAt: Date.now() - 30 * 1000,
  },
  {
    id: 'ord-demo-104',
    orderNumber: '#10248',
    restaurantId: 'rst-prolific',
    branchId: 'br-main-01',
    employeeId: 'emp-olu',
    orderType: 'TAKEOUT',
    status: 'ON_HOLD',
    heldAt: Date.now() - 25 * 60 * 1000,
    heldBy: 'emp-olu',
    onHoldReason: 'Customer stepped out',
    paymentStatus: 'UNPAID',
    sourceChannel: 'POS',
    items: [
      { menuItemId: 'mi-burger', name: 'Prolific Burger & Chips', unitPrice: 42, quantity: 2, subtotal: 84, totalAmount: 84, selectedModifiers: [] },
      { menuItemId: 'mi-zobo', name: 'Hibiscus Zobo Drink', unitPrice: 8, quantity: 2, subtotal: 16, totalAmount: 16, selectedModifiers: [] },
    ],
    subtotal: 10000,
    discountAmount: 0,
    taxAmount: 1250,
    totalAmount: 11250,
    paidAmount: 0,
    balanceDue: 11250,
    notes: '',
    createdAt: Date.now() - 25 * 60 * 1000,
    updatedAt: Date.now() - 25 * 60 * 1000,
  },
  {
    id: 'ord-demo-105',
    orderNumber: '#10249',
    restaurantId: 'rst-prolific',
    branchId: 'br-main-01',
    tableId: 'tbl-a3',
    tableName: 'A3',
    employeeId: 'emp-adaeze',
    orderType: 'DINE_IN',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    sourceChannel: 'POS',
    items: [
      { menuItemId: 'mi-friedrice', name: 'Golden Fried Rice', unitPrice: 38, quantity: 1, subtotal: 38, totalAmount: 38, selectedModifiers: [] },
    ],
    subtotal: 3800,
    discountAmount: 0,
    taxAmount: 475,
    totalAmount: 4275,
    paidAmount: 4275,
    balanceDue: 0,
    notes: '',
    createdAt: Date.now() - 35 * 60 * 1000,
    updatedAt: Date.now() - 10 * 60 * 1000,
  },
];

const mockPayments: any[] = [];
const mockCashAdjustments: any[] = [];
const mockSyncQueue: any[] = [];
// Mock order_items + order_item_modifier_options tables (mirror SQLite in browser mode).
// Used so receipts/kitchen tickets render modifiers and line items correctly on Vite dev.
const mockOrderItems: any[] = [];
const mockOrderItemModifiers: any[] = [];
let mockLastAuth: any = { mode: 'OFFLINE_PIN', employeeId: 'emp-adaeze', branchId: 'br-main-01', restaurantId: 'rst-prolific', at: Date.now() - 86400000 };

// --- Mock open shift persistence (browser mode) ----------------------------
// The open shift state must survive page refreshes and logout→login cycles
// so the "Open New Shift" modal is NOT re-shown to a cashier who already has
// an OPEN shift on record. We use localStorage as the durable backing store
// (mirrors the role of SQLite in the real Electron build), keyed per device.
const MOCK_OPEN_SHIFT_KEY = 'pos_mock_open_shift_v1';

function loadMockOpenShiftFromStorage(): any {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(MOCK_OPEN_SHIFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only return it if it's genuinely still OPEN (status gate matches
    // ShiftsRepository.getOpen behaviour).
    if (parsed && parsed.status && parsed.status !== 'OPEN') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveMockOpenShiftToStorage(value: any): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) {
      localStorage.removeItem(MOCK_OPEN_SHIFT_KEY);
    } else {
      localStorage.setItem(MOCK_OPEN_SHIFT_KEY, JSON.stringify(value));
    }
  } catch {
    // ignore quota / serialization errors — state will at least live in-memory
  }
}

// Load the persisted shift once at module bootstrap so a refresh doesn't drop
// the cashier back into the "Open New Shift" modal.
let mockOpenShift: any = loadMockOpenShiftFromStorage();

// --- Running-tab / Table Sessions mock state (browser-mode parity with SQLite) ---
// Parallel structure to the new SQLite table_sessions / table_session_ledger tables
// so every "Assign to table → add menu items" flow is immediately persisted both
// in real Electron/SQLite and in the browser dev-mode.
interface MockTableSession {
  id: string;
  branchId: string;
  restaurantId: string;
  tableId: string;
  tabNumber: string;
  status: 'OPEN' | 'AWAITING_PAYMENT' | 'PARTIALLY_PAID' | 'PAID' | 'CLOSED' | 'VOIDED';
  covers: number;
  openedBy: string | null;
  openedByName: string | null;
  serverId: string | null;
  serverName: string | null;
  openedAt: number;
  closedAt: number | null;
  closedBy: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  paidAmountCents: number;
  balanceDueCents: number;
  customerCount: number;
  customerName: string | null;
  note: string | null;
  currentOrderId: string | null;
  createdAt: number;
  updatedAt: number;
}
interface MockLedgerEntry {
  id: number;
  sessionId: string;
  branchId: string;
  restaurantId: string;
  entryType: string;
  referenceId: string | null;
  actorId: string | null;
  actorName: string | null;
  label: string;
  quantity: number;
  amountDeltaCents: number;
  amountAfterCents: number;
  note: string | null;
  metadataJson: string | null;
  createdAt: number;
}
const mockTableSessions: MockTableSession[] = [];
const mockTableLedger: MockLedgerEntry[] = [];
let mockLedgerIdCounter = 1;
/** current_order_id → in-memory order items (parallel to order_items SQL table) */
const mockSessionOrderItems: { orderId: string; items: any[] }[] = [];

function recalcMockTotals(sessionId: string, taxRates: any[] = SEEDED_TAXES): MockTableSession {
  const sess = mockTableSessions.find((s) => s.id === sessionId);
  if (!sess) throw new Error(`Mock session ${sessionId} not found`);
  const bucket = mockSessionOrderItems.find((b) => b.orderId === sess.currentOrderId);
  const items = bucket ? bucket.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.subtotalCents) || 0), 0);
  const taxableBase = Math.max(0, subtotal - Number(sess.discountCents || 0));
  let tax = 0;
  for (const t of taxRates || []) {
    const rate = Number(t.rate_percent ?? t.rate ?? 0);
    const inclusive = Boolean(t.is_inclusive ?? t.isIncludedInPrice);
    if (inclusive) continue;
    tax += Math.round(taxableBase * (rate / 100));
  }
  sess.subtotalCents = subtotal;
  sess.taxCents = tax;
  sess.totalCents = taxableBase + tax + Number(sess.tipCents || 0);
  sess.balanceDueCents = Math.max(0, sess.totalCents - Number(sess.paidAmountCents || 0));
  sess.updatedAt = Date.now();
  return sess;
}

function appendMockLedger(
  row: Partial<Omit<MockLedgerEntry, 'id' | 'entryType' | 'amountAfterCents'>> &
    Pick<MockLedgerEntry, 'entryType' | 'amountAfterCents'> & {
      sessionId?: string;
      branchId?: string;
      restaurantId?: string;
      label?: string;
      createdAt?: number;
    }
): MockLedgerEntry {
  const entry: MockLedgerEntry = {
    id: mockLedgerIdCounter++,
    createdAt: row.createdAt ?? Date.now(),
    sessionId: row.sessionId ?? '',
    branchId: row.branchId ?? '',
    restaurantId: row.restaurantId ?? '',
    entryType: row.entryType,
    referenceId: row.referenceId ?? null,
    actorId: row.actorId ?? null,
    actorName: row.actorName ?? null,
    label: row.label ?? '',
    quantity: row.quantity ?? 0,
    amountDeltaCents: row.amountDeltaCents ?? 0,
    amountAfterCents: row.amountAfterCents,
    note: row.note ?? null,
    metadataJson: row.metadataJson ?? null,
  };
  mockTableLedger.unshift(entry);
  return entry;
}

const delay = (ms = 50) => new Promise((r) => setTimeout(r, ms));

export function installMockElectronAPI() {
  if (typeof window === 'undefined') return;
  if (window.electronAPI) return; // already provided by real Electron preload

  // -------------------------------------------------------------------------
  // Browser-mode printing helpers. Mirrors the registerPrintHandlers() logic
  // in electron/main/index.ts so browser dev mode (Vite server on :5173) can
  // still print receipts + kitchen tickets via the native "Print" dialog
  // instead of silently dropping prints.
  // -------------------------------------------------------------------------
  const escapeHtml = (v: unknown): string =>
    String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const ngn = (cents: number): string => `₦${(Math.round(cents) / 100).toFixed(2)}`;

  const mockResolveBranchHeader = (order: any) => {
    const restaurantName = (order?.restaurant_name || order?.restaurantName || 'Prolific Restaurant').trim();
    const branchName = (order?.branch_name || order?.branchName || '').trim();
    const line1 = branchName ? `${restaurantName} · ${branchName}` : restaurantName;
    return { line1, line2: 'Thank you for your patronage', defaultFooter: 'Powered by Prolific POS' };
  };

  const mockBuildReceiptHtml = (
    order: any,
    items: any[],
    modifiers: any[],
    payments: any[],
    meta: { title: string; printedAt: number; copyIndex: number; totalCopies: number }
  ): string => {
    const createdAt = order?.created_at ? new Date(Number(order.created_at)) : new Date();
    const hdr = mockResolveBranchHeader(order);
    const orderNo = order?.order_number || order?.orderNumber || '';
    const subtotalCents = Number(order?.subtotal_cents ?? order?.subtotalCents ?? 0);
    const discountCents = Number(order?.discount_cents ?? order?.discountCents ?? 0);
    const taxCents = Number(order?.tax_cents ?? order?.taxCents ?? 0);
    const tipCents = Number(order?.tip_cents ?? order?.tipCents ?? 0);
    const totalCents = Number(order?.total_cents ?? order?.totalCents ?? 0);
    const changeDueCents = Number(order?.change_due_cents ?? order?.changeDueCents ?? 0);
    const isPaid = String(order?.payment_status ?? order?.paymentStatus ?? '').toUpperCase() === 'PAID';

    const rows: string[] = [];
    for (const it of items || []) {
      const name = it.name_snapshot || it.menuItemName || it.name || 'Item';
      const qty = Number(it.quantity ?? 1);
      const unit = Number(it.price_snapshot_cents ?? it.unitPriceCents ?? it.price_cents ?? 0);
      const total = Number(it.total_cents ?? it.totalCents ?? it.subtotal_cents ?? qty * unit);
      const note = it.special_instructions || it.specialInstructions || it.notes || '';
      rows.push(`
        <div class="row"><div class="left">${escapeHtml(qty)}x ${escapeHtml(name)}</div><div class="right">${escapeHtml(ngn(total))}</div></div>
        ${unit && qty > 1 ? `<div class="row small muted"><div class="left">&nbsp;&nbsp;@ ${escapeHtml(ngn(unit))} each</div><div class="right"></div></div>` : ''}
      `);
      const itemId = it.id || it.order_item_id || it._id;
      const itemMods = (modifiers || []).filter((m) =>
        String(m.order_item_id || m.orderItemId || m._id) === String(itemId)
      );
      for (const mod of itemMods) {
        rows.push(`<div class="row small muted"><div class="left">&nbsp;&nbsp;+ ${escapeHtml(String(mod.modifier_name || mod.modifierName || ''))}: ${escapeHtml(String(mod.option_name || mod.optionName || ''))}</div><div class="right"></div></div>`);
      }
      if (note) rows.push(`<div class="row small note"><div class="left">※ ${escapeHtml(String(note))}</div><div class="right"></div></div>`);
    }

    const totalsParts: string[] = [
      `<div class="line"></div>`,
      `<div class="row small pad4"><div class="left muted">Subtotal</div><div class="right">${escapeHtml(ngn(subtotalCents))}</div></div>`,
    ];
    if (discountCents !== 0) totalsParts.push(`<div class="row small pad4"><div class="left muted">Discount</div><div class="right">−${escapeHtml(ngn(discountCents))}</div></div>`);
    if (taxCents !== 0) totalsParts.push(`<div class="row small pad4"><div class="left muted">Tax</div><div class="right">${escapeHtml(ngn(taxCents))}</div></div>`);
    if (tipCents !== 0) totalsParts.push(`<div class="row small pad4"><div class="left muted">Tip</div><div class="right">${escapeHtml(ngn(tipCents))}</div></div>`);
    totalsParts.push(`<div class="row bold"><div class="left">TOTAL</div><div class="right">${escapeHtml(ngn(totalCents))}</div></div>`);

    for (const p of payments || []) {
      const method = String(p.method || p.payment_method || '').toUpperCase() || 'PAYMENT';
      const paid = Number(p.amount_cents ?? p.amountCents ?? p.amount ?? 0);
      totalsParts.push(`<div class="row small pad4"><div class="left muted">${escapeHtml(method)}</div><div class="right">${escapeHtml(ngn(paid))}</div></div>`);
      if ((p?.method === 'CASH' || p?.payment_method === 'CASH') && changeDueCents > 0) {
        const tendered = paid + changeDueCents;
        totalsParts.push(`<div class="row small pad4"><div class="left muted">Tendered</div><div class="right">${escapeHtml(ngn(tendered))}</div></div>`);
        totalsParts.push(`<div class="row small pad4"><div class="left muted">Change</div><div class="right">${escapeHtml(ngn(changeDueCents))}</div></div>`);
      }
    }
    totalsParts.push(`<div class="row bold"><div class="left">Paid</div><div class="right">${isPaid ? 'YES' : 'NO'}</div></div>`);

    const orderType = String(order?.order_type ?? order?.orderType ?? 'POS ORDER').replace(/_/g, ' ');
    const tableStr = (order?.table_name || order?.tableName) ? `🪑 ${escapeHtml(String(order.table_name || order.tableName))}` : '';
    const customerStr = (order?.customer_name || order?.customerName) ? `👤 ${escapeHtml(String(order.customer_name || order.customerName))}` : '';

    return `<!doctype html><html><head><meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 12px; margin: 0; padding: 12px; color: #000; }
        .title { font-size: 14px; font-weight: 800; margin-top: 4px; }
        .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
        .row .left { text-align: left; flex: 1 1 auto; }
        .row .right { text-align: right; flex: 0 0 auto; white-space: nowrap; }
        .center { text-align: center; }
        .bold { font-weight: 800; }
        .small { font-size: 11px; }
        .muted { color: #555; }
        .note { font-style: italic; color: #111; }
        .pad4 { padding-top: 4px; padding-bottom: 4px; }
        .line { border-top: 1px dashed #888; margin: 8px 0; }
        @media print { @page { margin: 0; size: 80mm auto; } body { padding: 4mm; } }
      </style>
    </head><body>
      <div class="center bold">${escapeHtml(hdr.line1)}</div>
      <div class="center small muted">${escapeHtml(hdr.line2)}</div>
      <div class="title center">${escapeHtml(meta.title)}</div>
      <div class="line"></div>
      <div class="row"><div class="left">Order</div><div class="right">${escapeHtml(String(orderNo || ''))}</div></div>
      <div class="row"><div class="left">Date</div><div class="right">${escapeHtml(createdAt.toLocaleString())}</div></div>
      ${orderType ? `<div class="row"><div class="left">Type</div><div class="right">${escapeHtml(orderType)}</div></div>` : ''}
      ${tableStr ? `<div class="row"><div class="left">Table</div><div class="right">${tableStr}</div></div>` : ''}
      ${customerStr ? `<div class="row"><div class="left">Customer</div><div class="right">${customerStr}</div></div>` : ''}
      <div class="line"></div>
      ${rows.join('')}
      ${totalsParts.join('')}
      <div class="line"></div>
      <div class="center small muted">Printed: ${escapeHtml(new Date(meta.printedAt).toLocaleString())}</div>
      <div class="center small bold">Thank you</div>
      <div class="center small muted">${escapeHtml(hdr.defaultFooter)}</div>
    </body></html>`;
  };

  const mockBuildKitchenTicketHtml = (
    order: any,
    items: any[],
    modifiers: any[],
    meta: { printedAt: number }
  ): string => {
    const createdAt = order?.created_at ? new Date(Number(order.created_at)) : new Date();
    const hdr = mockResolveBranchHeader(order);
    const orderNo = order?.order_number || order?.orderNumber || '';
    const rows: string[] = [];
    for (const it of items || []) {
      const name = it.name_snapshot || it.menuItemName || it.name || 'Item';
      const qty = Number(it.quantity ?? 1);
      const note = it.special_instructions || it.specialInstructions || it.notes || '';
      const itemId = it.id || it.order_item_id || it._id;
      const itemMods = (modifiers || []).filter((m) =>
        String(m.order_item_id || m.orderItemId || m._id) === String(itemId)
      );
      rows.push(`
        <div class="kitem">
          <div class="kqty">${escapeHtml(String(qty))}×</div>
          <div class="kname">${escapeHtml(name)}</div>
        </div>
      `);
      for (const mod of itemMods) {
        rows.push(`<div class="kmod">+ ${escapeHtml(String(mod.modifier_name || mod.modifierName || ''))}: ${escapeHtml(String(mod.option_name || mod.optionName || ''))}</div>`);
      }
      if (note) rows.push(`<div class="note">※ ${escapeHtml(String(note))}</div>`);
    }

    const orderType = String(order?.order_type ?? order?.orderType ?? '').replace(/_/g, ' ');
    return `<!doctype html><html><head><meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 12px; margin: 0; padding: 12px; color: #000; }
        h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
        h2 { font-size: 13px; margin: 0 0 6px; text-align: center; }
        .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
        .row .left { text-align: left; flex: 1 1 auto; }
        .row .right { text-align: right; flex: 0 0 auto; }
        .center { text-align: center; }
        .kitem { display: flex; gap: 8px; margin: 8px 0 2px; }
        .kqty { flex: 0 0 auto; font-weight: 900; font-size: 16px; }
        .kname { flex: 1 1 auto; font-weight: 800; font-size: 15px; }
        .kmod { padding-left: 28px; font-size: 12px; color: #222; }
        .note { font-style: italic; color: #111; }
        .small { font-size: 11px; color: #333; }
        .line { border-top: 1px dashed #888; margin: 8px 0; }
        @media print { @page { margin: 0; size: 80mm auto; } body { padding: 4mm; } }
      </style>
    </head><body>
      <h1>KITCHEN TICKET</h1>
      <h2>${escapeHtml(hdr.line1)}</h2>
      <div class="line"></div>
      <div class="row"><div class="left">Order</div><div class="right">${escapeHtml(String(orderNo || ''))}</div></div>
      <div class="row"><div class="left">Time</div><div class="right">${escapeHtml(createdAt.toLocaleString())}</div></div>
      ${(order?.table_id || order?.tableId) && (order?.table_name || order?.tableName) ? `<div class="row"><div class="left">Table</div><div class="right">${escapeHtml(String(order.table_name || order.tableName))}</div></div>` : ''}
      ${orderType ? `<div class="row"><div class="left">Type</div><div class="right">${escapeHtml(orderType)}</div></div>` : ''}
      ${(order?.customer_name || order?.customerName) ? `<div class="row"><div class="left">Customer</div><div class="right">${escapeHtml(String(order.customer_name || order.customerName))}</div></div>` : ''}
      ${(order?.note || order?.notes) ? `<div class="row"><div class="left">Note</div><div class="right">${escapeHtml(String(order.note || order.notes))}</div></div>` : ''}
      <div class="line"></div>
      ${rows.join('')}
      <div class="line"></div>
      <div class="center small">Printed ${escapeHtml(new Date(meta.printedAt).toLocaleTimeString())}</div>
    </body></html>`;
  };

  const mockPrintHtml = async (html: string): Promise<void> => {
    // Render into a clean iframe, then trigger native window.print() through
    // the iframe's content window. Clobber the same iframe slot each print so
    // we don't leak iframes.
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const iframeId = 'pos-shim-print-frame';
    let iframe: HTMLIFrameElement | null = document.getElementById(iframeId) as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = iframeId;
      iframe.style.position = 'fixed';
      iframe.style.right = '-9999px';
      iframe.style.top = '0';
      iframe.style.width = '400px';
      iframe.style.height = '1200px';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      document.body.appendChild(iframe);
    }
    return new Promise<void>((resolve) => {
      if (!iframe) return resolve();
      const done = () => {
        try {
          const win = iframe?.contentWindow;
          if (win && typeof win.print === 'function') {
            win.focus();
            win.print();
          }
        } catch { /* ignore print errors */ }
        setTimeout(() => resolve(), 100);
      };
      try {
        iframe.onload = done;
        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        } else {
          done();
        }
      } catch {
        done();
      }
    });
  };

  const api: any = {
    // Parity with real Electron preload cashiers.ts getApiBaseUrlSync/getApiBaseUrl:
    // the renderer resolveApiBase in remote-auth.ts asks for these FIRST so
    // browser mock-shim mode and real Electron packaged mode share an
    // identical URL-resolution protocol. Resolve URL once, the result is
    // deterministic for this page-load.
    getApiBaseUrlSync: () => resolvePublicApiBase(),
    getApiBaseUrl: async () => resolvePublicApiBase(),

    getConnectionStatus: async () => {
      await delay(20);
      return { status: navigator.onLine ? 'ONLINE' : 'OFFLINE', lastSuccessfulAt: Date.now() - 60000 };
    },

    // CORS bypass for PIN login: the shim uses real renderer fetch since the
    // browser shim runs on a real URL (no file://) so CORS always works. We
    // still expose the signature for interface parity with the real Electron
    // preload cashiers.ts, so code paths testing for
    // window.electronAPI.authPinLogin() can unconditionally invoke it.
    authPinLogin: async (payload: { pin: string; branchId?: string; deviceId?: string }) => {
      const url = `${resolvePublicApiBase().replace(/\/+$/, '')}/auth/pin/login`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8_000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
          signal: controller.signal,
          cache: 'no-store' as RequestCache,
        }).finally(() => clearTimeout(timeoutId));
        let body: unknown = null;
        try { body = await resp.json(); } catch { body = null; }
        return {
          url,
          status: resp.status,
          ok: resp.ok,
          statusText: resp.statusText,
          body,
        };
      } catch (err) {
        const e = err as Error;
        return {
          url,
          status: -1,
          ok: false,
          statusText: e?.name || 'Error',
          body: { message: e?.message || String(err) },
        };
      }
    },

    // Generic public HTTP GET (CORS bypass) — parity with real Electron
    // preload cashiers.ts. Browser shim runs over real https origin so CORS
    // is OK; we still route through here so the shape {status, ok, body,
    // text} matches exactly for callers.
    publicHttpGet: async (path: string) => {
      const base = resolvePublicApiBase().replace(/\/+$/, '');
      const safePath = path.startsWith('/') ? path : `/${path}`;
      const url = `${base}${safePath}`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);
        const resp = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store' as RequestCache,
        }).finally(() => clearTimeout(timeoutId));
        const text = await resp.text().catch(() => '');
        let body: unknown = null;
        try {
          if (text) body = JSON.parse(text);
        } catch { body = null; }
        return {
          url,
          status: resp.status,
          ok: resp.ok,
          statusText: resp.statusText,
          body,
          text,
        };
      } catch (err) {
        const e = err as Error;
        return {
          url,
          status: -1,
          ok: false,
          statusText: e?.name || 'Error',
          text: e?.message || String(err),
          body: { message: e?.message || String(err) },
        };
      }
    },

    sync: {
      subscribeStatus: (_cb: any) => () => {},
      unsubscribeStatus: () => {},
    },

    db: {
      meta: {
        getLastAuth: async () => {
          await delay(10);
          return mockLastAuth;
        },
        setLastAuth: async (v: any) => {
          await delay(10);
          mockLastAuth = v;
          return true;
        },
      },

      employees: {
        findAll: async () => {
          await delay(15);
          return [...SEEDED_EMPLOYEES];
        },
        findByPin: async (pinOrBranchId: string, pin?: string) => {
          await delay(25);
          const resolvedPin: string =
            typeof pin === 'string' && pin !== undefined ? pin : pinOrBranchId;

          // -------------------------------------------------------------------
          // PRIMARY-OFFLINE POLICY: local cache FIRST, network LAST.
          // -------------------------------------------------------------------
          // User confirmed: "POS system will be used MOSTLY without internet.
          // The offline login should be priority." On the browser shim path
          // (pos.prolifictables.com / localhost web) we MUST NOT force a
          // 15s network timeout when the cashier has already logged in via
          // this browser before and we have them cached locally.
          //
          // Local check order (purely in-memory / localStorage):
          //   1. Upserted-employee local pin map (from any prior successful
          //      online login via `upsertWithPin` or the applySnapshot path
          //      that stored a pin).
          //   2. SEEDED_EMPLOYEES demo list for 1234/0000 demo pins (dev
          //      experience + backwards compat).
          //   3. mockLastAuth employee: if the last logged-in employee
          //      matches the typed pin, treat it as still valid offline.
          //
          // Only IF local lookup returns nothing do we attempt the network.
          // On network error → return local hit instead of throwing.
          // On network HTTP 401/400/403 → still return null (real credential
          // mismatch from server — never fall to SEEDED to mask the real
          // rejection).
          // -------------------------------------------------------------------
          const SERVER_UNREACHABLE_MARKER_SHIM = '🔴 SERVER_UNREACHABLE';
          const unreachableShimErr = (why: string) =>
            new Error(`${SERVER_UNREACHABLE_MARKER_SHIM}: ${why}`);

          // Hostname booleans used both by resolveShimApiBase below AND by
          // the try/catch block that decides whether to fall to SEEDED.
          const prodHostname = (() => {
            if (typeof window === 'undefined' || typeof window.location?.hostname !== 'string')
              return false;
            const hn = window.location.hostname.toLowerCase();
            return (
              hn === 'prolifictables.com' ||
              hn.endsWith('.prolifictables.com') ||
              hn === 'onrender.com' ||
              hn.endsWith('.onrender.com')
            );
          })();
          const localhostHostname = (() => {
            if (typeof window === 'undefined' || typeof window.location?.hostname !== 'string')
              return false;
            const hn = window.location.hostname.toLowerCase();
            return hn === 'localhost' || hn === '127.0.0.1' || hn === '';
          })();

          // (A) Local pin-cache: employees whose plaintext pin (or bcrypt
          // hash) were previously stored on this browser shim instance.
          // Only populated when a prior online login stored them here.
          if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
            try {
              const shimCachedRaw = window.localStorage.getItem('prolific-shim-employees-v1');
              if (shimCachedRaw && shimCachedRaw.trim()) {
                const list = JSON.parse(shimCachedRaw) as any[];
                const hit = list.find((e: any) => e.pin === resolvedPin || e.pinHash === resolvedPin);
                if (hit && hit.id) return hit;
              }
            } catch { /* ignore JSON/corruption */ }
          }
          // (B) SEEDED demo cashiers (1234 / 0000) — always local-fast,
          // works even with zero network. Checks all SEEDED_EMPLOYEES pins.
          const seededHit = SEEDED_EMPLOYEES.find((e) => e.pin === resolvedPin);
          if (seededHit) return seededHit;

          // (C) Last-auth single employee match: if the last logged-in
          // employee has a pin= field that survived from previous session
          // via mockLastAuth.persistedPin (we set it below on any online
          // success), reuse it locally-fast.
          if (mockLastAuth && (mockLastAuth as any).cachedPin === resolvedPin && (mockLastAuth as any).cachedEmployee) {
            return (mockLastAuth as any).cachedEmployee;
          }

          // Shared API base resolver (duplicated locally to avoid circular import
          // from remote-auth into shim, but SAME CHAIN — 4-tier priority exactly
          // matches resolveApiBase in ../remote-auth.ts:
          //   (0) localStorage "prolific_api_base" operator override (HIGHEST)
          //   (1) VITE_API_BASE_URL / VITE_API_URL / VITE_PUBLIC_API_URL / API_BASE_URL
          //   (2) prod hostname → https://api.prolifictables.com/api/v1
          //   (3) localhost → http://localhost:4000/api/v1
          const resolveShimApiBase = (): string => {
            // (0) localStorage operator override — HIGHEST priority.
            if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
              try {
                const override = window.localStorage.getItem('prolific_api_base');
                if (typeof override === 'string' && override.trim().length > 3) {
                  const trimmed = override.trim().replace(/\/+$/, '');
                  if (/\/api\/v\d+\/?$/.test(trimmed) || trimmed.endsWith('/v1') || trimmed.endsWith('/v0')) {
                    return trimmed;
                  }
                  return `${trimmed}/api/v1`;
                }
              } catch {
                // localStorage blocked (Safari private, etc.) → fall through
              }
            }
            // (1) Vite build env
            const viteExplicit =
              (typeof import.meta !== 'undefined' &&
                (import.meta as any).env &&
                ((import.meta as any).env.VITE_API_BASE_URL ||
                  (import.meta as any).env.VITE_API_URL ||
                  (import.meta as any).env.VITE_PUBLIC_API_URL ||
                  (import.meta as any).env.API_BASE_URL)) ||
              null;
            if (viteExplicit) return viteExplicit;
            // (2) Prod hostname → REAL confirmed Render API slug.
            // NOTE: User explicitly confirmed the API is hosted at
            //       https://prolific-api.onrender.com.
            if (prodHostname) return 'https://prolific-api.onrender.com/api/v1';
            // (3) Dev localhost
            return 'http://localhost:4000/api/v1';
          };

          try {
            const API_BASE_FOR_SHIM = resolveShimApiBase();

            // Since this network try block ONLY runs AFTER all local lookups
            // (shim employees cache, SEEDED, mockLastAuth cachedPin) failed to
            // find a match, we can aggressively timeout. A primary-offline
            // terminal has no internet 90% of the time — waiting 15s when
            // we already know this is a first-time-login cache miss is bad
            // UX. On localhost keep 15s for debugging; on prod use 2500ms
            // (enough for Render if already warm, fast-fail otherwise).
            const abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const SHIM_PIN_HTTP_TIMEOUT = localhostHostname ? 15_000 : 2_500;
            let timeoutHandle: any = null;
            if (abortCtrl) {
              timeoutHandle = setTimeout(() => abortCtrl.abort(), SHIM_PIN_HTTP_TIMEOUT);
            }
            let resp: Response;
            try {
              resp = await fetch(`${API_BASE_FOR_SHIM}/auth/pin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: resolvedPin }),
                signal: abortCtrl ? abortCtrl.signal : undefined,
              });
            } finally {
              if (timeoutHandle) clearTimeout(timeoutHandle);
            }
            if (resp.ok) {
              const payload = await resp.json().catch(() => ({}));
              const envelope = payload && payload.data ? payload.data : payload;
              const emp = envelope?.employee;
              const usr = envelope?.user;
              if (emp && emp.id) {
                const returned: any = {
                  id: emp.id,
                  userId: emp.userId ?? usr?.id ?? null,
                  restaurantId: emp.restaurantId ?? envelope?.restaurant?.id ?? null,
                  branchId: emp.branchId ?? envelope?.branch?.id ?? null,
                  role: emp.role,
                  firstName: usr?.firstName ?? '',
                  lastName: usr?.lastName ?? '',
                  name: usr ? `${usr.firstName ?? ''} ${usr.lastName ?? ''}`.trim() : '',
                  email: usr?.email ?? '',
                  phone: usr?.phone ?? '',
                  pin: resolvedPin,
                  positionTitle: emp.positionTitle ?? '',
                  status: 'ACTIVE',
                };
                // PRIMARY-OFFLINE cache: persist the returned employee + pin
                // to localStorage.shim-employees-v1 AND the singleton
                // cachedPin/cachedEmployee on mockLastAuth so the NEXT login
                // hits local check (A) or (C) above — instant <50ms, zero
                // network.
                try {
                  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
                    const existingRaw = window.localStorage.getItem('prolific-shim-employees-v1');
                    let list: any[] = [];
                    try { list = existingRaw ? JSON.parse(existingRaw) : []; } catch { list = []; }
                    if (!Array.isArray(list)) list = [];
                    list = list.filter((e: any) => e.id !== returned.id);
                    list.push({ ...returned });
                    try { window.localStorage.setItem('prolific-shim-employees-v1', JSON.stringify(list)); } catch { /* ignore quota */ }
                  }
                } catch { /* ignore localStorage persistence failures; memory-only next-boot */ }
                // (C) single-pin memory cache. Set it even if localStorage fails
                // so at least same-browser-reopen-later is still offline-instant.
                if (mockLastAuth && typeof mockLastAuth === 'object') {
                  (mockLastAuth as any).cachedPin = resolvedPin;
                  (mockLastAuth as any).cachedEmployee = returned;
                }
                return returned;
              }
            }
            if (resp.status === 401 || resp.status === 400 || resp.status === 403) {
              // Real explicit 4xx: server says wrong PIN. Return null (caller
              // shows Incorrect PIN). Do NOT fall to SEEDED.
              return null;
            }
            // Any other non-2xx (502/503/504 Render sleeping, or 404 for wrong
            // API path, etc.) → unreachable if not localhost. On localhost it
            // means dev server is down → fall to SEEDED demo cashiers.
            if (localhostHostname) {
              // fall through
            } else {
              throw unreachableShimErr(
                `Server returned HTTP ${resp.status} instead of rejecting PIN`
              );
            }
          } catch (err) {
            // Always re-throw the SERVER_UNREACHABLE marker if we set it.
            if (typeof err === 'object' && err !== null && (err as any).message?.includes?.(SERVER_UNREACHABLE_MARKER_SHIM)) {
              throw err;
            }
            // AbortError (timeout 15s) → unreachable, not wrong PIN.
            // (Hard-coded literal 15 here instead of SHIM_PIN_HTTP_TIMEOUT to
            // avoid TDZ issues if the const declaration ever moves.)
            if (typeof err === 'object' && err !== null && ((err as any).name === 'AbortError' || (err as any).code === 20)) {
              throw unreachableShimErr(`POST /auth/pin/login timed out after 15s`);
            }
            // Real network-level error (no connectivity, CORS, DNS not
            // resolving): on localhost we fall to SEEDED demo cashiers; on
            // ANY production hostname we mark unreachable (SEEDED is useless
            // because admin PINs never make it to SEEDED).
            if (localhostHostname) {
              // fall through to SEEDED below
            } else {
              const reason =
                (typeof err === 'object' && err !== null && typeof (err as any).message === 'string'
                  ? (err as any).message
                  : 'network error');
              throw unreachableShimErr(`Network fail on PIN POST: ${reason}`);
            }
          }

          // ONLY REACHABLE on localhost hostnames where the developer has no
          // backend running. Show SEEDED demo cashiers. Production hostnames
          // will have thrown unreachable above so never get here.
          return SEEDED_EMPLOYEES.find((e) => e.pin === resolvedPin) || null;
        },
        applySnapshot: async (_employees: unknown) => {
          await delay(10);
          return true;
        },
        upsertWithPin: async (employee: unknown, pin: string) => {
          await delay(10);
          // Mirror Electron SQLite: persist the employee + plaintext pin into
          // the browser shim's localStorage mirror so findByPin's local check
          // (A) on subsequent logins returns instantly. This mirrors the
          // offline-first priority across the shim.
          if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
            try {
              const e = (employee || {}) as any;
              const id = String(e.id || e._id || '');
              const userId = String(e.userId || e.user_id || '');
              const restaurantId = String(e.restaurantId || e.restaurant_id || '');
              const branchId = String(e.branchId || e.branch_id || '');
              if (id && typeof pin === 'string' && pin.length >= 4) {
                const existingRaw = window.localStorage.getItem('prolific-shim-employees-v1');
                let list: any[] = [];
                try { list = existingRaw ? JSON.parse(existingRaw) : []; } catch { list = []; }
                if (!Array.isArray(list)) list = [];
                list = list.filter((x: any) => x.id !== id);
                list.push({
                  id,
                  userId,
                  restaurantId,
                  branchId,
                  role: String(e.role || 'CASHIER'),
                  firstName: e.firstName || e.first_name || '',
                  lastName: e.lastName || e.last_name || '',
                  email: e.email || '',
                  phone: e.phone || '',
                  positionTitle: e.positionTitle || e.position_title || '',
                  pin,
                  status: 'ACTIVE',
                });
                try { window.localStorage.setItem('prolific-shim-employees-v1', JSON.stringify(list)); } catch { /* ignore quota */ }
              }
            } catch { /* ignore */ }
          }
          if (mockLastAuth && typeof mockLastAuth === 'object') {
            const e = (employee || {}) as any;
            const id = String(e.id || e._id || '');
            if (id && typeof pin === 'string' && pin.length >= 4) {
              (mockLastAuth as any).cachedPin = pin;
              (mockLastAuth as any).cachedEmployee = e && typeof e === 'object' ? { ...e, pin } : null;
            }
          }
          return true;
        },
      },

      // Aggregated menu namespace. Electron SQLite implementation exists in the real
      // desktop IPC bridge (ipc-db-bridge.ts). The browser mock shim was
      // previously missing this, so LoginScreen + CashierScreenLayout calls to
      // db.menu.applySnapshot were SILENT NO-OPS via the window.electronAPI?.db?.menu?.applySnapshot?.(...)
      // optional chain — meaning the 60s / 15s reference refresh tick never actually
      // populated the shared in-memory remoteMenuSnapshot from anywhere except in
      // MenuGrid's own direct applyRemoteMenuSnapshot() call. Now both paths
      // now both code paths converge to the same in-memory state:
      menu: {
        applySnapshot: async (snapshot: unknown) => {
          const s = snapshot as { categories?: any[]; items?: any[]; modifiers?: any[] };
          applyRemoteMenuSnapshot({
            categories: Array.isArray(s?.categories) ? s.categories : [],
            items: Array.isArray(s?.items) ? s.items : [],
            modifiers: Array.isArray(s?.modifiers) ? s.modifiers : [],
          });
          return true;
        },
      },

      menuCategories: {
        listAll: async () => {
          await delay(5);
          const source = resolveMenuSource('categories');
          return source.filter(
            (c) => (c as any).isActive !== false && (c as any).is_active !== 0
          );
        },
        upsert: async (row: any) => {
          await delay(5);
          return upsertIntoMenuArray('categories', row);
        },
        deleteById: async (id: string) => {
          await delay(5);
          return softDeleteFromMenuArray('categories', id);
        },
      },

      menuItems: {
        list: async (filters?: { status?: string; categoryId?: string }) => {
          await delay(5);
          const allowed = new Set(['AVAILABLE', 'OUT_OF_STOCK', 'OOS', 'SCHEDULED']);
          const source = resolveMenuSource('items');
          const out = source.filter((m) => {
            if ((m as any).isActive === false || (m as any).is_active === 0) return false;
            if (!allowed.has(String(m.status || 'AVAILABLE'))) return false;
            if (filters?.status && String(m.status) !== String(filters.status)) return false;
            if (filters?.categoryId && String(m.categoryId) !== String(filters.categoryId)) return false;
            return true;
          });
          return out;
        },
        findById: async (id: string) => {
          await delay(5);
          const source = resolveMenuSource('items');
          return source.find((m) => String(m.id) === String(id)) || null;
        },
        listByCategory: async (categoryId: string) => {
          await delay(5);
          const allowed = new Set(['AVAILABLE', 'OUT_OF_STOCK', 'OOS', 'SCHEDULED']);
          const source = resolveMenuSource('items');
          return source.filter((m) => {
            if ((m as any).isActive === false || (m as any).is_active === 0) return false;
            if (!allowed.has(String(m.status || 'AVAILABLE'))) return false;
            return String(m.categoryId) === String(categoryId);
          });
        },
        search: async (q: string) => {
          await delay(10);
          const allowed = new Set(['AVAILABLE', 'OUT_OF_STOCK', 'OOS', 'SCHEDULED']);
          const source = resolveMenuSource('items');
          const pool = source.filter((m) => {
            if ((m as any).isActive === false || (m as any).is_active === 0) return false;
            return allowed.has(String(m.status || 'AVAILABLE'));
          });
          const ql = (q || '').toLowerCase();
          return pool.filter(
            (m) =>
              m.name.toLowerCase().includes(ql) ||
              (m.description || '').toLowerCase().includes(ql)
          );
        },
        upsert: async (row: any) => {
          await delay(5);
          return upsertIntoMenuArray('items', row);
        },
        deleteById: async (id: string) => {
          await delay(5);
          return softDeleteFromMenuArray('items', id);
        },
      },

      menuModifiers: {
        listAll: async (branchId?: string) => {
          await delay(5);
          const source = resolveMenuSource('modifiers');
          const filtered = source.filter((m) => {
            if ((m as any).isActive === false || (m as any).is_active === 0) return false;
            if (branchId && String((m as any).branchId) !== String(branchId)) return false;
            return true;
          });
          return filtered.map((m) => {
            const opts = Array.isArray((m as any).options) ? (m as any).options : [];
            return { ...m, options: opts };
          });
        },
        listByIds: async (ids: string[]) => {
          await delay(5);
          if (!Array.isArray(ids) || ids.length === 0) return [];
          const set = new Set(ids.map((i) => String(i)));
          const source = resolveMenuSource('modifiers');
          const filtered = source.filter((m) => {
            if ((m as any).isActive === false || (m as any).is_active === 0) return false;
            return set.has(String((m as any).id));
          });
          return filtered.map((m) => {
            const opts = Array.isArray((m as any).options) ? (m as any).options : [];
            return { ...m, options: opts };
          });
        },
        listOptionsByModifierIds: async (ids: string[]) => {
          await delay(5);
          if (!Array.isArray(ids) || ids.length === 0) return [];
          const set = new Set(ids.map((i) => String(i)));
          const source = resolveMenuSource('modifiers');
          const options: any[] = [];
          for (const m of source) {
            if (!set.has(String((m as any).id))) continue;
            if ((m as any).isActive === false || (m as any).is_active === 0) continue;
            const opts = Array.isArray((m as any).options) ? (m as any).options : [];
            for (const opt of opts) {
              if ((opt as any).isActive === false || (opt as any).is_active === 0) continue;
              options.push({ ...opt, modifierId: (m as any).id });
            }
          }
          return options;
        },
        listForItemId: async (itemId: string) => {
          await delay(10);
          const itemsSource = resolveMenuSource('items');
          const modifiersSource = resolveMenuSource('modifiers');
          const item = itemsSource.find((m) => String(m.id) === String(itemId));
          if (!item) return [];
          const joined = modifiersForItem(item, modifiersSource);
          return joined.map((m) => {
            const opts = Array.isArray((m as any).options) ? (m as any).options : [];
            return { ...m, options: opts };
          });
        },
        upsert: async (payload: { modifier: any; options: any[] }) => {
          await delay(5);
          const { modifier, options } = payload || {};
          const snap = ensureRemoteSnapshotWritable();
          const arr = snap.modifiers as any[];
          const modIn = modifier || {};
          const optsIn = Array.isArray(options) ? options : [];
          const id = String(modIn?.id ?? '');
          const idx = id ? arr.findIndex((e) => String(e.id) === id) : -1;
          const timestampedMod = { ...modIn, updatedAt: modIn?.updatedAt ?? Date.now() };
          const mergedOptions = optsIn.map((o: any) => ({
            ...o,
            updatedAt: o?.updatedAt ?? Date.now(),
            isActive: o?.isActive ?? true,
          }));
          let final: any;
          if (idx >= 0) {
            arr[idx] = {
              ...arr[idx],
              ...timestampedMod,
              options: mergedOptions,
              updatedAt: Date.now(),
            };
            final = arr[idx];
          } else {
            final = {
              createdAt: modIn?.createdAt ?? Date.now(),
              ...timestampedMod,
              options: mergedOptions,
              isActive: modIn?.isActive ?? true,
            };
            arr.push(final);
          }
          persistRemoteSnapshotToOffline();
          return final;
        },
        deleteById: async (id: string) => {
          await delay(5);
          return softDeleteFromMenuArray('modifiers', id);
        },
      },

      taxes: {
        listActiveDefaults: async () => {
          await delay(10);
          return [...SEEDED_TAXES];
        },
      },

      diningTables: {
        listAll: async () => {
          await delay(15);
          return [...SEEDED_TABLES];
        },
        listByZone: async () => [...SEEDED_TABLES],
        update: async () => true,
      },

      orders: {
        list: async () => {
          await delay(15);
          return [...mockOrders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        },
        listRecent: async (_limit?: number) => {
          await delay(15);
          return [...mockOrders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        },
        get: async (id: string) => mockOrders.find((o) => o.id === id) || null,
        getById: async (id: string) => mockOrders.find((o) => o.id === id) || null,
        create: async (draft: any) => {
          await delay(20);
          const order = {
            id: draft.id || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            orderNumber: draft.orderNumber || `#${10000 + Math.floor(Math.random() * 90000)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...draft,
          };
          mockOrders.unshift(order);
          return order;
        },
        addItem: async (orderId: string, item: any) => {
          await delay(5);
          mockOrderItems.push({ order_id: orderId, ...item });
          return true;
        },
        removeItem: async (_orderId: string, itemId: string) => {
          await delay(5);
          const idx = mockOrderItems.findIndex((it) => String(it.id) === String(itemId));
          if (idx >= 0) mockOrderItems.splice(idx, 1);
          const idxs: number[] = [];
          mockOrderItemModifiers.forEach((m, i) => {
            if (String(m.order_item_id) === String(itemId)) idxs.push(i);
          });
          idxs.reverse().forEach((i) => mockOrderItemModifiers.splice(i, 1));
          return true;
        },
        listHeld: async (employeeId?: string) => {
          await delay(5);
          return mockOrders.filter((o) => {
            if (o.status !== 'ON_HOLD') return false;
            if (employeeId && String(o.heldBy || o.held_by || '') !== String(employeeId)) return false;
            return true;
          });
        },
        setHeld: async (id: string, held: boolean, _reason?: string) => {
          await delay(5);
          const idx = mockOrders.findIndex((o) => o.id === id);
          if (idx < 0) return null;
          mockOrders[idx] = {
            ...mockOrders[idx],
            status: held ? 'ON_HOLD' : (mockOrders[idx].status || 'NEW'),
            heldBy: held ? mockOrders[idx].heldBy || mockLastAuth.employeeId : null,
            heldAt: held ? Date.now() : null,
            updatedAt: Date.now(),
          };
          return mockOrders[idx];
        },
        update: async (id: string, patch: any) => {
          const idx = mockOrders.findIndex((o) => o.id === id);
          if (idx >= 0) {
            mockOrders[idx] = { ...mockOrders[idx], ...patch, updatedAt: Date.now() };
            return mockOrders[idx];
          }
          return null;
        },
        updateStatus: async (id: string, status: string) => {
          const idx = mockOrders.findIndex((o) => o.id === id);
          if (idx >= 0) {
            mockOrders[idx] = { ...mockOrders[idx], status, updatedAt: Date.now() };
            if (status === 'COMPLETED') mockOrders[idx].paymentStatus = 'PAID';
            return mockOrders[idx];
          }
          return null;
        },
        // Counter-attendant "Mark as Paid" for QR/website/counter-pay orders.
        // Atomically updates the order's payment status + PAID amount cents,
        // writes a local-verification Payment ledger row, and returns the order.
        updatePaymentStatus: async (
          id: string,
          payload: {
            paymentStatus: string;
            method: string;
            paidAmountCents?: number;
            note?: string;
            employeeId?: string;
            employeeName?: string;
            shiftId?: string;
            referenceId?: string;
          }
        ) => {
          await delay(10);
          const idx = mockOrders.findIndex((o) => o.id === id);
          if (idx < 0) return null;
          const order = mockOrders[idx];
          const totalCents =
            Number(order.totalCents ?? 0) ||
            Math.round(Number(order.totalAmount ?? 0) * 100);
          const paid = Number(payload.paidAmountCents ?? totalCents);
          const balanceDue = Math.max(0, totalCents - paid);
          const effectiveStatus =
            balanceDue <= 0
              ? payload.paymentStatus || 'PAID'
              : payload.paymentStatus === 'PAID'
              ? 'PARTIALLY_PAID'
              : payload.paymentStatus || 'PARTIALLY_PAID';
          const patched = {
            ...order,
            paymentStatus: effectiveStatus,
            paymentMethod: payload.method,
            paidAmountCents: paid,
            paidAmount: paid / 100,
            balanceDueCents: balanceDue,
            balanceDue: balanceDue / 100,
            updatedAt: Date.now(),
          };
          mockOrders[idx] = patched;
          // Persist the payment so shift-close reconciliation + per-order history
          // (Print Receipt) both see it.
          const payRow: any = {
            id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            orderId: id,
            order_id: id,
            employeeId: payload.employeeId || null,
            employee_id: payload.employeeId || null,
            employeeName: payload.employeeName || null,
            shiftId: payload.shiftId || null,
            amountCents: paid,
            amount: paid / 100,
            method: payload.method,
            status: effectiveStatus === 'FAILED' ? 'FAILED' : 'PAID',
            verificationType: 'LOCAL',
            referenceId: payload.referenceId || null,
            terminalId: 'POS-WEB-LOCAL',
            receiptNumber: `RCP-${Date.now().toString().slice(-8)}`,
            notes: payload.note || null,
            processedAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          mockPayments.push(payRow);
          return { order: patched, payment: payRow };
        },
        recallToCart: async (id: string) => mockOrders.find((o) => o.id === id) || null,
        // Used by TablePickerModal to show how many open orders each table has
        listByTableId: async (tableId: string) =>
          mockOrders.filter(
            (o) => o.tableId === tableId && o.status !== 'CLOSED' && o.status !== 'COMPLETED'
          ),
      },

      orderItems: {
        listForOrderId: async (orderId: string) =>
          mockOrderItems.filter((it) => String(it.order_id || it.orderId) === String(orderId)),
      },

      orderItemModifierOptions: {
        bulkInsert: async (rows: any[]) => {
          await delay(5);
          mockOrderItemModifiers.push(...(Array.isArray(rows) ? rows : []));
          return true;
        },
        listForOrderId: async (orderId: string) => {
          const items = mockOrderItems.filter((it) => String(it.order_id || it.orderId) === String(orderId));
          const itemIds = new Set(items.map((it) => String(it.id)));
          return mockOrderItemModifiers.filter((m) => itemIds.has(String(m.order_item_id || m.orderItemId)));
        },
      },

      payments: {
        create: async (p: any) => {
          await delay(15);
          const pay = { id: p.id || `pay-${Date.now()}`, createdAt: Date.now(), ...p };
          mockPayments.push(pay);
          return pay;
        },
        listForOrder: async (orderId: string) => mockPayments.filter((p) => p.orderId === orderId),
        listByOrderId: async (orderId: string) => mockPayments.filter((p) => p.orderId === orderId || String(p.order_id || '') === String(orderId)),
        // Used by ShiftModal close reconciliation to sum takings for the shift
        listByShiftId: async (shiftId: string) =>
          mockPayments.filter((p) => p.shiftId === shiftId),
        // Computed end-of-shift reconciliation totals. Mirrors the SQL
        // aggregation performed by the repository's getShiftTotals — same
        // shape so ShiftModal close mode renders identically in browser shim
        // dev mode vs packaged Electron.
        getShiftTotals: async (shiftId: string) => {
          await delay(10);
          const pays = mockPayments.filter((p) =>
            (p.shiftId === shiftId) &&
            (p.status === 'PAID' || p.status === undefined)
          );
          let cash = 0, card = 0, other = 0, tip = 0;
          let cashCount = 0, cardCount = 0, otherCount = 0;
          const perMethod = new Map<string, { method: string; amount: number; tip: number; count: number }>();
          for (const p of pays) {
            const amt =
              typeof p.amount_cents === 'number' ? p.amount_cents :
              typeof p.amountCents === 'number' ? p.amountCents :
              Math.round((Number(p.amount || 0)) * 100);
            const tipCents =
              typeof p.tip_cents === 'number' ? p.tip_cents :
              typeof p.tipCents === 'number' ? p.tipCents :
              Math.round((Number(p.tip || 0)) * 100);
            const method = (p.method || 'OTHER').toUpperCase();
            tip += tipCents;
            const bucket = perMethod.get(method) || { method, amount: 0, tip: 0, count: 0 };
            bucket.amount += amt;
            bucket.tip += tipCents;
            bucket.count += 1;
            perMethod.set(method, bucket);
            if (method === 'CASH') { cash += amt; cashCount++; }
            else if (method.includes('CARD') || method === 'PAYSTACK' || method === 'FLUTTERWAVE' || method === 'POS') {
              card += amt; cardCount++;
            }
            else { other += amt; otherCount++; }
          }
          // Order statistics for the shift (all orders linked to this shift,
          // regardless of payment state — the SQL query does the same so
          // voids/refunds are counted properly).
          const shiftOrders = mockOrders.filter((o: any) =>
            o.shiftId === shiftId || String(o.shift_id || '') === String(shiftId)
          );
          let paidOrderCount = 0, voidedOrderCount = 0, refundedOrderCount = 0;
          let paidItemQty = 0, subtotalCents = 0, discountCents = 0, taxCents = 0, totalPaidCents = 0;
          for (const o of shiftOrders) {
            const status = (o.status || '').toUpperCase();
            const payStatus = (o.payment_status || o.paymentStatus || '').toUpperCase();
            if (payStatus === 'PAID') paidOrderCount++;
            if (status === 'VOID') voidedOrderCount++;
            if (status === 'REFUNDED') refundedOrderCount++;
            const itemQty =
              typeof o.item_qty === 'number' ? o.item_qty :
              typeof o.itemQty === 'number' ? o.itemQty :
              Number(o.quantity || 0);
            paidItemQty += itemQty;
            const st =
              typeof o.subtotal_cents === 'number' ? o.subtotal_cents :
              typeof o.subtotalCents === 'number' ? o.subtotalCents :
              Math.round(Number(o.subtotal || 0) * 100);
            const disc =
              typeof o.discount_cents === 'number' ? o.discount_cents :
              typeof o.discountCents === 'number' ? o.discountCents :
              Math.round(Number(o.discount || 0) * 100);
            const tx =
              typeof o.tax_cents === 'number' ? o.tax_cents :
              typeof o.taxCents === 'number' ? o.taxCents :
              Math.round(Number(o.tax || 0) * 100);
            const tot =
              typeof o.total_cents === 'number' ? o.total_cents :
              typeof o.totalCents === 'number' ? o.totalCents :
              Math.round(Number(o.total || 0) * 100);
            subtotalCents += st;
            discountCents += disc;
            taxCents += tx;
            totalPaidCents += tot;
          }
          // Payouts (petty cash withdrawals) — in the shim they live as
          // direction=PAID_OUT cash adjustments.
          let totalPayoutCents = 0, payoutCount = 0;
          let totalPaidInAdj = 0, totalPaidOutAdj = 0, cashAdjCount = 0;
          for (const a of mockCashAdjustments) {
            if (a.shiftId !== shiftId) continue;
            const amt =
              typeof a.amount_cents === 'number' ? a.amount_cents :
              typeof a.amountCents === 'number' ? a.amountCents :
              Math.round(Number(a.amount || 0) * 100);
            cashAdjCount++;
            const dir = (a.direction || a.type || '').toUpperCase();
            if (dir === 'PAID_OUT') { totalPaidOutAdj += amt; }
            else if (dir === 'PAID_IN') { totalPaidInAdj += amt; }
          }
          // In the SQL schema, distinct payouts table holds withdrawals; in
          // the shim we've historically used PAID_OUT cash adjustments.
          // Surface them as payouts too (non-destructive overlap is fine).
          totalPayoutCents = totalPaidOutAdj;
          payoutCount = mockCashAdjustments.filter((a) =>
            a.shiftId === shiftId &&
            ((a.direction || a.type || '').toUpperCase() === 'PAID_OUT')
          ).length;
          return {
            cash,
            card,
            other,
            total: cash + card + other,
            tip,
            counts: {
              cash: cashCount,
              card: cardCount,
              other: otherCount,
              total: cashCount + cardCount + otherCount,
            },
            perMethod: Array.from(perMethod.values()),
            orders: {
              paidOrderCount,
              voidedOrderCount,
              refundedOrderCount,
              paidItemQty,
              subtotalCents,
              discountCents,
              taxCents,
              totalPaidCents,
            },
            payouts: {
              totalPayoutCents,
              payoutCount,
            },
            cashAdjustments: {
              totalPaidInCents: totalPaidInAdj,
              totalPaidOutCents: totalPaidOutAdj,
              count: cashAdjCount,
            },
          };
        },
      },

      // Cash drawer adjustments (pay-ins, pay-outs, petty cash) referenced by
      // ShiftModal.tsx when computing the expected vs actual drawer amount
      cashAdjustments: {
        create: async (data: any) => {
          await delay(10);
          const adj = { id: `adj-${Date.now()}`, createdAt: Date.now(), ...data };
          mockCashAdjustments.push(adj);
          return adj;
        },
        listByShiftId: async (shiftId: string) =>
          mockCashAdjustments.filter((a) => a.shiftId === shiftId),
      },

      // Flat table listing (TablePickerModal.tsx uses db.tables.list for the
      // quick assign-table dropdown; distinct from diningTables floor-plan list)
      tables: {
        list: async () => {
          await delay(10);
          return [...SEEDED_TABLES];
        },
        listAll: async () => {
          await delay(10);
          return [...SEEDED_TABLES];
        },
        applySnapshot: async (_tables: unknown) => {
          await delay(10);
          return true;
        },
      },

      shifts: {
        // getOpen returns the currently OPEN shift for the given (employee,
        // branch, restaurant) context. If filter params are provided and the
        // globally stored open shift doesn't match, null is returned so the
        // cashier is forced to open a new shift (prevents cross-employee /
        // cross-branch shift takeovers without explicit reconciliation).
        //
        // Terminal-level override (user policy): if filter includes `deviceId` (per
        // shift open-shift restore on same device), employee/branch filters are skipped
        // explicitly passed through the SAME device-level comparisons take precedence.
        getOpen: async (filter?: { deviceId?: string; employeeId?: string; branchId?: string; restaurantId?: string }) => {
          await delay(10);
          // Refresh in-memory copy from storage so multi-tab scenarios and page
          // refreshes all see the latest authoritative open shift.
          const persisted = loadMockOpenShiftFromStorage();
          if (persisted) mockOpenShift = persisted;
          const open = mockOpenShift;
          if (!open) return null;
          // A shift can also carry status — ignore anything that isn't OPEN.
          if (open.status && open.status !== 'OPEN') return null;
          // The ShiftModal payload stores ids under snake_case keys
          // (employee_id, branch_id, restaurant_id, device_id) — the filter uses
          // camelCase. Normalize both sides before comparing so the scoping
          // check works reliably (this is critical for restore-after-refresh
          // and logout→login flows).
          const shiftEmployeeId = open.employeeId || open.employee_id;
          const shiftBranchId = open.branchId || open.branch_id;
          const shiftRestaurantId = open.restaurantId || open.restaurant_id;
          const shiftDeviceId = open.deviceId || open.device_id;
          // If filter provides a deviceId, use it as the primary match
          // (terminal-level per user policy).
          if (filter?.deviceId) {
            // Device id match wins — a shift may lack device_id (legacy shim rows).
            // Treat a match either by string equality OR if shift has no id at all.
            if (shiftDeviceId && shiftDeviceId !== filter.deviceId) return null;
            // Device id match: ignore employee/branch filter — inherit the
            // open shift regardless of who originally opened it (same
            // terminal).
            return open;
          }
          if (filter?.employeeId && shiftEmployeeId && shiftEmployeeId !== filter.employeeId) return null;
          if (filter?.branchId && shiftBranchId && shiftBranchId !== filter.branchId) return null;
          if (filter?.restaurantId && shiftRestaurantId && shiftRestaurantId !== filter.restaurantId) return null;
          return open;
        },
        open: async (payload: any) => {
          await delay(15);
          // Idempotency guard: mirror the Electron SQLite partial UNIQUE
          // index idx_shifts_device_open ON shifts(device_id) WHERE status =
          // 'OPEN'. In browser mode the "device id" key is the localStorage
          // open-shift singleton. If there is already an OPEN shift, reuse it
          // — never clobber or throw a visible error (equivalent to SQLite
          // "Unique constraint failed: shifts.device_id" in packaged mode).
          const persisted = loadMockOpenShiftFromStorage();
          if (persisted) mockOpenShift = persisted;
          if (mockOpenShift && (!mockOpenShift.status || mockOpenShift.status === 'OPEN')) {
            const cur = { ...mockOpenShift };
            // If the prior open shift has a zero/missing opening balance but
            // the new payload carries one, upgrade the balance (handles
            // "ghost shift skeleton with no opening_cash_cents").
            const newOpening = Number(payload?.opening_cash_cents ?? payload?.openingCashCents ?? 0);
            const curOpening = Number(cur.opening_cash_cents ?? cur.openingCashCents ?? 0);
            if (newOpening > 0 && !curOpening) {
              cur.opening_cash_cents = newOpening;
              cur.openingCashCents = newOpening;
              mockOpenShift = cur;
              saveMockOpenShiftToStorage(cur);
            }
            return cur;
          }
          mockOpenShift = { id: `sh-${Date.now()}`, openedAt: Date.now(), status: 'OPEN', ...payload };
          // Persist so browser refresh / logout+login keeps using the same
          // shift — the "Open New Shift" modal must not reappear until the
          // cashier explicitly ends the shift.
          saveMockOpenShiftToStorage(mockOpenShift);
          return mockOpenShift;
        },
        close: async (payload: any) => {
          await delay(15);
          if (mockOpenShift) {
            const closed = { ...mockOpenShift, closedAt: Date.now(), ...payload, status: 'CLOSED' };
            mockOpenShift = null;
            // Clear the persisted open shift so the next login cycle correctly
            // prompts the cashier to open a brand new shift.
            saveMockOpenShiftToStorage(null);
            return closed;
          }
          return null;
        },
      },

      syncQueue: {
        getCounts: async () => {
          await delay(8);
          return {
            pending: mockSyncQueue.filter((q) => q.status !== 'FAILED' && q.status !== 'DONE').length,
            failed: mockSyncQueue.filter((q) => q.status === 'FAILED').length,
          };
        },
        push: async (item: any) => {
          mockSyncQueue.push({ ...item, status: 'PENDING', createdAt: Date.now() });
          return true;
        },
      },

      // --- Professional dine-in running tab / Table Sessions (mock) ---
      // Mirrors the SQLite TableSessionService + IPC handlers so the browser
      // dev-mode (no Electron) and real Electron both persist items the
      // moment an attendant assigns them to a table.
      tableSessions: {
        openOrGet: async (payload: any) => {
          await delay(10);
          const tableId = String(payload?.tableId ?? '');
          const existing = mockTableSessions.find(
            (s) =>
              s.tableId === tableId &&
              ['OPEN', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'].includes(s.status)
          );
          if (existing) return { session: existing, wasCreated: false };
          const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const seq = ((Date.now() / 1000) >>> 0) % 9000 + 1000;
          const session: MockTableSession = {
            id,
            branchId: payload?.branchId || mockLastAuth?.branchId || 'br-main-01',
            restaurantId: payload?.restaurantId || mockLastAuth?.restaurantId || 'rst-prolific',
            tableId,
            tabNumber: `T-${seq}`,
            status: 'OPEN',
            covers: payload?.covers ?? 0,
            openedBy: payload?.openedBy ?? mockLastAuth?.employeeId ?? null,
            openedByName: payload?.openedByName ?? null,
            serverId: payload?.serverId ?? mockLastAuth?.employeeId ?? null,
            serverName: payload?.serverName ?? null,
            openedAt: Date.now(),
            closedAt: null,
            closedBy: null,
            subtotalCents: 0,
            discountCents: 0,
            taxCents: 0,
            tipCents: 0,
            totalCents: 0,
            paidAmountCents: 0,
            balanceDueCents: 0,
            customerCount: 0,
            customerName: payload?.tableName ?? null,
            note: null,
            currentOrderId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          mockTableSessions.unshift(session);
          appendMockLedger({
            sessionId: session.id,
            branchId: session.branchId,
            restaurantId: session.restaurantId,
            entryType: 'OPENED',
            actorId: session.openedBy,
            actorName: session.openedByName,
            label: `Tab ${session.tabNumber} opened`,
            amountAfterCents: 0,
            metadataJson: JSON.stringify({ tableId, tableName: payload?.tableName ?? null }),
          });
          return { session, wasCreated: true };
        },
        getById: async (id: string) => {
          await delay(5);
          return mockTableSessions.find((s) => s.id === id) || null;
        },
        getOpenForTable: async (tableId: string) => {
          await delay(5);
          return (
            mockTableSessions.find(
              (s) =>
                s.tableId === tableId &&
                ['OPEN', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'].includes(s.status)
            ) || null
          );
        },
        listOpen: async (branchId?: string) => {
          await delay(5);
          return mockTableSessions.filter((s) => {
            if (!['OPEN', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'].includes(s.status)) return false;
            if (branchId && s.branchId !== branchId) return false;
            return true;
          });
        },
        listRecent: async (branchId?: string, limit = 100) => {
          await delay(5);
          const list = branchId
            ? mockTableSessions.filter((s) => s.branchId === branchId)
            : mockTableSessions.slice();
          return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
        },
        replaceCartItems: async (payload: any) => {
          await delay(8);
          const sessionId = String(payload?.sessionId ?? '');
          const sess = mockTableSessions.find((s) => s.id === sessionId);
          if (!sess) throw new Error(`Mock table session not found: ${sessionId}`);
          const items = Array.isArray(payload?.items) ? payload.items : [];
          if (!sess.currentOrderId) {
            sess.currentOrderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            mockSessionOrderItems.push({ orderId: sess.currentOrderId, items: [] });
            mockOrders.push({
              id: sess.currentOrderId,
              branchId: sess.branchId,
              restaurantId: sess.restaurantId,
              orderNumber: `O-${((Date.now() / 1000) >>> 0) % 9000 + 1000}`,
              orderType: 'DINE_IN',
              tableId: sess.tableId,
              tableSessionId: sess.id,
              employeeId: payload?.actorId ?? mockLastAuth?.employeeId ?? null,
              status: 'IN_PROGRESS',
              createdAt: Date.now(),
            });
          }
          const bucket = mockSessionOrderItems.find((b) => b.orderId === sess.currentOrderId);
          if (bucket) bucket.items.splice(0, bucket.items.length);
          const taxRates = Array.isArray(payload?.taxRates) ? payload.taxRates : SEEDED_TAXES;
          const prevTotal = sess.totalCents;
          for (const it of items) {
            const row = {
              id: it.id || it.lineId,
              order_id: sess.currentOrderId,
              menu_item_id: it.menuItemId,
              name_snapshot: it.name,
              price_snapshot_cents: Number(it.unitPriceCents ?? it.price ?? 0),
              quantity: Number(it.quantity ?? 0),
              subtotal_cents: Number(it.subtotalCents ?? it.subtotal ?? 0),
              special_instructions: it.specialInstructions ?? null,
              preparation_status: 'NEW',
            };
            if (bucket) bucket.items.push(row);
            mockOrderItems.push(row);
            appendMockLedger({
              sessionId: sess.id,
              branchId: sess.branchId,
              restaurantId: sess.restaurantId,
              entryType: 'ADD_ITEM',
              referenceId: row.id,
              actorId: payload?.actorId ?? mockLastAuth?.employeeId ?? null,
              actorName: payload?.actorName ?? null,
              label: `+${row.quantity}× ${row.name_snapshot}`,
              quantity: row.quantity,
              amountDeltaCents: row.subtotal_cents,
              amountAfterCents: 0, // filled after recalc below
              metadataJson: JSON.stringify({ orderId: sess.currentOrderId, unitPriceCents: row.price_snapshot_cents }),
            });
          }
          const refreshed = recalcMockTotals(sess.id, taxRates);
          // Update last ledger entries with correct post-recalc "after" amount
          const sessionEntries = mockTableLedger.filter((l) => l.sessionId === sess.id);
          sessionEntries.forEach((l) => {
            l.amountAfterCents = refreshed.totalCents;
          });
          return refreshed;
        },
        updateStatus: async (payload: any) => {
          await delay(8);
          const id = String(payload?.id ?? '');
          const sess = mockTableSessions.find((s) => s.id === id);
          if (!sess) throw new Error(`Mock table session not found: ${id}`);
          sess.status = payload?.status ?? 'OPEN';
          if (payload?.closedAt) sess.closedAt = payload.closedAt;
          if (payload?.closedBy) sess.closedBy = payload.closedBy;
          sess.updatedAt = Date.now();
          appendMockLedger({
            sessionId: sess.id,
            branchId: sess.branchId,
            restaurantId: sess.restaurantId,
            entryType:
              sess.status === 'CLOSED'
                ? 'CLOSED'
                : sess.status === 'AWAITING_PAYMENT'
                  ? 'AWAITING_PAYMENT'
                  : sess.status === 'VOIDED'
                    ? 'VOIDED'
                    : 'NOTE',
            actorId: mockLastAuth?.employeeId ?? null,
            actorName: null,
            label: `Status → ${sess.status}`,
            amountAfterCents: sess.totalCents,
            note: payload?.ledgerNote ?? null,
          });
          return true;
        },
      },

      tableSessionLedger: {
        listForSession: async (sessionId: string) => {
          await delay(5);
          return mockTableLedger
            .filter((l) => l.sessionId === sessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
        },
        appendNote: async (payload: any) => {
          await delay(5);
          const sess = mockTableSessions.find((s) => s.id === String(payload?.sessionId ?? ''));
          if (!sess) throw new Error(`Mock table session not found: ${payload?.sessionId}`);
          const entry = appendMockLedger({
            sessionId: sess.id,
            branchId: sess.branchId,
            restaurantId: sess.restaurantId,
            entryType: 'NOTE',
            referenceId: payload?.referenceId ?? null,
            actorId: payload?.actorId ?? mockLastAuth?.employeeId ?? null,
            actorName: payload?.actorName ?? null,
            label: payload?.label || 'Note added to tab',
            amountAfterCents: sess.totalCents,
            note: payload?.note ?? null,
            metadataJson:
              payload?.metadata && typeof payload.metadata === 'object'
                ? JSON.stringify(payload.metadata)
                : null,
          });
          return entry.id;
        },
      },

      reports: (() => {
        type ReportPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
        interface PeriodBucket {
          key: string; label: string; startTs: number; endTs: number;
          netCents: number; grossCents: number; tipCents: number;
          paymentCount: number; ordersCount: number;
        }
        interface MethodSplit { method: string; netCents: number; tipCents: number; count: number; }
        interface TopItem { menuItemId: string | null; name: string | null; qty: number; revenueCents: number; }
        interface PeriodReport {
          period: ReportPeriod;
          scope: { year?: number; month?: number; weekStartTs?: number; dayTs?: number; branchId?: string | null; restaurantId?: string | null; };
          totals: { netCents: number; grossCents: number; tipCents: number; paymentCount: number; ordersCount: number; refundCents: number; payoutCents: number; };
          comparePrevPeriod: { netDeltaCents: number; orderDelta: number; pct: number; samePeriodLabel: string; } | null;
          buckets: PeriodBucket[];
          methodSplit: MethodSplit[];
          topItems: TopItem[];
          availableYears: number[];
        }
        const PAID_STATUSES = new Set(['SUCCESS', 'COMPLETED', 'PAID', 'CLOSED']);

        const norm = (o: any, k1: string, k2?: string, k3?: string) => {
          if (o == null) return undefined;
          if (k1 in o && o[k1] != null) return o[k1];
          if (k2 != null && k2 in o && o[k2] != null) return o[k2];
          if (k3 != null && k3 in o && o[k3] != null) return o[k3];
          return undefined;
        };

        const normStr = (o: any, ...keys: string[]): string | null => {
          for (const k of keys) {
            const v = norm(o, k);
            if (v != null && String(v).length > 0) return String(v);
          }
          return null;
        };

        const normNum = (o: any, ...keys: string[]): number => {
          for (const k of keys) {
            const v = norm(o, k);
            if (v == null) continue;
            const n = Number(v);
            if (Number.isFinite(n)) return n;
          }
          return 0;
        };

        const getOrderById = (id: string) => mockOrders.find((o) =>
          String(normStr(o, 'id') || '') === String(id)
        );

        const isPaidPayment = (p: any): boolean => {
          const status = normStr(p, 'status');
          const amt = normNum(p, 'amount_cents', 'amountCents', 'amount');
          if (status && PAID_STATUSES.has(status.toUpperCase())) return true;
          if ((status == null || status === '') && amt > 0) return true;
          return false;
        };

        const filterScope = (
          item: any,
          scope: { branchId?: string | null; restaurantId?: string | null }
        ): boolean => {
          const bid = scope.branchId;
          const rid = scope.restaurantId;
          if (bid) {
            const ib = normStr(item, 'branch_id', 'branchId');
            if (ib && String(ib) !== String(bid)) return false;
          }
          if (rid) {
            const ir = normStr(item, 'restaurant_id', 'restaurantId');
            if (ir && String(ir) !== String(rid)) return false;
          }
          return true;
        };

        const startOfDayMs = (ts: number): number => {
          const d = new Date(ts);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        };

        const startOfWeekMondayMs = (ts: number): number => {
          const d = new Date(ts);
          d.setHours(0, 0, 0, 0);
          const dow = d.getDay();
          const diff = dow === 0 ? -6 : 1 - dow;
          d.setDate(d.getDate() + diff);
          return d.getTime();
        };

        const startOfMonthMs = (y: number, m0: number) =>
          new Date(y, m0, 1, 0, 0, 0, 0).getTime();

        const endOfMonthMs = (y: number, m0: number) =>
          new Date(y, m0 + 1, 0, 23, 59, 59, 999).getTime();

        const daysInMonth = (y: number, m0: number) =>
          new Date(y, m0 + 1, 0).getDate();

        const resolveRange = (period: ReportPeriod, scope: any, now: number) => {
          switch (period) {
            case 'DAY': {
              const base = scope.dayTs && scope.dayTs > 0 ? Number(scope.dayTs) : now;
              const s = startOfDayMs(base);
              return { startTs: s, endTs: s + 86400000 - 1, label: new Date(s).toLocaleDateString() };
            }
            case 'WEEK': {
              const base = scope.weekStartTs && scope.weekStartTs > 0 ? Number(scope.weekStartTs) : now;
              const s = startOfWeekMondayMs(base);
              return { startTs: s, endTs: s + 7 * 86400000 - 1, label: `Week of ${new Date(s).toLocaleDateString()}` };
            }
            case 'MONTH': {
              const nd = new Date(now);
              const y = scope.year != null ? Number(scope.year) : nd.getFullYear();
              const m = (scope.month != null ? Number(scope.month) : nd.getMonth() + 1) - 1;
              return {
                startTs: startOfMonthMs(y, m),
                endTs: endOfMonthMs(y, m),
                label: new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
              };
            }
            case 'YEAR': {
              const nd = new Date(now);
              const y = scope.year != null ? Number(scope.year) : nd.getFullYear();
              return {
                startTs: new Date(y, 0, 1, 0, 0, 0, 0).getTime(),
                endTs: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
                label: String(y),
              };
            }
          }
        };

        const prevRange = (period: ReportPeriod, cur: { startTs: number; endTs: number }) => {
          switch (period) {
            case 'DAY': {
              const s = cur.startTs - 86400000;
              return { startTs: s, endTs: s + 86400000 - 1, label: new Date(s).toLocaleDateString() };
            }
            case 'WEEK': {
              const s = cur.startTs - 7 * 86400000;
              return { startTs: s, endTs: s + 7 * 86400000 - 1, label: `Prev week ${new Date(s).toLocaleDateString()}` };
            }
            case 'MONTH': {
              const cd = new Date(cur.startTs);
              const y = cd.getFullYear();
              const m = cd.getMonth();
              const pm = m === 0 ? 11 : m - 1;
              const py = m === 0 ? y - 1 : y;
              return {
                startTs: startOfMonthMs(py, pm),
                endTs: endOfMonthMs(py, pm),
                label: new Date(py, pm, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
              };
            }
            case 'YEAR': {
              const y = new Date(cur.startTs).getFullYear() - 1;
              return {
                startTs: new Date(y, 0, 1, 0, 0, 0, 0).getTime(),
                endTs: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
                label: String(y),
              };
            }
          }
        };

        const collectPaidPayments = (startTs: number, endTs: number, scope: any) => {
          return mockPayments.filter((p) => {
            const completedAt = normNum(p, 'completed_at', 'completedAt');
            if (completedAt <= 0) return false;
            if (completedAt < startTs || completedAt > endTs) return false;
            if (!isPaidPayment(p)) return false;
            if (!filterScope(p, scope)) return false;
            return true;
          });
        };

        const aggregateTotals = (startTs: number, endTs: number, scope: any) => {
          const paid = collectPaidPayments(startTs, endTs, scope);
          let gross = 0, tip = 0;
          const orderIds = new Set<string>();
          for (const p of paid) {
            gross += normNum(p, 'amount_cents', 'amountCents', 'amount');
            tip += normNum(p, 'tip_cents', 'tipCents', 'tip');
            const oid = normStr(p, 'order_id', 'orderId');
            if (oid) orderIds.add(oid);
          }

          let refundCents = 0;
          for (const o of mockOrders) {
            const status = normStr(o, 'status');
            const payStatus = normStr(o, 'payment_status', 'paymentStatus');
            const isRefund =
              (status && status.toUpperCase().includes('REFUND')) ||
              (payStatus && payStatus.toUpperCase().includes('REFUND'));
            if (!isRefund) continue;
            const ct = normNum(o, 'created_at', 'createdAt');
            if (ct < startTs || ct > endTs) continue;
            if (!filterScope(o, scope)) continue;
            refundCents += Math.abs(normNum(o, 'paid_amount_cents', 'paidAmountCents', 'paidAmount'));
          }

          let payoutCents = 0;
          for (const c of mockCashAdjustments) {
            const type = normStr(c, 'type');
            const dir = normStr(c, 'direction');
            const isPayout =
              (type && type.toUpperCase() === 'PAYOUT') ||
              (dir && (dir.toUpperCase() === 'OUT' || dir.toUpperCase() === 'PAID_OUT'));
            if (!isPayout) continue;
            const ct = normNum(c, 'created_at', 'createdAt');
            if (ct < startTs || ct > endTs) continue;
            if (!filterScope(c, scope)) continue;
            payoutCents += Math.abs(normNum(c, 'amount_cents', 'amountCents', 'amount'));
          }

          return {
            grossCents: gross,
            tipCents: tip,
            netCents: gross,
            paymentCount: paid.length,
            ordersCount: orderIds.size,
            refundCents,
            payoutCents,
          };
        };

        const buildBuckets = (period: ReportPeriod, range: { startTs: number; endTs: number }, scope: any): PeriodBucket[] => {
          const paid = collectPaidPayments(range.startTs, range.endTs, scope);

          const getPaymentBucketKey = (p: any): string | null => {
            const ts = normNum(p, 'completed_at', 'completedAt');
            if (ts <= 0) return null;
            const d = new Date(ts);
            switch (period) {
              case 'DAY': return `h${d.getHours()}`;
              case 'WEEK': {
                const dow = d.getDay();
                const idx = dow === 0 ? 6 : dow - 1;
                return `d${idx}`;
              }
              case 'MONTH': return `dm${d.getDate()}`;
              case 'YEAR': return `mo${d.getMonth() + 1}`;
            }
          };

          const bucketMap = new Map<string, { gross: number; tip: number; payCount: number; orderIds: Set<string> }>();
          for (const p of paid) {
            const k = getPaymentBucketKey(p);
            if (!k) continue;
            let b = bucketMap.get(k);
            if (!b) {
              b = { gross: 0, tip: 0, payCount: 0, orderIds: new Set() };
              bucketMap.set(k, b);
            }
            b.gross += normNum(p, 'amount_cents', 'amountCents', 'amount');
            b.tip += normNum(p, 'tip_cents', 'tipCents', 'tip');
            b.payCount += 1;
            const oid = normStr(p, 'order_id', 'orderId');
            if (oid) b.orderIds.add(oid);
          }

          const buckets: PeriodBucket[] = [];
          switch (period) {
            case 'DAY': {
              const dayStart = startOfDayMs(range.startTs);
              for (let h = 0; h < 24; h++) {
                const b = bucketMap.get(`h${h}`);
                const startTs = dayStart + h * 3600000;
                buckets.push({
                  key: `h${h}`,
                  label: `${h.toString().padStart(2, '0')}:00`,
                  startTs,
                  endTs: startTs + 3600000 - 1,
                  grossCents: b?.gross ?? 0,
                  tipCents: b?.tip ?? 0,
                  netCents: b?.gross ?? 0,
                  paymentCount: b?.payCount ?? 0,
                  ordersCount: b?.orderIds.size ?? 0,
                });
              }
              break;
            }
            case 'WEEK': {
              const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
              for (let i = 0; i < 7; i++) {
                const b = bucketMap.get(`d${i}`);
                const startTs = range.startTs + i * 86400000;
                buckets.push({
                  key: `d${i}`,
                  label: names[i],
                  startTs,
                  endTs: startTs + 86400000 - 1,
                  grossCents: b?.gross ?? 0,
                  tipCents: b?.tip ?? 0,
                  netCents: b?.gross ?? 0,
                  paymentCount: b?.payCount ?? 0,
                  ordersCount: b?.orderIds.size ?? 0,
                });
              }
              break;
            }
            case 'MONTH': {
              const sd = new Date(range.startTs);
              const y = sd.getFullYear();
              const m = sd.getMonth();
              const maxD = daysInMonth(y, m);
              for (let d = 1; d <= maxD; d++) {
                const b = bucketMap.get(`dm${d}`);
                const startTs = new Date(y, m, d, 0, 0, 0, 0).getTime();
                buckets.push({
                  key: `dm${d}`,
                  label: String(d),
                  startTs,
                  endTs: startTs + 86400000 - 1,
                  grossCents: b?.gross ?? 0,
                  tipCents: b?.tip ?? 0,
                  netCents: b?.gross ?? 0,
                  paymentCount: b?.payCount ?? 0,
                  ordersCount: b?.orderIds.size ?? 0,
                });
              }
              break;
            }
            case 'YEAR': {
              const y = new Date(range.startTs).getFullYear();
              const mnames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              for (let m = 1; m <= 12; m++) {
                const b = bucketMap.get(`mo${m}`);
                const startTs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
                const endTs = endOfMonthMs(y, m - 1);
                buckets.push({
                  key: `mo${m}`,
                  label: mnames[m - 1],
                  startTs,
                  endTs,
                  grossCents: b?.gross ?? 0,
                  tipCents: b?.tip ?? 0,
                  netCents: b?.gross ?? 0,
                  paymentCount: b?.payCount ?? 0,
                  ordersCount: b?.orderIds.size ?? 0,
                });
              }
              break;
            }
          }
          return buckets;
        };

        const aggregateMethodSplit = (startTs: number, endTs: number, scope: any): MethodSplit[] => {
          const paid = collectPaidPayments(startTs, endTs, scope);
          const map = new Map<string, { net: number; tip: number; count: number }>();
          for (const p of paid) {
            const method = normStr(p, 'method') || 'OTHER';
            let b = map.get(method);
            if (!b) { b = { net: 0, tip: 0, count: 0 }; map.set(method, b); }
            b.net += normNum(p, 'amount_cents', 'amountCents', 'amount');
            b.tip += normNum(p, 'tip_cents', 'tipCents', 'tip');
            b.count += 1;
          }
          return Array.from(map.entries())
            .sort((a, b) => b[1].net - a[1].net)
            .map(([method, v]) => ({ method, netCents: v.net, tipCents: v.tip, count: v.count }));
        };

        const aggregateTopItems = (startTs: number, endTs: number, scope: any): TopItem[] => {
          const paidOrderIds = new Set<string>();
          for (const p of collectPaidPayments(startTs, endTs, scope)) {
            const oid = normStr(p, 'order_id', 'orderId');
            if (oid) paidOrderIds.add(oid);
          }
          const keyMap = new Map<string, { menuItemId: string | null; name: string | null; qty: number; revenue: number }>();
          for (const oi of mockOrderItems) {
            const oid = normStr(oi, 'order_id', 'orderId');
            if (!oid || !paidOrderIds.has(oid)) continue;
            const order = getOrderById(oid);
            if (order && !filterScope(order, scope)) continue;
            const menuItemId = normStr(oi, 'menu_item_id', 'menuItemId');
            const name = normStr(oi, 'name_snapshot', 'nameSnapshot', 'name');
            const qty = normNum(oi, 'quantity', 'qty');
            const revenue = normNum(oi, 'subtotal_cents', 'subtotalCents', 'subtotal');
            const key = `${menuItemId || ''}__${name || ''}`;
            let b = keyMap.get(key);
            if (!b) {
              b = { menuItemId: menuItemId ?? null, name: name ?? null, qty: 0, revenue: 0 };
              keyMap.set(key, b);
            }
            b.qty += qty;
            b.revenue += revenue;
          }
          return Array.from(keyMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map((v, i) => ({
              menuItemId: v.menuItemId,
              name: v.name ?? (v.menuItemId ? `Item #${i + 1}` : null),
              qty: v.qty,
              revenueCents: v.revenue,
            }));
        };

        const listAvailableYears = (scope?: any): number[] => {
          const s = scope ?? {};
          const years = new Set<number>();
          for (const p of mockPayments) {
            if (!filterScope(p, s)) continue;
            const ts = normNum(p, 'completed_at', 'completedAt');
            if (ts <= 0) continue;
            years.add(new Date(ts).getFullYear());
          }
          return Array.from(years).sort((a, b) => b - a);
        };

        const periodSales = (opts: any): PeriodReport => {
          const o = opts ?? {};
          const period: ReportPeriod = (o.period as ReportPeriod) || 'DAY';
          const now = Date.now();
          const current = resolveRange(period, o, now);
          const prev = prevRange(period, current);
          const scopeObj = {
            year: o.year != null ? Number(o.year) : undefined,
            month: o.month != null ? Number(o.month) : undefined,
            weekStartTs: o.weekStartTs != null ? Number(o.weekStartTs) : undefined,
            dayTs: o.dayTs != null ? Number(o.dayTs) : undefined,
            branchId: o.branchId != null ? o.branchId : undefined,
            restaurantId: o.restaurantId != null ? o.restaurantId : undefined,
          };
          const filterScopeOnly = { branchId: scopeObj.branchId, restaurantId: scopeObj.restaurantId };

          const totals = aggregateTotals(current.startTs, current.endTs, filterScopeOnly);
          const prevTotals = aggregateTotals(prev.startTs, prev.endTs, filterScopeOnly);
          const buckets = buildBuckets(period, current, filterScopeOnly);
          const methodSplit = aggregateMethodSplit(current.startTs, current.endTs, filterScopeOnly);
          const topItems = aggregateTopItems(current.startTs, current.endTs, filterScopeOnly);
          const availableYears = listAvailableYears(filterScopeOnly);

          let comparePrevPeriod: PeriodReport['comparePrevPeriod'] = null;
          if (prevTotals.netCents > 0 || prevTotals.ordersCount > 0) {
            const netDeltaCents = totals.netCents - prevTotals.netCents;
            const orderDelta = totals.ordersCount - prevTotals.ordersCount;
            const pct = prevTotals.netCents > 0
              ? Math.round((netDeltaCents / prevTotals.netCents) * 10000) / 100
              : 0;
            comparePrevPeriod = { netDeltaCents, orderDelta, pct, samePeriodLabel: prev.label };
          } else {
            comparePrevPeriod = {
              netDeltaCents: totals.netCents,
              orderDelta: totals.ordersCount,
              pct: totals.netCents > 0 ? 100 : 0,
              samePeriodLabel: prev.label,
            };
          }

          return {
            period,
            scope: scopeObj,
            totals,
            comparePrevPeriod,
            buckets,
            methodSplit,
            topItems,
            availableYears,
          };
        };

        return {
          periodSales: async (opts: any) => { await delay(5); return periodSales(opts); },
          availableYears: async (scope?: any) => { await delay(5); return listAvailableYears(scope); },
        };
      })(),
    },

    customerDisplay: {
      // Idle: no active cart — show promos, chef specials, branch info
      showIdle: async () => {
        await bootstrapCustomerBranding();
        emitCustomerState({ screen: 'idle', orderPreview: undefined });
        return true;
      },
      // Live cart preview: cashier is ringing up items
      showOrder: async (orderPreview: CustomerOrderPreview) => {
        await bootstrapCustomerBranding();
        emitCustomerState({ screen: 'order', orderPreview });
        return true;
      },
      // Payment just recorded: show thank-you confetti screen with total paid
      showPaid: async (raw: any) => {
        await bootstrapCustomerBranding();
        // PaymentModal sends raw Payment data (dollars/NAIRA as floats).
        // Normalize to integer cents + CustomerOrderPreview shape so the
        // ThankYouScreen can share data structures with ActiveOrderScreen.
        const items: any[] = Array.isArray(raw?.items) ? raw.items : [];
        const totalCents = Math.round(Number(raw?.totalAmount ?? 0) * 100);
        const lines: CustomerOrderLine[] = items.map((it) => {
          const modifiers: string[] = [];
          (it?.selectedModifiers || []).forEach((m: any) => {
            if (Array.isArray(m?.optionIds)) {
              modifiers.push(...m.optionIds.map((oid: any) => String(oid)));
            } else if (typeof m?.name === 'string') {
              modifiers.push(m.name);
            } else if (typeof m === 'string') {
              modifiers.push(m);
            }
          });
          const unitCents = Math.round(Number(it?.unitPrice ?? 0) * 100);
          const qty = Number(it?.quantity ?? 1) || 1;
          return {
            qty,
            name: String(it?.name ?? 'Item'),
            modifiers,
            unitPriceCents: unitCents,
            totalCents: Math.round(Number(it?.totalAmount ?? it?.subtotal ?? unitCents * qty) * 100),
          };
        });
        // Derive a 5%-ish pseudo-tax if totals weren't supplied, just so the
        // thank-you screen always has meaningful breakdown lines.
        let subtotalCents = 0;
        lines.forEach((l) => (subtotalCents += l.totalCents));
        const taxCents = totalCents >= subtotalCents ? totalCents - subtotalCents : 0;
        const preview: CustomerOrderPreview = {
          orderNumber: String(raw?.orderNumber ?? '#00000'),
          lines,
          subtotalCents,
          discountCents: 0,
          taxCents,
          totalCents,
          paymentStatus: 'PAID',
          orderStatus: 'RECEIVED',
          paidAt: Date.now(),
        };
        emitCustomerState({ screen: 'thankyou', orderPreview: preview });
        return true;
      },
      // Legacy alias: CartPanel sometimes uses showCart interchangeably with
      // showOrder — treat them identically so older call sites don't regress.
      showCart: async (orderPreview: CustomerOrderPreview) => {
        await bootstrapCustomerBranding();
        emitCustomerState({ screen: 'order', orderPreview });
        return true;
      },
    },

    print: {
      testPage: async () => {
        // In browser mode, render a sample receipt and open native print dialog.
        console.log('[mock print] test page');
        const sampleItems = [
          { id: 't1', name_snapshot: 'Jollof Rice with Chicken', quantity: 1, price_snapshot_cents: 250000, total_cents: 250000 },
          { id: 't2', name_snapshot: 'Bottle Water', quantity: 2, price_snapshot_cents: 20000, total_cents: 40000, special_instructions: 'Cold please' },
        ];
        const sampleMods = [
          { order_item_id: 't1', modifier_name: 'Protein', option_name: 'Extra Chicken', price_delta_cents: 0 },
        ];
        const html = mockBuildReceiptHtml(
          {
            order_number: 'TEST-001',
            order_type: 'DINE_IN',
            table_id: 'T1',
            table_name: 'VIP 1',
            customer_name: 'Demo Guest',
            subtotal_cents: 290000,
            discount_cents: 10000,
            tax_cents: 21000,
            tip_cents: 5000,
            total_cents: 306000,
            payment_status: 'PAID',
            change_due_cents: 94000,
            created_at: Date.now(),
          },
          sampleItems,
          sampleMods,
          [{ method: 'CASH', amount_cents: 400000 }],
          { title: 'TEST RECEIPT', printedAt: Date.now(), copyIndex: 0, totalCopies: 1 }
        );
        await mockPrintHtml(html);
        return true;
      },
      receipt: async (orderId: string, copies = 1) => {
        console.log(`[mock print] receipt for ${orderId} × ${copies}`);
        const order = mockOrders.find((o) => o.id === orderId) || mockOrders.find((o) => (o.order_number || o.orderNumber) === orderId);
        if (!order) {
          console.warn(`[mock print] receipt skipped: order ${orderId} not found in mock DB`);
          return true;
        }
        const items = mockOrderItems.filter((i) => i.order_id === orderId || i.orderId === orderId);
        const mods = mockOrderItemModifiers.filter((m) => m.order_id === orderId || m.orderId === orderId);
        const payments = mockPayments.filter((p) => p.order_id === orderId || p.orderId === orderId);
        const printedAt = Date.now();
        const numCopies = Math.max(1, Math.min(5, Number(copies ?? 1)));
        for (let i = 0; i < numCopies; i += 1) {
          const title = i === 0 ? 'CUSTOMER COPY' : 'CASHIER COPY';
          const html = mockBuildReceiptHtml(order, items, mods, payments, {
            title,
            printedAt,
            copyIndex: i,
            totalCopies: numCopies,
          });
          // Note: in browser mode multiple copies just re-issue the dialog N times
          // — real Electron prints silently via Windows print spooler.
          await mockPrintHtml(html);
        }
        return true;
      },
      kitchenTicket: async (orderId: string) => {
        console.log(`[mock print] kitchen ticket for ${orderId}`);
        const order = mockOrders.find((o) => o.id === orderId) || mockOrders.find((o) => (o.order_number || o.orderNumber) === orderId);
        if (!order) {
          console.warn(`[mock print] kitchen ticket skipped: order ${orderId} not found`);
          return true;
        }
        const items = mockOrderItems.filter((i) => i.order_id === orderId || i.orderId === orderId);
        const mods = mockOrderItemModifiers.filter((m) => m.order_id === orderId || m.orderId === orderId);
        const html = mockBuildKitchenTicketHtml(order, items, mods, { printedAt: Date.now() });
        await mockPrintHtml(html);
        return true;
      },
      listPrinters: async () => ({ printers: [] }),
      getQueueStatus: async () => ({ queued: 0, inProgress: 0, failed: 0 }),
    },
  };

  window.electronAPI = api;
  console.log('[POS] mock ElectronAPI installed — seeded cashiers PIN: 1234 or supervisor 0000 or manager 9999');

  // -------------------------------------------------------------------------
  // Polyfill: window.customerWindowAPI
  //
  // Real Electron preload injects this API on BOTH the POS main window AND
  // the secondary customer-display BrowserWindow. In browser mode the popup
  // runs installMockElectronAPI() via main.tsx too, so this polyfill runs on
  // both windows and wraps our BroadcastChannel bus. Result: CustomerDisplayApp
  // code path "window.customerWindowAPI.subscribeCustomerState(cb)" works
  // identically in Electron and in Vite-browser popup.
  // -------------------------------------------------------------------------
  if (!window.customerWindowAPI) {
    const api = {
      getVersions: async () => ({ node: 'mock', chrome: 'mock', electron: 'mock' }),
      subscribeCustomerState: (cb: (state: CustomerStatePayload) => void) => {
        // Ensure channel is live so customer-latest-request replies flow back.
        getCustomerChannel();
        if (typeof cb === 'function') {
          _customerSubscribers.push(cb);
          // Deliver the last known state immediately so there's no flash of
          // empty/stale UI while waiting for the next cashier action.
          try {
            cb({ ..._latestCustomerState });
          } catch (_) {
            /* noop */
          }
          // Also explicitly request a replay from the POS window if we're in
          // the customer-display popup (the popup subscriber may have come up
          // after the POS window had already set state).
          try {
            const ch = getCustomerChannel();
            ch?.postMessage({ type: 'customer-latest-request' });
          } catch (_) {
            /* ignore */
          }
        }
      },
      unsubscribeCustomerState: () => {
        _customerSubscribers = [];
      },
      getRestaurantBranding: async (): Promise<CustomerBranding> => {
        await bootstrapCustomerBranding();
        return { ...(_latestCustomerState.branding || DEFAULT_CUSTOMER_BRANDING) };
      },
    };
    (window as any).customerWindowAPI = api;
  }

  // =========================================================================
  // REAL HTTP BACKEND BRIDGE (browser / Vite dev mode only)
  //
  // In packaged Electron, cloud-pull-worker.ts handles real order sync with
  // the backend every 30s. In Vite browser mode the Electron main process
  // code never runs, so the mock shim historically used ONLY hardcoded
  // in-memory orders. The user complained: "Real website orders don't appear
  // on POS portal" because this bridge was missing entirely.
  //
  // This block implements the equivalent auto-poll loop for browser mode,
  // calling the new public /api/v1/public/recent-orders endpoint and
  // upserting external (WEBSITE/QR) orders into the in-memory mockOrders
  // array so that CashierScreenLayout's 8-second interval polling tick and
  // detectAndQueueExternalOrders pipeline picks them up with zero manual
  // intervention.
  //
  // Pull strategy: first-run fires ~2.5s after install (so login + init
  // hydration has already happened), then every 30 seconds thereafter.
  // Belt+suspenders: also re-merges UNPAID external orders on every tick
  // so any transient failure on pull #1 is recovered on pull #2.
  // =========================================================================
  try {
    if (typeof (window as any).__mockSyncInstalled !== 'undefined') {
      // HMR double-install guard (Vite dev server hot module reload)
      // avoids accumulating duplicate intervals.
    } else {
      (window as any).__mockSyncInstalled = true;
      // Professional 4-tier API base resolution — parity with
      // resolvePublicApiBase() used everywhere else in this shim. Critically
      // ensures the browser POS pushes orders/payments and pulls recent
      // external orders to the REAL Render production API, never localhost.
      //
      // Prioritisation (same chain as remote-menu shim / auth shim):
      //   1. localStorage prolific_api_base (ops override)
      //   2. VITE_* / NEXT_PUBLIC_*_API_BASE_URL build-time vars
      //   3. Production hostname → prolific-api.onrender.com/api/v1
      //   4. Dev-only localhost:4000 fallback
      const env: any = (window as any).process?.env ?? {};
      const API_BASE = resolvePublicApiBase().replace(/\/$/, '');
      const BRANCH_ID =
        (env.VITE_BRANCH_ID as string) ||
        (env.NEXT_PUBLIC_BRANCH_ID as string) ||
        '6a814d299717fc01eabb6000'; // fallback to Port Harcourt if unset

      const upsertBackendExternalOrders = async () => {
        try {
          const url = `${API_BASE}/public/recent-orders?branchId=${encodeURIComponent(BRANCH_ID)}&sinceHours=24`;
          const resp = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit' });
          if (!resp.ok) {
            // 404 or offline — swallow silently. POS will retry in 30s.
            if (resp.status !== 404) {
              console.debug(`[mock sync] pull skipped (HTTP ${resp.status})`);
            }
            return;
          }
          const payload: any = await resp.json().catch(() => ({}));
          const orders = Array.isArray(payload?.orders) ? payload.orders : Array.isArray(payload?.data?.orders) ? payload.data.orders : [];
          if (!orders.length) return;
          let upserted = 0;
          for (const remote of orders) {
            if (!remote?.id) continue;
            const id = String(remote.id);
            // Upsert order into mockOrders
            const idx = mockOrders.findIndex((o) => String((o as any).id) === id);
            const canonical: any = {
              id,
              orderNumber: String(remote.orderNumber ?? remote.order_number ?? `#${id.slice(-6)}`),
              restaurantId: String(remote.restaurantId ?? (mockOrders[0] as any)?.restaurantId ?? 'rst-prolific'),
              branchId: String(remote.branchId ?? (mockOrders[0] as any)?.branchId ?? 'br-main-01'),
              orderType: String(remote.orderType ?? remote.order_type ?? 'DINE_IN'),
              status: String(remote.status ?? 'AWAITING_PAYMENT'),
              paymentStatus: String(remote.paymentStatus ?? 'UNPAID'),
              source: String(remote.source ?? remote.sourceChannel ?? 'WEBSITE').toUpperCase(),
              sourceChannel: String(remote.source ?? remote.sourceChannel ?? 'WEBSITE').toUpperCase(),
              customerId: remote.customerId ? String(remote.customerId) : undefined,
              customerName: remote.customerName ? String(remote.customerName) : undefined,
              customerPhone: remote.customerPhone ? String(remote.customerPhone) : undefined,
              customerEmail: remote.customerEmail ? String(remote.customerEmail) : undefined,
              subtotal: typeof remote.subtotal === 'number' ? remote.subtotal : typeof remote.subtotalAmount === 'number' ? remote.subtotalAmount : 0,
              subtotalAmount: typeof remote.subtotalAmount === 'number' ? remote.subtotalAmount : typeof remote.subtotal === 'number' ? remote.subtotal : 0,
              discountAmount: typeof remote.discountAmount === 'number' ? remote.discountAmount : 0,
              taxAmount: typeof remote.taxAmount === 'number' ? remote.taxAmount : 0,
              totalAmount: typeof remote.totalAmount === 'number' ? remote.totalAmount : 0,
              tipAmount: typeof remote.tipAmount === 'number' ? remote.tipAmount : 0,
              paidAmount: typeof remote.paidAmount === 'number' ? remote.paidAmount : 0,
              balanceDue: typeof remote.balanceDue === 'number' ? remote.balanceDue : 0,
              notes: remote.notes ?? null,
              createdAt: typeof remote.createdAt === 'number' ? remote.createdAt : remote.createdAt instanceof Date ? remote.createdAt.getTime() : Date.now() - 60_000,
              updatedAt: typeof remote.updatedAt === 'number' ? remote.updatedAt : remote.updatedAt instanceof Date ? remote.updatedAt.getTime() : Date.now(),
              items: Array.isArray(remote.items) ? remote.items : [],
            };
            if (idx >= 0) {
              // Preserve local-only fields (e.g. POS-assigned line items) and
              // merge incoming remote properties (source, customer, totals...).
              mockOrders[idx] = { ...(mockOrders[idx] as any), ...canonical };
            } else {
              mockOrders.unshift(canonical as any);
            }
            upserted++;

            // Upsert snake_case order_items rows (for CashierScreenLayout's
            // recall-to-cart + line-item counts on history/rail cards)
            const lineItems = Array.isArray(remote._lineItems) ? remote._lineItems : [];
            for (const li of lineItems) {
              if (!li?.id) continue;
              const liExists = mockOrderItems.findIndex((x) => String((x as any).id) === String(li.id));
              const child = {
                id: String(li.id),
                order_id: id,
                menu_item_id: String(li.menu_item_id ?? ''),
                name_snapshot: String(li.name_snapshot ?? ''),
                price_snapshot_cents: Number(li.price_snapshot_cents ?? 0) || 0,
                quantity: Number(li.quantity ?? 1) || 1,
                subtotal_cents: Number(li.subtotal_cents ?? 0) || 0,
                tax_cents: Number(li.tax_cents ?? 0) || 0,
                discount_cents: Number(li.discount_cents ?? 0) || 0,
                total_cents: Number(li.total_cents ?? 0) || 0,
                special_instructions: li.special_instructions ?? null,
                preparation_status: String(li.preparation_status ?? 'NEW'),
              };
              if (liExists >= 0) mockOrderItems[liExists] = child as any;
              else mockOrderItems.push(child as any);

              // child-of-child: ORDER_ITEM_MODIFIER_OPTION rows
              const mods = Array.isArray(li._modifierOptions) ? li._modifierOptions : [];
              for (const mo of mods) {
                if (!mo?.id) continue;
                const moIdx = mockOrderItemModifiers.findIndex((m) => String((m as any).id) === String(mo.id));
                const mrow = {
                  id: String(mo.id),
                  order_item_id: String(li.id),
                  modifier_id: String(mo.modifier_id ?? ''),
                  modifier_name: String(mo.modifier_name ?? ''),
                  option_id: String(mo.option_id ?? ''),
                  option_name: String(mo.option_name ?? ''),
                  price_delta_cents: Number(mo.price_delta_cents ?? 0) || 0,
                };
                if (moIdx >= 0) mockOrderItemModifiers[moIdx] = mrow as any;
                else mockOrderItemModifiers.push(mrow as any);
              }
            }
          }
          if (upserted) {
            console.log(`[mock sync] pulled ${upserted} backend website/QR order(s) into POS mock stores`);
          }
        } catch (e: any) {
          // Network error, CORS failure, offline — POS cashier works fully
          // offline anyway; just log and try again in 30s.
          if (e?.name !== 'AbortError') {
            console.debug('[mock sync] pull skipped (network/offline):', e?.message ?? e);
          }
        }
      };

      // First run shortly after install (2.5s) → login shift open → init
      // hydration ran → then on a stable 30s loop aligned with Electron
      // cloud-pull-worker cadence.
      setTimeout(upsertBackendExternalOrders, 2500);
      setInterval(upsertBackendExternalOrders, 30_000);

      // =====================================================================
      // SYNC PUSH (POS → backend) for browser mode
      //
      // In Electron packaged mode, command-queue-reader.ts polls the SQLite
      // sync_queue table every 1.5s and POSTs batches to /sync/batch. In
      // browser mode the mock shim has NO equivalent push loop — so all
      // syncQueue.push() from PaymentModal, CartPanel, and (new in this
      // session) Mark Paid / DELIVERED status bumps were silently piling up
      // in mockSyncQueue with zero delivery to the backend.
      //
      // Result: admin panel showed "Unpaid" forever for orders marked paid
      // on the POS (browser mode).
      //
      // This block mirrors the command-queue-reader cycle every 3s: batches
      // PENDING rows into commands, POSTs to /api/v1/sync/batch, marks
      // successes DONE, transient failures → retry on next tick.
      // =====================================================================
      if (typeof (window as any).__mockSyncPushInstalled === 'undefined') {
        (window as any).__mockSyncPushInstalled = true;
        let claimCursor = 0; // dummy lock: prevents concurrent cycles from double-processing

        const processSyncPushBatch = async () => {
          if (claimCursor !== 0) return; // skip if prior cycle is still running
          const pending = mockSyncQueue.filter((q) => q.status === 'PENDING').slice(0, 25);
          if (pending.length === 0) return;
          claimCursor = pending.length;

          try {
            // Mark claimed (PREPARING) so next tick doesn't pick them up
            pending.forEach((q) => { q.status = 'PROCESSING'; });

            const deviceId =
              (env.VITE_DEVICE_ID as string) ||
              (env.NEXT_PUBLIC_DEVICE_ID as string) ||
              `browser-${Date.now()}`;

            const commands = pending.map((row) => {
              let payload: any = {};
              try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload ?? {}; } catch { /* noop */ }
              return {
                idempotencyKey: String(row.idempotency_key ?? row.op_id ?? `op-${Date.now()}-${Math.random()}`),
                entityType: String(row.entity_type || 'UNKNOWN'),
                operation: (String(row.operation || 'CREATE').toUpperCase() as any),
                entityId: String(row.entity_id || ''),
                payload,
                localEntityVersion: Number(row.local_entity_version ?? 1) || 1,
              };
            });

            // /sync/batch is AUTH-guarded with JWT + permissions
            // (RequiredPermissions ORDER_CREATE + PAYMENT_ACCEPT), but browser
            // mock shim runs with credentials:'omit' and has no JWT. Instead
            // use the dedicated /public/pos-sync-batch unauthenticated endpoint
            // which mirrors /sync/batch but accepts POS-origin ORDER UPDATE +
            // PAYMENT CREATE commands without JWT.
            const url = `${API_BASE}/public/pos-sync-batch`;
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              credentials: 'omit',
              body: JSON.stringify({ deviceId, commands }),
            }).catch((e) => ({ ok: false, status: 0, statusText: String(e?.message ?? e) } as any));

            if (!resp.ok) {
              // Backend down, offline, or 401/403 — rollback to PENDING so
              // next cycle retries. Offline POS cashiers keep working locally
              // forever; sync resumes once backend reachable.
              pending.forEach((q) => { q.status = 'PENDING'; });
              console.debug(`[mock sync] push skipped (HTTP ${(resp as any).status || 'net-err'}) — ${pending.length} command(s) stay pending`);
              return;
            }

            let envelope: any = {};
            try { envelope = await (resp as any).json().catch(() => ({})); } catch { /* noop */ }
            const results: any[] =
              Array.isArray(envelope?.results) ? envelope.results :
              Array.isArray(envelope?.data?.results) ? envelope.data.results :
              commands.map((c, i) => ({ idempotencyKey: c.idempotencyKey, success: true, index: i }));

            // Correlate results via idempotencyKey → mark row DONE or FAILED
            const resByKey = new Map<string, any>();
            for (const r of results) if (r?.idempotencyKey) resByKey.set(String(r.idempotencyKey), r);
            pending.forEach((q) => {
              const key = String(q.idempotency_key ?? q.op_id ?? '');
              const r = resByKey.get(key);
              if (r && r.success === false) { q.status = 'FAILED'; q.error = String(r.error || r.message || 'server rejected'); }
              else { q.status = 'DONE'; q.ackedAt = Date.now(); }
            });
            const done = pending.filter((q) => q.status === 'DONE').length;
            const fail = pending.filter((q) => q.status === 'FAILED').length;
            if (done || fail) {
              console.log(`[mock sync] push batch → ${done} delivered, ${fail} rejected (${pending.length} total)`);
            }
          } catch (e: any) {
            // Any transport error: rollback to PENDING for retry
            pending.forEach((q) => { if (q.status === 'PROCESSING') q.status = 'PENDING'; });
            console.debug('[mock sync] push error (will retry):', e?.message ?? e);
          } finally {
            claimCursor = 0;
          }
        };

        // Kick off: 5s after install (so cashier login + shift open are done
        // before first push attempt), then every 3 seconds matching
        // command-queue-reader 1.5s cadence but 2x slower to reduce browser
        // fetch pressure.
        setTimeout(processSyncPushBatch, 5000);
        setInterval(processSyncPushBatch, 3000);
      }
    }
  } catch (e) {
    console.warn('[mock sync] bridge install failed:', e);
  }

  // =========================================================================
  // Eager customer branding + display write-up bootstrap
  //
  // Previously bootstrapCustomerBranding was LAZY — called ONLY on the
  // cashier's first `showIdle`/`showOrder`/etc click. This caused the
  // customer-display popup (which may open before the cashier clicks
  // anything, or via a direct URL visit) to show baked-in hardcoded
  // promos/specials forever.
  //
  // Running it EAGERLY here means:
  //   (a) Both the POS main window AND the customer-display popup fetch
  //       promos/specials from /public/customer-display-settings as soon
  //       as main.tsx finishes installing the shim.
  //   (b) The already-installed 30-second poller keeps both windows'
  //       state fresh after admin saves.
  //   (c) The BroadcastChannel handshake reply (customer-latest-request)
  //       already carries populated promos/specials since _latestCustomerState
  //       was hydrated earlier.
  // =========================================================================
  try {
    bootstrapCustomerBranding().catch((e) =>
      console.debug('[mock shim] customer branding bootstrap skipped:', e?.message ?? e)
    );
  } catch (_) {
    /* startup race / non-browser context */
  }
}
