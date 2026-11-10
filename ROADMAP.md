# Roadmap

Where Open Mass Times is going, roughly in order. Each item that is ready to
pick up has an issue. Look for the
[good first issue](https://github.com/coletebou/open-mass-times/labels/good%20first%20issue)
label.

## v0: scaffold (done)

- [x] Data model: dioceses, parishes, churches, schedules (Mass with
      language, rite and form; confession; adoration; devotions; Hours),
      recurrence (RRULE subset + liturgical days + one-offs), exceptions, and
      provenance and last-verified fields on every record
- [x] Liturgical calendar: Easter computus, movable feasts, holy days of
      obligation for the US (with the Ascension-Thursday provinces) and Canada
- [x] Public read API (`/api/v1`): services near a point, churches, church and
      parish detail, holy days
- [x] Web app: map, near-me, search, filters by day, time, type, language,
      rite and form, church detail, shareable URLs
- [x] OpenStreetMap importer (church locations), sample data, CI, docs

## v0.1: ready for a pilot area

Goal: real, verified schedules for one metro area or diocese, good enough to
show parishioners.

**Good first issues**
- [ ] Holy-day rules for another country (Mexico, the Philippines, England &
      Wales, Ireland, Australia, ...)
- [ ] Download a church's schedule as a calendar (`.ics`)
- [ ] "Next Mass near me" shortcut
- [ ] Look up each church's time zone from its coordinates in the OSM importer
- [ ] Show a "may be out of date" badge on times not verified for 12 months
- [ ] Collapsible filters on small screens
- [ ] Spanish translation of the web app (with a small i18n layer)
- [ ] OpenAPI 3.1 description of `/api/v1`
- [ ] Dockerfile for self-hosting

**Bigger items**
- [ ] Draft schedules from OSM `service_times` tags (opening_hours syntax),
      marked unverified
- [ ] Wikidata cross-referencing for imported churches (CC0)
- [ ] Bulk data downloads (SQLite + GeoJSON, weekly), so anyone can use the
      ODbL data without scraping the API
- [ ] Before any public deploy: rate limiting and caching, production map tiles
      (OpenFreeMap or self-hosted Protomaps; the OSM Foundation tile servers
      are not for production traffic), and an uptime check
- [ ] Project contact alias for conduct and data requests (replaces the
      GitHub-form-only channel)

## v0.2: contributions in the app

- [ ] "Suggest a correction" form in the app, feeding a moderation queue
      (a `submissions` table with the CC0 consent recorded)
- [ ] Verified parish staff accounts, e.g. by confirming an email at the
      parish's own domain, so staff can update their schedule directly
- [ ] Edit history and audit log per record
- [ ] Liturgical overrides: Holy Week, Christmas and Easter schedules replacing
      the regular weekly pattern

## v1: public launch

- [ ] Deploy (Hono runs on Node or on edge platforms such as Cloudflare
      Workers, so this stays cheap)
- [ ] Diocesan partnerships: dioceses maintaining their own feed
- [ ] More countries and languages; the Julian Paschalion for Eastern Catholic
      Churches that keep it
- [ ] Installable PWA with an offline "my parishes" list
- [ ] Accessibility audit (keyboard paths between list and map, screen readers)
- [ ] Postgres + PostGIS if write volume or geo queries outgrow SQLite

## Open questions

- **Data as code?** Curated schedules could live as reviewed JSON files in
  the repo (every edit a PR, git as the audit log), with SQLite built from
  them. Or the database could stay the source of truth, with a moderation UI.
  The first is simpler and more transparent at pilot scale.
- **Hosting and domain.** Decide before v1.
- **Which pilot area?** Pick one with a willing diocese or a handful of
  parishes ready to verify their own schedules.
