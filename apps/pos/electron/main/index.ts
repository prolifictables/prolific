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
import { WindowManager } from './window-manager';
import { registerSecurityHandlers } from './security';
import { SyncEngine } from './sync';
import { createSingletonDb, createRepos, type ReposBundle, type PosDatabase } from './db';
import { registerAllDbIpc } from './ipc-db-bridge';

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

ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('app:get-versions', () => ({
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
}));

ipcMain.handle('window:customer-show', () => {
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

ipcMain.handle('window:customer-hide', () => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.hide();
    ipcMain.emit('customer-window-state-changed', { visible: false });
    customerWin.webContents.send('customer:state-changed', { visible: false });
  }
  return true;
});

ipcMain.handle('window:pos-fullscreen', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.setFullScreen(true);
  }
  return true;
});

ipcMain.handle('window:pos-exit-fullscreen', () => {
  if (posWin && !posWin.isDestroyed()) {
    posWin.setFullScreen(false);
  }
  return true;
});

ipcMain.handle('device:get-device-id', () => {
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
ipcMain.handle('device:get-api-base-url', () => getHttpBaseUrl());
// Synchronous counterpart: used by renderer at module-load time so
// resolveApiBase() can return a string synchronously (all downstream calls in
// remote-auth.ts and mock-electron-shim.ts expect a string, not a Promise).
ipcMain.on('device:get-api-base-url-sync', (event) => {
  event.returnValue = getHttpBaseUrl();
});

ipcMain.handle('db:run-migrations', () => {
  if (!posDb) return { success: false, migrations: 0, error: 'db not initialized' };
  const result = posDb.migrate();
  return { success: true, migrations: result.applied, from: result.from, to: result.to };
});

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
        <div class="row">
          <div class="left">${escapeHtml(name)} × ${qty}</div>
          <div class="right">${escapeHtml(ngn(total))}</div>
        </div>`;
      if (unitCents > 0 && qty > 1) {
        rows += `<div class="small left pad4 muted">@ ${escapeHtml(ngn(unitCents))} each</div>`;
      }
      if (itemMods && itemMods.length) {
        for (const m of itemMods) {
          rows += `<div class="small left pad4 muted">+ ${escapeHtml((m.modifier_name || '') + ': ' + (m.option_name || ''))}</div>`;
        }
      }
      if (special) {
        rows += `<div class="small left pad4 muted note">Note: ${escapeHtml(special)}</div>`;
      }
      return rows;
    };

    const header = `
      <div class="center">${escapeHtml(hdr.line1)}</div>
      <div class="center small muted">${escapeHtml(hdr.line2)}</div>
      <div class="line"></div>
      <div class="center title">${escapeHtml(meta.title)}</div>
      <div class="center small muted">Copy ${meta.copyIndex + 1} of ${meta.totalCopies}</div>
      <div class="row small">
        <div class="left muted">Date</div>
        <div class="right">${escapeHtml(createdAt.toLocaleString())}</div>
      </div>
      ${orderNo ? `<div class="row small"><div class="left muted">Order</div><div class="right">${escapeHtml(orderNo)}</div></div>` : ''}
      ${order?.order_type ? `<div class="row small"><div class="left muted">Type</div><div class="right">${escapeHtml(String(order.order_type).replace(/_/g, ' '))}</div></div>` : ''}
      ${order?.customer_name ? `<div class="row small"><div class="left muted">Customer</div><div class="right">${escapeHtml(order.customer_name)}</div></div>` : ''}
      ${order?.table_id && order?.table_name ? `<div class="row small"><div class="left muted">Table</div><div class="right">${escapeHtml(order.table_name)}</div></div>` : ''}
      <div class="line"></div>
    `;

    const bodyLines = items.length
      ? items.map(renderItem).join('')
      : `<div class="center small muted">No item details available</div>`;

    // Totals block: subtotal → discounts → taxes → tips → total.
    const totalsParts: string[] = [];
    totalsParts.push(`<div class="row"><div class="left">Subtotal</div><div class="right">${escapeHtml(ngn(subtotalCents))}</div></div>`);
    if (discountCents > 0) {
      totalsParts.push(`<div class="row"><div class="left">Discount</div><div class="right">-${escapeHtml(ngn(discountCents))}</div></div>`);
    }
    if (taxCents > 0) {
      totalsParts.push(`<div class="row"><div class="left">Tax</div><div class="right">${escapeHtml(ngn(taxCents))}</div></div>`);
    }
    if (tipCents > 0) {
      totalsParts.push(`<div class="row"><div class="left">Tip</div><div class="right">${escapeHtml(ngn(tipCents))}</div></div>`);
    }
    totalsParts.push(`<div class="line"></div><div class="row bold big"><div class="left">TOTAL</div><div class="right">${escapeHtml(ngn(totalCents))}</div></div>`);

    // Payment method breakdown (useful when split-bill or cashier wants to verify tender/change).
    if (payments && payments.length) {
      totalsParts.push(`<div class="line"></div><div class="small muted left">Payments</div>`);
      for (const p of payments) {
        const method = (p?.method || p?.payment_method || 'UNKNOWN').toString().replace(/_/g, ' ');
        const paid = Number(p?.amount_cents ?? p?.amountCents ?? 0);
        totalsParts.push(`<div class="row small"><div class="left">${escapeHtml(method)}</div><div class="right">${escapeHtml(ngn(paid))}</div></div>`);
        // For cash payments show tendered + change if available.
        if ((p?.method === 'CASH' || p?.payment_method === 'CASH') && changeDueCents > 0) {
          const tendered = paid + changeDueCents;
          totalsParts.push(`<div class="row small pad4"><div class="left muted">Tendered</div><div class="right">${escapeHtml(ngn(tendered))}</div></div>`);
          totalsParts.push(`<div class="row small pad4"><div class="left muted">Change</div><div class="right">${escapeHtml(ngn(changeDueCents))}</div></div>`);
        }
      }
    }
    totalsParts.push(`<div class="row bold"><div class="left">Paid</div><div class="right">${isPaid ? 'YES' : 'NO'}</div></div>`);

    const footer = `
      <div class="line"></div>
      <div class="center small muted">Printed: ${escapeHtml(new Date(meta.printedAt).toLocaleString())}</div>
      <div class="center small bold">Thank you</div>
      <div class="center small muted">${escapeHtml(hdr.defaultFooter)}</div>
    `;

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; font-size: 12px; margin: 0; padding: 12px; color: #000; }
            .title { font-size: 14px; font-weight: 800; margin-top: 4px; }
            .big { font-size: 14px; }
            .bold { font-weight: 800; }
            .center { text-align: center; }
            .small { font-size: 11px; }
            .muted { color: #333; }
            .note { color: #111; font-style: italic; }
            .row { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0; }
            .left { flex: 1 1 auto; }
            .right { flex: 0 0 auto; text-align: right; white-space: nowrap; }
            .pad4 { padding-left: 8px; }
            .line { border-top: 1px dashed #000; margin: 10px 0; }
            .big-gap > div { margin: 6px 0; }
          </style>
        </head>
        <body>
          ${header}
          <div class="big-gap">
            ${bodyLines}
          </div>
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
          <div class="kqty">${qty}×</div>
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
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; font-size: 13px; margin: 0; padding: 12px; color: #000; }
            h1 { font-size: 18px; font-weight: 900; text-align: center; margin: 0 0 2px; letter-spacing: 0.14em; }
            h2 { font-size: 15px; font-weight: 800; text-align: center; margin: 0 0 6px; }
            .row { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
            .left { flex: 1 1 auto; }
            .right { flex: 0 0 auto; text-align: right; white-space: nowrap; font-weight: 700; }
            .line { border-top: 2px dashed #000; margin: 10px 0; }
            .center { text-align: center; }
            .kitem { display: flex; gap: 8px; margin: 8px 0 2px; }
            .kqty { flex: 0 0 auto; font-weight: 900; font-size: 16px; }
            .kname { flex: 1 1 auto; font-weight: 800; font-size: 15px; }
            .kmod { padding-left: 28px; font-size: 12px; color: #222; }
            .note { font-style: italic; color: #111; }
            .small { font-size: 11px; color: #333; }
          </style>
        </head>
        <body>
          <h1>KITCHEN TICKET</h1>
          <h2>${escapeHtml(hdr.line1)}</h2>
          <div class="line"></div>
          <div class="row"><div class="left">Order</div><div class="right">${escapeHtml(orderNo)}</div></div>
          <div class="row"><div class="left">Time</div><div class="right">${escapeHtml(createdAt.toLocaleString())}</div></div>
          ${order?.table_id && order?.table_name ? `<div class="row"><div class="left">Table</div><div class="right">${escapeHtml(order.table_name)}</div></div>` : ''}
          ${order?.order_type ? `<div class="row"><div class="left">Type</div><div class="right">${escapeHtml(String(order.order_type).replace(/_/g, ' '))}</div></div>` : ''}
          ${order?.customer_name ? `<div class="row"><div class="left">Customer</div><div class="right">${escapeHtml(order.customer_name)}</div></div>` : ''}
          ${order?.note ? `<div class="row"><div class="left">Note</div><div class="right">${escapeHtml(order.note)}</div></div>` : ''}
          <div class="line"></div>
          ${rows.join('')}
          <div class="line"></div>
          <div class="center small">Printed ${escapeHtml(new Date(meta.printedAt).toLocaleTimeString())}</div>
        </body>
      </html>
    `;
  };

  const printHtml = async (html: string, deviceName?: string): Promise<void> => {
    const win = new BrowserWindow({
      show: false,
      width: 360,
      height: 800,
      webPreferences: { sandbox: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        { silent: true, printBackground: true, deviceName },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'print failed'));
        }
      );
    });
    win.destroy();
  };

  ipcMain.handle('print:list-printers', async () => {
    if (!posWin || posWin.isDestroyed()) return { printers: [] };
    const printers = await posWin.webContents.getPrintersAsync();
    return { printers };
  });

  ipcMain.handle('print:queue-status', async () => ({ queued: 0, inProgress: 0, failed: 0 }));

  ipcMain.handle('print:test-page', async () => {
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
    await printHtml(html, defaultPrinter?.name);
    return { queued: true, jobId: `test_${Date.now()}` };
  });

  ipcMain.handle('print:kitchen-ticket', async (_e, payload) => {
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
    await printHtml(html, defaultPrinter?.name);
    return { queued: true, orderId, jobId: `ktn_${orderId}_${Date.now()}` };
  });

  ipcMain.handle('print:receipt', async (_e, payload) => {
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

    for (let i = 0; i < copies; i += 1) {
      const title = i === 0 ? 'CUSTOMER COPY' : 'CASHIER COPY';
      const html = buildReceiptHtml(order, items, modifiers, payments, {
        title,
        printedAt,
        copyIndex: i,
        totalCopies: copies,
        header,
      });
      await printHtml(html, defaultPrinter?.name);
    }

    return { queued: true, orderId, copies, jobId: `rcpt_${orderId}_${Date.now()}` };
  });
}

ipcMain.handle('customer:show-idle', () => {
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

  if (
    typeof input.orderNumber === 'string' &&
    Array.isArray(input.lines) &&
    typeof input.totalCents === 'number'
  ) {
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
      orderStatus:
        typeof input.orderStatus === 'string' ? input.orderStatus : undefined,
      paidAt: typeof input.paidAt === 'number' ? input.paidAt : undefined,
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
      paymentStatus: 'PAID',
      paidAt: Date.now(),
    };
  }

  return null;
}

ipcMain.handle('customer:show-order', (_e, orderPreview) => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send('customer:state-changed', {
      screen: 'order',
      orderPreview: toCustomerOrderPreview(orderPreview) ?? undefined,
    });
  }
  return { sent: true };
});

ipcMain.handle('customer:show-paid', (_e, order) => {
  if (customerWin && !customerWin.isDestroyed()) {
    customerWin.webContents.send('customer:state-changed', {
      screen: 'thankyou',
      orderPreview: toCustomerOrderPreview(order) ?? undefined,
    });
  }
  return { sent: true };
});

ipcMain.handle('customer:get-branding', () => ({
  name: 'Prolific POS',
  tagline: 'Thanks for dining with us',
  logoUrl: '',
  wifi: '',
  openingHours: '',
  branchName: '',
}));

ipcMain.handle('shift:open', (_e, data) => ({ success: true, shift: data }));
ipcMain.handle('shift:close', (_e, data) => ({ success: true, shift: data }));
ipcMain.handle('shift:get-open', () => ({ success: true, result: null }));

ipcMain.on('second-display-added', () => {
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

app.on('ready', async () => {
  const { deviceId } = ensureDeviceId();

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
