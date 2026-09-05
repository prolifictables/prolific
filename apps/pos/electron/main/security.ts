import type { App, Session } from 'electron';
import { protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// IMPORTANT: keep directives aligned with the <meta> CSP in index.html.
// Electron applies BOTH the HTTP response header (below, injected via onHeadersReceived)
// AND the meta tag. Chromium uses the INTERSECTION (strictest) of both policies, so
// if the header's connect-src is localhost-only but the meta tag allows *.onrender.com,
// all remote API fetches are blocked with "violates the document's Content Security
// Policy" (the exact error from the user's DevTools screenshots).
const CSP_POLICY = [
  "default-src 'self'",
  // script-src: keep 'unsafe-eval' + Vite HMR origins (ws + http) so dev mode works
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173",
  "style-src 'self' 'unsafe-inline'",
  // img-src: allow remote hosts (Render slugs, Prolific subdomains) plus local dev
  "img-src 'self' data: blob: app: http://localhost:* http://127.0.0.1:* https://*.onrender.com https://*.prolifictables.com",
  "font-src 'self' data:",
  // connect-src (fetch/XHR/WebSocket): whitelist production hosts (wildcards cover any
  // Render free-tier slug + all Prolific subdomains on both REST + WS transports).
  // Local dev ports (5173 Vite, 4000 local API, loopback variants) preserved.
  "connect-src 'self'" +
    " https://*.prolifictables.com wss://*.prolifictables.com" +
    " https://prolifictables.com wss://prolifictables.com" +
    " https://*.onrender.com wss://*.onrender.com" +
    " ws://localhost:5173 http://localhost:5173" +
    " ws://localhost:4000 http://localhost:4000" +
    " ws://127.0.0.1:4000 http://127.0.0.1:4000" +
    " ws://0.0.0.0:4000 http://0.0.0.0:4000" +
    " ws://localhost:* http://localhost:* http://127.0.0.1:*",
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
