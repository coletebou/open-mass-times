import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { loadDataFile } from '../src/db/repository.ts';
import { DataFileSchema } from '../src/domain/model.ts';

// Monday 2026-11-09, 10:00 in Charlotte (America/New_York, UTC-5).
const NOW = new Date('2026-11-09T15:00:00Z');
const CHARLOTTE = 'lat=35.2271&lon=-80.8431&radius=20';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const db = openDatabase(':memory:');
  loadDataFile(db, DataFileSchema.parse(JSON.parse(readFileSync('data/sample/sample-data.json', 'utf8'))));
  app = createApp(db, { now: () => NOW });
});

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, headers: res.headers, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const summary = (results: any[]) => results.map((r) => `${r.date} ${r.startTime} ${r.serviceType} ${r.church.id}`); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('GET /api/v1/services', () => {
  it("lists today's services near a point in time order, with licence metadata", async () => {
    const { status, headers, body } = await get(`/api/v1/services?${CHARLOTTE}`);
    expect(status).toBe(200);
    expect(headers.get('x-data-license')).toBe('ODbL-1.0');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(body.meta.dataLicense).toBe('ODbL-1.0');
    expect(summary(body.results)).toEqual([
      '2026-11-09 00:00 adoration ch_sample-our-lady',
      '2026-11-09 07:00 mass ch_sample-oratory',
      '2026-11-09 11:30 confession ch_sample-cathedral',
      '2026-11-09 12:10 mass ch_sample-cathedral',
    ]);
    expect(body.results[3].startsAt).toBe('2026-11-09T12:10:00-05:00');
    expect(body.results[3].lastVerifiedAt).toBe('2026-10-30T15:00:00Z');
  });

  it('upcoming=true drops what already ended', async () => {
    const { body } = await get(`/api/v1/services?${CHARLOTTE}&upcoming=true`);
    expect(summary(body.results)).not.toContain('2026-11-09 07:00 mass ch_sample-oratory');
    expect(summary(body.results)).toContain('2026-11-09 00:00 adoration ch_sample-our-lady'); // runs until 24:00
  });

  it('filters by type, language and form on a Sunday', async () => {
    const { body } = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-15&type=mass&language=es`);
    expect(summary(body.results)).toEqual(['2026-11-15 13:00 mass ch_sample-cathedral', '2026-11-15 19:00 mass ch_sample-our-lady']);

    const latin = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-15&form=usus_antiquior`);
    expect(latin.body.results.map((r: { title: string }) => r.title)).toEqual(['Missa Cantata']);

    const eastern = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-15&rite=byzantine`);
    expect(eastern.body.results.map((r: { title: string }) => r.title)).toEqual(['Divine Liturgy']);
  });

  it('filters by time of day', async () => {
    const { body } = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-15&type=mass&after=17:00`);
    expect(summary(body.results)).toEqual(['2026-11-15 18:00 mass ch_sample-cathedral', '2026-11-15 19:00 mass ch_sample-our-lady']);
  });

  it('applies exceptions', async () => {
    const thanksgiving = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-26&type=mass`);
    expect(thanksgiving.body.results).toContainEqual(
      expect.objectContaining({ startTime: '09:00', status: 'rescheduled', originalStartTime: '12:10', exceptionReason: 'Thanksgiving Day Mass' }),
    );
    const eve = await get(`/api/v1/services?${CHARLOTTE}&date=2026-11-25&type=confession`);
    expect(summary(eve.body.results)).toEqual(['2026-11-25 11:30 confession ch_sample-cathedral']);
  });

  it('expands holy days of obligation and their vigils', async () => {
    const vigil = await get(`/api/v1/services?church=ch_sample-cathedral&date=2026-12-07&type=mass&after=17:00`);
    expect(summary(vigil.body.results)).toEqual(['2026-12-07 18:00 mass ch_sample-cathedral']);
    const day = await get(`/api/v1/services?church=ch_sample-cathedral&date=2026-12-08&type=mass`);
    expect(day.body.results.map((r: { startTime: string }) => r.startTime)).toEqual(['07:00', '12:10', '12:10', '19:00']);
  });

  it("uses the diocese's Ascension rule (Thursday for the sample eparchy), with DST offsets", async () => {
    const { body } = await get('/api/v1/services?church=ch_sample-byzantine&date=2027-05-06');
    expect(body.results).toEqual([
      expect.objectContaining({ title: 'Divine Liturgy of the Ascension', startsAt: '2027-05-06T18:30:00-04:00' }),
    ]);
  });

  it('treats a blank optional parameter as not given', async () => {
    const { status, body } = await get(`/api/v1/services?church=ch_sample-oratory&date=&type=&after=`);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ date: '2026-11-09', startTime: '07:00' }); // today, all types
  });

  it('spans several days', async () => {
    const { body } = await get(`/api/v1/services?church=ch_sample-oratory&date=2026-11-14&days=2&type=mass`);
    expect(summary(body.results)).toEqual(['2026-11-14 07:00 mass ch_sample-oratory', '2026-11-15 09:30 mass ch_sample-oratory']);
  });

  it.each([
    ['/api/v1/services', 400],
    ['/api/v1/services?lat=35', 400],
    ['/api/v1/services?lat=95&lon=0', 400],
    [`/api/v1/services?${CHARLOTTE}&days=99`, 400],
    [`/api/v1/services?${CHARLOTTE}&type=bingo`, 400],
    [`/api/v1/services?${CHARLOTTE}&after=7pm`, 400],
    ['/api/v1/services?church=ch_nope-nope', 404],
    // Blank values are "not given", never coerced to 0 (which would search at 0°N 0°E).
    ['/api/v1/services?lat=&lon=', 400],
    ['/api/v1/services?lat=%20&lon=0', 400],
    ['/api/v1/churches?lat=&lon=', 400],
    ['/api/v1/holy-days?year=', 400],
  ])('%s -> %i', async (path, status) => {
    const res = await get(path);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(status === 400 ? 'bad_request' : 'not_found');
  });
});

describe('GET /api/v1/churches', () => {
  it('finds churches near a point, nearest first, with schedule counts', async () => {
    const { body } = await get(`/api/v1/churches?${CHARLOTTE}`);
    expect(body.results[0]).toMatchObject({ id: 'ch_sample-cathedral', source: 'sample' });
    expect(body.results).toHaveLength(5);
    expect(body.results.every((c: { scheduleCount: number }) => c.scheduleCount > 0)).toBe(true);
  });

  it('searches by name with prefix matching and diacritics folded', async () => {
    const { body } = await get('/api/v1/churches?q=plac');
    expect(body.results.map((c: { id: string }) => c.id)).toEqual(['ch_sample-cathedral']);
    const accented = await get('/api/v1/churches?q=Grégory');
    expect(accented.body.results.map((c: { id: string }) => c.id)).toEqual(['ch_sample-oratory']);
  });

  it('treats FTS syntax in the query as plain text', async () => {
    const { status } = await get('/api/v1/churches?q=%22OR%20NEAR(*');
    expect(status).toBe(200);
  });
});

describe('detail endpoints', () => {
  it('GET /api/v1/churches/:id returns the parish, diocese and readable schedules', async () => {
    const { body } = await get('/api/v1/churches/ch_sample-cathedral');
    expect(body.parish.id).toBe('par_sample-cathedral');
    expect(body.diocese.id).toBe('dio_sample');
    expect(body.holyDayRulesAvailable).toBe(true);
    const texts = body.schedules.map((s: { recurrenceText: string }) => s.recurrenceText);
    expect(texts).toContain('First Fridays');
    expect(texts).toContain('Holy days of obligation');
    expect(body.upcomingExceptions.map((e: { id: string }) => e.id)).toEqual(['exc_sample-thanksgiving']);
  });

  it('GET /api/v1/parishes/:id lists its churches', async () => {
    const { body } = await get('/api/v1/parishes/par_sample-our-lady');
    expect(body.churches.map((c: { id: string }) => c.id).sort()).toEqual(['ch_sample-mission', 'ch_sample-our-lady']);
  });

  it('GET /api/v1/holy-days', async () => {
    const { body } = await get('/api/v1/holy-days?year=2026&country=US');
    expect(body.holyDaysOfObligation.map((h: { date: string }) => h.date)).toEqual(['2026-01-01', '2026-11-01', '2026-12-08', '2026-12-25']);
    expect(body.feasts.easter).toBe('2026-04-05');
  });

  it('GET /api/v1/meta and unknown endpoints', async () => {
    const meta = await get('/api/v1/meta');
    expect(meta.body).toMatchObject({ codeLicense: 'Apache-2.0', dataLicense: 'ODbL-1.0', counts: { churches: 5 } });
    expect((await get('/api/v1/nope')).status).toBe(404);
  });
});
