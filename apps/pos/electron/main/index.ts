import {
  app,
  BrowserWindow,
  dialog,
  shell,
  screen,
  ipcMain,
  nativeImage,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Store from 'electron-store';
import electronUpdater from 'electron-updater';
import { WindowManager } from './window-manager';
import { registerSecurityHandlers } from './security';
import { SyncEngine } from './sync';
import { createSingletonDb, createRepos, type ReposBundle, type PosDatabase } from './db';
import { registerAllDbIpc } from './ipc-db-bridge';

// === Defensive IPC registration guard =========================================
// Electron's ipcMain.handle() THROWS when the same channel is registered a
// second time (unlike ipcMain.on). The SyncEngine (sync/index.ts L202-L223)
// internally registers 'sync:request-now' and 'sync:get-connection-status' via
// SyncEngine.registerIpc(). Any manual re-registering of those channels in
// this file causes Electron to throw → the app.on('ready') try/catch fires
// dialog.showErrorBox('Prolific POS failed to initialize local DB', stack).
//
// We wrap ipcMain.handle() here so duplicates are safely skipped (logged but
// never throw), preventing future regression of the exact launch crash the
// user encountered in the 0.1.8 pre-build.
const _registeredHandleChannels = new Set<string>();
const _registeredOnceChannels = new Set<string>();

function safeHandle<T extends Parameters<typeof ipcMain.handle>>(
  channel: T[0],
  handler: T[1],
): void {
  if (_registeredHandleChannels.has(String(channel))) {
    // Already registered — keep the existing handler and skip.
    console.warn(`[ipc] skip duplicate handle for channel: ${String(channel)}`);
    return;
  }
  try {
    (ipcMain.handle as any)(channel, handler);
    _registeredHandleChannels.add(String(channel));
  } catch (err) {
    // Electron 20+ can still throw internally (race, test harness, etc).
    console.error(`[ipc] failed to register handle ${String(channel)}:`, (err as Error).message);
  }
}

function safeOn<T extends Parameters<typeof ipcMain.on>>(
  channel: T[0],
  listener: T[1],
): void {
  const key = String(channel) + '::ONCE';
  if (_registeredOnceChannels.has(key)) {
    console.warn(`[ipc] skip duplicate on for channel: ${String(channel)}`);
    return;
  }
  try {
    (ipcMain.on as any)(channel, listener);
    _registeredOnceChannels.add(key);
  } catch (err) {
    console.error(`[ipc] failed to register on ${String(channel)}:`, (err as Error).message);
  }
}

const isDev = !app.isPackaged;
const isProd = app.isPackaged;

// Redirect the Electron userData directory to a project-local folder during
// development so the app keeps working even when the sandbox blocks writes
// under ~/Library/Application Support (common in restricted dev sandboxes).
const PROJECT_USERDATA_NAME = '.userData';
function resolveDevUserDataDir(): string {
  // Walk up from electron/main/ to apps/pos/.userData
  const here = __dirname; // dist-electron/main (built) OR electron/main (uncommon)
  const candidates = [
    path.resolve(here, '..', '..', PROJECT_USERDATA_NAME),        // apps/pos/dist-electron/main/ -> apps/pos/.userData
    path.resolve(here, '..', '..', '..', PROJECT_USERDATA_NAME), // fallback double-parent
  ];
  // Try to pick a dir whose sibling package.json matches @prolific/pos.
  for (const candidate of candidates) {
    const parent = path.dirname(candidate);
    const pkgPath = path.join(parent, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) return candidate;
    } catch { /* ignore */ }
  }
  return candidates[0];
}

const USERDATA_DIR = isDev ? resolveDevUserDataDir() : app.getPath('userData');
try {
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
} catch (e) {
  // Best-effort; fall back to Electron's default if the override dir is
  // truly unwritable (should be impossible in-dev since apps/pos/ is ours).
  console.warn('[pos] could not create project-local userData dir', USERDATA_DIR, e);
}
// app.setPath('userData') is safe to call pre-ready (Electron docs allow it).
try {
  app.setPath('userData', USERDATA_DIR);
} catch (e) {
  console.warn('[pos] app.setPath(userData) failed; using electron-store cwd override', e);
}

const store = new Store<{
  deviceId: string;
  deviceKey: string;
  lastAuth: { employeeId?: string; branchId?: string; timestamp?: number } | null;
  syncCursor: Record<string, string | number>;
}>({
  name: 'prolific-pos',
  encryptionKey: 'prolific-pos-encryption-key-change-me',
  // Explicit cwd bypasses app.getPath('userData') entirely — acts as a safety
  // net even if app.setPath() was denied for any reason.
  cwd: USERDATA_DIR,
  defaults: {
    deviceId: '',
    deviceKey: '',
    lastAuth: null,
    syncCursor: {},
  },
});

let posWin: BrowserWindow | null = null;
let customerWin: BrowserWindow | null = null;
let syncEngine: SyncEngine | null = null;
let repos: ReposBundle | null = null;
let posDb: PosDatabase | null = null;

const ALLOWED_ORIGINS = [
  'app://',
  'http://localhost:',
  'http://127.0.0.1:',
  process.env.VITE_SERVER_URL || '',
].filter(Boolean);

function isAllowedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'app:') return true;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      const port = parseInt(parsed.port, 10);
      return port >= 3000 && port <= 4000;
    }
    if (process.env.VITE_SERVER_URL) {
      const serverUrl = new URL(process.env.VITE_SERVER_URL);
      return parsed.origin === serverUrl.origin;
    }
    return false;
  } catch {
    return false;
  }
}

function ensureDeviceId(): { deviceId: string; deviceKey: string } {
  let deviceId = store.get('deviceId');
  let deviceKey = store.get('deviceKey');

  if (!deviceId) {
    deviceId = `dev_${crypto.randomBytes(8).toString('hex')}`;
    store.set('deviceId', deviceId);
  }
  if (!deviceKey) {
    deviceKey = crypto.randomBytes(32).toString('base64url');
    store.set('deviceKey', deviceKey);
  }
  return { deviceId, deviceKey };
}

function getRendererUrl(routeHash?: string): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (isDev) {
    return routeHash ? `${devUrl}#${routeHash}` : devUrl;
  }
  const prodPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
  const base = `file://${prodPath}`;
  return routeHash ? `${base}#${routeHash}` : base;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedOrigin(navigationUrl)) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOrigin(url)) {
      return { action: 'allow' };
    }
    setImmediate(() => {
      shell.openExternal(url);
    });
    return { action: 'deny' };
  });
});

safeHandle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});

safeHandle('app:get-versions', () => ({
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
}));

safeHandle('window:customer-show', () => {
  // Use the WindowManager helper so always-on-top is only applied when a
  // real external display exists (avoids covering the cashier keypad on a
  // single monitor in dev mode).
  if (WindowManager.instance) {
    WindowManager.instance.showCustomer();
  } else if (customerWin && !customerWin.isDestroyed()) {
    customerWin.show();
    const primaryId = screen.getPrimaryDisplay().id;
    const hasExternal = screen.getAllDisplays().some((d) => d.id !== primaryId);
    if (hasExternal) {
      customerWin.setAlwaysOnTop(true, 'screen-saver');
    }
    ipcMain.emit('customer-window-state-changed', { visible: true });
    customerWin.webContents.send('customer:state-changed', { visible: true });
  }
  return true;
});

safeHandle('window:customer-hide', () => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.hide();
    ipcMain.emit('customer-window-state-changed', { visible: false });
    customerWin.webContents.send('customer:state-changed', { visible: false });
  }
  return true;
});

safeHandle('window:pos-fullscreen', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.setFullScreen(true);
  }
  return true;
});

safeHandle('window:pos-exit-fullscreen', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.setFullScreen(false);
  }
  return true;
});

// Custom renderer-controlled window chrome.
// Hiding the native frame lets us paint a branded, unified title bar
// (Header.tsx) that carries the same Prolific neon-dark aesthetic across
// Windows, macOS, and Linux. The Header renders these 4 controls:
//   [＋ Add]  — POS-domain shortcut (triggers `pos:quick-new-cart` event)
//   [－]     — minimize
//   [☐/▣]    — toggle maximize (with live maximized-state label)
//   [✕]      — close (macOS still keeps native traffic-light; this is
//              the primary trigger on Windows/Linux, secondary on macOS).
safeHandle('window:pos-minimize', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.minimize();
  }
  return true;
});

safeHandle('window:pos-toggle-maximize', () => {
  if (!posWin || posWin.isDestroyed()) {
    return { maximized: false, isMaximizable: false };
  }
  const canMaximize = posWin.isMaximizable();
  // Toggle. Unmaximize when already maximized; maximize otherwise.
  if (posWin.isMaximized()) {
    posWin.unmaximize();
  } else if (canMaximize) {
    posWin.maximize();
  }
  return {
    maximized: posWin.isMaximized(),
    isMaximizable: canMaximize,
  };
});

safeHandle('window:pos-is-maximized', () => ({
  maximized: posWin && !posWin.isDestroyed() ? posWin.isMaximized() : false,
  isMaximizable: posWin && !posWin.isDestroyed() ? posWin.isMaximizable() : true,
  platform: process.platform,
}));

safeHandle('window:pos-close', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.close();
  }
  return true;
});

// Broadcasts POS window state changes to the renderer so the
// custom chrome icons (☐/▣) stay in sync with native chrome actions
// (dragging title bar off the top, Windows/Mac keyboard shortcuts, etc).
function broadcastWindowState(): void {
  if (!posWin || posWin.isDestroyed()) return;
  const payload = {
    maximized: posWin.isMaximized(),
    minimizable: posWin.minimizable,
    maximizable: posWin.isMaximizable(),
    fullscreen: posWin.isFullScreen(),
  };
  try {
    posWin.webContents.send('pos:window-state-changed', payload);
  } catch { /* ignore during teardown */ }
}
// Register once after app.ready so posWin exists; guard against duplicates
// since app.on('activate') may re-create posWin but our singleton pattern
// in WindowManager will keep the function below idempotent.
let windowStateListenersRegistered = false;
function registerWindowStateBroadcast(): void {
  if (windowStateListenersRegistered) return;
  windowStateListenersRegistered = true;
  const rebindWhenAvailable = () => {
    if (!posWin || posWin.isDestroyed()) {
      // Try again after app.ready if posWin was still null.
      setTimeout(rebindWhenAvailable, 250);
      return;
    }
    posWin.on('maximize', broadcastWindowState);
    posWin.on('unmaximize', broadcastWindowState);
    posWin.on('enter-full-screen', broadcastWindowState);
    posWin.on('leave-full-screen', broadcastWindowState);
    posWin.on('minimize', broadcastWindowState);
    posWin.on('restore', broadcastWindowState);
  };
  rebindWhenAvailable();
}

safeHandle('device:get-device-id', () => {
  const { deviceId, deviceKey } = ensureDeviceId();
  return { deviceId, deviceKey };
});

// Resolves the canonical API base URL from the MAIN process (which has
// perfect visibility into whether this is a packaged production build on
// Windows/macOS/Linux or a dev build). The renderer cannot detect prod via
// `window.location.hostname` because packaged apps load through
// `file:///dist/index.html` or `app://` — no hostname information. Without
// this IPC call, the renderer always falls back to `localhost:4000` on
// desktop installs → login fails with the exact SERVER_UNREACHABLE error the
// user reported. Returned URL always has trailing slash stripped.
safeHandle('device:get-api-base-url', () => getHttpBaseUrl());
// Synchronous counterpart: used by renderer at module-load time so
// resolveApiBase() can return a string synchronously (all downstream calls in
// remote-auth.ts and mock-electron-shim.ts expect a string, not a Promise).
safeOn('device:get-api-base-url-sync', (event) => {
  event.returnValue = getHttpBaseUrl();
});

safeHandle('db:run-migrations', () => {
  if (!posDb) return { success: false, migrations: 0, error: 'db not initialized' };
  const result = posDb.migrate();
  return { success: true, migrations: result.applied, from: result.from, to: result.to };
});

// CORS-BYPASS for Electron packaged renderers.
// Electron renderers load over `file:///` and Chromium sends Origin: "null"
// (opaque) or "file://". On older Render deployments where the server CORS
// allowlist may lag behind the client, the OPTIONS preflight is rejected
// with 404 "Cannot OPTIONS /api/v1/auth/pin/login" → renderer fetch throws
// TypeError (network error, NO response object) → guardedFetch maps that to
// SERVER_UNREACHABLE "after wake" even though the API is live.
//
// This helper routes the PIN login POST through main-process Node.js
// `fetch` (which is NOT bound to Chromium's browser CORS spec and NEVER
// sends an opaque origin nor triggers an OPTIONS preflight). It always
// returns a structured { status, ok, body } shape so the renderer can
// treat success/failure exactly like a normal Response.
safeHandle(
  'auth:pin-login',
  async (
    _event,
    payload: { pin: string; branchId?: string; deviceId?: string },
  ) => {
    const url = `${getHttpBaseUrl().replace(/\/+$/, '')}/auth/pin/login`;
    const controller = new AbortController();
    // Match guardedFetch's per-attempt PIN budget (8 seconds) so renderers
    // see the same timeout behavior regardless of which path runs.
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `ProlificPOS-ElectronMain/${app.getVersion()}`,
        },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
        cache: 'no-store' as RequestCache,
      }).finally(() => clearTimeout(timeoutId));
      let body: unknown = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }
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
  }
);

// Generic renderer-accessible public HTTP GET.
// Renderers packaged in Electron load from file:// — any POST or custom-header
// GET (anything not safelisted) triggers an OPTIONS preflight with Origin:
// "null" or "file://". On older Render builds before server CORS was patched
// to allow opaque origins, the preflight 404 causes Chromium fetch() to throw
// a TypeError with NO status code and NO Response — indistinguishable from a
// network outage. This IPC bypasses Chromium's browser CORS entirely by
// routing the GET through main-process Node fetch(), which has no Origin
// header restriction at all. Callers pass the URL PATH + optional query
// string (e.g. "/public/menu?branchId=XYZ"), and Node resolves it against
// getHttpBaseUrl() (the same canonical URL used by the sync daemon and
// getConnectionStatus). Returns { status, ok, headers, body (json), text }
// so callers can drop in wherever fetch() was used.
safeHandle(
  'public:http-get',
  async (_event, args: { path: string }) => {
    const base = getHttpBaseUrl().replace(/\/+$/, '');
    const rawPath = String(args?.path ?? '');
    // Collapse slashes so the caller can pass "/public/menu" or
    // "public/menu" without producing a double-slash URL.
    const safePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const url = `${base}${safePath}`;
    const controller = new AbortController();
    // Matches PIN budget: the caller (MenuGrid/LoginScreen) falls back to
    // local mirrors on failure, so a fast short timeout is better than a
    // hanging 30s TCP retry during Windows network blips.
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': `ProlificPOS-ElectronMain/${app.getVersion()}` },
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
  }
);

let printHandlersRegistered = false;
function registerPrintHandlers(): void {
  if (printHandlersRegistered) return;
  printHandlersRegistered = true;

  const escapeHtml = (v: unknown): string => {
    const s = String(v ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const ngn = (amountCents: number): string => {
    const n = Math.round(amountCents) / 100;
    return `₦${n.toFixed(2)}`;
  };

  // Resolves a simple branch-info block for the receipt header from repos + DB.
  // Returns sensible defaults when the info is missing (e.g. offline fresh state).
  const resolveBranchHeader = (order: any) => {
    const restaurantName = (order?.restaurant_name || '').trim() || 'Restaurant';
    const branchName = (order?.branch_name || '').trim() || '';
    // Stored receipt header comes from sync'd DB settings. We read it via
    // repos.settings when available, but keep the receipt fully functional
    // offline with sane text defaults.
    const defaultLine1 = branchName ? `${restaurantName} · ${branchName}` : restaurantName;
    const defaultLine2 = 'Thank you for your patronage';
    return { line1: defaultLine1, line2: defaultLine2, defaultFooter: 'Powered by Prolific POS' };
  };

  // Emits a 40mm paper-feed spacer with dashed tear-off line, used on BOTH
  // receipts and kitchen tickets. Thermal printers (EPSON TM-T88/Xprinter/Zjiang
  // 80mm/58mm series with auto-cutter) trigger cutter when job document ends;
  // without this spacer the cut happens mid-Thank-You footer. The spacer also
  // pushes footer lines past the printer-tear bar on models WITHOUT cutter
  // (staff tears manually at the dashed line).
  const renderPaperCutSpacer = (jobKind: 'receipt' | 'kitchen'): string => {
    // 12 thin feed lines (about 6–8 mm) + 32mm tall invisible cut spacer
    // = ~40mm of blank paper after the footer. Adjust amount if cut happens
    // too early or too late on your printer fleet.
    const feedLines = Array.from({ length: 12 }, () => `<div class="feed-line">&nbsp;</div>`).join('');
    // Dashed tear-off cut line (visible on non-cutter printers so staff knows
    // exactly where to rip). Skip on kitchen tickets — KDS doesn't need it.
    const tearBar = jobKind === 'receipt'
      ? `<div class="tear-off"><span>CUT / TEAR HERE</span></div>`
      : '';
    return `
      ${tearBar}
      <div class="cut-spacer" role="separator" aria-hidden="true"></div>
      <div class="feed-lines" aria-hidden="true">${feedLines}</div>
    `;
  };

  // CSS class helpers for the paper-cut spacer. Injected into the <style>
  // block of each receipt/kitchen HTML so everything is self-contained (no
  // external stylesheet deps needed for the hidden BrowserWindow print spool).
  const PAPER_CUT_CSS = `
    /* Tear-off cut bar: dashed line + CUT/TEAR HERE label so non-cutter
       printers show staff the rip position. Label is small so auto-cutter
       printers don't waste ink on the message. */
    .tear-off {
      width: 100%;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      margin: 6mm 0 2mm 0;
      padding: 0.5mm 0;
      text-align: center;
    }
    .tear-off span {
      font-family: 'Courier New', Courier, monospace;
      font-size: 9px;
      line-height: 1;
      letter-spacing: 0.2em;
      color: #000;
      opacity: 0.75;
    }
    /* Blank spacer div (32mm) = tall enough block so Chromium rasterizes a
       region of empty paper past the last visible line. Thermal auto-cutter
       fires at last-rasterized scan line; 32mm + 12 feed lines = ~40mm
       after footer which is the standard "cut here" position on 80mm EPSON /
       Xprinter / Zjiang / Gprinter hardware. */
    .cut-spacer {
      height: 32mm;
      width: 100%;
      visibility: hidden;
      overflow: hidden;
    }
    /* 12 lines of non-breaking space (≈ 6–8 mm) so 58mm narrow printers
       without cutter also get enough paper past the tear bar. */
    .feed-lines .feed-line {
      width: 100%;
      height: 11px;
      line-height: 11px;
      visibility: hidden;
      font-size: 11px;
    }
    /* Ensure spacer blocks don't get page-broken — we want cut offset to
       always be at the very end of the single document page. */
    .tear-off, .cut-spacer, .feed-lines, .feed-line {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  `;

  const buildReceiptHtml = (
    order: any,
    items: any[],
    modifiers: any[],
    payments: any[],
    meta: { title: string; printedAt: number; copyIndex: number; totalCopies: number; header?: ReturnType<typeof resolveBranchHeader> }
  ): string => {
    const createdAt = order?.created_at ? new Date(Number(order.created_at)) : new Date();
    const hdr = meta.header ?? resolveBranchHeader(order);
    const orderNo = order?.order_number || order?.orderNumber || '';
    const subtotalCents = Number(order?.subtotal_cents ?? order?.subtotalCents ?? 0);
    const discountCents = Number(order?.discount_cents ?? order?.discountCents ?? 0);
    const taxCents = Number(order?.tax_cents ?? order?.taxCents ?? 0);
    const tipCents = Number(order?.tip_cents ?? order?.tipCents ?? 0);
    const totalCents = Number(order?.total_cents ?? order?.totalCents ?? 0);
    const changeDueCents = Number(order?.change_due_cents ?? order?.changeDueCents ?? 0);
    const isPaid = (order?.payment_status ?? order?.paymentStatus) === 'PAID';

    // Helper: indent + wrap modifier and special-instruction lines under a line item.
    const renderItem = (it: any, idx: number): string => {
      const name = it?.name_snapshot ?? it?.name ?? '';
      const qty = Number(it?.quantity ?? 0);
      const unitCents = Number(it?.price_snapshot_cents ?? it?.unitPriceCents ?? 0);
      const total = Number(it?.total_cents ?? it?.subtotal_cents ?? 0);
      const itemMods = modifiers.filter((m: any) => String(m.order_item_id) === String(it.id));
      const special = (it?.special_instructions ?? it?.specialInstructions ?? '').toString().trim();
      let rows = `
        <div class="grid item">
          <div class="cell qty center">${escapeHtml(String(qty))}</div>
          <div class="cell name">${escapeHtml(name)}</div>
          <div class="cell price right">${escapeHtml(ngn(total))}</div>
        </div>`;
      if (unitCents > 0 && qty > 1) {
        rows += `<div class="grid small muted">
          <div class="cell qty"></div>
          <div class="cell name">@ ${escapeHtml(ngn(unitCents))} each</div>
          <div class="cell price right"></div>
        </div>`;
      }
      if (itemMods && itemMods.length) {
        for (const m of itemMods) {
          rows += `<div class="grid small muted">
            <div class="cell qty"></div>
            <div class="cell name">+ ${escapeHtml((m.modifier_name || '') + ': ' + (m.option_name || ''))}</div>
            <div class="cell price right"></div>
          </div>`;
        }
      }
      if (special) {
        rows += `<div class="grid small note">
          <div class="cell qty"></div>
          <div class="cell name">※ ${escapeHtml(special)}</div>
          <div class="cell price right"></div>
        </div>`;
      }
      return rows;
    };

    const header = `
      <div class="center brand">${escapeHtml(hdr.line1)}</div>
      <div class="center small muted">${escapeHtml(hdr.line2)}</div>
      <div class="line"></div>
      <div class="center title">${escapeHtml(meta.title)}</div>
      <div class="center small muted">Copy ${meta.copyIndex + 1} of ${meta.totalCopies}</div>
      <div class="grid">
        <div class="cell muted">Date</div><div class="cell right">${escapeHtml(createdAt.toLocaleString())}</div>
        ${orderNo ? `<div class="cell muted">Order</div><div class="cell right mono">${escapeHtml(orderNo)}</div>` : ''}
        ${order?.order_type ? `<div class="cell muted">Type</div><div class="cell right">${escapeHtml(String(order.order_type).replace(/_/g, ' '))}</div>` : ''}
        ${order?.customer_name ? `<div class="cell muted">Customer</div><div class="cell right">${escapeHtml(order.customer_name)}</div>` : ''}
        ${order?.table_id && order?.table_name ? `<div class="cell muted">Table</div><div class="cell right">${escapeHtml(order.table_name)}</div>` : ''}
        ${order?.cashier_name ? `<div class="cell muted">Cashier</div><div class="cell right">${escapeHtml(order.cashier_name)}</div>` : (order?.employee_name ? `<div class="cell muted">Cashier</div><div class="cell right">${escapeHtml(order.employee_name)}</div>` : '')}
      </div>
      <div class="line"></div>
      <div class="grid head small muted">
        <div class="cell qty">Qty</div>
        <div class="cell name">Item</div>
        <div class="cell price right">Price</div>
      </div>
      <div class="line thin"></div>
    `;

    const bodyLines = items.length
      ? items.map(renderItem).join('')
      : `<div class="center small muted">No item details available</div>`;

    // Totals block: subtotal → discounts → taxes → tips → total.
    const totalsParts: string[] = [`<div class="line thin"></div>`];
    totalsParts.push(`<div class="grid total"><div class="cell left">Subtotal</div><div class="cell right">${escapeHtml(ngn(subtotalCents))}</div></div>`);
    if (discountCents > 0) {
      totalsParts.push(`<div class="grid total"><div class="cell left">Discount</div><div class="cell right">−${escapeHtml(ngn(discountCents))}</div></div>`);
    }
    if (taxCents > 0) {
      totalsParts.push(`<div class="grid total"><div class="cell left">Tax</div><div class="cell right">${escapeHtml(ngn(taxCents))}</div></div>`);
    }
    if (tipCents > 0) {
      totalsParts.push(`<div class="grid total"><div class="cell left">Tip</div><div class="cell right">${escapeHtml(ngn(tipCents))}</div></div>`);
    }
    totalsParts.push(`<div class="line"></div><div class="grid total big bold"><div class="cell left">TOTAL</div><div class="cell right">${escapeHtml(ngn(totalCents))}</div></div>`);

    // Payment method breakdown (useful when split-bill or cashier wants to verify tender/change).
    if (payments && payments.length) {
      totalsParts.push(`<div class="line"></div><div class="small muted">Payments</div>`);
      for (const p of payments) {
        const method = (p?.method || p?.payment_method || 'UNKNOWN').toString().replace(/_/g, ' ');
        const paid = Number(p?.amount_cents ?? p?.amountCents ?? 0);
        totalsParts.push(`<div class="grid total small"><div class="cell left">${escapeHtml(method)}</div><div class="cell right">${escapeHtml(ngn(paid))}</div></div>`);
        // For cash payments show tendered + change if available.
        if ((p?.method === 'CASH' || p?.payment_method === 'CASH') && changeDueCents > 0) {
          const tendered = paid + changeDueCents;
          totalsParts.push(`<div class="grid total small muted"><div class="cell left">Tendered</div><div class="cell right">${escapeHtml(ngn(tendered))}</div></div>`);
          totalsParts.push(`<div class="grid total small muted"><div class="cell left">Change</div><div class="cell right">${escapeHtml(ngn(changeDueCents))}</div></div>`);
        }
      }
    }
    totalsParts.push(`<div class="grid total bold"><div class="cell left">Paid</div><div class="cell right">${isPaid ? 'YES' : 'NO'}</div></div>`);

    const footer = `
      <div class="line"></div>
      <div class="center small muted">Printed: ${escapeHtml(new Date(meta.printedAt).toLocaleString())}</div>
      <div class="center small bold">Thank you</div>
      <div class="center small muted">${escapeHtml(hdr.defaultFooter)}</div>
      ${renderPaperCutSpacer('receipt')}
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(meta.title || 'Receipt')}</title>
          <style>
            /* ----- Screen/preview styles ----- */
            html, body { margin: 0; padding: 0; background: #fff; color: #000; }
            html { box-sizing: border-box; }
            * { box-sizing: inherit; }
            :root {
              /* 80mm paper has ~72–76mm printable area depending on printer margins.
                 We use 74mm as the safe default and let the @page rules size the paper. */
              --paper-width: 74mm;
              --font-stack: 'Courier New', Courier, 'DejaVu Sans Mono', Consolas, monospace,
                            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              --body-size: 11px;
              --body-lh: 1.35;
              --small-size: 10px;
              --small-lh: 1.35;
            }
            body {
              width: var(--paper-width);
              margin: 0 auto;
              padding: 3mm 3mm 4mm 3mm;
              font-family: var(--font-stack);
              font-size: var(--body-size);
              line-height: var(--body-lh);
              font-weight: 500;
              -webkit-font-smoothing: antialiased;
              color: #000;
              background: #fff;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            .brand {
              font-size: 13px;
              font-weight: 800;
              letter-spacing: 0.02em;
              line-height: 1.25;
            }
            .title {
              font-size: 12px;
              font-weight: 800;
              margin: 2px 0 0 0;
              text-transform: uppercase;
              letter-spacing: 0.12em;
            }
            .big { font-size: 13px; }
            .bold { font-weight: 800; }
            .center { text-align: center; }
            .right { text-align: right; }
            .small { font-size: var(--small-size); line-height: var(--small-lh); }
            .muted { color: #111; opacity: 0.75; }
            .note { color: #000; font-style: italic; }
            .mono { font-family: 'Courier New', Courier, monospace; }

            /* Two-column info grid (label : value). */
            .grid {
              display: grid;
              grid-template-columns: 24mm 1fr;
              column-gap: 2mm;
              row-gap: 1px;
              align-items: start;
            }
            /* Totals two-column grid: left-label | right-amount. */
            .grid.total {
              grid-template-columns: 1fr auto;
              column-gap: 2mm;
            }
            .grid.total .cell.right,
            .grid.total .cell.left { align-self: start; }
            /* Items three-column grid: qty | name | price.
               Columns add up to ~var(--paper-width) minus 6mm horizontal padding so
               74mm paper - 6mm padding = 68mm usable width.
               qty = 10mm, price = 17mm, gap = 2mm, name = 100% (fills). */
            .grid.item,
            .grid.head {
              grid-template-columns: 10mm 1fr 17mm;
              column-gap: 1.5mm;
              align-items: start;
            }
            .grid .cell.qty { width: 10mm; }
            .grid .cell.price { width: 17mm; }
            .grid .cell.name {
              width: 100%;
              min-width: 0;        /* critical: enables overflow-wrap inside grid */
              overflow-wrap: break-word;
              word-wrap: break-word;
              hyphens: manual;
            }
            .grid .cell { display: block; min-width: 0; }
            .grid .cell.left { justify-self: start; }
            .grid .cell.right { justify-self: end; }

            .line {
              border-top: 1px dashed #000;
              margin: 3mm 0;
            }
            .line.thin {
              border-top: 1px dotted #000;
              margin: 1.5mm 0;
              opacity: 0.8;
            }

            /* Paper-cut / tear-off spacer classes so auto-cutter fires at the
               right document boundary and manual-tear printers show a visible
               dashed cut line. Shared with kitchen tickets. */
            ${PAPER_CUT_CSS}

            /* ----- Thermal print styles ----- */
            @page {
              /* size: 80mm width and AUTO height so paper cuts dynamically
                 instead of forcing A4/Letter. */
              size: 80mm auto;
              margin: 0;
            }
            @media print {
              html, body { background: #fff !important; }
              body {
                /* Preview padding replaced with print-optimized padding: L3/R3
                   for paper margins, T3 for header clearance, B35 so Chromium
                   print-driver advances paper past the tear bar / auto-cutter
                   blade BEFORE signalling end-of-doc (which triggers GS V cut). */
                width: 74mm;
                max-width: 74mm;
                margin: 0 auto !important;
                padding: 3mm 3mm 35mm 3mm !important;
                font-family: var(--font-stack) !important;
                font-size: var(--body-size) !important;
                line-height: var(--body-lh) !important;
                color: #000 !important;
                background: #fff !important;
              }
              /* Kill browser chrome: headers, footers, url strings, etc. */
              @page { margin: 0; size: 80mm auto; }
              /* Chrome/Chromium default margins on some Linux/Windows builds. */
              @page :first { margin: 0; }
              @page :left  { margin: 0; }
              @page :right { margin: 0; }

              /* Prevent any elements outside the receipt body from leaking onto paper. */
              body > * { visibility: hidden; }
              body { visibility: visible; }
              body > * { visibility: visible; }

              /* Prevent blank trailing pages + avoid page breaks inside rows. */
              html, body {
                height: auto !important;
                min-height: auto !important;
                max-height: none !important;
              }
              .grid, .line, .center, .bold, .big, .brand, .title, .small {
                page-break-inside: avoid;
                break-inside: avoid;
              }
              .grid.item {
                page-break-inside: auto;      /* long names can wrap across rows but */
                break-inside: auto;           /* individual grid cells stay together */
              }
              .grid .cell { page-break-inside: avoid; break-inside: avoid; }

              /* Avoid orphans at top/bottom of a page. */
              body { orphans: 2; widows: 2; }

              /* Ensure no scrollbars/extra background. */
              * {
                background: transparent !important;
                color: #000 !important;
                box-shadow: none !important;
                text-shadow: none !important;
              }
            }
          </style>
        </head>
        <body>
          ${header}
          ${bodyLines}
          ${totalsParts.join('')}
          ${footer}
        </body>
      </html>
    `;
  };

  const buildKitchenTicketHtml = (
    order: any,
    items: any[],
    modifiers: any[],
    meta: { printedAt: number; header?: ReturnType<typeof resolveBranchHeader> }
  ): string => {
    const createdAt = order?.created_at ? new Date(Number(order.created_at)) : new Date();
    const hdr = meta.header ?? resolveBranchHeader(order);
    const orderNo = order?.order_number || order?.orderNumber || '';
    const rows: string[] = [];
    for (const it of items) {
      const name = it?.name_snapshot ?? it?.name ?? '';
      const qty = Number(it?.quantity ?? 0);
      const special = (it?.special_instructions ?? it?.specialInstructions ?? '').toString().trim();
      const itemMods = modifiers.filter((m: any) => String(m.order_item_id) === String(it.id));
      rows.push(`
        <div class="kitem">
          <div class="kqty">${escapeHtml(String(qty))}×</div>
          <div class="kname">${escapeHtml(name)}</div>
        </div>
      `);
      if (itemMods && itemMods.length) {
        for (const m of itemMods) {
          rows.push(`<div class="kmod">+ ${escapeHtml((m.modifier_name || '') + ': ' + (m.option_name || ''))}</div>`);
        }
      }
      if (special) {
        rows.push(`<div class="kmod note">Note: ${escapeHtml(special)}</div>`);
      }
    }

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>KITCHEN TICKET ${escapeHtml(orderNo || '')}</title>
          <style>
            html, body { margin: 0; padding: 0; background: #fff; color: #000; }
            html { box-sizing: border-box; }
            * { box-sizing: inherit; }
            :root {
              --paper-width: 74mm;
              --font-stack: 'Courier New', Courier, 'DejaVu Sans Mono', Consolas, monospace,
                            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              --body-size: 12px;
              --body-lh: 1.35;
              --small-size: 11px;
            }
            body {
              width: var(--paper-width);
              margin: 0 auto;
              padding: 3mm 3mm 4mm 3mm;
              font-family: var(--font-stack);
              font-size: var(--body-size);
              line-height: var(--body-lh);
              font-weight: 600;
              -webkit-font-smoothing: antialiased;
              color: #000;
              background: #fff;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            h1 {
              font-size: 16px;
              font-weight: 900;
              text-align: center;
              margin: 0 0 2px;
              letter-spacing: 0.14em;
              text-transform: uppercase;
            }
            h2 {
              font-size: 13px;
              font-weight: 800;
              text-align: center;
              margin: 0 0 6px;
            }
            .row {
              display: grid;
              grid-template-columns: 24mm 1fr;
              column-gap: 2mm;
              row-gap: 1px;
              align-items: start;
              margin: 1px 0;
            }
            .row > *:first-child { justify-self: start; }
            .row > *:last-child  { justify-self: end; text-align: right; font-weight: 700; }
            .line { border-top: 2px dashed #000; margin: 3mm 0; }
            .center { text-align: center; }
            .kitem { display: grid; grid-template-columns: 10mm 1fr; column-gap: 2mm; margin: 6px 0 2px; align-items: start; }
            .kqty { font-weight: 900; font-size: 16px; text-align: center; }
            .kname { font-weight: 800; font-size: 14px; word-wrap: break-word; overflow-wrap: break-word; }
            .kmod { padding-left: 12mm; font-size: var(--small-size); color: #111; word-wrap: break-word; overflow-wrap: break-word; }
            .note { font-style: italic; color: #111; }
            .small { font-size: var(--small-size); color: #222; opacity: 0.85; }

            @page { size: 80mm auto; margin: 0; }
            ${PAPER_CUT_CSS}
            @media print {
              html, body { background: #fff !important; }
              body {
                width: 74mm;
                max-width: 74mm;
                margin: 0 auto !important;
                padding: 3mm 3mm 35mm 3mm !important;
                font-family: var(--font-stack) !important;
                font-size: var(--body-size) !important;
                line-height: var(--body-lh) !important;
                color: #000 !important;
                background: #fff !important;
              }
              @page { margin: 0; size: 80mm auto; }
              @page :first { margin: 0; }
              @page :left  { margin: 0; }
              @page :right { margin: 0; }
              body > * { visibility: hidden; }
              body { visibility: visible; }
              body > * { visibility: visible; }
              html, body { height: auto !important; min-height: auto !important; max-height: none !important; }
              h1, h2, .row, .line, .center, .kitem, .kmod, .note, .small { page-break-inside: avoid; break-inside: avoid; }
              body { orphans: 2; widows: 2; }
              * { background: transparent !important; color: #000 !important; box-shadow: none !important; text-shadow: none !important; }
            }
          </style>
        </head>
        <body>
          <h1>KITCHEN TICKET</h1>
          <h2>${escapeHtml(hdr.line1)}</h2>
          <div class="line"></div>
          <div class="row"><span>Order</span><span>${escapeHtml(orderNo)}</span></div>
          <div class="row"><span>Time</span><span>${escapeHtml(createdAt.toLocaleString())}</span></div>
          ${order?.table_id && order?.table_name ? `<div class="row"><span>Table</span><span>${escapeHtml(order.table_name)}</span></div>` : ''}
          ${order?.order_type ? `<div class="row"><span>Type</span><span>${escapeHtml(String(order.order_type).replace(/_/g, ' '))}</span></div>` : ''}
          ${order?.customer_name ? `<div class="row"><span>Customer</span><span>${escapeHtml(order.customer_name)}</span></div>` : ''}
          ${order?.note ? `<div class="row"><span>Note</span><span>${escapeHtml(order.note)}</span></div>` : ''}
          <div class="line"></div>
          ${rows.join('')}
          <div class="line"></div>
          <div class="center small">Printed ${escapeHtml(new Date(meta.printedAt).toLocaleTimeString())}</div>
          ${renderPaperCutSpacer('kitchen')}
        </body>
      </html>
    `;
  };

  // All print helpers MUST swallow errors internally. Printer / spooler /
  // device failures must NEVER propagate into the payment-confirm catch path
  // (which shows the generic "Payment not recorded" toast).
  const printHtml = async (html: string, deviceName?: string): Promise<{ success: boolean; error?: string }> => {
    let win: Electron.BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 360,
        height: 800,
        webPreferences: { sandbox: true },
      });
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        if (!win) return resolve({ success: false, error: 'window gone' });
        try {
          win.webContents.print(
            { silent: true, printBackground: true, deviceName },
            (ok, failureReason) => {
              if (ok) resolve({ success: true });
              else resolve({ success: false, error: failureReason || 'silent print failed' });
            }
          );
        } catch (inner: any) {
          resolve({ success: false, error: inner?.message || 'print call threw' });
        }
      });
      return result;
    } catch (e: any) {
      return { success: false, error: e?.message || 'printHtml unexpected error' };
    } finally {
      if (win && !win.isDestroyed()) {
        try { win.destroy(); } catch { /* ignore destroy errors */ }
      }
    }
  };

  // All print handlers MUST swallow errors to avoid leaking printer exceptions
  // into the payment-confirm toast catch path. Printer errors are logged but
  // NEVER re-thrown; the payment-write success is independent of printer state.
  safeHandle('print:list-printers', async () => {
    try {
      if (!posWin || posWin.isDestroyed()) return { printers: [] };
      const printers = await posWin.webContents.getPrintersAsync();
      return { printers: printers ?? [] };
    } catch (e: any) {
      return { printers: [], error: e?.message || 'list printers failed' };
    }
  });

  safeHandle('print:queue-status', async () => {
    try {
      return { queued: 0, inProgress: 0, failed: 0 };
    } catch (e: any) {
      return { queued: 0, inProgress: 0, failed: 0, error: e?.message || 'queue-status failed' };
    }
  });

  safeHandle('print:test-page', async () => {
    try {
      if (!posWin || posWin.isDestroyed()) return { queued: false, error: 'no window' };
      const printers = await posWin.webContents.getPrintersAsync();
      const defaultPrinter = printers.find((p) => (p as any).isDefault) ?? printers[0];
      const sampleItems = [
        { id: 't1', name_snapshot: 'Jollof Rice with Chicken', quantity: 1, price_snapshot_cents: 250000, total_cents: 250000 },
        { id: 't2', name_snapshot: 'Bottle Water', quantity: 2, price_snapshot_cents: 20000, total_cents: 40000, special_instructions: 'Cold please' },
      ];
      const sampleMods = [
        { order_item_id: 't1', modifier_name: 'Protein', option_name: 'Extra Chicken', price_delta_cents: 0 },
      ];
      const html = buildReceiptHtml(
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
      const res = await printHtml(html, defaultPrinter?.name);
      if (!res.success) return { queued: false, error: res.error || 'test page print failed' };
      return { queued: true, jobId: `test_${Date.now()}` };
    } catch (e: any) {
      return { queued: false, error: e?.message || 'test-page unexpected error' };
    }
  });

  safeHandle('print:kitchen-ticket', async (_e, payload) => {
    try {
      const p = (payload ?? {}) as { orderId?: unknown };
      const orderId = String(p.orderId ?? '');
      if (!orderId) return { queued: false, error: 'missing orderId' };
      if (!posWin || posWin.isDestroyed()) return { queued: false, error: 'no window' };
      if (!repos) return { queued: false, error: 'db not ready' };

      const order = repos.orders.getById(orderId);
      if (!order) return { queued: false, error: 'order not found' };

      const items = repos.orderItems.listByOrderId(orderId);
      const modifiers = repos.orderItemModifierOptions.listByOrderId(orderId);
      const printers = await posWin.webContents.getPrintersAsync();
      const defaultPrinter = printers.find((pr) => (pr as any).isDefault) ?? printers[0];

      const html = buildKitchenTicketHtml(order, items, modifiers, { printedAt: Date.now() });
      const res = await printHtml(html, defaultPrinter?.name);
      if (!res.success) return { queued: false, error: res.error || 'kitchen ticket print failed' };
      return { queued: true, orderId, jobId: `ktn_${orderId}_${Date.now()}` };
    } catch (e: any) {
      return { queued: false, error: e?.message || 'kitchen-ticket unexpected error' };
    }
  });

  safeHandle('print:receipt', async (_e, payload) => {
    try {
      const p = (payload ?? {}) as { orderId?: unknown; copy?: unknown };
      const orderId = String(p.orderId ?? '');
      const copies = Math.max(1, Math.min(5, Number(p.copy ?? 1)));
      if (!orderId) return { queued: false, error: 'missing orderId' };
      if (!posWin || posWin.isDestroyed()) return { queued: false, error: 'no window' };
      if (!repos) return { queued: false, error: 'db not ready' };

      const order = repos.orders.getById(orderId);
      if (!order) return { queued: false, error: 'order not found' };

      const items = repos.orderItems.listByOrderId(orderId);
      const modifiers = repos.orderItemModifierOptions.listByOrderId(orderId);
      const payments = repos.payments.listByOrderId(orderId);
      const printers = await posWin.webContents.getPrintersAsync();
      const defaultPrinter = printers.find((pr) => (pr as any).isDefault) ?? printers[0];
      const printedAt = Date.now();
      const header = resolveBranchHeader(order);

      let lastError: string | undefined;
      for (let i = 0; i < copies; i += 1) {
        const title = i === 0 ? 'CUSTOMER COPY' : 'CASHIER COPY';
        const html = buildReceiptHtml(order, items, modifiers, payments, {
          title,
          printedAt,
          copyIndex: i,
          totalCopies: copies,
          header,
        });
        const res = await printHtml(html, defaultPrinter?.name);
        if (!res.success) lastError = res.error || `copy ${i + 1} print failed`;
      }

      if (lastError) {
        // If any copy failed, report it but still mark the handler as non-throwing.
        // The payment DID record; only printing partially failed.
        return {
          queued: false,
          partial: true,
          orderId,
          copies,
          error: lastError,
          jobId: `rcpt_${orderId}_${Date.now()}`,
        };
      }
      return { queued: true, orderId, copies, jobId: `rcpt_${orderId}_${Date.now()}` };
    } catch (e: any) {
      return { queued: false, error: e?.message || 'print-receipt unexpected error' };
    }
  });
}

safeHandle('customer:show-idle', () => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send('customer:state-changed', { screen: 'idle' });
  }
  return { sent: true };
});

function toCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function toCentsFromNaira(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toCustomerOrderPreview(input: any): any | null {
  if (!input || typeof input !== 'object') return null;

  // Pass-through fields that are ALWAYS preserved verbatim, no matter which
  // branch below rebuilds the preview object. These are:
  //   - bankDetails             (user strict rule: always show on CD regardless of payment method)
  //   - paymentMethodLabel      (human label with emoji, e.g. "💵 Cash Paid")
  //   - tenderedCents / changeDueCents  (CASH-only tender/change lines on ThankYou)
  //   - orderStatus             (5-step pillar Received/Accepted/Preparing/Ready/Served)
  // These are copied in via spread at each branch return site to keep the
  // pipeline DRY. Branch 1 (exact verbatim pass-through) already keeps them.
  const passthroughExtraFields = () => {
    const out: Record<string, any> = {};
    const preserveKeys = [
      'bankDetails',
      'bank_details',
      'paymentMethodLabel',
      'tenderedCents',
      'tendered',
      'changeDueCents',
      'change',
      'orderStatus',
      'paidAt',
    ];
    for (const k of preserveKeys) {
      if (Object.prototype.hasOwnProperty.call(input, k)) out[k] = input[k];
    }
    return out;
  };

  if (
    typeof input.orderNumber === 'string' &&
    Array.isArray(input.lines) &&
    typeof input.totalCents === 'number'
  ) {
    // Fast path: input already matches the new CustomerOrderPreview shape.
    // Return as-is so the renderer receives every injected field
    // (bankDetails, paymentMethodLabel, etc.) intact.
    return input;
  }

  if (typeof input.orderNumber === 'string' && Array.isArray(input.lines)) {
    const subtotalCents = toCents(input.subtotalCents) ?? 0;
    const discountCents = toCents(input.discountCents) ?? 0;
    const taxCents = toCents(input.taxCents) ?? 0;
    const totalCents = toCents(input.totalCents) ?? subtotalCents - discountCents + taxCents;
    return {
      orderNumber: input.orderNumber,
      table: typeof input.table === 'string' ? input.table : undefined,
      orderType: typeof input.orderType === 'string' ? input.orderType : undefined,
      customerName:
        typeof input.customerName === 'string' ? input.customerName : undefined,
      lines: input.lines,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      paymentStatus:
        typeof input.paymentStatus === 'string' ? input.paymentStatus : undefined,
      ...passthroughExtraFields(),
    };
  }

  if (typeof input.orderNumber === 'string' && Array.isArray(input.items)) {
    const lines = input.items.map((it: any) => {
      const qty = Number(it.quantity ?? 1);
      const unitPriceCents = toCentsFromNaira(it.unitPrice) ?? 0;
      const totalCents = toCentsFromNaira(it.totalAmount ?? it.subtotal) ?? unitPriceCents * qty;
      const modifiersRaw = it.selectedModifiers ?? it.modifiers ?? [];
      const modifiers = Array.isArray(modifiersRaw)
        ? modifiersRaw.flatMap((m: any) => {
            if (!m) return [];
            if (typeof m === 'string') return [m];
            if (typeof m.modifierId === 'string' && Array.isArray(m.optionIds)) {
              return m.optionIds.map((oid: any) => `${m.modifierId}:${String(oid)}`);
            }
            if (typeof m.modifierId === 'string' && typeof m.optionId === 'string') {
              return [`${m.modifierId}:${m.optionId}`];
            }
            return [];
          })
        : [];
      return {
        qty,
        name: String(it.name ?? 'Item'),
        modifiers,
        unitPriceCents,
        totalCents,
      };
    });

    const totalCents =
      toCentsFromNaira(input.totalAmount) ??
      lines.reduce((sum: number, l: any) => sum + (Number(l.totalCents) || 0), 0);

    return {
      orderNumber: input.orderNumber,
      orderType: typeof input.orderType === 'string' ? input.orderType : undefined,
      table: typeof input.table === 'string' ? input.table : undefined,
      customerName: typeof input.customerName === 'string' ? input.customerName : undefined,
      lines,
      subtotalCents:
        toCentsFromNaira(input.subtotalAmount) ??
        lines.reduce((sum: number, l: any) => sum + (Number(l.totalCents) || 0), 0),
      discountCents: toCentsFromNaira(input.discountAmount) ?? 0,
      taxCents: toCentsFromNaira(input.taxAmount) ?? 0,
      totalCents,
      paymentStatus: typeof input.paymentStatus === 'string' ? input.paymentStatus : 'PAID',
      paidAt: typeof input.paidAt === 'number' ? input.paidAt : Date.now(),
      ...passthroughExtraFields(),
    };
  }

  return null;
}

safeHandle('customer:show-order', (_e, orderPreview) => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send('customer:state-changed', {
      screen: 'order',
      orderPreview: toCustomerOrderPreview(orderPreview) ?? undefined,
    });
  }
  return { sent: true };
});

safeHandle('customer:show-paid', (_e, order) => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send('customer:state-changed', {
      screen: 'thankyou',
      orderPreview: toCustomerOrderPreview(order) ?? undefined,
    });
  }
  return { sent: true };
});

safeHandle('customer:get-branding', () => {
  // Hardcoded defaults — the CustomerDisplayApp merges these over its baked-in
  // branding. Additionally, we read the LATEST cached branch-scoped bank
  // details from the SQLite settings table (written by the POS cart poller
  // every time /public/customer-display-settings succeeds). This ensures the
  // branding fallback always has bank details even when CartPanel hasn't
  // populated the order-preview-level copy for the current cart.
  const base: Record<string, any> = {
    name: 'Prolific POS',
    tagline: 'Thanks for dining with us',
    logoUrl: '',
    wifi: '',
    openingHours: '',
    branchName: '',
  };
  try {
    if (repos && repos.settings && typeof repos.settings.getAllByScope === 'function') {
      const rows = repos.settings.getAllByScope('BRANCH', {});
      const allRows = Array.isArray(rows) ? rows : [];
      for (const r of allRows) {
        const rAny: any = r;
        const key = typeof rAny.key === 'string' ? rAny.key : '';
        if (key.startsWith('bank_details:')) {
          const val = rAny.value ?? rAny.settings_value;
          if (val && typeof val === 'object') {
            base.bankDetails = val;
            break;
          }
          if (typeof val === 'string' && val.length) {
            try {
              const parsed = JSON.parse(val);
              if (parsed && typeof parsed === 'object') {
                base.bankDetails = parsed;
                break;
              }
            } catch { /* string not JSON, skip */ }
          }
        }
      }
    }
  } catch (_e) {
    // Swallow — branding lookup is best-effort; CustomerDisplayApp falls back
    // to the promo poller cache and finally to the order-preview-level copy.
  }
  return base;
});

safeHandle('shift:open', (_e, data) => ({ success: true, shift: data }));
safeHandle('shift:close', (_e, data) => ({ success: true, shift: data }));
safeHandle('shift:get-open', () => ({ success: true, result: null }));

safeOn('second-display-added', () => {
  if (WindowManager.instance) {
    WindowManager.instance.moveCustomerToExternalIfDetected();
  }
});

// Broadcast the current display list to the POS renderer.
// Must only be called after app `ready` (safe to access `screen`).
function broadcastDisplayList(): void {
  if (!posWin || posWin.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  posWin.webContents.send('display:changed', {
    displays: displays.map((d) => ({
      id: d.id,
      label: d.label,
      primary: d.id === primaryId,
      bounds: d.bounds,
    })),
  });
}

// Screen event listeners MUST be registered after `app.ready` because
// the `screen` module cannot be accessed before that event
// (it throws `The 'screen' module can't be used before the app 'ready' event`).
// We wire them up inside `app.on('ready', ...)` below.
let screenListenersRegistered = false;

function broadcastSync(channel: string, payload: unknown): void {
  if (posWin && !posWin.isDestroyed()) {
    posWin.webContents.send(channel, payload);
  }
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send(channel, payload);
  }
}

/**
 * Professional 4-tier API base URL resolution.
 *
 * Must match the browser POS `resolvePublicApiBase()` chain EXACTLY so that
 * the desktop Electron app and the browser Web POS always push/pull against
 * the same backend surface. Earlier versions hardcoded a nonexistent
 * `api.prolificpos.com` domain which silently dropped all Electron orders
 * from the Admin portal because the sync daemon could never reach Render.
 *
 * Priority chain (same as browser shim, highest first):
 *   1. Runtime override — `PROLIFIC_API_BASE` env var (ops/debug) OR an
 *      `electron-store` setting under `api_base` (settable via future
 *      advanced-settings panel or command-line flag).
 *   2. Build-time env — `VITE_API_BASE_URL || API_BASE_URL ||
 *      VITE_API_URL || NEXT_PUBLIC_API_BASE_URL` (matches browser env vars).
 *   3. Prod hostname default — when packaged for production, always use the
 *      canonical Render deployment URL: `https://prolific-api.onrender.com/api/v1`.
 *   4. Dev fallback — `http://localhost:4000/api/v1` (local Nest server).
 */
function getHttpBaseUrl(): string {
  // (1) Runtime overrides — electron-store settings take the absolute
  // highest precedence so ops teams can reroute packaged builds without
  // recompiling or editing shell-env files.
  const settingsOverride = store.get('api_base') as unknown;
  if (typeof settingsOverride === 'string' && settingsOverride.trim()) {
    return settingsOverride.replace(/\/+$/, '');
  }
  const envOverride = process.env.PROLIFIC_API_BASE;
  if (envOverride && envOverride.trim()) {
    return envOverride.replace(/\/+$/, '');
  }

  // (2) Build-time env (parity with browser — both `VITE_*` (vite) and
  // `NEXT_PUBLIC_*` (next) are accepted for cross-surface compatibility.)
  const envUrl =
    process.env.VITE_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.VITE_API_URL ||
    process.env.VITE_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.replace(/\/+$/, '');
  }

  // (3) Production packaged build → canonical Render URL.
  // The old fallback `https://api.prolificpos.com/api` never existed and is
  // replaced with the confirmed live production deployment.
  if (!isDev) return 'https://prolific-api.onrender.com/api/v1';

  // (4) Dev-only fallback → local Nest server.
  return 'http://localhost:4000/api/v1';
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('[updater] Skipping update check in development mode');
    return;
  }

  const { autoUpdater } = electronUpdater;

  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] No update available. Current/latest: ${info.version}`);
  });

  autoUpdater.on('error', (error) => {
    console.error('[updater] Update error:', error);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(
      `[updater] Download progress: ${Math.round(progress.percent)}%`
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
  });

  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('[updater] Failed to check for updates:', error);
  });
}

app.on('ready', async () => {
  setupAutoUpdater();
  const { deviceId } = ensureDeviceId();
  // Wire up maximize/minimize/restore broadcasts so the custom chrome
  // icon stays in sync with OS-level window actions.
  registerWindowStateBroadcast();

  const session = (await import('electron')).session.defaultSession;
  registerSecurityHandlers(app, session);

  try {
    const userDataPath = app.getPath('userData');
    posDb = createSingletonDb(userDataPath);
    repos = createRepos(posDb);
    registerAllDbIpc(ipcMain, repos);

    syncEngine = new SyncEngine({
      repos,
      db: posDb,
      httpBaseUrl: getHttpBaseUrl(),
      getAuthFn: () => {
        const lastAuth = repos?.meta.getLastAuth();
        return {
          accessToken: lastAuth?.accessToken,
          deviceId,
          branchId: lastAuth?.branchId,
          restaurantId: lastAuth?.restaurantId,
        };
      },
      ipcMain,
      deviceId,
      broadcastToRenderers: broadcastSync,
    });
    syncEngine.start();
  } catch (err) {
    const e = err as Error;
    const message = e?.stack || e?.message || String(err);
    console.error('[pos] failed to initialize local db/sync:', message);
    try {
      dialog.showErrorBox('Prolific POS failed to initialize local DB', message);
    } catch {
    }
  }

  const windows = await WindowManager.createWindows(getRendererUrl);
  posWin = windows.posWin;
  customerWin = windows.customerWin ?? null;

  // Register screen listeners AFTER app.ready AND after posWin is assigned.
  // Accessing `screen` before `ready` throws Electron's "screen can't be used before app ready" error.
  if (!screenListenersRegistered) {
    screenListenersRegistered = true;
    screen.on('display-added', () => {
      if (WindowManager.instance) {
        WindowManager.instance.moveCustomerToExternalIfDetected();
      }
      broadcastDisplayList();
    });
    screen.on('display-removed', () => {
      broadcastDisplayList();
    });
  }

  registerPrintHandlers();

  if (isDev) {
    posWin?.webContents.openDevTools({ mode: 'detach' });
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createWindows(getRendererUrl).then((windows) => {
      posWin = windows.posWin;
      customerWin = windows.customerWin ?? null;
    });
  }
});

app.on('window-all-closed', (event) => {
  const posIsFullscreen = posWin && !posWin.isDestroyed() && posWin.isFullScreen();
  if (isProd && posIsFullscreen) {
    event.preventDefault();
  } else if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  try {
    syncEngine?.stop();
  } catch {
  }
  if (isProd) {
    const shiftOpen = false;
    if (shiftOpen) {
      event.preventDefault();
    }
  }
});
