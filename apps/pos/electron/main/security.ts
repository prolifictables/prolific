import type { App, Session } from 'electron';
import { protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: app: http://localhost:* http://127.0.0.1:*",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:* http://127.0.0.1:*",
  "media-src 'self' data: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const APP_SCHEME = 'app';
const ALLOWED_APP_HOSTS = ['renderer', 'assets'];

export function registerSecurityHandlers(app: App, session: Session): void {
  registerAppProtocol();
  registerContentSecurityPolicy(session);
  registerRequestFilters(session);
  registerPermissionsHandlers(session);
  disableDangerousFeatures(app);
}

function registerAppProtocol(): void {
  protocol.registerFileProtocol(APP_SCHEME, (request, callback) => {
    const url = request.url.substring(`${APP_SCHEME}://`.length);
    const [host, ...pathParts] = url.split('/');

    if (!ALLOWED_APP_HOSTS.includes(host)) {
      callback({ statusCode: 403 });
      return;
    }

    const relativePath = pathParts.join('/');
    const decodedPath = decodeURIComponent(relativePath);

    if (
      decodedPath.includes('..') ||
      decodedPath.startsWith('.') ||
      decodedPath.includes('\0')
    ) {
      callback({ statusCode: 403 });
      return;
    }

    let baseDir: string;
    if (host === 'renderer') {
      baseDir = path.join(__dirname, '..', '..', 'dist');
    } else {
      const assetsFromResources = path.join(process.resourcesPath, 'assets');
      if (fs.existsSync(assetsFromResources)) {
        baseDir = assetsFromResources;
      } else {
        baseDir = path.join(__dirname, '..', '..', 'assets');
      }
    }

    const filePath = path.join(baseDir, decodedPath);

    const normalized = path.normalize(filePath);
    if (!normalized.startsWith(baseDir)) {
      callback({ statusCode: 403 });
      return;
    }

    callback({ path: normalized });
  });
}

function registerContentSecurityPolicy(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const existing = details.responseHeaders ?? {};
    const newHeaders: Record<string, string[]> = { ...existing };

    newHeaders['Content-Security-Policy'] = [CSP_POLICY];
    newHeaders['X-Frame-Options'] = ['DENY'];
    newHeaders['X-Content-Type-Options'] = ['nosniff'];
    newHeaders['Referrer-Policy'] = ['no-referrer'];
    newHeaders['Permissions-Policy'] = [
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), clipboard-read=(), clipboard-write=(self)',
    ];

    callback({ responseHeaders: newHeaders });
  });
}

function registerRequestFilters(session: Session): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;

    if (url.startsWith(`${APP_SCHEME}://`)) {
      const urlWithoutScheme = url.substring(`${APP_SCHEME}://`.length);
      const host = urlWithoutScheme.split('/')[0];
      if (!ALLOWED_APP_HOSTS.includes(host)) {
        callback({ cancel: true });
        return;
      }
    }

    callback({});
  });
}

function registerPermissionsHandlers(session: Session): void {
  const permissionsAllowlist = new Set<string>([]);

  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permissionsAllowlist.has(permission));
  });

  session.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin) => {
      return permissionsAllowlist.has(permission);
    }
  );
}

function disableDangerousFeatures(app: App): void {
  app.commandLine.appendSwitch('disable-remote-module');
  app.commandLine.appendSwitch('disable-pinch');
  app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');

  const safeOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  for (const origin of safeOrigins) {
    try {
      const url = new URL(origin);
      app.commandLine.appendSwitch(
        'unsafely-treat-insecure-origin-as-secure',
        url.origin
      );
    } catch {
      // ignore
    }
  }
}
