// A deliberately small subset of RFC 5545 RRULE.
//
// Parish schedules are simple ("Sundays", "weekdays", "first Fridays",
// "Sundays in June-August"), so instead of a full iCalendar engine we accept
// only the parts we can evaluate as a plain yes/no test on a date, and reject
// everything else loudly. An unsupported rule is a validation error, never a
// silently wrong schedule.
//
// Supported:
//   FREQ=DAILY | WEEKLY | MONTHLY | YEARLY      (required)
//   BYDAY=SU,MO,...                             any FREQ; ordinals (1FR, -1SU)
//                                               only with MONTHLY or YEARLY+BYMONTH
//   BYMONTH=1..12                               any FREQ (seasonal schedules)
//   BYMONTHDAY=1..31 or -1..-31                 MONTHLY or YEARLY
// Not supported: INTERVAL, COUNT, UNTIL, BYSETPOS, BYWEEKNO, BYYEARDAY, WKST,
// BYHOUR and friends. Use the schedule's validFrom/validUntil for bounds.

import { daysInMonth, parseDate, weekday, type Weekday } from '../calendar/dates.ts';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ByDay {
  weekday: Weekday;
  /** 1..5 = nth in the month, -1..-5 = nth from the end; undefined = every. */
  ordinal?: number;
}

export interface RRule {
  freq: Frequency;
  byDay?: ByDay[];
  byMonth?: number[];
  byMonthDay?: number[];
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const FREQUENCIES: readonly Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

function parseIntList(name: string, value: string, min: number, max: number, allowNegative = false): number[] {
  return value.split(',').map((raw) => {
    if (!/^[+-]?\d+$/.test(raw)) throw new Error(`${name}: "${raw}" is not a number`);
    const n = Number(raw);
    const abs = Math.abs(n);
    if (abs < min || abs > max || (n < 0 && !allowNegative)) {
      throw new Error(`${name}: ${raw} is out of range`);
    }
    return n;
  });
}

function parseByDay(value: string): ByDay[] {
  return value.split(',').map((raw) => {
    const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(raw);
    if (!m) throw new Error(`BYDAY: "${raw}" is not a weekday such as SU or 1FR`);
    const day: ByDay = { weekday: WEEKDAY_CODES.indexOf(m[2] as (typeof WEEKDAY_CODES)[number]) as Weekday };
    if (m[1] !== undefined) {
      const ordinal = Number(m[1]);
      if (ordinal === 0 || Math.abs(ordinal) > 5) throw new Error(`BYDAY: ordinal in "${raw}" must be 1..5 or -1..-5`);
      day.ordinal = ordinal;
    }
    return day;
  });
}

/** Parse and validate an RRULE string. Throws with a human-readable message. */
export function parseRRule(input: string): RRule {
  const text = input.trim().replace(/^RRULE:/i, '');
  if (text === '') throw new Error('RRULE is empty');
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    const [key, value, extra] = part.split('=');
    if (!key || value === undefined || value === '' || extra !== undefined) {
      throw new Error(`RRULE part "${part}" must look like KEY=VALUE`);
    }
    const upper = key.toUpperCase();
    if (parts.has(upper)) throw new Error(`RRULE has ${upper} twice`);
    parts.set(upper, value.toUpperCase());
  }

  const freq = parts.get('FREQ');
  if (!freq) throw new Error('RRULE needs FREQ');
  if (!FREQUENCIES.includes(freq as Frequency)) {
    throw new Error(`FREQ=${freq} is not supported (use DAILY, WEEKLY, MONTHLY or YEARLY)`);
  }
  const rule: RRule = { freq: freq as Frequency };

  for (const [key, value] of parts) {
    switch (key) {
      case 'FREQ':
        break;
      case 'BYDAY':
        rule.byDay = parseByDay(value);
        break;
      case 'BYMONTH':
        rule.byMonth = parseIntList('BYMONTH', value, 1, 12);
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = parseIntList('BYMONTHDAY', value, 1, 31, true);
        break;
      default:
        throw new Error(`RRULE part ${key} is not supported; see src/recurrence/rrule.ts`);
    }
  }

  const hasOrdinal = rule.byDay?.some((d) => d.ordinal !== undefined) ?? false;
  switch (rule.freq) {
    case 'WEEKLY':
      if (!rule.byDay) throw new Error('FREQ=WEEKLY needs BYDAY (e.g. BYDAY=SU)');
      if (hasOrdinal) throw new Error('FREQ=WEEKLY cannot use ordinals like 1FR; use FREQ=MONTHLY');
      if (rule.byMonthDay) throw new Error('FREQ=WEEKLY cannot use BYMONTHDAY');
      break;
    case 'DAILY':
      if (hasOrdinal) throw new Error('FREQ=DAILY cannot use ordinals like 1FR');
      if (rule.byMonthDay) throw new Error('FREQ=DAILY cannot use BYMONTHDAY; use FREQ=MONTHLY');
      break;
    case 'MONTHLY':
      if (!rule.byDay && !rule.byMonthDay) throw new Error('FREQ=MONTHLY needs BYDAY (e.g. 1FR) or BYMONTHDAY');
      break;
    case 'YEARLY':
      if (!rule.byMonth) throw new Error('FREQ=YEARLY needs BYMONTH');
      if (!rule.byDay && !rule.byMonthDay) throw new Error('FREQ=YEARLY needs BYDAY or BYMONTHDAY');
      break;
  }
  return rule;
}

/** Does the rule produce an occurrence on this date? */
export function matchesDate(rule: RRule, date: string): boolean {
  const { year, month, day } = parseDate(date);
  if (rule.byMonth && !rule.byMonth.includes(month)) return false;

  const monthLength = daysInMonth(year, month);
  if (rule.byMonthDay) {
    const hit = rule.byMonthDay.some((md) => (md > 0 ? md === day : monthLength + md + 1 === day));
    if (!hit) return false;
  }

  if (rule.byDay) {
    const wd = weekday(date);
    const nthFromStart = Math.ceil(day / 7); // 1..5
    const nthFromEnd = -Math.ceil((monthLength - day + 1) / 7); // -1..-5
    const hit = rule.byDay.some(
      (d) => d.weekday === wd && (d.ordinal === undefined || d.ordinal === nthFromStart || d.ordinal === nthFromEnd),
    );
    if (!hit) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Human-readable descriptions ("First Fridays", "Sundays (June-August)")
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const ORDINALS: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth', [-1]: 'Last', [-2]: 'Second-to-last' };

function listJoin(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function describeDays(days: ByDay[]): string {
  const plain = days.filter((d) => d.ordinal === undefined).map((d) => d.weekday);
  const sorted = [...plain].sort();
  const parts: string[] = [];
  if (sorted.join() === '1,2,3,4,5') parts.push('Weekdays (Mon-Fri)');
  else if (sorted.join() === '1,2,3,4,5,6') parts.push('Monday-Saturday');
  else if (sorted.length === 7) parts.push('Every day');
  else if (sorted.length) parts.push(listJoin(sorted.map((d) => `${DAY_NAMES[d]}s`)));
  for (const d of days.filter((x) => x.ordinal !== undefined)) {
    parts.push(`${ORDINALS[d.ordinal!] ?? `#${d.ordinal}`} ${DAY_NAMES[d.weekday]}s`);
  }
  return listJoin(parts);
}

function describeMonths(months: number[]): string {
  const sorted = [...months].sort((a, b) => a - b);
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1]! + 1);
  if (contiguous && sorted.length > 2) return `${MONTH_NAMES[sorted[0]! - 1]}-${MONTH_NAMES[sorted.at(-1)! - 1]}`;
  return listJoin(sorted.map((m) => MONTH_NAMES[m - 1]!));
}

function describeMonthDay(d: number): string {
  if (d === -1) return 'the last day';
  return d < 0 ? `the ${-d}th-to-last day` : `day ${d}`;
}

export function describeRRule(rule: RRule): string {
  // "Every August 15"
  if (rule.freq === 'YEARLY' && rule.byMonthDay && !rule.byDay && rule.byMonth?.length === 1) {
    return `Every ${MONTH_NAMES[rule.byMonth[0]! - 1]} ${rule.byMonthDay.join(', ')}`;
  }
  let base = 'Every day';
  if (rule.byDay) base = describeDays(rule.byDay);
  else if (rule.byMonthDay) base = `Monthly on ${listJoin(rule.byMonthDay.map(describeMonthDay))}`;
  return rule.byMonth ? `${base} (${describeMonths(rule.byMonth)})` : base;
}
