// Reading and writing records. Column names are the zod field names in
// snake_case, so one generic mapper covers every table; only booleans and JSON
// columns need special handling.

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  ChurchSchema,
  DioceseSchema,
  ParishSchema,
  ScheduleExceptionSchema,
  ScheduleSchema,
  type Church,
  type DataFile,
  type Diocese,
  type Parish,
  type Schedule,
  type ScheduleException,
} from '../domain/model.ts';
import type { CalendarOptions } from '../calendar/liturgical.ts';
import { boundingBox, haversineKm } from '../geo.ts';
import { transaction } from './database.ts';

interface TableSpec {
  fields: string[];
  booleans: ReadonlySet<string>;
  json: ReadonlySet<string>;
}

const spec = (shape: object, booleans: string[] = [], json: string[] = []): TableSpec => ({
  fields: Object.keys(shape),
  booleans: new Set(booleans),
  json: new Set(json),
});

const TABLES = {
  dioceses: spec(DioceseSchema.shape, ['ascensionOnThursday']),
  parishes: spec(ParishSchema.shape),
  churches: spec(ChurchSchema.shape),
  schedules: spec(ScheduleSchema.shape, ['isVigil'], ['languages']),
  schedule_exceptions: spec(ScheduleExceptionSchema.shape),
} as const;
type TableName = keyof typeof TABLES;

const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function toRow(table: TableName, record: Record<string, unknown>): Record<string, SQLInputValue> {
  const { fields, booleans, json } = TABLES[table];
  const row: Record<string, SQLInputValue> = {};
  for (const field of fields) {
    const value = record[field];
    if (value === undefined || value === null) row[field] = null;
    else if (booleans.has(field)) row[field] = value ? 1 : 0;
    else if (json.has(field)) row[field] = JSON.stringify(value);
    else row[field] = value as SQLInputValue;
  }
  return row;
}

function fromRow<T>(table: TableName, row: Record<string, unknown>): T {
  const { fields, booleans, json } = TABLES[table];
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    const value = row[snake(field)];
    if (booleans.has(field)) record[field] = value === 1;
    else if (json.has(field)) record[field] = JSON.parse(String(value ?? '[]'));
    else record[field] = value ?? null;
  }
  return record as T;
}

/** Insert or replace a validated record. Keeps created_at, bumps updated_at. */
export function upsert(db: DatabaseSync, table: TableName, record: Record<string, unknown>): void {
  const { fields } = TABLES[table];
  const columns = fields.map(snake);
  const updates = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${fields.map((f) => `:${f}`).join(', ')})
    ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  db.prepare(sql).run(toRow(table, record));
}

/** Load a validated data file (seed data, curated imports) in one transaction. */
export function loadDataFile(db: DatabaseSync, data: DataFile): Record<string, number> {
  return transaction(db, () => {
    for (const d of data.dioceses) upsert(db, 'dioceses', d);
    for (const p of data.parishes) upsert(db, 'parishes', p);
    for (const c of data.churches) upsert(db, 'churches', c);
    for (const s of data.schedules) upsert(db, 'schedules', s);
    for (const e of data.exceptions) upsert(db, 'schedule_exceptions', e);
    return {
      dioceses: data.dioceses.length,
      parishes: data.parishes.length,
      churches: data.churches.length,
      schedules: data.schedules.length,
      exceptions: data.exceptions.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type ChurchWithDistance = Church & { distanceKm: number };

export function getChurch(db: DatabaseSync, id: string): Church | null {
  const row = db.prepare('SELECT * FROM churches WHERE id = ?').get(id);
  return row ? fromRow<Church>('churches', row) : null;
}

export function getParish(db: DatabaseSync, id: string): Parish | null {
  const row = db.prepare('SELECT * FROM parishes WHERE id = ?').get(id);
  return row ? fromRow<Parish>('parishes', row) : null;
}

export function getDiocese(db: DatabaseSync, id: string): Diocese | null {
  const row = db.prepare('SELECT * FROM dioceses WHERE id = ?').get(id);
  return row ? fromRow<Diocese>('dioceses', row) : null;
}

export function churchesOfParish(db: DatabaseSync, parishId: string): Church[] {
  return db
    .prepare('SELECT * FROM churches WHERE parish_id = ? ORDER BY name')
    .all(parishId)
    .map((r) => fromRow<Church>('churches', r));
}

/** Open churches within `radiusKm` of a point, nearest first. */
export function churchesNear(
  db: DatabaseSync,
  q: { lat: number; lon: number; radiusKm: number; limit: number },
): ChurchWithDistance[] {
  const box = boundingBox(q.lat, q.lon, q.radiusKm);
  const crossesAntimeridian = box.minLon > box.maxLon;
  const lonClause = crossesAntimeridian
    ? '(longitude >= :minLon OR longitude <= :maxLon)'
    : 'longitude BETWEEN :minLon AND :maxLon';
  const rows = db
    .prepare(
      `SELECT * FROM churches
       WHERE latitude BETWEEN :minLat AND :maxLat AND ${lonClause} AND status != 'closed'`,
    )
    .all({ ...box });
  return rows
    .map((r) => {
      const church = fromRow<Church>('churches', r);
      return { ...church, distanceKm: haversineKm(q.lat, q.lon, church.latitude, church.longitude) };
    })
    .filter((c) => c.distanceKm <= q.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, q.limit);
}

/** Turn free text into a safe FTS5 query: every word must prefix-match. */
export function toFtsQuery(text: string): string | null {
  const words = text
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replaceAll('"', '""')}"*`).join(' ');
}

/** Full-text search over church names and places. */
export function searchChurches(
  db: DatabaseSync,
  q: { text: string; limit: number; near?: { lat: number; lon: number } },
): Array<Church & { distanceKm: number | null }> {
  const match = toFtsQuery(q.text);
  if (!match) return [];
  const rows = db
    .prepare(
      `SELECT churches.* FROM churches_fts
       JOIN churches ON churches.rowid = churches_fts.rowid
       WHERE churches_fts MATCH ? AND churches.status != 'closed'
       ORDER BY rank LIMIT ?`,
    )
    .all(match, q.near ? Math.max(q.limit * 5, 100) : q.limit);
  const results = rows.map((r) => {
    const church = fromRow<Church>('churches', r);
    const distanceKm = q.near ? haversineKm(q.near.lat, q.near.lon, church.latitude, church.longitude) : null;
    return { ...church, distanceKm };
  });
  if (q.near) results.sort((a, b) => a.distanceKm! - b.distanceKm!);
  return results.slice(0, q.limit);
}

export function schedulesForChurches(db: DatabaseSync, churchIds: readonly string[]): Schedule[] {
  if (churchIds.length === 0) return [];
  return db
    .prepare(
      `SELECT * FROM schedules WHERE church_id IN (SELECT value FROM json_each(?))
       ORDER BY church_id, start_time`,
    )
    .all(JSON.stringify(churchIds))
    .map((r) => fromRow<Schedule>('schedules', r));
}

export function exceptionsForChurches(
  db: DatabaseSync,
  churchIds: readonly string[],
  from: string,
  to: string,
): ScheduleException[] {
  if (churchIds.length === 0) return [];
  return db
    .prepare(
      `SELECT * FROM schedule_exceptions
       WHERE church_id IN (SELECT value FROM json_each(?)) AND date BETWEEN ? AND ?
       ORDER BY date`,
    )
    .all(JSON.stringify(churchIds), from, to)
    .map((r) => fromRow<ScheduleException>('schedule_exceptions', r));
}

/**
 * Liturgical-calendar options per church: the country, plus the diocese's
 * Ascension rule when the church is linked to a parish in a known diocese.
 */
export function calendarOptionsForChurches(
  db: DatabaseSync,
  churches: ReadonlyArray<Pick<Church, 'id' | 'countryCode'>>,
): Map<string, CalendarOptions> {
  const ascension = new Map<string, boolean>();
  if (churches.length > 0) {
    const rows = db
      .prepare(
        `SELECT c.id AS id, d.ascension_on_thursday AS asc FROM churches c
         JOIN parishes p ON p.id = c.parish_id
         JOIN dioceses d ON d.id = p.diocese_id
         WHERE c.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(churches.map((c) => c.id)));
    for (const r of rows) ascension.set(String(r.id), r.asc === 1);
  }
  return new Map(
    churches.map((c) => [c.id, { countryCode: c.countryCode, ascensionOnThursday: ascension.get(c.id) ?? false }]),
  );
}

/** The box around every open church, or null when there are none. */
export function churchBounds(db: DatabaseSync): { south: number; west: number; north: number; east: number } | null {
  const row = db
    .prepare(
      `SELECT min(latitude) AS south, min(longitude) AS west, max(latitude) AS north, max(longitude) AS east
       FROM churches WHERE status != 'closed'`,
    )
    .get();
  if (!row || row.south === null) return null;
  return { south: Number(row.south), west: Number(row.west), north: Number(row.north), east: Number(row.east) };
}

export function countRecords(db: DatabaseSync): Record<string, number> {
  const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0);
  return {
    dioceses: count('dioceses'),
    parishes: count('parishes'),
    churches: count('churches'),
    schedules: count('schedules'),
    exceptions: count('schedule_exceptions'),
  };
}
