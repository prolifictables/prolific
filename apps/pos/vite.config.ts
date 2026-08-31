import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

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
