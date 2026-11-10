import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataFileSchema, ScheduleSchema } from '../src/domain/model.ts';

const provenance = { source: 'community', sourceLicense: 'CC0-1.0' } as const;
const schedule = {
  id: 'sch_test-1',
  churchId: 'ch_test',
  serviceType: 'mass',
  startTime: '09:00',
  rrule: 'FREQ=WEEKLY;BYDAY=SU',
  ...provenance,
};

describe('DataFileSchema', () => {
  it('accepts the sample data file', () => {
    const data = DataFileSchema.parse(JSON.parse(readFileSync('data/sample/sample-data.json', 'utf8')));
    expect(data.churches.length).toBeGreaterThan(0);
    expect(data.churches.every((c) => c.source === 'sample')).toBe(true);
  });
});

describe('ScheduleSchema', () => {
  it('fills defaults', () => {
    const s = ScheduleSchema.parse(schedule);
    expect(s).toMatchObject({ languages: [], isVigil: false, lastVerifiedAt: null, endTime: null });
  });

  it.each([
    [{ rrule: null }, /exactly one of rrule/],
    [{ liturgicalDay: 'christmas' }, /exactly one of rrule/],
    [{ rrule: 'FREQ=WEEKLY;BYDAY=SU;INTERVAL=2' }, /INTERVAL is not supported/],
    [{ startTime: '9:00' }, /HH:MM/],
    [{ endTime: '08:00' }, /endTime must be after startTime/],
    [{ rite: 'byzantine', form: 'usus_antiquior' }, /form only applies to the Roman rite/],
    [{ serviceType: 'confession', isVigil: true }, /only a Mass/],
    [{ languages: ['English'] }, /BCP 47/],
    [{ validFrom: '2027-01-01', validUntil: '2026-01-01' }, /validUntil is before validFrom/],
    [{ source: 'masstimes' }, /source/],
  ])('rejects %j', (patch, message) => {
    const result = ScheduleSchema.safeParse({ ...schedule, ...patch });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(message);
  });
});
