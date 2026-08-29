import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
