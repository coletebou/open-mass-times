// Liturgical calendar: the dates schedules can attach to instead of a weekly
// pattern ("holy days of obligation at 07:00 and 19:00", "Ash Wednesday 12:10").
//
// Two kinds of keys:
//  - Feast keys (ash_wednesday, christmas, assumption, ...): the day the feast
//    is celebrated in a country, whether or not it is a day of obligation.
//  - Obligation keys (holy_day_of_obligation, holy_day_of_obligation_vigil):
//    the holy days of obligation that fall Monday-Saturday, plus the evening
//    before each. On a Sunday the obligation is already met by the Sunday
//    schedule, so these never expand onto a Sunday.
//
// Which feasts are obligatory, and which are moved to a Sunday, is set by each
// bishops' conference (canon 1246 §2). Countries without rules here get every
// feast key, but no obligation keys, rather than a guess. Adding a country is a
// good first issue: see ROADMAP.md.

import { addDays, formatDate, parseDate, weekday } from './dates.ts';

export const LITURGICAL_DAY_KEYS = [
  'holy_day_of_obligation',
  'holy_day_of_obligation_vigil',
  'mary_mother_of_god', // Jan 1
  'epiphany',
  'ash_wednesday',
  'palm_sunday',
  'holy_thursday', // Mass of the Lord's Supper
  'good_friday', // Celebration of the Lord's Passion
  'holy_saturday',
  'easter_vigil', // same date as holy_saturday; the schedule's time sets it apart
  'easter',
  'ascension',
  'pentecost',
  'trinity_sunday',
  'corpus_christi',
  'assumption', // Aug 15
  'all_saints', // Nov 1
  'all_souls', // Nov 2
  'immaculate_conception', // Dec 8
  'christmas_eve', // Dec 24, for vigil and midnight Masses
  'christmas', // Dec 25
] as const;
export type LiturgicalDayKey = (typeof LITURGICAL_DAY_KEYS)[number];

export const LITURGICAL_DAY_LABELS: Record<LiturgicalDayKey, string> = {
  holy_day_of_obligation: 'Holy days of obligation',
  holy_day_of_obligation_vigil: 'Vigils of holy days of obligation',
  mary_mother_of_god: 'Solemnity of Mary, Mother of God',
  epiphany: 'Epiphany',
  ash_wednesday: 'Ash Wednesday',
  palm_sunday: 'Palm Sunday',
  holy_thursday: 'Holy Thursday',
  good_friday: 'Good Friday',
  holy_saturday: 'Holy Saturday',
  easter_vigil: 'Easter Vigil',
  easter: 'Easter Sunday',
  ascension: 'Ascension',
  pentecost: 'Pentecost',
  trinity_sunday: 'Trinity Sunday',
  corpus_christi: 'Corpus Christi',
  assumption: 'Assumption',
  all_saints: 'All Saints',
  all_souls: 'All Souls',
  immaculate_conception: 'Immaculate Conception',
  christmas_eve: 'Christmas Eve',
  christmas: 'Christmas',
};

export interface CalendarOptions {
  countryCode: string;
  /** US only: the province keeps Ascension on Thursday (else it moves to Sunday). */
  ascensionOnThursday?: boolean;
}

export interface HolyDay {
  key: LiturgicalDayKey;
  name: string;
  date: string;
}

/**
 * Gregorian Easter Sunday (the anonymous "Meeus/Jones/Butcher" computus).
 * Eastern Catholic Churches that keep the Julian Paschalion need a separate
 * rule; see ROADMAP.md.
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatDate(year, month, day);
}

interface CountryRules {
  /** Epiphany moved to the Sunday between Jan 2 and Jan 8. */
  epiphanyOnSunday: boolean;
  /** Corpus Christi moved to the following Sunday. */
  corpusChristiOnSunday: boolean;
  ascensionOnSunday: (opts: CalendarOptions) => boolean;
  /** Holy days of obligation for a year, given the feast dates. */
  obligations: (year: number, feasts: Map<LiturgicalDayKey, string>, opts: CalendarOptions) => LiturgicalDayKey[];
}

const SATURDAY = 6;
const MONDAY = 1;

// United States: USCCB complementary norm on canon 1246 (approved 1991,
// https://www.usccb.org/prayer-and-worship/liturgical-year/holy-days-of-obligation).
// Jan 1, Aug 15 and Nov 1 are not obligatory when they fall on a Saturday or
// Monday. The Immaculate Conception (patronal feast of the US) always is,
// except that when Dec 8 is a Sunday of Advent the solemnity moves to Monday,
// Dec 9, and the obligation does not move with it.
const US: CountryRules = {
  epiphanyOnSunday: true,
  corpusChristiOnSunday: true,
  ascensionOnSunday: (opts) => !opts.ascensionOnThursday,
  obligations: (_year, feasts, opts) => {
    const keys: LiturgicalDayKey[] = ['christmas', 'immaculate_conception'];
    for (const key of ['mary_mother_of_god', 'assumption', 'all_saints'] as const) {
      const wd = weekday(feasts.get(key)!);
      if (wd !== SATURDAY && wd !== MONDAY) keys.push(key);
    }
    if (opts.ascensionOnThursday) keys.push('ascension');
    return keys.filter((k) => k !== 'immaculate_conception' || feasts.get(k)!.endsWith('-12-08'));
  },
};

// Canada: CCCB norm; Christmas and Mary, Mother of God are the only holy days
// of obligation. Epiphany, Ascension and Corpus Christi move to Sunday.
const CA: CountryRules = {
  epiphanyOnSunday: true,
  corpusChristiOnSunday: true,
  ascensionOnSunday: () => true,
  obligations: () => ['christmas', 'mary_mother_of_god'],
};

const COUNTRY_RULES: Record<string, CountryRules> = { US, CA };

export function supportsObligations(countryCode: string): boolean {
  return countryCode in COUNTRY_RULES;
}

/** The date of every feast key (not the obligation keys) in a given year. */
export function feastDates(year: number, opts: CalendarOptions): Map<LiturgicalDayKey, string> {
  const rules = COUNTRY_RULES[opts.countryCode];
  const easter = easterSunday(year);
  const fixed = (month: number, day: number) => formatDate(year, month, day);
  const f = new Map<LiturgicalDayKey, string>();

  f.set('mary_mother_of_god', fixed(1, 1));
  if (rules?.epiphanyOnSunday) {
    // The Sunday between January 2 and January 8.
    const jan2 = fixed(1, 2);
    f.set('epiphany', addDays(jan2, (7 - weekday(jan2)) % 7));
  } else {
    f.set('epiphany', fixed(1, 6));
  }
  f.set('ash_wednesday', addDays(easter, -46));
  f.set('palm_sunday', addDays(easter, -7));
  f.set('holy_thursday', addDays(easter, -3));
  f.set('good_friday', addDays(easter, -2));
  f.set('holy_saturday', addDays(easter, -1));
  f.set('easter_vigil', addDays(easter, -1));
  f.set('easter', easter);
  f.set('ascension', addDays(easter, rules?.ascensionOnSunday(opts) ? 42 : 39));
  f.set('pentecost', addDays(easter, 49));
  f.set('trinity_sunday', addDays(easter, 56));
  f.set('corpus_christi', addDays(easter, rules?.corpusChristiOnSunday ? 63 : 60));
  f.set('assumption', fixed(8, 15));
  f.set('all_saints', fixed(11, 1));
  f.set('all_souls', fixed(11, 2));
  // A Sunday of Advent outranks the Immaculate Conception, which moves to Monday.
  const dec8 = fixed(12, 8);
  f.set('immaculate_conception', weekday(dec8) === 0 ? addDays(dec8, 1) : dec8);
  f.set('christmas_eve', fixed(12, 24));
  f.set('christmas', fixed(12, 25));
  return f;
}

/** Holy days of obligation in a year, including any that fall on a Sunday. */
export function holyDaysOfObligation(year: number, opts: CalendarOptions): HolyDay[] {
  const rules = COUNTRY_RULES[opts.countryCode];
  if (!rules) return [];
  const feasts = feastDates(year, opts);
  return rules
    .obligations(year, feasts, opts)
    .map((key) => ({ key, name: LITURGICAL_DAY_LABELS[key], date: feasts.get(key)! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Every date in `year` that a liturgical-day key expands to. Obligation keys
 * skip Sundays (see the file comment); vigils are the day before.
 */
export function datesForKey(key: LiturgicalDayKey, year: number, opts: CalendarOptions): string[] {
  if (key === 'holy_day_of_obligation' || key === 'holy_day_of_obligation_vigil') {
    const weekdayHolyDays = holyDaysOfObligation(year, opts)
      .map((h) => h.date)
      .filter((d) => weekday(d) !== 0);
    return key === 'holy_day_of_obligation' ? weekdayHolyDays : weekdayHolyDays.map((d) => addDays(d, -1));
  }
  const date = feastDates(year, opts).get(key);
  return date ? [date] : [];
}

const datesCache = new Map<string, string[]>();

function cachedDatesForKey(key: LiturgicalDayKey, year: number, opts: CalendarOptions): string[] {
  const cacheKey = `${key}|${year}|${opts.countryCode}|${opts.ascensionOnThursday ? 1 : 0}`;
  let dates = datesCache.get(cacheKey);
  if (!dates) {
    dates = datesForKey(key, year, opts);
    datesCache.set(cacheKey, dates);
  }
  return dates;
}

/** True when `date` is the given liturgical day. Handles vigils that cross a year boundary. */
export function isLiturgicalDay(key: LiturgicalDayKey, date: string, opts: CalendarOptions): boolean {
  const { year } = parseDate(date);
  if (cachedDatesForKey(key, year, opts).includes(date)) return true;
  // A vigil on Dec 31 belongs to next year's Jan 1 holy day.
  return key === 'holy_day_of_obligation_vigil' && cachedDatesForKey(key, year + 1, opts).includes(date);
}
