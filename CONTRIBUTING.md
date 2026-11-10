# Contributing to Open Mass Times

Thank you for helping. There are two ways to contribute, and both matter:
**data** (schedules and corrections) and **code**.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contributing data

You don't need to write code to help.

- **Report a schedule or a correction.** Use the
  [schedule correction form](https://github.com/coletebou/open-mass-times/issues/new?template=schedule_correction.yml).
  Say where the information came from: the parish website, bulletin, a sign, a
  phone call, or attending yourself.
- **Parish staff:** the same form works. Choose "I work for the parish", and
  we will mark the schedule as verified by parish staff.
- **Missing or misplaced church?** Fix it in
  [OpenStreetMap](https://www.openstreetmap.org/) (tag it
  `amenity=place_of_worship`, `religion=christian`,
  `denomination=roman_catholic`). That helps every map, and we re-import from
  OSM.
- **A new source** (a diocesan feed, an open dataset)? Open a
  [new data source issue](https://github.com/coletebou/open-mass-times/issues/new?template=new_data_source.yml)
  first. Licensing has to be settled before any import.

Every submission is dedicated to the public domain under CC0 1.0, and must not
come from MassTimes.org or any other directory or app.
[SOURCES.md](SOURCES.md) explains why.

**Corrections and removals.** A parish can ask us to correct or remove its
data at any time, with a public issue, or privately through the repository's
[confidential report form](https://github.com/coletebou/open-mass-times/security/advisories/new)
(start the title with "Data:").

## Contributing code

### Setup

```sh
git clone https://github.com/coletebou/open-mass-times.git
cd open-mass-times
npm ci                   # Node 24+ (see .nvmrc)
npm run db:seed:sample
npm run dev              # http://localhost:5173
```

### Workflow

1. Pick an issue. [Good first issues](https://github.com/coletebou/open-mass-times/labels/good%20first%20issue)
   are scoped to be done without knowing the whole codebase. Comment that
   you're taking it.
2. Branch from `master` (`feat/ics-export`, `fix/vigil-dates`).
3. Make the change, with tests. `npm run check` runs everything CI runs:
   lint, typecheck, tests and build.
4. Open a pull request against `master`. Fill in the template, and link the
   issue. CI must pass before merging.
5. A maintainer reviews. Small PRs get reviewed fastest.

`master` is protected: every change lands through a pull request with green CI.

### Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
  `feat(api): add ICS export`, `fix(calendar): move Epiphany in Canada`.
- **TypeScript**, strict mode. Node runs `.ts` directly, so: import with the
  `.ts` extension, and don't use `enum`, `namespace` or constructor parameter
  properties. `tsc` will tell you.
- **Formatting:** follow the surrounding code (2 spaces, single quotes,
  semicolons). The repo deliberately has no auto-formatter; ESLint is the
  linter.
- **Schema changes:** update `src/domain/model.ts`, add a new numbered file in
  `src/db/migrations/` (never edit one that has shipped), and update
  [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
- **API changes** are additive within `/api/v1`. Document them in
  [docs/API.md](docs/API.md).
- **Liturgical rules** cite their source (the bishops' conference norm) in a
  comment, with a test for at least two years.
- **Web UI:** build DOM with the `h()` helper (it uses `textContent`), never
  `innerHTML` with data.
- **Dependencies:** prefer none. If you need one, check that it is maintained
  and its licence is compatible (no GPL/AGPL in the runtime bundle).

### Where things live

See the layout in the [README](README.md#project-layout), and
[AGENTS.md](AGENTS.md) for what each part can break.

## Licensing of contributions

Code contributions are licensed under the [Apache License 2.0](LICENSE)
(section 5: what you submit is licensed the same way). Data contributions are
dedicated under CC0 1.0 and published as part of the ODbL database.
