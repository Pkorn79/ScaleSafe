-- 096_scheduling_evidence_bridge.sql
-- Provider-neutral booking records used to correlate Zoom/Meet attendance with
-- the exact tenant, contact, and enrollment that was scheduled.

CREATE TABLE IF NOT EXISTS evidence_scheduling_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  contact_id TEXT,
  contact_email TEXT,
  external_calendar_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  meeting_provider TEXT,
  meeting_id TEXT,
  meeting_url TEXT,
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  offer_id UUID REFERENCES offers_mirror(id) ON DELETE SET NULL,
  match_method TEXT,
  match_confidence TEXT,
  source_payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, source_provider, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduling_meeting_time
  ON evidence_scheduling_events(location_id, meeting_provider, meeting_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_scheduling_contact_time
  ON evidence_scheduling_events(location_id, contact_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduling_enrollment
  ON evidence_scheduling_events(location_id, enrollment_id, starts_at DESC)
  WHERE enrollment_id IS NOT NULL;

ALTER TABLE evidence_scheduling_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON evidence_scheduling_events;
CREATE POLICY "Service role full access" ON evidence_scheduling_events
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS evidence_scheduling_events_updated_at ON evidence_scheduling_events;
CREATE TRIGGER evidence_scheduling_events_updated_at
  BEFORE UPDATE ON evidence_scheduling_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
