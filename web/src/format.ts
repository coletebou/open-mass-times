// Display formatting. Everything uses the browser's locale.

import type { ServiceType } from './api.ts';

const locale = navigator.language || 'en-US';

export const SERVICE_LABELS: Record<ServiceType, string> = {
  mass: 'Mass',
  confession: 'Confession',
  adoration: 'Adoration',
  devotion: 'Devotion',
  liturgy_of_the_hours: 'Liturgy of the Hours',
};

export const FORM_LABELS: Record<string, string> = {
  ordinary: 'Ordinary Form',
  usus_antiquior: '1962 Missal (Traditional Latin Mass)',
  divine_worship: 'Divine Worship (Ordinariate)',
};

export const RITE_LABELS: Record<string, string> = {
  roman: 'Roman',
  ambrosian: 'Ambrosian',
  mozarabic: 'Mozarabic',
  byzantine: 'Byzantine',
  alexandrian: 'Alexandrian (Coptic, Ge’ez)',
  antiochene: 'Antiochene (Maronite, Syriac, Syro-Malankara)',
  armenian: 'Armenian',
  east_syriac: 'East Syriac (Chaldean, Syro-Malabar)',
};

const languageNames = new Intl.DisplayNames([locale], { type: 'language' });
export function languageName(tag: string): string {
  try {
    return languageNames.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

const timeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export function formatTime(hhmm: string): string {
  if (hhmm === '24:00') return 'midnight';
  const [h, m] = hhmm.split(':').map(Number);
  return timeFormat.format(new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)));
}

export function formatTimeRange(start: string, end: string | null): string {
  if (start === '00:00' && end === '24:00') return 'All day';
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
export function formatDay(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const label = dayFormat.format(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)));
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

const verifiedFormat = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
export function formatVerified(iso: string | null): string {
  return iso ? `Verified ${verifiedFormat.format(new Date(iso))}` : 'Not yet verified';
}

export function formatDistance(km: number | null): string {
  if (km === null) return '';
  const miles = locale.startsWith('en-US') || locale.startsWith('en-GB');
  const value = miles ? km * 0.621371 : km;
  const unit = miles ? 'mi' : 'km';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

/** The coming Sunday (today if today is Sunday). */
export function nextSunday(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const wd = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return addDays(today, (7 - wd) % 7);
}
