import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Customer Display — the browser-facing second screen that shows order totals
// and the "thank you / next order" animations. Kept on its own Vite port so
// it never collides with the cashier POS Electron renderer (5173).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@prolific/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@prolific/utils': path.resolve(__dirname, '../../packages/utils/src/index.ts'),
      '@prolific/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
      '@prolific/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
});
