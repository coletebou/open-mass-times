# Data sources and licensing

Open Mass Times only works if its data is **clean**: every record must come
from a source we are allowed to use, and must say so. This file sets out which
sources we use, under what terms, and which are off limits. When you add a
source or a record, follow it. If you are unsure, open a
[new data source issue](https://github.com/coletebou/open-mass-times/issues/new?template=new_data_source.yml)
before importing anything.

> This is the project's policy, written in good faith. It is not legal advice.
> When in doubt, ask the source for permission, or leave the data out.

## Why Mass times can be shared at all

A single fact, such as "St. Ann's has Mass on Sundays at 9:00", is not
protected by copyright (in the US see *Feist v. Rural*, 1991; most countries
agree). Three things around facts **are** protected, and they shape everything
below:

1. **Compilations.** The selection and arrangement of a directory can be
   copyrighted, even when each entry is a fact.
2. **Database rights.** In the EU and UK, the *sui generis* database right
   forbids extracting a substantial part of someone else's database, even
   piece by piece.
3. **Terms of service.** A website's terms are a contract; scraping or copying
   against them can be a breach regardless of copyright.

So we take facts **from primary sources**, one parish at a time: the parish
itself, its diocese, open datasets, and people who attend. We never extract
records from another organisation's compiled database.

## Sources at a glance

| Source | What we take | Licence / legal basis | `source` / `sourceLicense` | Status |
| --- | --- | --- | --- | --- |
| [OpenStreetMap](#openstreetmap) | Church locations, names, addresses, websites, phone, wheelchair access | ODbL 1.0 | `osm` / `ODbL-1.0` | Importer in v0 |
| [Wikidata](#wikidata) | Identifiers (Q-ids), names, diocese links | CC0 1.0 | `wikidata` / `CC0-1.0` | Planned |
| [Parish staff](#parish-and-community-submissions) | Schedules, exceptions, corrections | CC0 1.0 dedication by the submitter | `parish_submission` / `CC0-1.0` | Issue form now; in-app later |
| [Community](#parish-and-community-submissions) | Schedules seen in a bulletin, on a sign, on the parish website, or in person | CC0 1.0 dedication by the submitter | `community` / `CC0-1.0` | Issue form / pull request |
| [Parish websites](#parish-websites) | Individual schedule facts from the parish's own published schedule, entered by a maintainer | Uncopyrightable facts, terms checked | `parish_website` / `public-facts` | Manual, per parish |
| [Diocesan directories](#diocesan-directories) | Parish lists and schedules | Only with written permission or an open licence | `diocese` / `permission` or the licence | By agreement |
| Sample data | Fictional demo records | CC0 1.0 (we wrote them) | `sample` / `CC0-1.0` | `data/sample/` |

## OpenStreetMap

- **What:** `amenity=place_of_worship` + `religion=christian` + a Catholic
  `denomination` (an explicit allowlist in
  [`src/importers/osm.ts`](src/importers/osm.ts); Old Catholic, Polish Catholic,
  Polish National Catholic, Liberal Catholic and similar bodies not in
  communion with Rome are excluded).
- **Licence:** [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  © OpenStreetMap contributors. See <https://www.openstreetmap.org/copyright>.
- **Consequences for us:**
  - Our database contains OSM data, so it is a *derivative database* and is
    published under the ODbL as a whole (see [Our licences](#our-licences)).
  - We must attribute OSM wherever the data is shown (the map footer and every
    API response do).
  - Every imported record keeps `osmType`/`osmId`, `sourceUrl` and
    `retrievedAt`, so we can re-sync and link back.
- **Etiquette:** the public Overpass API is volunteer-run. Import one metro
  area or diocese at a time (the CLI refuses areas over 4 square degrees),
  never in a tight loop, and never from CI. Our importer sends an identifying
  `User-Agent` and backs off when Overpass is busy.
- **Give back:** if you find a missing or wrong church, fix it **in
  OpenStreetMap** (it helps everyone), then re-import. Do not copy data *into*
  OSM from sources that are not ODbL-compatible.
- OSM's `service_times` tag holds service times for some churches. They are
  ODbL like the rest of OSM, so we may use them, as unverified drafts. See the
  roadmap.

## Wikidata

- **What:** church and parish items, their Q-ids, names in many languages,
  coordinates, and diocese relations.
- **Licence:** structured data is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  with no conditions. We store `wikidataId` on churches for cross-referencing.
- **Not covered:** Wikipedia article text (CC BY-SA) and Commons images (various
  licences). Don't import those.

## Parish and community submissions

Most schedules will come from people: parish staff, and parishioners who read
the bulletin. Both are welcome. Every submission must:

1. come from the parish itself (its website, bulletin, sign, newsletter, social
   media post or staff) or from the submitter's own attendance, **not** from
   MassTimes.org or any other directory or app;
2. state the facts in the submitter's own words (times, days, languages), not
   paste prose, images or PDFs;
3. carry the submitter's dedication of the facts to the public domain under
   **CC0 1.0**.

The issue forms ask for all three, with this consent text:

> I dedicate the information in this submission to the public domain under
> CC0 1.0. It comes from the parish itself or my own attendance, not from
> MassTimes.org or another directory, website or app.

Why CC0 and not ODbL? CC0 adds no extra conditions, so submitted facts can
also flow back to OpenStreetMap or Wikidata, and can join the ODbL database.

Parish staff who submit or confirm schedules set `verifiedBy: parish_staff`;
a community member who checked in person sets `verifiedBy: community` with
`verificationMethod: in_person`.

## Parish websites

A maintainer may enter the schedule a parish publishes on its **own** website,
record by record, as facts (`sourceLicense: public-facts`), when:

- the site's terms of use do not forbid reuse of its content;
- `robots.txt` is respected, and nothing is scraped automatically or in bulk
  without the parish's (or diocese's) written permission;
- only facts are taken (days, times, languages, rite/form, notes in our own
  words). No prose, logos, photos or bulletin PDFs are copied;
- `sourceUrl` points to the page used, and `retrievedAt` records when.

A parish can ask us to correct or remove its data at any time
(a public issue, or privately through the repository's confidential report form; see [CONTRIBUTING.md](CONTRIBUTING.md)), and we will.

Many parish websites are hosted by platforms (for example eCatholic, Diocesan,
ParishSOFT, Flocknote) whose terms cover the whole site. Check the platform's
terms as well as the parish's.

## Diocesan directories

Diocesan websites often publish parish directories, sometimes with Mass times.
These are usually **compilations** and covered by the diocese's terms, so:

- use them only with **written permission** from the diocese, or when the
  diocese publishes the data under an open licence (some publish ArcGIS/open
  data feeds; check the stated licence);
- record `source: diocese` and `sourceLicense: permission` (or the open
  licence's SPDX id), and link the permission or licence in `sourceUrl`;
- keep a copy of the permission in the issue that tracked the import.

A diocesan partnership (a feed the diocese maintains) is the best long-term
source of all. See the roadmap.

## Not allowed

Do not scrape, copy, import, "check against" or derive records from:

- **MassTimes.org** (Mass Times International Inc.). Their database is their
  work, protected by their terms. This project is an *independent*, open
  alternative; it must never contain their data. Don't use their site even as a
  reference for corrections.
- **The Official Catholic Directory** (P.J. Kenedy & Sons) and other
  commercial Catholic directories.
- **Google Maps / Google Places, Apple Maps, Bing Maps, Yelp, Foursquare**:
  their terms forbid extracting content.
- **GCatholic.org, Catholic-Hierarchy.org** and similar reference sites: their
  compilations are copyrighted. Ask the site owners for permission if a
  specific use seems valuable.
- **Other Mass-time apps and sites**, and scraped social media.
- Any dataset under **non-commercial (NC) or no-derivatives (ND)** licences,
  which cannot be combined with the ODbL.

If a source is not on this page, assume it is not allowed until an issue has
discussed it and this file has been updated.

## Recording provenance

Every record (diocese, parish, church, schedule, exception) carries:

| Field | Meaning |
| --- | --- |
| `source` | Where it came from: `osm`, `wikidata`, `diocese`, `parish_website`, `parish_submission`, `community`, `sample` |
| `sourceUrl` | The OSM object, parish page, or permission letter |
| `sourceRef` | The id within the source, e.g. `node/123456` |
| `sourceLicense` | `ODbL-1.0`, `CC0-1.0`, `CC-BY-4.0`, `permission` or `public-facts` |
| `retrievedAt` | When we last fetched or received it |
| `lastVerifiedAt` | When a person last confirmed it is still right (null = never) |
| `verifiedBy`, `verificationMethod` | Who confirmed it, and how |

The API returns these fields with every record, so users can judge freshness
for themselves.

## Our licences

- **Code:** [Apache License 2.0](LICENSE).
- **Database:** the Open Mass Times database is made available under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  Contents contributed by the community are CC0; contents from OpenStreetMap
  remain © OpenStreetMap contributors under the ODbL.

**Attribution** for anyone using the data, in a map, an app or the API:

> © OpenStreetMap contributors, © Open Mass Times contributors. ODbL 1.0.

If you publish a modified or extended copy of the *database*, the ODbL
requires you to offer it under the ODbL too. A *produced work*, such as a
printed map or an app screen, only needs the attribution. Bulk downloads, so
anyone can exercise these rights without scraping our API, are on the
roadmap.
