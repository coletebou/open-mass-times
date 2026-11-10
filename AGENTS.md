# AGENTS.md

Guidance for coding agents (and humans in a hurry). The README covers what
the project is; this file covers how not to break it.

## Hard rules

- **Data provenance is the product.** Never add data from a source that
  SOURCES.md doesn't allow. That means never MassTimes.org, Google
  Maps/Places, or any other directory. Every record carries `source`,
  `sourceLicense` and the other provenance fields.
- Never commit imported real-world data dumps or `*.sqlite` files. Sample data
  in `data/sample/` is fictional and must stay obviously so ("(sample)" in names).
- Don't run the OSM importer in CI or in loops; Overpass is a shared volunteer service.
- No personal email addresses in files or commit metadata.
- Prettier is not used here; don't add it or reformat files. ESLint is the linter.
- Code is Apache-2.0, data is ODbL-1.0. Don't add dependencies with
  incompatible licences (GPL/AGPL in the runtime bundle, NC/ND data).

## Map: what each part can break

| Area | Files | Breaks if you get it wrong |
| --- | --- | --- |
| Record schemas | `src/domain/model.ts` | Seed/import validation, API output, SQL mirror. Change `src/db/migrations/` (new numbered file, never edit an applied one) in the same PR. |
| Recurrence | `src/recurrence/rrule.ts`, `expand.ts` | Which days services appear. Unsupported RRULE parts must keep failing loudly. |
| Liturgical calendar | `src/calendar/liturgical.ts` | Holy days and movable feasts per country. Cite the bishops' conference norm in a comment for every rule. |
| Dates / time zones | `src/calendar/dates.ts` | Off-by-one days, DST offsets in `startsAt`. Times are local to the church's IANA zone. |
| API | `src/api/app.ts`, `docs/API.md` | Public contract (v1). Additive changes only; document them in docs/API.md. |
| OSM importer | `src/importers/osm.ts` | The Catholic denomination allowlist; must not overwrite curated (non-`osm`) records. |
| Web | `web/src/` | Build all DOM with `h()`/textContent, never `innerHTML` with data. |

## Checks (scoped)

```sh
npm run lint
npm run typecheck              # server + web
npx vitest run test/<file>     # the suites your change touches
npm test                       # everything (fast: ~2 s, in-memory SQLite)
npm run build                  # web bundle
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build on every PR.

## Running it

```sh
npm ci && npm run db:seed:sample && npm run dev   # http://localhost:5173
PORT=8791 npm start                               # after npm run build; serves dist/web too
DATABASE_PATH=data/scratch.sqlite npm run import:osm -- --bbox s,w,n,e --country US --timezone America/New_York
```

## Known traps

- Node runs `.ts` files directly (type stripping): imports need the `.ts`
  extension, and `enum`, `namespace` and constructor parameter properties are
  not allowed (`erasableSyntaxOnly`).
- TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7 yet.
- `node:sqlite` binds named parameters from plain objects; `undefined` is not a
  valid value (use `null`).
- `holy_day_of_obligation` schedules never expand onto Sundays, by design (see
  `liturgical.ts`).
- Deleting the SQLite file while a server is running leaves the server on the
  old (deleted) file; restart it.
