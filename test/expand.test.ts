import { describe, expect, it } from 'vitest';
import { describeRecurrence, expandSchedules, overlapsTimeWindow, type SchedulePattern } from '../src/recurrence/expand.ts';

const US = { countryCode: 'US' };
const base: Omit<SchedulePattern, 'id' | 'startTime'> = {
  churchId: 'ch_test',
  endTime: null,
  rrule: null,
  liturgicalDay: null,
  date: null,
  validFrom: null,
  validUntil: null,
};

describe('expandSchedules', () => {
  const sunday9: SchedulePattern = { ...base, id: 'sch_sun9', startTime: '09:00', rrule: 'FREQ=WEEKLY;BYDAY=SU' };
  const weekday: SchedulePattern = { ...base, id: 'sch_wk', startTime: '12:10', endTime: '12:40', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' };
  const holyDay: SchedulePattern = { ...base, id: 'sch_hdo', startTime: '19:00', liturgicalDay: 'holy_day_of_obligation' };
  const oneOff: SchedulePattern = { ...base, id: 'sch_one', startTime: '15:00', date: '2026-12-09' };

  it('expands rrule, liturgical and one-off schedules in date/time order', () => {
    const out = expandSchedules([sunday9, weekday, holyDay, oneOff], [], { from: '2026-12-06', to: '2026-12-09', calendar: US });
    expect(out.map((o) => `${o.date} ${o.startTime} ${o.scheduleId}`)).toEqual([
      '2026-12-06 09:00 sch_sun9',
      '2026-12-07 12:10 sch_wk',
      '2026-12-08 12:10 sch_wk',
      '2026-12-08 19:00 sch_hdo', // Immaculate Conception, a Tuesday
      '2026-12-09 12:10 sch_wk',
      '2026-12-09 15:00 sch_one',
    ]);
  });

  it('respects validFrom / validUntil', () => {
    const lent = { ...weekday, id: 'sch_lent', validFrom: '2027-02-10', validUntil: '2027-02-12' };
    const out = expandSchedules([lent], [], { from: '2027-02-08', to: '2027-02-15', calendar: US });
    expect(out.map((o) => o.date)).toEqual(['2027-02-10', '2027-02-11', '2027-02-12']);
  });

  it('cancels and reschedules single occurrences, keeping the duration', () => {
    const out = expandSchedules(
      [weekday],
      [
        { churchId: 'ch_test', scheduleId: 'sch_wk', date: '2026-11-25', kind: 'cancelled', startTime: null, endTime: null, reason: null },
        { churchId: 'ch_test', scheduleId: 'sch_wk', date: '2026-11-26', kind: 'rescheduled', startTime: '09:00', endTime: null, reason: 'Thanksgiving' },
      ],
      { from: '2026-11-24', to: '2026-11-26', calendar: US },
    );
    expect(out).toMatchObject([
      { date: '2026-11-24', startTime: '12:10', status: 'scheduled' },
      { date: '2026-11-26', startTime: '09:00', endTime: '09:30', status: 'rescheduled', originalStartTime: '12:10', exceptionReason: 'Thanksgiving' },
    ]);
  });

  it('a church-wide cancellation removes everything that day', () => {
    const out = expandSchedules(
      [sunday9, weekday],
      [{ churchId: 'ch_test', scheduleId: null, date: '2026-11-15', kind: 'cancelled', startTime: null, endTime: null, reason: 'Closed' }],
      { from: '2026-11-15', to: '2026-11-16', calendar: US },
    );
    expect(out.map((o) => o.date)).toEqual(['2026-11-16']);
  });
});

describe('overlapsTimeWindow', () => {
  it('point events must start inside the window', () => {
    expect(overlapsTimeWindow({ startTime: '09:00', endTime: null }, '08:00', '10:00')).toBe(true);
    expect(overlapsTimeWindow({ startTime: '07:00', endTime: null }, '08:00')).toBe(false);
  });
  it('windows only need to overlap', () => {
    expect(overlapsTimeWindow({ startTime: '00:00', endTime: '24:00' }, '18:00', '20:00')).toBe(true);
    expect(overlapsTimeWindow({ startTime: '15:30', endTime: '16:30' }, '16:30')).toBe(false);
    expect(overlapsTimeWindow({ startTime: '15:30', endTime: '16:30' }, '16:00')).toBe(true);
  });
});

describe('describeRecurrence', () => {
  it('describes each kind of schedule', () => {
    expect(describeRecurrence({ rrule: 'FREQ=MONTHLY;BYDAY=1FR', liturgicalDay: null, date: null, validFrom: null, validUntil: null })).toBe('First Fridays');
    expect(describeRecurrence({ rrule: null, liturgicalDay: 'ash_wednesday', date: null, validFrom: null, validUntil: null })).toBe('Ash Wednesday');
    expect(describeRecurrence({ rrule: null, liturgicalDay: null, date: '2026-12-24', validFrom: null, validUntil: null })).toBe('Only on 2026-12-24');
    expect(
      describeRecurrence({ rrule: 'FREQ=WEEKLY;BYDAY=FR', liturgicalDay: null, date: null, validFrom: '2027-02-10', validUntil: '2027-03-26' }),
    ).toBe('Fridays, 2027-02-10 to 2027-03-26');
  });
});
