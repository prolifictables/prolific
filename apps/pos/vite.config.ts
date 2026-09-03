import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import fs from 'node:fs';

// Single source of truth: read APP_VERSION from package.json at Vite build time.
// This GUARANTEES APP_VERSION === package.json.version in ALL builds (web +
// packaged Electron). Manual APP_VERSION constants can never drift again —
// there is exactly ONE number to bump when cutting a release: package.json
// version field. Additionally, POWERED_BY_LABEL is defined here (and mirrored
// in app-meta.ts via import.meta.env) so vendor branding is also a single
// location for future edits.
const PACKAGE_JSON_PATH = path.resolve(__dirname, 'package.json');
const PACKAGE_MANIFEST = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const PACKAGE_VERSION = String(PACKAGE_MANIFEST?.version || '0.1.0');
const VENDOR_LABEL = 'Powered by Giovy Tech - (+234)7066689108';

const browserOnly = process.env.BROWSER_ONLY === '1';
// Only wire up vite-plugin-electron / vite-plugin-electron-renderer
// when running as a desktop app. When BROWSER_ONLY=1 we skip calling
// the electron(...) plugin factory entirely so the browser dev server
// stays up even when the native electron binary is not installable.
const desktopPlugins = browserOnly
  ? []
  : [
      electron([
        {
          entry: 'electron/main/index.ts',
          vite: {
            build: {
              outDir: 'dist-electron/main',
              minify: false,
              sourcemap: true,
              rollupOptions: {
                external: [
                  'better-sqlite3',
                  'electron-store',
                  'node-thermal-printer',
                  'usb',
                  'escpos',
                ],
              },
            },
          },
        },
        {
          entry: 'electron/preload/cashier.ts',
          onstart(args) {
            args.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron/preload',
              minify: false,
              sourcemap: true,
              rollupOptions: {
                external: [
                  'better-sqlite3',
                  'electron-store',
                  'node-thermal-printer',
                  'usb',
                  'escpos',
                ],
              },
            },
          },
        },
        {
          entry: 'electron/preload/customer.ts',
          onstart(args) {
            args.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron/preload',
              minify: false,
              sourcemap: true,
              rollupOptions: {
                external: [
                  'better-sqlite3',
                  'electron-store',
                  'node-thermal-printer',
                  'usb',
                  'escpos',
                ],
              },
            },
          },
        },
      ]),
      renderer(),
    ];

export default defineConfig({
  plugins: [react(), ...desktopPlugins],
  // define: inject compile-time constants into every renderer TS module.
  // IMPORTANT: Vite define performs JSON.stringify on the RHS automatically
  // when values are plain strings (so the final code sees a quoted string
  // literal, not a raw identifier). We stringify manually below because we
  // want the extra safety of explicit quoting + JSON.stringify to match
  // Vite's documented behaviour for non-identifier chars.
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(PACKAGE_VERSION),
    'import.meta.env.VENDOR_LABEL': JSON.stringify(VENDOR_LABEL),
    '__APP_VERSION__': JSON.stringify(PACKAGE_VERSION),
    '__VENDOR_LABEL__': JSON.stringify(VENDOR_LABEL),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mirror tsconfig.json `paths` so Vite resolves shared packages to
      // their TypeScript sources instead of falling back to node_modules
      // symlink -> package.json main -> CJS dist (which fails named-import
      // ESM interop in the browser).
      '@prolific/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@prolific/utils': path.resolve(__dirname, '../../packages/utils/src/index.ts'),
      '@prolific/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
      '@prolific/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'chrome120',
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
