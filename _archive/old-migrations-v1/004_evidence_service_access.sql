-- 004_evidence_service_access.sql — Platform access evidence table
--
-- Tracks when clients access digital learning platforms (Kajabi, Skool,
-- GHL Memberships, Teachable). This evidence proves the client had access
-- to and engaged with the program content they paid for.
--
-- The other 9 evidence tables already exist in Supabase from the Make.com era.
-- This is the only NEW evidence table added by the Node.js app.

CREATE TABLE IF NOT EXISTS evidence_service_access (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id          TEXT NOT NULL,
  location_id         TEXT NOT NULL,
  platform            TEXT,               -- kajabi, skool, ghl_memberships, teachable
  event_type          TEXT,               -- login, view, download, completion
  content_accessed    TEXT,               -- course/lesson/module name
  access_date         TIMESTAMPTZ,
  time_spent          INTEGER,            -- minutes
  completion_status   TEXT,               -- started, in_progress, completed
  source              TEXT,               -- webhook source identifier
  contact_email       TEXT,
  contact_name        TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_evidence_sa_contact ON evidence_service_access (location_id, contact_id);
CREATE INDEX idx_evidence_sa_date ON evidence_service_access (created_at);

ALTER TABLE evidence_service_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_service_access
  FOR ALL USING (true) WITH CHECK (true);
