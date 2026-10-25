import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** The API in development (`pnpm dev:server` or the Docker stack). The browser only talks to this page's origin. */
const api = 'http://localhost:8080';
const proxy = { '/v1': { target: api, ws: true }, '/health': api };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
