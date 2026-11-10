import { describe, expect, it } from 'vitest';
import { describeRRule, matchesDate, parseRRule } from '../src/recurrence/rrule.ts';

const matching = (rule: string, dates: string[]) => dates.filter((d) => matchesDate(parseRRule(rule), d));

describe('parseRRule', () => {
  it('parses the supported subset', () => {
    expect(parseRRule('FREQ=WEEKLY;BYDAY=SU,SA')).toEqual({ freq: 'WEEKLY', byDay: [{ weekday: 0 }, { weekday: 6 }] });
    expect(parseRRule('RRULE:FREQ=MONTHLY;BYDAY=1FR')).toEqual({ freq: 'MONTHLY', byDay: [{ weekday: 5, ordinal: 1 }] });
    expect(parseRRule('freq=yearly;bymonth=8;bymonthday=15')).toEqual({ freq: 'YEARLY', byMonth: [8], byMonthDay: [15] });
  });

  it.each([
    ['', /empty/],
    ['BYDAY=SU', /needs FREQ/],
    ['FREQ=HOURLY', /not supported/],
    ['FREQ=WEEKLY', /needs BYDAY/],
    ['FREQ=WEEKLY;BYDAY=1SU', /ordinals/],
    ['FREQ=WEEKLY;BYDAY=SU;INTERVAL=2', /INTERVAL is not supported/],
    ['FREQ=WEEKLY;BYDAY=SU;COUNT=3', /COUNT is not supported/],
    ['FREQ=MONTHLY', /needs BYDAY/],
    ['FREQ=MONTHLY;BYDAY=6FR', /ordinal/],
    ['FREQ=YEARLY;BYMONTHDAY=15', /needs BYMONTH/],
    ['FREQ=WEEKLY;BYDAY=SUN', /not a weekday/],
    ['FREQ=WEEKLY;BYDAY=SU;BYMONTH=13', /out of range/],
    ['FREQ=WEEKLY;FREQ=DAILY', /twice/],
  ])('rejects %j', (rule, message) => {
    expect(() => parseRRule(rule)).toThrow(message);
  });
});

describe('matchesDate', () => {
  // November 2026: Sun 1, 8, 15, 22, 29; Fri 6, 13, 20, 27.
  const nov2026 = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

  it('weekly on Sundays', () => {
    expect(matching('FREQ=WEEKLY;BYDAY=SU', nov2026)).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
  });

  it('first and last weekdays of the month', () => {
    expect(matching('FREQ=MONTHLY;BYDAY=1FR', nov2026)).toEqual(['2026-11-06']);
    expect(matching('FREQ=MONTHLY;BYDAY=-1SU', nov2026)).toEqual(['2026-11-29']);
    expect(matching('FREQ=MONTHLY;BYDAY=-1FR', nov2026)).toEqual(['2026-11-27']);
  });

  it('month days, including from the end', () => {
    expect(matching('FREQ=MONTHLY;BYMONTHDAY=-1', nov2026)).toEqual(['2026-11-30']);
    expect(matching('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=2', nov2026)).toEqual(['2026-11-02']);
  });

  it('seasonal filters with BYMONTH', () => {
    expect(matchesDate(parseRRule('FREQ=WEEKLY;BYDAY=SU;BYMONTH=6,7,8'), '2026-07-05')).toBe(true);
    expect(matchesDate(parseRRule('FREQ=WEEKLY;BYDAY=SU;BYMONTH=6,7,8'), '2026-11-08')).toBe(false);
  });

  it('daily', () => {
    expect(matching('FREQ=DAILY', nov2026)).toHaveLength(30);
    expect(matching('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', nov2026)).toHaveLength(21);
  });
});

describe('describeRRule', () => {
  it.each([
    ['FREQ=WEEKLY;BYDAY=SU', 'Sundays'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', 'Sundays and Saturdays'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Weekdays (Mon-Fri)'],
    ['FREQ=MONTHLY;BYDAY=1FR', 'First Fridays'],
    ['FREQ=DAILY', 'Every day'],
    ['FREQ=WEEKLY;BYDAY=SU;BYMONTH=6,7,8', 'Sundays (June-August)'],
    ['FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15', 'Every August 15'],
  ])('%s -> %s', (rule, text) => {
    expect(describeRRule(parseRRule(rule))).toBe(text);
  });
});
