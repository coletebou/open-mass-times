// Production/dev entry point: the API plus, when built, the web app.
//
//   npm run dev    -> API on :8787 (watch mode), Vite dev server on :5173
//   npm start      -> API and dist/web on :8787 (run `npm run build` first)

import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './api/app.ts';
import { openDatabase } from './db/database.ts';
import { countRecords } from './db/repository.ts';

const port = Number(process.env.PORT ?? 8787);
const db = openDatabase();
const app = createApp(db);

const WEB_ROOT = 'dist/web';
if (existsSync(WEB_ROOT)) {
  app.use('/*', serveStatic({ root: WEB_ROOT }));
  // Single-page app: unknown non-API paths get index.html.
  app.get('*', serveStatic({ root: WEB_ROOT, path: 'index.html' }));
}

const counts = countRecords(db);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Open Mass Times API listening on http://localhost:${info.port}/api/v1/health`);
  if (existsSync(WEB_ROOT)) console.log(`Web app: http://localhost:${info.port}/`);
  if (counts.churches === 0) {
    console.log('The database is empty. Load demo data with `npm run db:seed:sample`,');
    console.log('or import real church locations with `npm run import:osm -- --help`.');
  }
});
