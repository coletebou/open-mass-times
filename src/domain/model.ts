// Domain model for Open Mass Times.
//
// These zod schemas are the single source of truth for what a record looks
// like. They validate seed/import files, they document the API, and the SQL
// schema in src/db/migrations mirrors them column for column (snake_case).
// docs/DATA_MODEL.md explains the reasoning behind each field.

import { z } from 'zod';
import { parseRRule } from '../recurrence/rrule.ts';
import { LITURGICAL_DAY_KEYS } from '../calendar/liturgical.ts';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const SERVICE_TYPES = [
  'mass', // includes the Divine Liturgy and other Eucharistic liturgies
  'confession', // the Sacrament of Penance / Reconciliation
  'adoration', // Eucharistic adoration / exposition
  'devotion', // rosary, novena, stations of the cross, benediction, ...
  'liturgy_of_the_hours',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

// Liturgical traditions (families of rites). The Latin Church uses the Roman
// rite almost everywhere, with a few historic Latin rites still in use. The 23
// Eastern Catholic Churches use one of five Eastern traditions.
export const RITES = [
  'roman',
  'ambrosian',
  'mozarabic',
  'byzantine',
  'alexandrian',
  'antiochene', // West Syriac: Maronite, Syriac Catholic, Syro-Malankara
  'armenian',
  'east_syriac', // Chaldean, Syro-Malabar
] as const;
export type Rite = (typeof RITES)[number];

// Which form/use of the Roman rite is celebrated. Only meaningful when
// rite = 'roman'.
export const ROMAN_FORMS = [
  'ordinary', // Roman Missal of Paul VI (1970, 3rd typical ed. 2002)
  'usus_antiquior', // Roman Missal of 1962 ("Traditional Latin Mass")
  'divine_worship', // Divine Worship: The Missal (Personal Ordinariates)
] as const;
export type RomanForm = (typeof ROMAN_FORMS)[number];

// Where a record came from. See SOURCES.md for the licensing of each.
export const SOURCE_KINDS = [
  'osm', // OpenStreetMap (ODbL-1.0)
  'wikidata', // Wikidata (CC0-1.0)
  'diocese', // a diocesan directory or feed used with permission / open licence
  'parish_website', // a parish's own published schedule, recorded as facts
  'parish_submission', // submitted by parish staff
  'community', // submitted by a community contributor
  'sample', // fictional demo data, never shown as real
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LICENSES = [
  'ODbL-1.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'permission', // written permission on file (link it in source_url / notes)
  'public-facts', // uncopyrightable facts restated from a public schedule; see SOURCES.md
] as const;
export type SourceLicense = (typeof SOURCE_LICENSES)[number];

export const VERIFIERS = ['parish_staff', 'diocese', 'maintainer', 'community'] as const;
export type Verifier = (typeof VERIFIERS)[number];

export const VERIFICATION_METHODS = [
  'parish_submission',
  'parish_website',
  'bulletin',
  'phone',
  'in_person',
  'diocese_directory',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const EXCEPTION_KINDS = ['cancelled', 'rescheduled'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

// ---------------------------------------------------------------------------
// Primitive formats
// ---------------------------------------------------------------------------

export const IdSchema = z
  .string()
  .regex(/^[a-z]{2,4}_[A-Za-z0-9_-]{4,64}$/, 'ids look like "ch_abc123" (prefix_slug)');

/** Calendar date, no time zone: YYYY-MM-DD. */
export const LocalDateSchema = z.iso.date();

/** Wall-clock time in the church's own time zone: HH:MM, 24-hour. */
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'times are 24-hour HH:MM');

/** End times may also be 24:00 (end of day), e.g. perpetual adoration. */
export const LocalEndTimeSchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'end times are 24-hour HH:MM or 24:00');

/** BCP 47 language tag, e.g. "en", "es", "la", "vi", "zh-Hant". */
export const LanguageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'use a BCP 47 language tag such as "en" or "es"');

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2, e.g. "US"');

export const TimeZoneSchema = z.string().refine(isValidTimeZone, 'must be an IANA time zone');

const isoDateTime = z.iso.datetime({ offset: true });

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Provenance: attached to every record
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  /** Where the record (or its latest revision) came from. */
  source: z.enum(SOURCE_KINDS),
  /** Link to the source: the OSM object, the parish bulletin, the permission letter. */
  sourceUrl: z.url().nullable().default(null),
  /** Identifier inside the source, e.g. "node/123456" for OSM or a diocese record id. */
  sourceRef: z.string().nullable().default(null),
  /** Licence or legal basis under which we hold the data. */
  sourceLicense: z.enum(SOURCE_LICENSES),
  /** When we last fetched/received it from the source. */
  retrievedAt: isoDateTime.nullable().default(null),
  /** When a human last confirmed the record is still correct. Null = never verified. */
  lastVerifiedAt: isoDateTime.nullable().default(null),
  verifiedBy: z.enum(VERIFIERS).nullable().default(null),
  verificationMethod: z.enum(VERIFICATION_METHODS).nullable().default(null),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

const AddressSchema = z.object({
  street: z.string().nullable().default(null),
  locality: z.string().nullable().default(null), // city / town
  region: z.string().nullable().default(null), // state / province
  postalCode: z.string().nullable().default(null),
  countryCode: CountryCodeSchema,
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export const DioceseSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    countryCode: CountryCodeSchema,
    website: z.url().nullable().default(null),
    /** Latin, or an Eastern Catholic Church (eparchies are dioceses too). */
    churchSuiIuris: z.string().default('latin'),
    /**
     * US-specific: whether this diocese's ecclesiastical province keeps the
     * Ascension on Thursday instead of moving it to the following Sunday.
     */
    ascensionOnThursday: z.boolean().default(false),
  })
  .extend(ProvenanceSchema.shape);
export type Diocese = z.infer<typeof DioceseSchema>;

export const PARISH_STATUSES = ['active', 'merged', 'closed'] as const;

export const ParishSchema = z
  .object({
    id: IdSchema,
    dioceseId: IdSchema.nullable().default(null),
    name: z.string().min(1),
    website: z.url().nullable().default(null),
    phone: z.string().nullable().default(null),
    email: z.email().nullable().default(null),
    status: z.enum(PARISH_STATUSES).default('active'),
    /** When status = merged: the parish it merged into. */
    mergedIntoId: IdSchema.nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .extend(AddressSchema.partial().shape)
  .extend(ProvenanceSchema.shape);
export type Parish = z.infer<typeof ParishSchema>;

export const CHURCH_STATUSES = ['active', 'closed', 'unknown'] as const;

/**
 * A church is a physical place of worship with coordinates. A parish may have
 * several churches (mission churches, oratories, merged parishes); an imported
 * OSM church may not be linked to a parish yet.
 */
export const ChurchSchema = z
  .object({
    id: IdSchema,
    parishId: IdSchema.nullable().default(null),
    name: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** IANA time zone; every schedule time at this church is local to it. */
    timezone: TimeZoneSchema,
    churchSuiIuris: z.string().nullable().default(null),
    website: z.url().nullable().default(null),
    phone: z.string().nullable().default(null),
    wheelchair: z.enum(['yes', 'limited', 'no']).nullable().default(null),
    osmType: z.enum(['node', 'way', 'relation']).nullable().default(null),
    osmId: z.number().int().positive().nullable().default(null),
    wikidataId: z
      .string()
      .regex(/^Q\d+$/)
      .nullable()
      .default(null),
    status: z.enum(CHURCH_STATUSES).default('active'),
  })
  .extend(AddressSchema.shape)
  .extend(ProvenanceSchema.shape);
export type Church = z.infer<typeof ChurchSchema>;

/**
 * A schedule is one recurring (or one-off) service at a church: "Sundays at
 * 09:00, Mass in Spanish". Exactly one of `rrule`, `liturgicalDay` or `date`
 * says when it happens:
 *
 *  - rrule: a restricted RFC 5545 RRULE (see src/recurrence/rrule.ts), e.g.
 *    "FREQ=WEEKLY;BYDAY=SU" or "FREQ=MONTHLY;BYDAY=1FR" (first Fridays).
 *  - liturgicalDay: a movable or fixed feast computed per country, e.g.
 *    "holy_day_of_obligation", "ash_wednesday", "christmas_eve".
 *  - date: a single occurrence.
 *
 * validFrom / validUntil bound the schedule (e.g. "starting Advent 2026").
 */
export const ScheduleSchema = z
  .object({
    id: IdSchema,
    churchId: IdSchema,
    serviceType: z.enum(SERVICE_TYPES),
    title: z.string().nullable().default(null), // "Children's Mass", "Rosary"
    startTime: LocalTimeSchema,
    /** Required for windows such as confession or adoration; optional for Mass. */
    endTime: LocalEndTimeSchema.nullable().default(null),
    rrule: z
      .string()
      .nullable()
      .default(null)
      .superRefine((value, ctx) => {
        if (value === null) return;
        try {
          parseRRule(value);
        } catch (err) {
          ctx.addIssue({ code: 'custom', message: (err as Error).message });
        }
      }),
    liturgicalDay: z.enum(LITURGICAL_DAY_KEYS).nullable().default(null),
    date: LocalDateSchema.nullable().default(null),
    validFrom: LocalDateSchema.nullable().default(null),
    validUntil: LocalDateSchema.nullable().default(null),
    languages: z.array(LanguageTagSchema).default([]),
    rite: z.enum(RITES).nullable().default(null),
    form: z.enum(ROMAN_FORMS).nullable().default(null),
    churchSuiIuris: z.string().nullable().default(null),
    /** An anticipated Mass of the following day (e.g. Saturday evening vigil). */
    isVigil: z.boolean().default(false),
    livestreamUrl: z.url().nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .extend(ProvenanceSchema.shape)
  .superRefine((s, ctx) => {
    const whens = [s.rrule, s.liturgicalDay, s.date].filter((v) => v !== null).length;
    if (whens !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of rrule, liturgicalDay or date must be set',
        path: ['rrule'],
      });
    }
    if (s.endTime !== null && s.endTime <= s.startTime) {
      ctx.addIssue({ code: 'custom', message: 'endTime must be after startTime', path: ['endTime'] });
    }
    if (s.validFrom && s.validUntil && s.validUntil < s.validFrom) {
      ctx.addIssue({ code: 'custom', message: 'validUntil is before validFrom', path: ['validUntil'] });
    }
    if (s.form !== null && s.rite !== null && s.rite !== 'roman') {
      ctx.addIssue({ code: 'custom', message: 'form only applies to the Roman rite', path: ['form'] });
    }
    if (s.isVigil && s.serviceType !== 'mass') {
      ctx.addIssue({ code: 'custom', message: 'only a Mass can be a vigil Mass', path: ['isVigil'] });
    }
  });
export type Schedule = z.infer<typeof ScheduleSchema>;

/**
 * A dated change to the normal schedule. With a scheduleId it cancels or moves
 * one occurrence of that schedule; without one, kind = cancelled means the
 * whole church has nothing that day (e.g. closed for repairs).
 */
export const ScheduleExceptionSchema = z
  .object({
    id: IdSchema,
    churchId: IdSchema,
    scheduleId: IdSchema.nullable().default(null),
    date: LocalDateSchema,
    kind: z.enum(EXCEPTION_KINDS),
    startTime: LocalTimeSchema.nullable().default(null),
    endTime: LocalEndTimeSchema.nullable().default(null),
    reason: z.string().nullable().default(null),
  })
  .extend(ProvenanceSchema.shape)
  .superRefine((e, ctx) => {
    if (e.kind === 'rescheduled' && (e.scheduleId === null || e.startTime === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a rescheduled exception needs scheduleId and the new startTime',
        path: ['startTime'],
      });
    }
  });
export type ScheduleException = z.infer<typeof ScheduleExceptionSchema>;

/** File format for seed files, imports and (later) bulk data dumps. */
export const DataFileSchema = z.object({
  dioceses: z.array(DioceseSchema).default([]),
  parishes: z.array(ParishSchema).default([]),
  churches: z.array(ChurchSchema).default([]),
  schedules: z.array(ScheduleSchema).default([]),
  exceptions: z.array(ScheduleExceptionSchema).default([]),
});
export type DataFile = z.infer<typeof DataFileSchema>;
