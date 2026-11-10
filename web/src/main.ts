// Open Mass Times web app: a map, a list of service times, and filters.
//
// State lives in the URL (center, zoom, filters), so every view is a
// shareable link. The map drives the search area: whenever it settles, we ask
// the API for services within the visible area (up to 100 km).

import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import {
  fetchChurch,
  fetchChurchesNear,
  fetchServices,
  searchChurches,
  type Church,
  type ChurchDetail,
  type Occurrence,
  type ServiceType,
} from './api.ts';
import { $, h } from './dom.ts';
import {
  FORM_LABELS,
  RITE_LABELS,
  SERVICE_LABELS,
  addDays,
  formatDay,
  formatDistance,
  formatTime,
  formatTimeRange,
  formatVerified,
  languageName,
  localToday,
  nextSunday,
} from './format.ts';

const REPO = 'https://github.com/coletebou/open-mass-times';
const MAX_RADIUS_KM = 100;
const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const LANGUAGES = ['en', 'es', 'la', 'vi', 'pl', 'pt', 'fr', 'it', 'de', 'ko', 'tl', 'zh', 'ar', 'uk', 'hu', 'sk', 'hr', 'ga', 'cu'];
const TIME_WINDOWS: Record<string, { after?: string; before?: string }> = {
  any: {},
  morning: { before: '11:59' },
  afternoon: { after: '12:00', before: '16:59' },
  evening: { after: '17:00' },
};

type Day = 'today' | 'tomorrow' | 'sunday' | 'date';

interface Filters {
  day: Day;
  date: string;
  time: string;
  upcoming: boolean;
  types: ServiceType[];
  language: string;
  rite: string;
  form: string;
}

// ---------------------------------------------------------------------------
// State <-> URL
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const today = localToday();

const filters: Filters = {
  day: (params.get('day') as Day | null) ?? 'today',
  date: params.get('date') ?? today,
  time: params.get('time') ?? 'any',
  upcoming: params.has('upcoming') ? params.get('upcoming') === '1' : true,
  types: (params.get('types')?.split(',') as ServiceType[] | undefined) ?? ['mass', 'confession', 'adoration'],
  language: params.get('lang') ?? '',
  rite: params.get('rite') ?? '',
  form: params.get('form') ?? '',
};

function selectedDate(): string {
  if (filters.day === 'today') return today;
  if (filters.day === 'tomorrow') return addDays(today, 1);
  if (filters.day === 'sunday') return nextSunday(today);
  return filters.date;
}

function writeUrl() {
  const c = map.getCenter();
  const p = new URLSearchParams({ lat: c.lat.toFixed(4), lon: c.lng.toFixed(4), z: String(map.getZoom()) });
  if (filters.day !== 'today') p.set('day', filters.day);
  if (filters.day === 'date') p.set('date', filters.date);
  if (filters.time !== 'any') p.set('time', filters.time);
  if (!filters.upcoming) p.set('upcoming', '0');
  p.set('types', filters.types.join(','));
  if (filters.language) p.set('lang', filters.language);
  if (filters.rite) p.set('rite', filters.rite);
  if (filters.form) p.set('form', filters.form);
  history.replaceState(null, '', `?${p}`);
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

const map = L.map('map', { zoomControl: true, worldCopyJump: true });
L.tileLayer(TILE_URL, {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
    'times &copy; Open Mass Times contributors (ODbL)',
}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const markers = new Map<string, L.CircleMarker>();

const hint = new L.Control({ position: 'topright' });
hint.onAdd = () => h('div', { class: 'map-hint', hidden: true });
hint.addTo(map);
const hintEl = hint.getContainer()!;

function setHint(text: string | null) {
  hintEl.hidden = text === null;
  hintEl.textContent = text ?? '';
}

function searchRadiusKm(): number {
  const center = map.getCenter();
  return center.distanceTo(map.getBounds().getNorthEast()) / 1000;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const resultsEl = $('#results');
const detailEl = $('#detail');
const statusEl = $('#status');
const bannerEl = $('#banner');

let lastResults: Occurrence[] = [];
let selectedChurch: string | null = null;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function describeOccurrence(o: Occurrence): string {
  if (o.title) return o.title;
  const base = SERVICE_LABELS[o.serviceType];
  return o.isVigil ? `${base} (vigil)` : base;
}

function tags(o: Pick<Occurrence, 'languages' | 'form' | 'rite' | 'lastVerifiedAt'>): HTMLElement {
  return h(
    'div',
    { class: 'meta' },
    ...o.languages.map((l) => h('span', { class: 'tag' }, languageName(l))),
    o.form && o.form !== 'ordinary' ? h('span', { class: 'tag' }, FORM_LABELS[o.form] ?? o.form) : null,
    o.rite && o.rite !== 'roman' ? h('span', { class: 'tag' }, `${RITE_LABELS[o.rite] ?? o.rite} rite`) : null,
    h('span', { class: o.lastVerifiedAt ? 'tag verified' : 'tag unverified' }, formatVerified(o.lastVerifiedAt)),
  );
}

function renderResults(results: Occurrence[], churches: Church[]) {
  resultsEl.replaceChildren();
  detailEl.hidden = true;
  resultsEl.hidden = false;

  if (results.length === 0) {
    const withoutTimes = churches.filter((c) => !c.scheduleCount).length;
    resultsEl.append(
      h(
        'div',
        { class: 'empty' },
        h('strong', {}, churches.length ? 'No matching times here' : 'No churches in this area yet'),
        churches.length
          ? `Try another day, time or filter. ${withoutTimes ? `${withoutTimes} church${withoutTimes === 1 ? '' : 'es'} here ha${withoutTimes === 1 ? 's' : 've'} no times yet. ` : ''}`
          : 'Move the map, search for a church, or ',
        churches.length ? null : h('a', { href: `${REPO}/blob/master/CONTRIBUTING.md` }, 'help add your parish.'),
      ),
    );
    return;
  }

  let currentDay = '';
  for (const o of results) {
    if (o.date !== currentDay) {
      currentDay = o.date;
      resultsEl.append(h('h2', { class: 'day' }, formatDay(o.date, today)));
    }
    const item = h(
      'article',
      {
        class: `item${o.church.id === selectedChurch ? ' selected' : ''}`,
        tabindex: 0,
        'data-church': o.church.id,
        onclick: () => selectChurch(o.church.id, true),
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === 'Enter') selectChurch(o.church.id, true);
        },
      },
      o.startTime === '00:00' && o.endTime === '24:00'
        ? h('div', { class: 'time' }, 'All day')
        : h('div', { class: 'time' }, formatTime(o.startTime), o.endTime ? h('small', {}, `until ${formatTime(o.endTime)}`) : null),
      h(
        'div',
        {},
        h('div', { class: 'what' }, describeOccurrence(o)),
        h('div', { class: 'where' }, `${o.church.name} · ${formatDistance(o.church.distanceKm)}`),
        o.status === 'rescheduled'
          ? h('div', { class: 'meta' }, h('span', { class: 'tag changed' }, `Moved from ${formatTime(o.originalStartTime!)}${o.exceptionReason ? `: ${o.exceptionReason}` : ''}`))
          : null,
        tags(o),
      ),
    );
    resultsEl.append(item);
  }
}

function renderMarkers(churches: Church[], results: Occurrence[]) {
  markerLayer.clearLayers();
  markers.clear();
  const byChurch = new Map<string, Occurrence[]>();
  for (const o of results) byChurch.set(o.church.id, [...(byChurch.get(o.church.id) ?? []), o]);

  for (const church of churches) {
    const times = byChurch.get(church.id) ?? [];
    const active = times.length > 0;
    const marker = L.circleMarker([church.latitude, church.longitude], {
      radius: active ? 9 : 6,
      color: active ? '#1f4e8c' : '#8a8475',
      weight: 2,
      fillColor: active ? '#3a6fb8' : '#d8d2c2',
      fillOpacity: 0.9,
    });
    marker.bindPopup(() =>
      h(
        'div',
        { class: 'popup' },
        h('h4', {}, church.name),
        h('p', {}, [church.locality, church.region].filter(Boolean).join(', ')),
        active
          ? h('p', {}, times.slice(0, 4).map((o) => `${formatTime(o.startTime)} ${SERVICE_LABELS[o.serviceType]}`).join(' · '))
          : h('p', {}, church.scheduleCount ? 'No matching times for this filter.' : 'No times yet.'),
        h('button', { type: 'button', onclick: () => void showChurch(church.id) }, 'Details'),
      ),
    );
    marker.on('click', () => selectChurch(church.id, false));
    marker.addTo(markerLayer);
    markers.set(church.id, marker);
  }
}

function selectChurch(id: string, fromList: boolean) {
  selectedChurch = id;
  for (const el of resultsEl.querySelectorAll<HTMLElement>('.item')) {
    el.classList.toggle('selected', el.dataset.church === id);
  }
  const marker = markers.get(id);
  if (fromList && marker) {
    suppressNextMove = true;
    map.panTo(marker.getLatLng());
    marker.openPopup();
  } else {
    resultsEl.querySelector<HTMLElement>(`.item[data-church="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** Bulletin order: Sundays, weekdays, Saturdays, other patterns, feasts, one-offs; then by time. */
function bulletinOrder(a: ChurchDetail['schedules'][number], b: ChurchDetail['schedules'][number]): number {
  const rank = (sch: typeof a) => {
    if (sch.rrule) {
      const days = /BYDAY=([^;]+)/.exec(sch.rrule)?.[1] ?? '';
      if (/MONTHLY|YEARLY/.test(sch.rrule)) return 3;
      if (days === 'SU') return 0;
      if (/^(MO|TU|WE|TH|FR)(,(MO|TU|WE|TH|FR))*$/.test(days)) return 1;
      if (days === 'SA') return 2;
      return 3;
    }
    return sch.liturgicalDay ? 4 : 5;
  };
  return rank(a) - rank(b) || a.recurrenceText.localeCompare(b.recurrenceText) || a.startTime.localeCompare(b.startTime);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

/** The church's most common language set, which the detail view doesn't repeat on every line. */
function usualLanguage(schedules: ChurchDetail['schedules']): string {
  const counts = new Map<string, number>();
  for (const sch of schedules) if (sch.languages.length) counts.set(sch.languages.join(), (counts.get(sch.languages.join()) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function safeHref(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function renderDetail(d: ChurchDetail) {
  const c = d.church;
  const address = [c.street, c.locality, c.region, c.postalCode].filter(Boolean).join(', ');
  const groups = new Map<string, ChurchDetail['schedules']>();
  for (const sch of [...d.schedules].sort(bulletinOrder)) {
    groups.set(sch.serviceType, [...(groups.get(sch.serviceType) ?? []), sch]);
  }
  const usual = usualLanguage(d.schedules);

  const correction = new URL(`${REPO}/issues/new`);
  correction.searchParams.set('template', 'schedule_correction.yml');
  correction.searchParams.set('title', `Correction: ${c.name}`);
  correction.searchParams.set('church', `${c.name} (${c.id})`);

  const view = h(
    'div',
    {},
    h('button', { type: 'button', class: 'link-button back', onclick: () => backToResults() }, '← Back to times'),
    h('h2', {}, c.name),
    address ? h('p', { class: 'sub' }, address) : null,
    d.parish && d.parish.name !== c.name ? h('p', { class: 'sub' }, `Parish: ${d.parish.name}`) : null,
    d.diocese ? h('p', { class: 'sub' }, d.diocese.name) : null,
    h(
      'div',
      { class: 'links' },
      safeHref(c.website ?? d.parish?.website ?? null) ? h('a', { href: safeHref(c.website ?? d.parish?.website ?? null)!, rel: 'noopener', target: '_blank' }, 'Website') : null,
      c.phone ? h('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, c.phone) : null,
      h('a', { href: `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}`, target: '_blank', rel: 'noopener' }, 'Map'),
      h('a', { href: correction.toString(), target: '_blank', rel: 'noopener' }, 'Suggest a correction'),
    ),
    ...(d.schedules.length === 0
      ? [h('div', { class: 'empty' }, h('strong', {}, 'No times yet'), 'Know the schedule? ', h('a', { href: correction.toString() }, 'Tell us.'))]
      : [...groups].map(([type, list]) =>
          h(
            'section',
            {},
            h('h3', {}, SERVICE_LABELS[type as ServiceType]),
            ...[...groupBy(list, (sch) => sch.recurrenceText)].map(([when, items]) =>
              h(
                'div',
                { class: 'sched' },
                h('span', { class: 'when' }, when),
                h(
                  'span',
                  { class: 'times' },
                  ...items.flatMap((sch, i) => {
                    const extra = [
                      sch.title,
                      sch.isVigil && !sch.title ? 'vigil' : null,
                      sch.languages.length && sch.languages.join() !== usual ? sch.languages.map(languageName).join(' / ') : null,
                    ].filter(Boolean);
                    return [
                      i ? h('br') : null,
                      formatTimeRange(sch.startTime, sch.endTime),
                      extra.length ? h('small', {}, ` · ${extra.join(' · ')}`) : null,
                    ];
                  }),
                ),
                ...items.filter((sch) => sch.notes).map((sch) => h('span', { class: 'note' }, sch.notes!)),
              ),
            ),
          ),
        )),
    d.upcomingExceptions.length
      ? h(
          'section',
          {},
          h('h3', {}, 'Upcoming changes'),
          ...d.upcomingExceptions.map((e) =>
            h('p', {}, `${e.date}: ${e.kind === 'cancelled' ? 'cancelled' : `moved to ${formatTime(e.startTime!)}`}${e.reason ? ` (${e.reason})` : ''}`),
          ),
        )
      : null,
    h(
      'p',
      { class: 'provenance' },
      `Location source: ${c.source === 'osm' ? 'OpenStreetMap' : c.source} (${c.sourceLicense}). ${formatVerified(c.lastVerifiedAt)}.`,
      !d.holyDayRulesAvailable ? ' Holy-day rules for this country are not in the database yet.' : '',
    ),
  );
  detailEl.replaceChildren(view);
  resultsEl.hidden = true;
  detailEl.hidden = false;
  detailEl.scrollIntoView({ block: 'start' });
}

async function showChurch(id: string) {
  setStatus('Loading church…');
  try {
    renderDetail(await fetchChurch(id));
    setStatus('');
  } catch (err) {
    setStatus((err as Error).message, true);
  }
}

function backToResults() {
  detailEl.hidden = true;
  resultsEl.hidden = false;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let requestSeq = 0;
let suppressNextMove = false;

async function refresh() {
  writeUrl();
  const radius = searchRadiusKm();
  if (radius > MAX_RADIUS_KM) {
    setHint('Zoom in to see service times');
    setStatus('Zoom in, search, or use your location to see times.');
    markerLayer.clearLayers();
    resultsEl.replaceChildren();
    bannerEl.replaceChildren();
    return;
  }
  setHint(null);
  const seq = ++requestSeq;
  const center = map.getCenter();
  const date = selectedDate();
  const timeWindow = TIME_WINDOWS[filters.time] ?? {};
  setStatus('Searching…');
  try {
    const [services, churches] = await Promise.all([
      fetchServices({
        lat: center.lat,
        lon: center.lng,
        radius,
        date,
        upcoming: filters.upcoming && date === today,
        ...timeWindow,
        type: filters.types.includes('devotion') ? [...filters.types, 'liturgy_of_the_hours'] : filters.types,
        language: filters.language || undefined,
        rite: filters.rite || undefined,
        form: filters.form || undefined,
      }),
      fetchChurchesNear(center.lat, center.lng, radius),
    ]);
    if (seq !== requestSeq) return; // a newer search started
    lastResults = services.results;
    renderMarkers(churches.results, lastResults);
    if (detailEl.hidden) renderResults(lastResults, churches.results);
    const n = lastResults.length;
    setStatus(
      `${n} time${n === 1 ? '' : 's'} at ${new Set(lastResults.map((o) => o.church.id)).size} of ${churches.results.length} churches in view` +
        (services.truncated ? ' (showing the first 500)' : ''),
    );
    const sample = churches.results.some((c) => c.source === 'sample');
    bannerEl.replaceChildren(
      sample ? h('div', { class: 'banner' }, 'Showing fictional sample data for development. These churches do not exist.') : '',
    );
  } catch (err) {
    if (seq === requestSeq) setStatus((err as Error).message, true);
  }
}

let moveTimer: number | undefined;
map.on('moveend', () => {
  if (suppressNextMove) {
    suppressNextMove = false;
    writeUrl();
    return;
  }
  clearTimeout(moveTimer);
  moveTimer = window.setTimeout(() => void refresh(), 350);
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function fillSelect(select: HTMLSelectElement, entries: Array<[string, string]>, value: string) {
  for (const [v, label] of entries) select.append(h('option', { value: v }, label));
  select.value = value;
}

const languageSelect = $<HTMLSelectElement>('#language');
fillSelect(languageSelect, LANGUAGES.map((l) => [l, languageName(l)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])), filters.language);
const riteSelect = $<HTMLSelectElement>('#rite');
fillSelect(riteSelect, Object.entries(RITE_LABELS), filters.rite);
const formSelect = $<HTMLSelectElement>('#form');
fillSelect(formSelect, Object.entries(FORM_LABELS), filters.form);
const timeSelect = $<HTMLSelectElement>('#time');
timeSelect.value = filters.time;
const upcomingBox = $<HTMLInputElement>('#upcoming');
const dateInput = $<HTMLInputElement>('#date');
dateInput.value = selectedDate();
dateInput.min = today;

function syncDayControls() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#day-chips button')) {
    b.setAttribute('aria-pressed', String(b.dataset.day === filters.day));
  }
  dateInput.classList.toggle('active', filters.day === 'date');
  dateInput.value = selectedDate();
  upcomingBox.checked = filters.upcoming;
  upcomingBox.disabled = selectedDate() !== today;
}
syncDayControls();
for (const b of document.querySelectorAll<HTMLButtonElement>('#day-chips button')) {
  b.addEventListener('click', () => {
    filters.day = b.dataset.day as Day;
    syncDayControls();
    void refresh();
  });
}
dateInput.addEventListener('change', () => {
  if (!dateInput.value) return;
  filters.day = 'date';
  filters.date = dateInput.value;
  syncDayControls();
  void refresh();
});
timeSelect.addEventListener('change', () => {
  filters.time = timeSelect.value;
  void refresh();
});
upcomingBox.addEventListener('change', () => {
  filters.upcoming = upcomingBox.checked;
  void refresh();
});
for (const [el, key] of [
  [languageSelect, 'language'],
  [riteSelect, 'rite'],
  [formSelect, 'form'],
] as const) {
  el.addEventListener('change', () => {
    filters[key] = el.value;
    void refresh();
  });
}
const typeBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name="type"]')];
for (const box of typeBoxes) {
  box.checked = filters.types.includes(box.value as ServiceType);
  box.addEventListener('change', () => {
    filters.types = typeBoxes.filter((b) => b.checked).map((b) => b.value as ServiceType);
    if (filters.types.length === 0) {
      box.checked = true; // keep at least one type selected
      filters.types = [box.value as ServiceType];
    }
    void refresh();
  });
}

$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('Your browser cannot share its location.', true);
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 13),
    (err) => setStatus(`Could not get your location: ${err.message}`, true),
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
});

$<HTMLFormElement>('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $<HTMLInputElement>('#q').value.trim();
  if (text.length < 2) return;
  setStatus('Searching churches…');
  try {
    const center = map.getCenter();
    const { results } = await searchChurches(text, { lat: center.lat, lon: center.lng });
    if (results.length === 0) {
      setStatus(`No churches match “${text}”. Try a church name, city or ZIP code.`, true);
      return;
    }
    // Zoom to the matches. The map move then searches the area.
    const nearest = results.slice(0, 10);
    const bounds = L.latLngBounds(nearest.map((c) => [c.latitude, c.longitude] as [number, number]));
    if (nearest.length === 1 || bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 1000) {
      map.setView(bounds.getCenter(), 15);
    } else {
      map.fitBounds(bounds.pad(0.2), { maxZoom: 15 });
    }
    selectedChurch = nearest[0]!.id;
  } catch (err) {
    setStatus((err as Error).message, true);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const zoom = Number(params.get('z') || 13);
  if (params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    map.setView([lat, lon], zoom);
    return;
  }
  // No location in the URL: open on wherever the data is (the whole dataset
  // when small, e.g. sample data), else on the continental US.
  try {
    const meta = (await (await fetch('/api/v1/meta')).json()) as {
      bounds: { south: number; west: number; north: number; east: number } | null;
    };
    if (meta.bounds) {
      const b = L.latLngBounds([meta.bounds.south, meta.bounds.west], [meta.bounds.north, meta.bounds.east]);
      if (b.getNorthEast().distanceTo(b.getSouthWest()) < 2 * MAX_RADIUS_KM * 1000) {
        map.fitBounds(b.pad(0.15), { maxZoom: 14 });
        return;
      }
    }
  } catch {
    // fall through to the default view
  }
  map.setView([39.5, -98.35], 4);
}

void start();
