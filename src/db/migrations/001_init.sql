-- Initial schema. Mirrors src/domain/model.ts (camelCase there, snake_case here).
-- Every record table carries the same provenance columns; see docs/DATA_MODEL.md.
-- Timestamps are ISO 8601 UTC strings; local dates/times are plain strings
-- interpreted in the church's time zone.

CREATE TABLE dioceses (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  country_code          TEXT NOT NULL CHECK (length(country_code) = 2),
  website               TEXT,
  church_sui_iuris      TEXT NOT NULL DEFAULT 'latin',
  ascension_on_thursday INTEGER NOT NULL DEFAULT 0 CHECK (ascension_on_thursday IN (0, 1)),
  -- provenance
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_ref            TEXT,
  source_license        TEXT NOT NULL,
  retrieved_at          TEXT,
  last_verified_at      TEXT,
  verified_by           TEXT,
  verification_method   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE parishes (
  id                    TEXT PRIMARY KEY,
  diocese_id            TEXT REFERENCES dioceses (id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  website               TEXT,
  phone                 TEXT,
  email                 TEXT,
  street                TEXT,
  locality              TEXT,
  region                TEXT,
  postal_code           TEXT,
  country_code          TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'closed')),
  merged_into_id        TEXT REFERENCES parishes (id) ON DELETE SET NULL,
  notes                 TEXT,
  -- provenance
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_ref            TEXT,
  source_license        TEXT NOT NULL,
  retrieved_at          TEXT,
  last_verified_at      TEXT,
  verified_by           TEXT,
  verification_method   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX parishes_diocese ON parishes (diocese_id);

CREATE TABLE churches (
  id                    TEXT PRIMARY KEY,
  parish_id             TEXT REFERENCES parishes (id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  latitude              REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude             REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone              TEXT NOT NULL,
  church_sui_iuris      TEXT,
  street                TEXT,
  locality              TEXT,
  region                TEXT,
  postal_code           TEXT,
  country_code          TEXT NOT NULL CHECK (length(country_code) = 2),
  website               TEXT,
  phone                 TEXT,
  wheelchair            TEXT CHECK (wheelchair IN ('yes', 'limited', 'no')),
  osm_type              TEXT CHECK (osm_type IN ('node', 'way', 'relation')),
  osm_id                INTEGER,
  wikidata_id           TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'unknown')),
  -- provenance
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_ref            TEXT,
  source_license        TEXT NOT NULL,
  retrieved_at          TEXT,
  last_verified_at      TEXT,
  verified_by           TEXT,
  verification_method   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((osm_type IS NULL) = (osm_id IS NULL))
);
CREATE INDEX churches_parish ON churches (parish_id);
-- Radius search does a latitude-band range scan, then filters longitude and
-- exact distance in code. Fine for the ~220k Catholic parishes worldwide; an
-- R*Tree index is the upgrade path if it ever is not.
CREATE INDEX churches_lat_lon ON churches (latitude, longitude);
CREATE UNIQUE INDEX churches_osm ON churches (osm_type, osm_id) WHERE osm_id IS NOT NULL;
CREATE UNIQUE INDEX churches_wikidata ON churches (wikidata_id) WHERE wikidata_id IS NOT NULL;

-- Full-text search over church names and places, kept in sync by triggers.
CREATE VIRTUAL TABLE churches_fts USING fts5 (
  name, locality, region, postal_code,
  content = 'churches', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER churches_fts_insert AFTER INSERT ON churches BEGIN
  INSERT INTO churches_fts (rowid, name, locality, region, postal_code)
  VALUES (new.rowid, new.name, new.locality, new.region, new.postal_code);
END;
CREATE TRIGGER churches_fts_delete AFTER DELETE ON churches BEGIN
  INSERT INTO churches_fts (churches_fts, rowid, name, locality, region, postal_code)
  VALUES ('delete', old.rowid, old.name, old.locality, old.region, old.postal_code);
END;
CREATE TRIGGER churches_fts_update AFTER UPDATE ON churches BEGIN
  INSERT INTO churches_fts (churches_fts, rowid, name, locality, region, postal_code)
  VALUES ('delete', old.rowid, old.name, old.locality, old.region, old.postal_code);
  INSERT INTO churches_fts (rowid, name, locality, region, postal_code)
  VALUES (new.rowid, new.name, new.locality, new.region, new.postal_code);
END;

CREATE TABLE schedules (
  id                    TEXT PRIMARY KEY,
  church_id             TEXT NOT NULL REFERENCES churches (id) ON DELETE CASCADE,
  service_type          TEXT NOT NULL
                        CHECK (service_type IN ('mass', 'confession', 'adoration', 'devotion', 'liturgy_of_the_hours')),
  title                 TEXT,
  start_time            TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time              TEXT CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- Exactly one of rrule / liturgical_day / date says when it happens.
  rrule                 TEXT,
  liturgical_day        TEXT,
  date                  TEXT,
  valid_from            TEXT,
  valid_until           TEXT,
  languages             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(languages) AND json_type(languages) = 'array'),
  rite                  TEXT,
  form                  TEXT CHECK (form IN ('ordinary', 'usus_antiquior', 'divine_worship')),
  church_sui_iuris      TEXT,
  is_vigil              INTEGER NOT NULL DEFAULT 0 CHECK (is_vigil IN (0, 1)),
  livestream_url        TEXT,
  notes                 TEXT,
  -- provenance
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_ref            TEXT,
  source_license        TEXT NOT NULL,
  retrieved_at          TEXT,
  last_verified_at      TEXT,
  verified_by           TEXT,
  verification_method   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((rrule IS NOT NULL) + (liturgical_day IS NOT NULL) + (date IS NOT NULL) = 1),
  CHECK (end_time IS NULL OR end_time > start_time)
);
CREATE INDEX schedules_church ON schedules (church_id);

CREATE TABLE schedule_exceptions (
  id                    TEXT PRIMARY KEY,
  church_id             TEXT NOT NULL REFERENCES churches (id) ON DELETE CASCADE,
  schedule_id           TEXT REFERENCES schedules (id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('cancelled', 'rescheduled')),
  start_time            TEXT,
  end_time              TEXT,
  reason                TEXT,
  -- provenance
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_ref            TEXT,
  source_license        TEXT NOT NULL,
  retrieved_at          TEXT,
  last_verified_at      TEXT,
  verified_by           TEXT,
  verification_method   TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind = 'cancelled' OR (schedule_id IS NOT NULL AND start_time IS NOT NULL))
);
CREATE INDEX schedule_exceptions_church_date ON schedule_exceptions (church_id, date);
