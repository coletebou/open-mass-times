// Public read API (v1). Read-only, JSON, CORS-open. Documented in docs/API.md.
//
// Every response carries the data licence and attribution, because the
// dataset is ODbL: whoever reuses it must credit OpenStreetMap and Open Mass
// Times contributors and keep derived databases open.

import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { addDays, nowInZone, zonedDateTimeToIso } from '../calendar/dates.ts';
import { feastDates, holyDaysOfObligation, supportsObligations } from '../calendar/liturgical.ts';
import {
  CountryCodeSchema,
  LanguageTagSchema,
  LocalDateSchema,
  LocalTimeSchema,
  RITES,
  ROMAN_FORMS,
  SERVICE_TYPES,
  IdSchema,
  type Schedule,
} from '../domain/model.ts';
import {
  calendarOptionsForChurches,
  churchBounds,
  churchesNear,
  churchesOfParish,
  countRecords,
  exceptionsForChurches,
  getChurch,
  getDiocese,
  getParish,
  schedulesForChurches,
  searchChurches,
} from '../db/repository.ts';
import { haversineKm } from '../geo.ts';
import { describeRecurrence, expandSchedules, overlapsTimeWindow } from '../recurrence/expand.ts';

export const API_VERSION = '0.1.0';

export const DATA_META = {
  dataLicense: 'ODbL-1.0',
  dataLicenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors; © Open Mass Times contributors',
  sources: 'https://github.com/coletebou/open-mass-times/blob/master/SOURCES.md',
  disclaimer: 'Schedules change. Check lastVerifiedAt, and confirm with the parish before travelling.',
} as const;

const MAX_RADIUS_KM = 100;
const MAX_DAYS = 14;
const MAX_CHURCHES_PER_QUERY = 500;

// ---------------------------------------------------------------------------
// Query parameter schemas
// ---------------------------------------------------------------------------

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item).min(1));

const latLon = {
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
};

const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const ChurchesQuery = z
  .object({
    lat: latLon.lat.optional(),
    lon: latLon.lon.optional(),
    radius: z.coerce.number().positive().max(MAX_RADIUS_KM).default(15),
    q: z.string().trim().min(2).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_CHURCHES_PER_QUERY).default(100),
  })
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), 'pass both lat and lon, or neither')
  .refine((v) => v.q !== undefined || v.lat !== undefined, 'pass lat and lon, or q');

const ServicesQuery = z
  .object({
    lat: latLon.lat.optional(),
    lon: latLon.lon.optional(),
    church: IdSchema.optional(),
    radius: z.coerce.number().positive().max(MAX_RADIUS_KM).default(15),
    date: LocalDateSchema.optional(),
    days: z.coerce.number().int().min(1).max(MAX_DAYS).default(1),
    after: LocalTimeSchema.optional(),
    before: LocalTimeSchema.optional(),
    upcoming: boolParam.default(false),
    type: csv(z.enum(SERVICE_TYPES)).optional(),
    language: csv(LanguageTagSchema).optional(),
    rite: csv(z.enum(RITES)).optional(),
    form: csv(z.enum(ROMAN_FORMS)).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), 'pass both lat and lon, or neither')
  .refine((v) => v.church !== undefined || v.lat !== undefined, 'pass lat and lon, or church');

const HolyDaysQuery = z.object({
  year: z.coerce.number().int().min(1583).max(4099),
  country: CountryCodeSchema.default('US'),
  ascension_thursday: boolParam.default(false),
});

function parseQuery<T extends z.ZodType>(schema: T, query: Record<string, string>): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new HTTPException(400, {
      res: Response.json(
        { error: { code: 'bad_request', message: z.prettifyError(result.error), issues: result.error.issues } },
        { status: 400 },
      ),
    });
  }
  return result.data;
}

const notFound = (what: string) =>
  new HTTPException(404, {
    res: Response.json({ error: { code: 'not_found', message: `${what} not found` } }, { status: 404 }),
  });

/** A language filter matches "es" against "es" and "es-MX". */
function languageMatches(scheduleLanguages: readonly string[], wanted: readonly string[]): boolean {
  return scheduleLanguages.some((have) =>
    wanted.some((w) => have.toLowerCase() === w.toLowerCase() || have.toLowerCase().startsWith(`${w.toLowerCase()}-`)),
  );
}

function scheduleMatchesFilters(s: Schedule, q: z.infer<typeof ServicesQuery>): boolean {
  if (q.type && !q.type.includes(s.serviceType)) return false;
  if (q.language && !languageMatches(s.languages, q.language)) return false;
  // Unknown rite on a schedule is assumed Roman, the overwhelming default.
  if (q.rite && !q.rite.includes(s.rite ?? 'roman')) return false;
  if (q.form && (s.form === null || !q.form.includes(s.form))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function createApp(db: DatabaseSync, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const app = new Hono();

  app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('X-Data-License', DATA_META.dataLicense);
    if (c.req.method === 'GET' && c.res.status === 200) c.header('Cache-Control', 'public, max-age=300');
  });

  app.get('/api/v1/health', (c) => c.json({ ok: true, version: API_VERSION }));

  app.get('/api/v1/meta', (c) =>
    c.json({
      name: 'Open Mass Times',
      version: API_VERSION,
      codeLicense: 'Apache-2.0',
      ...DATA_META,
      counts: countRecords(db),
      bounds: churchBounds(db),
    }),
  );

  app.get('/api/v1/churches', (c) => {
    const q = parseQuery(ChurchesQuery, c.req.query());
    const near = q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : undefined;
    const churches = q.q
      ? searchChurches(db, { text: q.q, limit: q.limit, near })
      : churchesNear(db, { lat: q.lat!, lon: q.lon!, radiusKm: q.radius, limit: q.limit });
    const scheduleCounts = new Map<string, number>();
    for (const s of schedulesForChurches(
      db,
      churches.map((ch) => ch.id),
    )) {
      scheduleCounts.set(s.churchId, (scheduleCounts.get(s.churchId) ?? 0) + 1);
    }
    return c.json({
      results: churches.map((ch) => ({ ...ch, scheduleCount: scheduleCounts.get(ch.id) ?? 0 })),
      meta: DATA_META,
    });
  });

  app.get('/api/v1/churches/:id', (c) => {
    const church = getChurch(db, c.req.param('id'));
    if (!church) throw notFound('church');
    const parish = church.parishId ? getParish(db, church.parishId) : null;
    const diocese = parish?.dioceseId ? getDiocese(db, parish.dioceseId) : null;
    const today = nowInZone(church.timezone, now()).date;
    const schedules = schedulesForChurches(db, [church.id]).map((s) => ({
      ...s,
      recurrenceText: describeRecurrence(s),
    }));
    return c.json({
      church,
      parish,
      diocese,
      schedules,
      upcomingExceptions: exceptionsForChurches(db, [church.id], today, addDays(today, 60)),
      holyDayRulesAvailable: supportsObligations(church.countryCode),
      meta: DATA_META,
    });
  });

  app.get('/api/v1/parishes/:id', (c) => {
    const parish = getParish(db, c.req.param('id'));
    if (!parish) throw notFound('parish');
    const diocese = parish.dioceseId ? getDiocese(db, parish.dioceseId) : null;
    return c.json({ parish, diocese, churches: churchesOfParish(db, parish.id), meta: DATA_META });
  });

  app.get('/api/v1/services', (c) => {
    const q = parseQuery(ServicesQuery, c.req.query());

    let churches;
    if (q.church) {
      const one = getChurch(db, q.church);
      if (!one) throw notFound('church');
      const distanceKm =
        q.lat !== undefined && q.lon !== undefined ? haversineKm(q.lat, q.lon, one.latitude, one.longitude) : 0;
      churches = [{ ...one, distanceKm }];
    } else {
      churches = churchesNear(db, { lat: q.lat!, lon: q.lon!, radiusKm: q.radius, limit: MAX_CHURCHES_PER_QUERY });
    }
    const ids = churches.map((ch) => ch.id);
    const schedules = schedulesForChurches(db, ids).filter((s) => scheduleMatchesFilters(s, q));
    const schedulesById = new Map(schedules.map((s) => [s.id, s]));
    const calendars = calendarOptionsForChurches(db, churches);

    // Each church's window starts on its own local "today" unless a date is given.
    const windows = new Map(
      churches.map((ch) => {
        const local = nowInZone(ch.timezone, now());
        const from = q.date ?? local.date;
        return [ch.id, { from, to: addDays(from, q.days - 1), local }];
      }),
    );
    const allFrom = [...windows.values()].reduce((m, w) => (w.from < m ? w.from : m), '9999-12-31');
    const allTo = [...windows.values()].reduce((m, w) => (w.to > m ? w.to : m), '0000-01-01');
    const exceptions = exceptionsForChurches(db, ids, allFrom, allTo);

    const results = [];
    for (const church of churches) {
      const window = windows.get(church.id)!;
      const occurrences = expandSchedules(
        schedules.filter((s) => s.churchId === church.id),
        exceptions.filter((e) => e.churchId === church.id),
        { from: window.from, to: window.to, calendar: calendars.get(church.id)! },
      );
      for (const o of occurrences) {
        if (!overlapsTimeWindow(o, q.after, q.before)) continue;
        if (q.upcoming && (o.date < window.local.date || (o.date === window.local.date && (o.endTime ?? o.startTime) < window.local.time))) {
          continue;
        }
        const s = schedulesById.get(o.scheduleId)!;
        results.push({
          date: o.date,
          startTime: o.startTime,
          endTime: o.endTime,
          startsAt: zonedDateTimeToIso(o.date, o.startTime, church.timezone),
          status: o.status,
          originalStartTime: o.originalStartTime,
          exceptionReason: o.exceptionReason,
          serviceType: s.serviceType,
          title: s.title,
          languages: s.languages,
          rite: s.rite,
          form: s.form,
          isVigil: s.isVigil,
          notes: s.notes,
          livestreamUrl: s.livestreamUrl,
          scheduleId: s.id,
          source: s.source,
          lastVerifiedAt: s.lastVerifiedAt,
          verifiedBy: s.verifiedBy,
          church: {
            id: church.id,
            name: church.name,
            latitude: church.latitude,
            longitude: church.longitude,
            locality: church.locality,
            region: church.region,
            timezone: church.timezone,
            distanceKm: Math.round(church.distanceKm * 100) / 100,
            source: church.source,
          },
        });
      }
    }
    results.sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.church.distanceKm - b.church.distanceKm || a.church.name.localeCompare(b.church.name),
    );
    return c.json({
      results: results.slice(0, q.limit),
      truncated: results.length > q.limit,
      churchesSearched: churches.length,
      meta: DATA_META,
    });
  });

  app.get('/api/v1/holy-days', (c) => {
    const q = parseQuery(HolyDaysQuery, c.req.query());
    const opts = { countryCode: q.country, ascensionOnThursday: q.ascension_thursday };
    return c.json({
      year: q.year,
      country: q.country,
      obligationRulesAvailable: supportsObligations(q.country),
      holyDaysOfObligation: holyDaysOfObligation(q.year, opts),
      feasts: Object.fromEntries(feastDates(q.year, opts)),
      meta: DATA_META,
    });
  });

  app.all('/api/*', () => {
    throw notFound('endpoint');
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });

  return app;
}
