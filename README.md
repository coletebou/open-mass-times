# Open Mass Times

**An open-source, open-data finder for Catholic Mass, confession and adoration
times.** A map, "near me" search, filters by day, time, language, rite and
form, and a public read API, built on data anyone may reuse.

> **Status: v0, not deployed.** The app runs locally against fictional
> sample data or real church locations imported from OpenStreetMap. Schedules
> for real parishes come next, from parishes and the community. See
> [ROADMAP.md](ROADMAP.md).

## Why

Finding Mass times today usually means a proprietary directory. Its data
can't be reused, corrected in the open, or built on. Open Mass Times is an
independent alternative:

- **Open data.** The whole database is ODbL, with provenance and a
  last-verified date on every record. Apps, dioceses and researchers can
  build on it.
- **Clean sources.** Locations come from OpenStreetMap and schedules from
  parishes and the people who attend them. Nothing is copied from another
  directory: [SOURCES.md](SOURCES.md) is the rulebook.
- **Honest freshness.** Every time shows when it was last verified, and by
  whom.

## Quick start

Requires **Node 24+** and nothing else. No database server, Docker or
compiler toolchain is needed.

```sh
git clone https://github.com/coletebou/open-mass-times.git
cd open-mass-times
npm ci
npm run db:seed:sample   # fictional demo churches around Charlotte, NC
npm run dev              # web app: http://localhost:5173  API: http://localhost:8787
```

Import real church locations (no schedules yet) for an area from
OpenStreetMap:

```sh
npm run import:osm -- --bbox 35.10,-80.95,35.35,-80.70 --country US --timezone America/New_York
```

| Command | What it does |
| --- | --- |
| `npm run dev` | API (watch mode) + Vite dev server with hot reload |
| `npm run build && npm start` | Production build; one Node process serves the API and the web app on `:8787` |
| `npm run db:seed:sample` | Load `data/sample/sample-data.json` (idempotent) |
| `npm run import:osm -- --help` | Import churches from OpenStreetMap for one area |
| `npm run db:migrate` | Apply database migrations (also runs on server start) |
| `npm run lint` / `typecheck` / `test` | What CI runs; `npm run check` runs all of them plus the build |

Configuration is through environment variables (see [`.env.example`](.env.example)):
`PORT`, `DATABASE_PATH`, `VITE_TILE_URL`.

## The API

Read-only, JSON, CORS-open. Full reference: [docs/API.md](docs/API.md).

```sh
# Sunday Masses in Spanish within 15 km
curl 'http://localhost:8787/api/v1/services?lat=35.227&lon=-80.843&date=2026-11-15&type=mass&language=es'

# What's still on today near me?
curl 'http://localhost:8787/api/v1/services?lat=35.227&lon=-80.843&upcoming=true'

# A church, its parish and its whole schedule in words ("First Fridays", ...)
curl 'http://localhost:8787/api/v1/churches/ch_sample-cathedral'
```

## The stack, and why

The goal is a stack a volunteer can clone and run in two minutes, that costs
almost nothing to host, and that won't need rewriting at 200,000 parishes.

| Piece | Choice | Why |
| --- | --- | --- |
| Runtime | **Node 24 + TypeScript, run directly** | Node 24 strips types natively, so the server has no build step and no `tsx`/`ts-node`. Types are still checked by `tsc` in CI. |
| Web framework | **[Hono](https://hono.dev)** | Small and built on web standards (`Request`/`Response`). The same app runs on Node, Cloudflare Workers, Deno or Bun, which keeps hosting cheap and open. |
| Database | **SQLite via built-in `node:sqlite`** | One file and no server to run. Nothing native to compile, since SQLite ships inside Node. FTS5 gives full-text search. The ~220k Catholic parishes worldwide fit easily, and the file itself can become the open-data download. |
| Validation | **[zod](https://zod.dev)** | One schema per record type gives runtime validation (seed files, imports, API queries) and the TypeScript types, with no drift. |
| Web app | **Vite + plain TypeScript + [Leaflet](https://leafletjs.com)** | A map and a list don't need a framework: there's nothing to learn before contributing, and the bundle is ~50 KB gzipped. Leaflet is the most widely known open map library, and tiles are configurable. |
| Tests / lint / CI | **Vitest, ESLint + typescript-eslint, GitHub Actions** | Standard, fast and free for a public repo. |

Considered and set aside for v0:
- **Next.js/React**: too much machinery for one page.
- **Postgres + PostGIS**: more operational weight for contributors. It's the
  upgrade path once in-app editing brings concurrent writes.
- **MapLibre vector tiles**: heavier. They pair well with self-hosted
  Protomaps tiles later.

## Licensing

- **Code: [Apache License 2.0](LICENSE).** It is as permissive as MIT, so
  dioceses, parishes and other Catholic apps (commercial or not) can reuse
  it. It adds three things MIT lacks:
  - an explicit **patent grant**, with termination for anyone who sues over
    patents;
  - **inbound = outbound contribution terms** (section 5), so contributions
    are clearly licensed without a separate CLA;
  - a [NOTICE](NOTICE) mechanism for attribution.

  As the contributor base grows, that legal clarity is worth the longer
  licence text.
- **Data: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).**
  This isn't optional. Importing OpenStreetMap makes our database a derivative
  of OSM, which is ODbL. It also suits the mission: anyone may use the data,
  but improved copies of the database must stay open, so the data can't be
  re-enclosed in a closed directory. Community submissions are dedicated CC0,
  so they add no further conditions. Details: [SOURCES.md](SOURCES.md).

Attribution for data users: **© OpenStreetMap contributors, © Open Mass Times
contributors, ODbL 1.0.**

## Project layout

```
src/
  domain/model.ts        record schemas (zod): the source of truth
  calendar/              dates, Easter, holy days of obligation by country
  recurrence/            RRULE subset, schedule expansion, exceptions
  db/                    SQLite connection, migrations/*.sql, queries
  api/app.ts             the public read API (Hono)
  importers/osm.ts       OpenStreetMap / Overpass importer
  cli/                   migrate, seed, import-osm
  server.ts              entry point
web/                     the web app (Vite + Leaflet)
data/sample/             fictional sample data
docs/                    DATA_MODEL.md, API.md
test/                    Vitest suites (run against an in-memory database)
```

## Contributing

Everyone is welcome: developers, parish staff, and anyone who knows their
parish's schedule. Start with [CONTRIBUTING.md](CONTRIBUTING.md), pick a
[good first issue](https://github.com/coletebou/open-mass-times/labels/good%20first%20issue),
or [send a schedule correction](https://github.com/coletebou/open-mass-times/issues/new?template=schedule_correction.yml).
Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

Maintainers: [Cole Tebou](https://github.com/coletebou) and
[Will Langhart](https://github.com/Will-Langhart).

*Open Mass Times is an independent project. It is not affiliated with
MassTimes.org, the USCCB, or any diocese.*
