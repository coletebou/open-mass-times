// Expand schedules into concrete, dated occurrences and apply exceptions.
//
// We evaluate each schedule as a yes/no test for every date in the window
// rather than generating a sequence. Windows are at most a few weeks, so this
// is cheap, and it keeps rrule, liturgical-day and one-off schedules on one
// code path.

import { eachDate } from '../calendar/dates.ts';
import { isLiturgicalDay, LITURGICAL_DAY_LABELS, type CalendarOptions } from '../calendar/liturgical.ts';
import type { Schedule, ScheduleException } from '../domain/model.ts';
import { describeRRule, matchesDate, parseRRule, type RRule } from './rrule.ts';

export type SchedulePattern = Pick<
  Schedule,
  'id' | 'churchId' | 'startTime' | 'endTime' | 'rrule' | 'liturgicalDay' | 'date' | 'validFrom' | 'validUntil'
>;

export type ExceptionPattern = Pick<
  ScheduleException,
  'churchId' | 'scheduleId' | 'date' | 'kind' | 'startTime' | 'endTime' | 'reason'
>;

export interface Occurrence {
  scheduleId: string;
  churchId: string;
  date: string;
  startTime: string;
  endTime: string | null;
  status: 'scheduled' | 'rescheduled';
  /** Set when an exception moved this occurrence. */
  originalStartTime: string | null;
  exceptionReason: string | null;
}

const rruleCache = new Map<string, RRule>();

function cachedRRule(text: string): RRule {
  let rule = rruleCache.get(text);
  if (!rule) {
    rule = parseRRule(text);
    rruleCache.set(text, rule);
  }
  return rule;
}

export function occursOn(schedule: SchedulePattern, date: string, calendar: CalendarOptions): boolean {
  if (schedule.validFrom && date < schedule.validFrom) return false;
  if (schedule.validUntil && date > schedule.validUntil) return false;
  if (schedule.date !== null) return schedule.date === date;
  if (schedule.liturgicalDay !== null) return isLiturgicalDay(schedule.liturgicalDay, date, calendar);
  if (schedule.rrule !== null) return matchesDate(cachedRRule(schedule.rrule), date);
  return false;
}

/** "Sundays", "First Fridays", "Holy days of obligation", "Only on 2026-12-24". */
export function describeRecurrence(schedule: Pick<Schedule, 'rrule' | 'liturgicalDay' | 'date' | 'validFrom' | 'validUntil'>): string {
  let text: string;
  if (schedule.date !== null) text = `Only on ${schedule.date}`;
  else if (schedule.liturgicalDay !== null) text = LITURGICAL_DAY_LABELS[schedule.liturgicalDay];
  else if (schedule.rrule !== null) text = describeRRule(cachedRRule(schedule.rrule));
  else text = 'Unscheduled';
  if (schedule.validFrom && schedule.validUntil) text += `, ${schedule.validFrom} to ${schedule.validUntil}`;
  else if (schedule.validFrom) text += `, from ${schedule.validFrom}`;
  else if (schedule.validUntil) text += `, until ${schedule.validUntil}`;
  return text;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * All occurrences of `schedules` between `from` and `to` (inclusive, local
 * dates), with `exceptions` applied. Schedules and exceptions should all
 * belong to churches that share `calendar` (same country rules).
 */
export function expandSchedules(
  schedules: readonly SchedulePattern[],
  exceptions: readonly ExceptionPattern[],
  window: { from: string; to: string; calendar: CalendarOptions },
): Occurrence[] {
  const closedChurchDays = new Set<string>();
  const bySchedule = new Map<string, ExceptionPattern>();
  for (const e of exceptions) {
    if (e.scheduleId === null) {
      if (e.kind === 'cancelled') closedChurchDays.add(`${e.churchId}|${e.date}`);
    } else {
      bySchedule.set(`${e.scheduleId}|${e.date}`, e);
    }
  }

  const out: Occurrence[] = [];
  for (const date of eachDate(window.from, window.to)) {
    for (const s of schedules) {
      if (!occursOn(s, date, window.calendar)) continue;
      if (closedChurchDays.has(`${s.churchId}|${date}`)) continue;
      const exception = bySchedule.get(`${s.id}|${date}`);
      if (exception?.kind === 'cancelled') continue;

      if (exception?.kind === 'rescheduled' && exception.startTime !== null) {
        // Keep the original duration unless the exception gives a new end.
        const shift = toMinutes(exception.startTime) - toMinutes(s.startTime);
        const endTime = exception.endTime ?? (s.endTime === null ? null : fromMinutes(toMinutes(s.endTime) + shift));
        out.push({
          scheduleId: s.id,
          churchId: s.churchId,
          date,
          startTime: exception.startTime,
          endTime,
          status: 'rescheduled',
          originalStartTime: s.startTime,
          exceptionReason: exception.reason,
        });
        continue;
      }

      out.push({
        scheduleId: s.id,
        churchId: s.churchId,
        date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: 'scheduled',
        originalStartTime: null,
        exceptionReason: null,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/**
 * Does an occurrence fall inside a local time-of-day window? Point events
 * (a Mass with no end time) must start inside it; windows such as confession
 * or adoration only need to overlap it.
 */
export function overlapsTimeWindow(o: Pick<Occurrence, 'startTime' | 'endTime'>, after?: string, before?: string): boolean {
  const start = o.startTime;
  const end = o.endTime ?? o.startTime;
  if (after !== undefined && (o.endTime === null ? start < after : end <= after)) return false;
  if (before !== undefined && start > before) return false;
  return true;
}
