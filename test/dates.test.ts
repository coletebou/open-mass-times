import { describe, expect, it } from 'vitest';
import { addDays, eachDate, nowInZone, weekday, zonedDateTimeToIso } from '../src/calendar/dates.ts';
import { boundingBox, haversineKm } from '../src/geo.ts';

describe('dates', () => {
  it('does plain date arithmetic across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekday('2026-11-08')).toBe(0);
    expect(eachDate('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('reads the wall clock in a time zone', () => {
    const instant = new Date('2026-11-09T03:30:00Z');
    expect(nowInZone('America/New_York', instant)).toEqual({ date: '2026-11-08', time: '22:30' });
    expect(nowInZone('Asia/Manila', instant)).toEqual({ date: '2026-11-09', time: '11:30' });
  });

  it('attaches the right UTC offset, including across DST', () => {
    expect(zonedDateTimeToIso('2026-11-15', '09:00', 'America/New_York')).toBe('2026-11-15T09:00:00-05:00');
    expect(zonedDateTimeToIso('2026-07-05', '09:00', 'America/New_York')).toBe('2026-07-05T09:00:00-04:00');
    expect(zonedDateTimeToIso('2026-11-15', '09:00', 'Asia/Kolkata')).toBe('2026-11-15T09:00:00+05:30');
    expect(zonedDateTimeToIso('2026-11-15', '09:00', 'UTC')).toBe('2026-11-15T09:00:00+00:00');
  });
});

describe('geo', () => {
  it('measures great-circle distance', () => {
    // Charlotte to Raleigh, NC: about 210 km.
    expect(haversineKm(35.2271, -80.8431, 35.7796, -78.6382)).toBeCloseTo(209, -1);
  });
  it('builds a box that wraps the antimeridian', () => {
    const box = boundingBox(-17.7, 179.9, 50); // Fiji
    expect(box.minLon).toBeGreaterThan(box.maxLon);
  });
});
