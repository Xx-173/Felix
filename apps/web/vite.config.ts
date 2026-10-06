import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    '@finagent/ui': resolve(root, 'packages/ui/src'),
    '@finagent/core': resolve(root, 'packages/core/src'),
    '@finagent/i18n': resolve(root, 'packages/i18n/src'),
  } },
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787', '/healthz': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
