// Typed client for the public read API (docs/API.md).

export type ServiceType = 'mass' | 'confession' | 'adoration' | 'devotion' | 'liturgy_of_the_hours';

export interface Provenance {
  source: string;
  sourceUrl: string | null;
  sourceLicense: string;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
}

export interface Church extends Provenance {
  id: string;
  parishId: string | null;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  street: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  website: string | null;
  phone: string | null;
  wheelchair: 'yes' | 'limited' | 'no' | null;
  distanceKm: number | null;
  scheduleCount?: number;
}

export interface Occurrence {
  date: string;
  startTime: string;
  endTime: string | null;
  startsAt: string;
  status: 'scheduled' | 'rescheduled';
  originalStartTime: string | null;
  exceptionReason: string | null;
  serviceType: ServiceType;
  title: string | null;
  languages: string[];
  rite: string | null;
  form: string | null;
  isVigil: boolean;
  notes: string | null;
  livestreamUrl: string | null;
  scheduleId: string;
  source: string;
  lastVerifiedAt: string | null;
  verifiedBy: string | null;
  church: Pick<Church, 'id' | 'name' | 'latitude' | 'longitude' | 'locality' | 'region' | 'timezone' | 'source'> & {
    distanceKm: number;
  };
}

export interface Schedule extends Provenance {
  id: string;
  serviceType: ServiceType;
  title: string | null;
  startTime: string;
  endTime: string | null;
  languages: string[];
  rite: string | null;
  form: string | null;
  isVigil: boolean;
  notes: string | null;
  rrule: string | null;
  liturgicalDay: string | null;
  date: string | null;
  recurrenceText: string;
}

export interface ChurchDetail {
  church: Church;
  parish: ({ name: string; website: string | null; phone: string | null } & Provenance) | null;
  diocese: { name: string } | null;
  schedules: Schedule[];
  upcomingExceptions: Array<{ date: string; kind: string; startTime: string | null; reason: string | null; scheduleId: string | null }>;
  holyDayRulesAvailable: boolean;
}

export interface ServicesQuery {
  lat: number;
  lon: number;
  radius: number;
  date: string;
  upcoming?: boolean;
  after?: string;
  before?: string;
  type?: ServiceType[];
  language?: string;
  rite?: string;
  form?: string;
}

export class ApiError extends Error {}

async function getJson<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const res = await fetch(`/api/v1${path}${qs.size ? `?${qs}` : ''}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export function fetchServices(q: ServicesQuery) {
  return getJson<{ results: Occurrence[]; truncated: boolean; churchesSearched: number }>('/services', {
    lat: q.lat.toFixed(5),
    lon: q.lon.toFixed(5),
    radius: Math.round(q.radius * 10) / 10,
    date: q.date,
    upcoming: q.upcoming || undefined,
    after: q.after,
    before: q.before,
    type: q.type?.join(','),
    language: q.language,
    rite: q.rite,
    form: q.form,
    limit: 500,
  });
}

export function fetchChurchesNear(lat: number, lon: number, radius: number) {
  return getJson<{ results: Church[] }>('/churches', {
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    radius: Math.round(radius * 10) / 10,
    limit: 500,
  });
}

export function searchChurches(text: string, near?: { lat: number; lon: number }) {
  return getJson<{ results: Church[] }>('/churches', {
    q: text,
    lat: near?.lat.toFixed(5),
    lon: near?.lon.toFixed(5),
    limit: 20,
  });
}

export function fetchChurch(id: string) {
  return getJson<ChurchDetail>(`/churches/${encodeURIComponent(id)}`);
}
