// OpenStreetMap importer: church locations (not schedules) from Overpass.
//
// OSM data is © OpenStreetMap contributors under the ODbL 1.0. Importing it
// makes our database a derivative database, which is why the whole dataset is
// published under the ODbL too (see SOURCES.md). Imported churches keep their
// OSM type/id so re-imports update them in place and we can link back.

import type { DatabaseSync } from 'node:sqlite';
import { ChurchSchema, type Church } from '../domain/model.ts';
import { transaction } from '../db/database.ts';
import { upsert } from '../db/repository.ts';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'open-mass-times/0.1 (+https://github.com/coletebou/open-mass-times)';

/**
 * OSM `denomination` values for churches in full communion with Rome, and the
 * Church sui iuris each implies (null = Catholic, but which Church is unknown).
 * Values come from taginfo (2026-11). Several look Catholic but are not in
 * communion with Rome, and are deliberately absent: old_catholic,
 * polish_catholic (the Old Catholic "Polish Catholic Church"),
 * polish_national_catholic, liberal_catholic, catholic_apostolic,
 * traditionalist_catholic, folk_catholicism.
 */
export const CATHOLIC_DENOMINATIONS: Readonly<Record<string, string | null>> = {
  catholic: null,
  roman_catholic: 'latin',
  latin_catholic: 'latin',
  latin: 'latin',
  greek_catholic: null, // Byzantine, but Ukrainian/Ruthenian/Romanian/... is not said
  byzantine_catholic: null,
  ukrainian_greek_catholic: 'ukrainian',
  ukrainian_catholic: 'ukrainian',
  maronite: 'maronite',
  'syro-malabar_catholic': 'syro_malabar',
  syro_malabar_catholic: 'syro_malabar',
  armenian_catholic: 'armenian',
  syriac_catholic: 'syriac',
  chaldean_catholic: 'chaldean',
  coptic_catholic: 'coptic',
  melkite: 'melkite',
  melkite_greek_catholic: 'melkite',
};

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function overpassQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  // A broad server-side filter; mapOsmElement applies the exact allowlist.
  return `[out:json][timeout:120];
nwr["amenity"="place_of_worship"]["religion"="christian"]["denomination"~"catholic|maronite|melkite|latin",i](${south},${west},${north},${east});
out center tags;`;
}

/** The Church sui iuris for a denomination tag, or undefined if not Catholic. */
export function catholicDenomination(tag: string | undefined): { churchSuiIuris: string | null } | undefined {
  if (!tag) return undefined;
  // Shared churches are tagged like "roman_catholic;greek_catholic".
  const values = tag.split(';').map((v) => v.trim().toLowerCase());
  const known = values.filter((v) => v in CATHOLIC_DENOMINATIONS);
  if (known.length === 0) return undefined;
  // Several Catholic Churches share the building: don't pick one.
  return { churchSuiIuris: known.length === 1 ? (CATHOLIC_DENOMINATIONS[known[0]!] ?? null) : null };
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ImportDefaults {
  countryCode: string;
  timezone: string;
  retrievedAt: string;
}

/** Map one Overpass element to a church record, or null if it should be skipped. */
export function mapOsmElement(el: OverpassElement, defaults: ImportDefaults): Church | null {
  const tags = el.tags ?? {};
  const denomination = catholicDenomination(tags.denomination);
  if (!denomination || tags.amenity !== 'place_of_worship') return null;
  const name = tags.name ?? tags['name:en'];
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null;
  const country = tags['addr:country']?.toUpperCase();
  const wheelchair = tags.wheelchair;
  const wikidata = tags.wikidata;

  const result = ChurchSchema.safeParse({
    id: `ch_osm-${el.type}-${el.id}`,
    name,
    latitude: lat,
    longitude: lon,
    timezone: defaults.timezone,
    churchSuiIuris: denomination.churchSuiIuris,
    street,
    locality: tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'] ?? tags['addr:hamlet'] ?? null,
    region: tags['addr:state'] ?? tags['addr:province'] ?? null,
    postalCode: tags['addr:postcode'] ?? null,
    countryCode: country && /^[A-Z]{2}$/.test(country) ? country : defaults.countryCode,
    website: httpUrl(tags.website ?? tags['contact:website']),
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    wheelchair: wheelchair === 'yes' || wheelchair === 'limited' || wheelchair === 'no' ? wheelchair : null,
    osmType: el.type,
    osmId: el.id,
    wikidataId: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : null,
    source: 'osm',
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    sourceRef: `${el.type}/${el.id}`,
    sourceLicense: 'ODbL-1.0',
    retrievedAt: defaults.retrievedAt,
  });
  return result.success ? result.data : null;
}

// Overpass sheds load with 429 (rate limit) and 502-504 (busy/timeout).
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export async function fetchOverpass(
  bbox: BBox,
  endpoint = OVERPASS_URL,
  opts: { attempts?: number; backoffMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<OverpassElement[]> {
  const attempts = opts.attempts ?? 3;
  const backoffMs = opts.backoffMs ?? 15_000;
  const doFetch = opts.fetchImpl ?? fetch;
  for (let attempt = 1; ; attempt++) {
    let retryAfterMs = backoffMs * attempt;
    let failure: Error;
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: overpassQuery(bbox) }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
        if (body.remark?.includes('error')) throw new Error(`Overpass: ${body.remark}`);
        return body.elements ?? [];
      }
      failure = new Error(`Overpass returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!RETRYABLE_STATUS.has(res.status)) throw failure;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
    } catch (err) {
      // Timeouts and network errors are worth retrying; anything else is not.
      const name = (err as Error).name;
      if (name !== 'TimeoutError' && name !== 'TypeError') throw err;
      failure = err as Error;
    }
    if (attempt >= attempts) throw failure;
    console.warn(`${failure.message.split('\n')[0]}; retrying in ${Math.round(retryAfterMs / 1000)}s (${attempt}/${attempts - 1})`);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }
}

export interface ImportStats {
  fetched: number;
  imported: number;
  /** Churches already curated from another source: left untouched. */
  keptCurated: number;
  skipped: number;
  /** Elements carrying an OSM service_times tag (future: draft schedules). */
  withServiceTimes: number;
}

export function importOsmElements(db: DatabaseSync, elements: OverpassElement[], defaults: ImportDefaults): ImportStats {
  const stats: ImportStats = { fetched: elements.length, imported: 0, keptCurated: 0, skipped: 0, withServiceTimes: 0 };
  const findByOsm = db.prepare('SELECT id, source FROM churches WHERE osm_type = ? AND osm_id = ?');
  const findByWikidata = db.prepare('SELECT id FROM churches WHERE wikidata_id = ?');
  transaction(db, () => {
    for (const el of elements) {
      const church = mapOsmElement(el, defaults);
      if (!church) {
        stats.skipped++;
        continue;
      }
      if (el.tags?.service_times) stats.withServiceTimes++;
      const existing = findByOsm.get(el.type, el.id);
      if (existing && existing.source !== 'osm') {
        stats.keptCurated++;
        continue;
      }
      const id = existing ? String(existing.id) : church.id;
      // The same building is sometimes mapped twice (node + way) with one Wikidata id.
      const wikidataOwner = church.wikidataId ? findByWikidata.get(church.wikidataId) : undefined;
      const wikidataId = wikidataOwner && wikidataOwner.id !== id ? null : church.wikidataId;
      upsert(db, 'churches', { ...church, id, wikidataId });
      stats.imported++;
    }
  });
  return stats;
}
