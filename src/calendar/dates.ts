// Plain calendar-date helpers.
//
// Schedules are wall-clock times at a church ("Sundays at 09:00 in
// America/Chicago"), so almost all date math here is on plain YYYY-MM-DD
// strings with no time zone. We do the arithmetic in UTC, where days are
// always 24 hours long, and only touch real time zones at the edges
// (localDateInZone, zonedDateTimeToIso).

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, as in Date#getUTCDay

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(date: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid date "${date}", expected YYYY-MM-DD`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toUtc(date: string): Date {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(d: Date): string {
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function weekday(date: string): Weekday {
  return toUtc(date).getUTCDay() as Weekday;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The wall-clock date and time right now in an IANA time zone. */
export function nowInZone(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** UTC offset of a time zone at an instant, in minutes (e.g. -300 for EST). */
function offsetMinutes(timeZone: string, instant: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '');
  if (!m) return 0; // "GMT" alone means UTC
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * Turn a local date + wall time at a place into an ISO 8601 timestamp with
 * that place's UTC offset, e.g. ("2026-11-15", "09:00", "America/New_York")
 * -> "2026-11-15T09:00:00-05:00". Times inside a DST gap resolve to the
 * offset in force just after the transition.
 */
export function zonedDateTimeToIso(date: string, time: string, timeZone: string): string {
  const { year, month, day } = parseDate(date);
  const [hh, mm] = time === '24:00' ? [24, 0] : time.split(':').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hh ?? 0, mm ?? 0);
  // Guess with the offset at the wall time read as UTC, then correct once:
  // two passes settle every real-world transition.
  let offset = offsetMinutes(timeZone, new Date(wallAsUtc));
  offset = offsetMinutes(timeZone, new Date(wallAsUtc - offset * 60_000));
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const local = new Date(wallAsUtc);
  const localDate = fromUtc(local);
  const localTime = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  return `${localDate}T${localTime}:00${off}`;
}
