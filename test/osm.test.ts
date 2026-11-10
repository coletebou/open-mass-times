import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.ts';
import { getChurch, upsert } from '../src/db/repository.ts';
import {
  catholicDenomination,
  fetchOverpass,
  importOsmElements,
  mapOsmElement,
  overpassQuery,
  type OverpassElement,
} from '../src/importers/osm.ts';

const { elements } = JSON.parse(readFileSync('test/fixtures/overpass-synthetic.json', 'utf8')) as { elements: OverpassElement[] };
const defaults = { countryCode: 'US', timezone: 'America/New_York', retrievedAt: '2026-11-09T00:00:00.000Z' };

describe('catholicDenomination', () => {
  it.each([
    ['catholic', null],
    ['roman_catholic', 'latin'],
    ['Maronite', 'maronite'],
    ['ukrainian_greek_catholic', 'ukrainian'],
    ['roman_catholic;greek_catholic', null],
    ['anglican;roman_catholic', 'latin'],
  ])('%s is Catholic (%s)', (tag, church) => {
    expect(catholicDenomination(tag)).toEqual({ churchSuiIuris: church });
  });

  it.each(['old_catholic', 'polish_catholic', 'polish_national_catholic', 'liberal_catholic', 'catholic_apostolic', 'lutheran', undefined])(
    '%s is not in communion with Rome (or not Catholic)',
    (tag) => {
      expect(catholicDenomination(tag)).toBeUndefined();
    },
  );
});

describe('mapOsmElement', () => {
  it('maps tags to a church with OSM provenance', () => {
    expect(mapOsmElement(elements[0]!, defaults)).toMatchObject({
      id: 'ch_osm-node-9000000001',
      name: 'St. Synthetic Church',
      street: '12 Fixture Ave',
      locality: 'Charlotte',
      postalCode: '28202',
      countryCode: 'US',
      churchSuiIuris: 'latin',
      website: 'https://example.org/st-synthetic',
      wheelchair: 'yes',
      wikidataId: 'Q999999901',
      osmType: 'node',
      osmId: 9000000001,
      source: 'osm',
      sourceLicense: 'ODbL-1.0',
      sourceUrl: 'https://www.openstreetmap.org/node/9000000001',
      lastVerifiedAt: null,
    });
  });

  it('uses way centers and addr:country', () => {
    expect(mapOsmElement(elements[1]!, { ...defaults, countryCode: 'CA' })).toMatchObject({ latitude: 35.22, countryCode: 'US' });
  });

  it('skips non-Catholic and unnamed churches, and drops bad URLs', () => {
    expect(mapOsmElement(elements[2]!, defaults)).toBeNull();
    expect(mapOsmElement(elements[3]!, defaults)).toBeNull();
    expect(mapOsmElement(elements[4]!, defaults)?.website).toBeNull();
  });

  it('builds a bbox query', () => {
    expect(overpassQuery({ south: 1, west: 2, north: 3, east: 4 })).toContain('(1,2,3,4)');
  });
});

describe('importOsmElements', () => {
  it('imports idempotently and never overwrites curated churches', () => {
    const db = openDatabase(':memory:');
    const first = importOsmElements(db, elements, defaults);
    expect(first).toEqual({ fetched: 6, imported: 3, keptCurated: 0, skipped: 3, withServiceTimes: 1 });

    // A maintainer verifies and renames one church; a re-import must keep that.
    const church = getChurch(db, 'ch_osm-node-9000000001')!;
    upsert(db, 'churches', { ...church, name: 'St. Synthetic (verified name)', source: 'parish_submission', sourceLicense: 'CC0-1.0' });
    const second = importOsmElements(db, elements, defaults);
    expect(second).toMatchObject({ imported: 2, keptCurated: 1 });
    expect(getChurch(db, 'ch_osm-node-9000000001')!.name).toBe('St. Synthetic (verified name)');
  });
});

describe('fetchOverpass', () => {
  const bbox = { south: 1, west: 2, north: 3, east: 4 };
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

  it('retries when Overpass is busy, then succeeds', async () => {
    const replies = [reply(429, 'rate limited', { 'retry-after': '0.001' }), reply(504, 'gateway timeout'), reply(200, { elements })];
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return replies.shift()!;
    }) as unknown as typeof fetch;
    const result = await fetchOverpass(bbox, 'https://overpass.invalid', { backoffMs: 1, fetchImpl });
    expect(result).toHaveLength(elements.length);
    expect(calls).toHaveLength(3);
    expect((calls[0]!.headers as Record<string, string>)['User-Agent']).toMatch(/open-mass-times/);
  });

  it('does not retry a bad request', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return reply(400, 'parse error');
    }) as unknown as typeof fetch;
    await expect(fetchOverpass(bbox, 'https://overpass.invalid', { backoffMs: 1, fetchImpl })).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });

  it('gives up after the last attempt', async () => {
    const fetchImpl = (async () => reply(503, 'busy')) as unknown as typeof fetch;
    await expect(fetchOverpass(bbox, 'https://overpass.invalid', { attempts: 2, backoffMs: 1, fetchImpl })).rejects.toThrow(/HTTP 503/);
  });
});
