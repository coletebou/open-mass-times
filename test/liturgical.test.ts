import { describe, expect, it } from 'vitest';
import {
  datesForKey,
  easterSunday,
  feastDates,
  holyDaysOfObligation,
  isLiturgicalDay,
  type CalendarOptions,
} from '../src/calendar/liturgical.ts';

const US: CalendarOptions = { countryCode: 'US' };

describe('easterSunday', () => {
  it.each([
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'], // earliest possible date
  ])('%i', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe('feastDates (US)', () => {
  const f = feastDates(2026, US);
  it('computes movable feasts from Easter', () => {
    expect(f.get('ash_wednesday')).toBe('2026-02-18');
    expect(f.get('good_friday')).toBe('2026-04-03');
    expect(f.get('pentecost')).toBe('2026-05-24');
    expect(f.get('corpus_christi')).toBe('2026-06-07'); // moved to Sunday in the US
  });
  it('moves Epiphany to the Sunday between Jan 2 and 8', () => {
    expect(f.get('epiphany')).toBe('2026-01-04');
  });
  it('moves Ascension to Sunday unless the province keeps Thursday', () => {
    expect(f.get('ascension')).toBe('2026-05-17');
    expect(feastDates(2026, { countryCode: 'US', ascensionOnThursday: true }).get('ascension')).toBe('2026-05-14');
  });
  it('moves the Immaculate Conception off a Sunday of Advent', () => {
    expect(feastDates(2024, US).get('immaculate_conception')).toBe('2024-12-09');
  });
  it('keeps universal dates where no country rules exist', () => {
    const xx = feastDates(2026, { countryCode: 'XX' });
    expect(xx.get('epiphany')).toBe('2026-01-06');
    expect(xx.get('ascension')).toBe('2026-05-14');
    expect(xx.get('corpus_christi')).toBe('2026-06-04');
  });
});

describe('holyDaysOfObligation (US)', () => {
  const dates = (year: number, opts: CalendarOptions = US) => holyDaysOfObligation(year, opts).map((h) => `${h.key}:${h.date}`);

  it('2026: Aug 15 is a Saturday, so it is not obligatory', () => {
    expect(dates(2026)).toEqual([
      'mary_mother_of_god:2026-01-01',
      'all_saints:2026-11-01',
      'immaculate_conception:2026-12-08',
      'christmas:2026-12-25',
    ]);
  });

  it('2024: Jan 1 is a Monday and Dec 8 is a Sunday of Advent', () => {
    expect(dates(2024)).toEqual(['assumption:2024-08-15', 'all_saints:2024-11-01', 'christmas:2024-12-25']);
  });

  it('includes Thursday Ascension where the province keeps it', () => {
    expect(dates(2027, { countryCode: 'US', ascensionOnThursday: true })).toContain('ascension:2027-05-06');
  });

  it('Canada: only Christmas and Mary, Mother of God', () => {
    expect(holyDaysOfObligation(2026, { countryCode: 'CA' }).map((h) => h.key)).toEqual(['mary_mother_of_god', 'christmas']);
  });

  it('returns nothing for countries without rules instead of guessing', () => {
    expect(holyDaysOfObligation(2026, { countryCode: 'XX' })).toEqual([]);
  });
});

describe('obligation keys', () => {
  it('skip Sundays and put vigils on the eve', () => {
    expect(datesForKey('holy_day_of_obligation', 2026, US)).toEqual(['2026-01-01', '2026-12-08', '2026-12-25']);
    expect(datesForKey('holy_day_of_obligation_vigil', 2026, US)).toEqual(['2025-12-31', '2026-12-07', '2026-12-24']);
  });
  it('find a vigil that falls in the previous calendar year', () => {
    expect(isLiturgicalDay('holy_day_of_obligation_vigil', '2025-12-31', US)).toBe(true);
    expect(isLiturgicalDay('holy_day_of_obligation_vigil', '2026-12-30', US)).toBe(false);
  });
});
