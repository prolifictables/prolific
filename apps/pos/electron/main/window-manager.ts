import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  type Display,
} from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;
const isProd = app.isPackaged;

type UrlResolver = (routeHash?: string) => string;

const secureWebPreferences = (preloadScript: string) => ({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  enableRemoteModule: false,
  preload: path.join(__dirname, '..', 'preload', preloadScript),
});

export class WindowManager {
  private static _instance: WindowManager | null = null;

  posWin: BrowserWindow | null = null;
  customerWin: BrowserWindow | null = null;
  private getRendererUrl: UrlResolver;

  constructor(getRendererUrl: UrlResolver) {
    this.getRendererUrl = getRendererUrl;
  }

  static get instance(): WindowManager | null {
    return WindowManager._instance;
  }

  private getDisplays(): { primary: Display; secondaries: Display[] } {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondaries = displays.filter(
      (d) => d.id !== primary.id && !d.internal
    );
    return { primary, secondaries };
  }

  static async createWindows(
    getRendererUrl: UrlResolver
  ): Promise<{ posWin: BrowserWindow; customerWin?: BrowserWindow }> {
    if (WindowManager._instance) {
      return {
        posWin: WindowManager._instance.posWin!,
        customerWin: WindowManager._instance.customerWin ?? undefined,
      };
    }

    const wm = new WindowManager(getRendererUrl);
    WindowManager._instance = wm;

    const posWin = await wm.createCashierWindow();
    const customerWin = await wm.createCustomerWindow();

    // Guarantee the cashier window lands on top of any auxiliary windows after
    // creation. Without this, the customer display window (even if only
    // always-on-top on a real external screen) could briefly be raised above
    // the cashier UI and absorb clicks on low-height terminals.
    try { posWin.moveTop(); } catch { /* ignore unsupported platforms */ }

    return { posWin, customerWin };
  }

  private async createCashierWindow(): Promise<BrowserWindow> {
    const { primary } = this.getDisplays();

    const preload = isDev ? 'cashier.js' : 'cashier.js';

    const win = new BrowserWindow({
      title: 'Prolific POS · Cashier',
      backgroundColor: '#0B1220',
      autoHideMenuBar: true,
      fullscreen: isProd,
      kiosk: isProd,
      width: isDev ? 1600 : primary.workArea.width,
      height: isDev ? 900 : primary.workArea.height,
      x: isDev ? undefined : primary.workArea.x,
      y: isDev ? undefined : primary.workArea.y,
      show: false,
      webPreferences: secureWebPreferences(preload),
    });

    this.posWin = win;

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.on('closed', () => {
      this.posWin = null;
    });

    // macOS activation race: even a focusable:false sibling can leave the app
    // visually front while clicks on the cashier card are silently dropped.
    // Elevate the cashier window for a brief moment after paint so focus
    // reliably lands in the renderer and the DOM receives click events on
    // the PIN keypad on the very first attempt.
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
      try { win.setAlwaysOnTop(true, 'floating'); } catch { /* noop */ }
      setTimeout(() => {
        if (win.isDestroyed()) return;
        try { win.setAlwaysOnTop(false); } catch { /* noop */ }
        try { win.moveTop(); } catch { /* noop */ }
        try { win.focus(); } catch { /* noop */ }
        // Extra pass: make the entire Electron app the macOS frontmost process
        // so clicks do not land on a Finder window behind.
        try {
          const { app } = require('electron');
          app.dock?.show?.();
          app.focus({ steal: true });
        } catch { /* noop */ }
      }, 180);
    });

    await win.loadURL(this.getRendererUrl());

    return win;
  }

  private async createCustomerWindow(): Promise<BrowserWindow | undefined> {
    const { primary, secondaries } = this.getDisplays();
    const hasExternal = secondaries.length > 0;

    // In single-monitor / laptop dev, there is no room for a dedicated customer
    // display and it creates nothing but z-order + focus-steal issues that
    // make the PIN keypad / shift modals appear unresponsive. Skip creating
    // the window entirely until a real secondary display is hot-plugged
    // (moveCustomerToExternalIfDetected re-checks and can re-create via the
    // display listeners in main/index.ts). Production always creates it.
    if (!hasExternal && isDev) {
      return undefined;
    }

    const target = hasExternal ? secondaries[0] : primary;

    const preload = isDev ? 'customer.js' : 'customer.js';

    let bounds: Electron.Rectangle;
    let closable: boolean;
    let movable: boolean;
    let minimizable: boolean;
    let resizable: boolean;
    let frame: boolean;
    // Only pin the customer display above every other window when it is on a
    // real external monitor. In single-monitor / dev mode the auxiliary
    // window sits next to the cashier window — if we force it above, it will
    // intercept clicks on the PIN keypad / shift modal and feel "broken".
    let customerAlwaysOnTop: boolean;

    if (hasExternal) {
      bounds = target.workArea;
      closable = false;
      movable = false;
      minimizable = false;
      resizable = false;
      frame = false;
      customerAlwaysOnTop = true;
    } else {
      // Dev / single-monitor fallback: place a compact auxiliary window in
      // the bottom-right corner where it won't overlap the login card or
      // the sidebar (sidebar is left ~220px; keypad is top-right quadrant).
      const w = 420;
      const h = 280;
      const x = primary.workArea.x + primary.workArea.width - w - 16;
      const y = primary.workArea.y + primary.workArea.height - h - 16;
      bounds = { x, y, width: w, height: h };
      closable = true;
      movable = true;
      minimizable = true;
      resizable = true;
      frame = true;
      customerAlwaysOnTop = false;
    }

    const win = new BrowserWindow({
      title: hasExternal ? 'Prolific POS · Customer Display' : 'Customer Display (Preview)',
      backgroundColor: '#0B1220',
      autoHideMenuBar: true,
      alwaysOnTop: customerAlwaysOnTop,
      skipTaskbar: true,
      focusable: false,
      kiosk: hasExternal && isProd,
      resizable,
      minimizable,
      closable,
      movable,
      frame,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      webPreferences: secureWebPreferences(preload),
    });

    this.customerWin = win;

    if (customerAlwaysOnTop) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.on('closed', () => {
      this.customerWin = null;
      this.emitCustomerWindowState(false);
    });

    win.on('show', () => this.emitCustomerWindowState(true));
    win.on('hide', () => this.emitCustomerWindowState(false));

    win.once('ready-to-show', () => {
      win.show();
      this.emitCustomerWindowState(true);
    });

    await win.loadURL(this.getRendererUrl('/customer-display'));

    return win;
  }

  moveCustomerToExternalIfDetected(): void {
    const { secondaries } = this.getDisplays();
    if (secondaries.length === 0) return;

    // If no customer window was created yet (e.g. launched in single-monitor
    // dev mode and a display was hot-plugged later), create it now so the
    // external monitor receives content.
    if (!this.customerWin || this.customerWin.isDestroyed()) {
      this.createCustomerWindow().catch(() => undefined);
      return;
    }

    const target = secondaries[0];
    const bounds = target.workArea;

    this.customerWin.setBounds(bounds);
    this.customerWin.setKiosk(isProd);
    this.customerWin.setAlwaysOnTop(true, 'screen-saver');
    if (isProd) {
      this.customerWin.setClosable(false);
      this.customerWin.setMovable(false);
      this.customerWin.setMinimizable(false);
      this.customerWin.setResizable(false);
    }

    if (this.posWin && !this.posWin.isDestroyed()) {
      this.posWin.webContents.send('customer:display-moved', {
        displayId: target.id,
        bounds,
      });
    }
  }

  showCustomer(): void {
    if (this.customerWin && !this.customerWin.isDestroyed()) {
      this.customerWin.show();
      // Only push it above other windows when we have a real external display.
      // In single-monitor dev this would hide the cashier keypad under it.
      const { secondaries } = this.getDisplays();
      if (secondaries.length > 0) {
        this.customerWin.setAlwaysOnTop(true, 'screen-saver');
      }
      this.emitCustomerWindowState(true);
    }
  }

  hideCustomer(): void {
    if (this.customerWin && !this.customerWin.isDestroyed()) {
      this.customerWin.hide();
      this.emitCustomerWindowState(false);
    }
  }

  toggleFullscreen(win: 'pos' | 'customer' = 'pos'): void {
    const target = win === 'pos' ? this.posWin : this.customerWin;
    if (target && !target.isDestroyed()) {
      target.setFullScreen(!target.isFullScreen());
    }
  }

  private emitCustomerWindowState(visible: boolean): void {
    ipcMain.emit('customer-window-state-changed', { visible });
    if (this.posWin && !this.posWin.isDestroyed()) {
      this.posWin.webContents.send('customer-window-state-changed', {
        visible,
      });
    }
    if (this.customerWin && !this.customerWin.isDestroyed()) {
      this.customerWin.webContents.send('customer-window-state-changed', {
        visible,
      });
    }
  }
}
