import { defineConfig } from 'vite';

const apiPort = process.env.PORT ?? '8787';

// The web app lives in web/. In development Vite serves it and proxies /api to
// the Node server; in production `npm run build` writes dist/web, which the
// Node server serves itself (see src/server.ts).
export default defineConfig({
  root: 'web',
  // Read .env files from the repo root, not web/.
  envDir: '..',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
