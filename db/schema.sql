-- Schema for the complaint routing engine's persistence layer.
-- Replaces the in-memory arrays used in dedup.ts/router.ts with real,
-- indexed, concurrent-safe storage.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE wards (
  ward_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authority TEXT NOT NULL,  -- 'MCD' | 'NDMC' | ... (default authority for this ward)
  boundary GEOGRAPHY(POLYGON, 4326) NOT NULL
);
CREATE INDEX wards_boundary_gix ON wards USING GIST (boundary);

CREATE TABLE raw_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  video_url TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  ward_id TEXT REFERENCES wards(ward_id),
  category TEXT NOT NULL,
  transcript TEXT,
  visual_tags TEXT[] DEFAULT '{}',
  confidence REAL NOT NULL,
  linked_account_number TEXT,
  issue_thread_id TEXT  -- set once consolidated into a thread
);
CREATE INDEX raw_reports_location_gix ON raw_reports USING GIST (location);

CREATE TABLE issue_threads (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  ward_id TEXT REFERENCES wards(ward_id),
  centroid GEOGRAPHY(POINT, 4326) NOT NULL,
  reporter_count INT NOT NULL DEFAULT 1,
  first_reported_at TIMESTAMPTZ NOT NULL,
  last_reported_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- new|drafted|awaiting_confirm|submitted|in_progress|resolved|stale
  complaint_id TEXT,
  auto_followup_count INT NOT NULL DEFAULT 0,
  last_followup_at TIMESTAMPTZ,
  needs_manual_escalation BOOLEAN NOT NULL DEFAULT false
);
-- The key index: this is what makes consolidation fast at volume instead of
-- scanning every open thread in application memory.
CREATE INDEX issue_threads_centroid_gix ON issue_threads USING GIST (centroid);
CREATE INDEX issue_threads_status_idx ON issue_threads (status);

CREATE TABLE complaints (
  id TEXT PRIMARY KEY,
  issue_thread_id TEXT NOT NULL REFERENCES issue_threads(id),
  authority TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_contact TEXT NOT NULL,
  draft_text TEXT NOT NULL,
  attached_media_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'drafted',
  authority_reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
