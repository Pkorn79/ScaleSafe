-- 093_zoom_attendance_integration.sql
-- First named evidence adapter: tenant-bound Zoom OAuth, meeting mappings,
-- and join/leave aggregation before attendance becomes evidence.

ALTER TABLE evidence_oauth_states
  ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES evidence_connections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_evidence_oauth_states_connection
  ON evidence_oauth_states(connection_id, provider_key, expires_at DESC);

CREATE TABLE IF NOT EXISTS evidence_zoom_attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  meeting_uuid TEXT NOT NULL,
  meeting_topic TEXT,
  participant_instance_id TEXT NOT NULL,
  participant_user_id TEXT,
  registrant_id TEXT,
  participant_email TEXT,
  participant_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  join_source_event_id TEXT NOT NULL,
  leave_source_event_id TEXT,
  evidence_event_id UUID REFERENCES external_evidence_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'joined'
    CHECK (status IN ('joined', 'completed', 'published', 'quarantined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, join_source_event_id),
  UNIQUE (connection_id, leave_source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_zoom_attendance_open_session
  ON evidence_zoom_attendance_sessions(connection_id, meeting_uuid, participant_instance_id, joined_at DESC)
  WHERE status = 'joined';

CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_active_account_location
  ON evidence_provider_authorizations(provider_key, external_account_id)
  WHERE provider_key = 'zoom' AND status = 'active' AND external_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_evidence_oauth_state(p_state_hash TEXT, p_provider_key TEXT)
RETURNS evidence_oauth_states AS $$
DECLARE
  claimed evidence_oauth_states%ROWTYPE;
BEGIN
  UPDATE evidence_oauth_states
  SET consumed_at = now()
  WHERE state_hash = p_state_hash
    AND provider_key = p_provider_key
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING * INTO claimed;

  IF claimed.id IS NULL THEN
    RAISE EXCEPTION 'OAuth state is invalid, expired, or already used';
  END IF;

  RETURN claimed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE evidence_zoom_attendance_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION claim_evidence_oauth_state(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evidence_oauth_state(TEXT, TEXT) TO service_role;

DROP TRIGGER IF EXISTS evidence_zoom_attendance_sessions_updated_at ON evidence_zoom_attendance_sessions;
CREATE TRIGGER evidence_zoom_attendance_sessions_updated_at
  BEFORE UPDATE ON evidence_zoom_attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

UPDATE evidence_provider_releases
SET release_status = 'beta', wave = 1, enabled_by_default = false,
    updated_by = 'migration_093', updated_at = now()
WHERE provider_key = 'zoom';

NOTIFY pgrst, 'reload schema';
