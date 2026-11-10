# Public read API (v1)

Base path: `/api/v1`. Read-only `GET`, JSON, CORS open to all origins.
Responses carry `X-Data-License: ODbL-1.0` and a `meta` block with the
attribution you must show when you use the data. Successful responses are
cacheable for 5 minutes.

Errors look like:

```json
{ "error": { "code": "bad_request", "message": "✖ pass lat and lon, or church", "issues": [] } }
```

with status `400` (bad parameters), `404` (unknown id or endpoint), or `500`.

Times are **local to the church** (`startTime: "09:00"`), and `startsAt` gives
the same moment as ISO 8601 with the church's UTC offset.

## `GET /services`

Concrete service times (Masses, confessions, adoration, ...) near a point or at
one church, with exceptions applied.

| Param | Default | Notes |
| --- | --- | --- |
| `lat`, `lon` | — | Required unless `church` is given |
| `church` | — | One church id instead of an area |
| `radius` | `15` | Kilometres, max `100` |
| `date` | church's local today | `YYYY-MM-DD` |
| `days` | `1` | `1`–`14` days from `date` |
| `after`, `before` | — | Local `HH:MM`. Point events must start in the window; confession/adoration windows only need to overlap it. |
| `upcoming` | `false` | `true`: drop what has already ended (church-local clock) |
| `type` | all | Comma list: `mass,confession,adoration,devotion,liturgy_of_the_hours` |
| `language` | all | Comma list of BCP 47 tags; `es` also matches `es-MX` |
| `rite` | all | Comma list, e.g. `byzantine`; unspecified counts as `roman` |
| `form` | all | Comma list: `ordinary,usus_antiquior,divine_worship` |
| `limit` | `200` | Max `1000`; `truncated: true` when cut |

```json
{
  "results": [
    {
      "date": "2026-11-15",
      "startTime": "13:00",
      "endTime": null,
      "startsAt": "2026-11-15T13:00:00-05:00",
      "status": "scheduled",
      "originalStartTime": null,
      "exceptionReason": null,
      "serviceType": "mass",
      "title": null,
      "languages": ["es"],
      "rite": "roman",
      "form": "ordinary",
      "isVigil": false,
      "notes": null,
      "livestreamUrl": null,
      "scheduleId": "sch_sample-cathedral-04",
      "source": "sample",
      "lastVerifiedAt": "2026-10-30T15:00:00Z",
      "verifiedBy": "parish_staff",
      "church": {
        "id": "ch_sample-cathedral", "name": "Cathedral of St. Placeholder (sample)",
        "latitude": 35.2265, "longitude": -80.844, "locality": "Charlotte", "region": "NC",
        "timezone": "America/New_York", "distanceKm": 0.11, "source": "sample"
      }
    }
  ],
  "truncated": false,
  "churchesSearched": 5,
  "meta": { "dataLicense": "ODbL-1.0", "attribution": "© OpenStreetMap contributors; © Open Mass Times contributors", "...": "..." }
}
```

A rescheduled occurrence has `status: "rescheduled"`, the new `startTime`,
and `originalStartTime`. Cancelled occurrences are omitted.

## `GET /churches`

Churches near a point, or a text search.

| Param | Default | Notes |
| --- | --- | --- |
| `lat`, `lon` | — | Nearest first within `radius` |
| `radius` | `15` | Kilometres, max `100` |
| `q` | — | Name, city, region or postal code; every word prefix-matches; accents ignored. With `lat`/`lon`, results are sorted by distance. |
| `limit` | `100` | Max `500` |

Each result is a full church record (with provenance) plus `distanceKm` and
`scheduleCount`.

## `GET /churches/:id`

`{ church, parish, diocese, schedules, upcomingExceptions, holyDayRulesAvailable, meta }`.
Each schedule includes `recurrenceText`, e.g. "First Fridays", "Sundays
(June-August)" or "Holy days of obligation". `upcomingExceptions` covers the
next 60 days.

## `GET /parishes/:id`

`{ parish, diocese, churches, meta }`.

## `GET /holy-days`

| Param | Default | Notes |
| --- | --- | --- |
| `year` | — | Required, `1583`–`4099` |
| `country` | `US` | ISO 3166-1 alpha-2 |
| `ascension_thursday` | `false` | US provinces that keep Ascension Thursday |

`{ year, country, obligationRulesAvailable, holyDaysOfObligation: [{ key, name, date }], feasts: { easter: "2026-04-05", ... } }`

## `GET /meta`, `GET /health`

`/meta`: licences, attribution, record counts and the bounding box of all
churches. `/health`: `{ ok: true, version }`.

## Fair use

There is no public deployment yet. When there is, please cache responses,
keep requests modest, and use the bulk downloads (on the roadmap) instead of
crawling the API.
