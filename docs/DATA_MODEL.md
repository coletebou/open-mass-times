# Data model

The zod schemas in [`src/domain/model.ts`](../src/domain/model.ts) are the
source of truth. The SQL in [`src/db/migrations/`](../src/db/migrations/)
mirrors them (camelCase fields, snake_case columns), and seed or import files
use the same shape ([`DataFileSchema`](../src/domain/model.ts)). This page
explains the *why*.

```
Diocese 1──* Parish 1──* Church 1──* Schedule
                                │            │
                                └──* ScheduleException *──┘ (optional)
```

## Records

### Diocese
A diocese, or an Eastern Catholic eparchy. `churchSuiIuris` defaults to
`latin`. `ascensionOnThursday` is a US-specific switch: most US provinces move
the Ascension to the following Sunday, but a few keep Thursday (historically
Boston, Hartford, New York, Newark, Philadelphia and Omaha; confirm against the
current USCCB liturgical calendar before setting it).

### Parish
The pastoral unit: the name people know, a website and office contacts.
`status` covers mergers (`merged` + `mergedIntoId`) and closures, which are
common and must not silently break links.

### Church
A physical place of worship with coordinates. It is separate from Parish
because one parish often has several churches (missions, merged parishes,
oratories), and an OSM-imported church may not be linked to a parish yet.
Every church has an IANA `timezone`, and every time at that church is local
to it.

### Schedule
One recurring or one-off service at a church: *"Sundays at 09:00, Mass in
Spanish."*

| Field | Notes |
| --- | --- |
| `serviceType` | `mass` (including the Divine Liturgy and other Eucharistic liturgies), `confession`, `adoration`, `devotion`, `liturgy_of_the_hours` |
| `startTime`, `endTime` | Local `HH:MM`. End is required in practice for windows (confession, adoration); `24:00` ends at midnight (perpetual adoration: `00:00`–`24:00` daily). |
| **when** | Exactly one of `rrule`, `liturgicalDay`, `date`; see below |
| `validFrom`, `validUntil` | Bound a schedule, e.g. Lent only or "from Advent 2026" |
| `languages` | BCP 47 tags (`en`, `es`, `la`, `vi`, `cu` for Church Slavonic, ...). Several for bilingual Masses. |
| `rite` | Liturgical tradition: `roman`, `ambrosian`, `mozarabic`, `byzantine`, `alexandrian`, `antiochene`, `armenian`, `east_syriac`. Null means unspecified, which the API treats as Roman. |
| `form` | Roman rite only: `ordinary` (Missal of Paul VI), `usus_antiquior` (1962 Missal), `divine_worship` (Ordinariate) |
| `churchSuiIuris` | Optional: which Church (`maronite`, `ukrainian`, `ruthenian`, ...) |
| `isVigil` | An anticipated Mass of the next day (Saturday evening, the eve of a holy day) |
| `title`, `notes`, `livestreamUrl` | Free text for people: "Children's Mass", "door code at the office" |

Why both `rite` and `languages`? Because "Latin Mass" means two different
things: Mass in Latin (`languages: ["la"]`, which can be the Ordinary Form)
and the 1962 Missal (`form: usus_antiquior`). Users filter on either.

### ScheduleException
A dated change: `cancelled` or `rescheduled` (with the new `startTime`).
With a `scheduleId` it affects one occurrence. Without one, `cancelled` means
nothing happens at the church that day. To move a service to another *date*,
cancel it and add a one-off schedule.

## When things happen

### RRULE (a small, strict subset of RFC 5545)
Parish schedules are simple, so we support only what can be evaluated as a
yes/no test on a date, and reject everything else with a clear error
([`src/recurrence/rrule.ts`](../src/recurrence/rrule.ts)):

| Pattern | RRULE |
| --- | --- |
| Sundays | `FREQ=WEEKLY;BYDAY=SU` |
| Weekdays | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| First Fridays | `FREQ=MONTHLY;BYDAY=1FR` |
| Last Sunday of the month | `FREQ=MONTHLY;BYDAY=-1SU` |
| Summer Sundays | `FREQ=WEEKLY;BYDAY=SU;BYMONTH=6,7,8` |
| Every day | `FREQ=DAILY` |
| A patronal feast, every year | `FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15` |

Not supported: `INTERVAL`, `COUNT`, `UNTIL`, `BYSETPOS`, `BYWEEKNO`, and the
rest. Use `validFrom`/`validUntil` for bounds.

### Liturgical days
Movable and fixed feasts, computed per country
([`src/calendar/liturgical.ts`](../src/calendar/liturgical.ts)):
`ash_wednesday`, `holy_thursday`, `good_friday`, `easter_vigil`, `easter`,
`ascension`, `pentecost`, `corpus_christi`, `christmas_eve`, `christmas`,
`assumption`, `all_saints`, `immaculate_conception`, and more. The country
rules decide moves (e.g. Epiphany and Corpus Christi move to Sunday in the US).

Two keys follow the **obligation** rules of the church's bishops'
conference:

- `holy_day_of_obligation`: the holy days of obligation that fall Monday to
  Saturday;
- `holy_day_of_obligation_vigil`: the evening before each.

They never land on a Sunday, because the Sunday schedule already covers the
obligation. Christmas on a Sunday uses the `christmas` key. Countries without
rules in the code get no obligation dates, rather than a guess.

### One-off
`date: "2026-12-24"`.

## Provenance (on every record)

`source`, `sourceUrl`, `sourceRef`, `sourceLicense`, `retrievedAt`,
`lastVerifiedAt`, `verifiedBy`, `verificationMethod`, plus database-managed
`created_at`/`updated_at`. Allowed values and their meaning:
[SOURCES.md](../SOURCES.md#recording-provenance). `lastVerifiedAt: null`
means nobody has confirmed the record yet. The UI says so.

## IDs

`prefix_slug`: `dio_`, `epa_`, `par_`, `ch_`, `sch_`, `exc_`. OSM-imported
churches get a stable id from their OSM identity (`ch_osm-way-123`), so
re-imports update in place. Imports never overwrite a church whose `source` is
no longer `osm` (someone curated it).
