-- 089_universal_evidence_connector.sql
-- Provider-neutral, tenant-bound external evidence intake and processing ledger.

DO $$
DECLARE
  required_table TEXT;
  required_tables TEXT[] := ARRAY[
    'merchants', 'enrollments', 'offers_mirror',
    'evidence_external_sessions', 'evidence_attendance', 'evidence_service_access',
    'evidence_modules', 'evidence_course_completion', 'evidence_milestones',
    'evidence_assignments', 'evidence_resource_delivery', 'evidence_communication',
    'evidence_custom_events', 'evidence_pulse_checkins', 'evidence_payment_confirmation'
  ];
BEGIN
  FOREACH required_table IN ARRAY required_tables LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Migration 089 preflight failed: required table public.% is missing', required_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['id', 'location_id', 'contact_id', 'offer_id', 'merchant_id', 'email']) AS required_columns(required_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns columns
      WHERE columns.table_schema = 'public'
        AND columns.table_name = 'enrollments'
        AND columns.column_name = required_columns.required_name
    )
  ) THEN
    RAISE EXCEPTION 'Migration 089 preflight failed: enrollments schema is missing a required connector column';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS evidence_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_label TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('canonical_api', 'raw_webhook', 'legacy_external')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  health_status TEXT NOT NULL DEFAULT 'ready' CHECK (health_status IN ('ready', 'healthy', 'warning', 'error', 'disabled')),
  mapping_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_attachment_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 300 CHECK (rate_limit_per_minute BETWEEN 1 AND 10000),
  last_event_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, name)
);

CREATE INDEX IF NOT EXISTS idx_evidence_connections_tenant
  ON evidence_connections(location_id, status);

CREATE TABLE IF NOT EXISTS evidence_connection_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('api_key', 'hmac', 'url_secret')),
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  secret_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'revoked')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (connection_id, secret_hash)
);

CREATE INDEX IF NOT EXISTS idx_evidence_credentials_hash
  ON evidence_connection_credentials(secret_hash)
  WHERE status IN ('active', 'expiring');

CREATE TABLE IF NOT EXISTS evidence_resource_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  external_resource_id TEXT NOT NULL,
  external_resource_name TEXT,
  offer_id UUID NOT NULL REFERENCES offers_mirror(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, resource_type, external_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_resource_mappings_offer
  ON evidence_resource_mappings(location_id, offer_id);

CREATE TABLE IF NOT EXISTS evidence_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  offer_id UUID REFERENCES offers_mirror(id) ON DELETE SET NULL,
  enrollment_ref TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  normalized_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_subjects_resolution
  ON evidence_subjects(location_id, normalized_email, offer_id);

CREATE TABLE IF NOT EXISTS evidence_subject_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES evidence_subjects(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  external_contact_id TEXT,
  external_enrollment_id TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_subject_identity_contact
  ON evidence_subject_identities(connection_id, subject_id, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_subject_identity_contact_lookup
  ON evidence_subject_identities(connection_id, external_contact_id)
  WHERE external_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_subject_identity_enrollment
  ON evidence_subject_identities(connection_id, external_enrollment_id)
  WHERE external_enrollment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_evidence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'verified', 'resolving', 'published', 'duplicate', 'retrying', 'quarantined', 'rejected')),
  auth_method TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  is_test BOOLEAN NOT NULL DEFAULT false,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB,
  payload_hash TEXT NOT NULL,
  subject_id UUID REFERENCES evidence_subjects(id) ON DELETE SET NULL,
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  contact_id TEXT,
  offer_id UUID REFERENCES offers_mirror(id) ON DELETE SET NULL,
  resolution_method TEXT,
  evidence_type TEXT,
  evidence_table TEXT,
  evidence_record_id UUID,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_external_evidence_events_worker
  ON external_evidence_events(status, next_attempt_at, lease_expires_at, received_at);
CREATE INDEX IF NOT EXISTS idx_external_evidence_events_tenant
  ON external_evidence_events(location_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_evidence_events_enrollment
  ON external_evidence_events(location_id, enrollment_id, occurred_at DESC);

ALTER TABLE evidence_attendance ADD COLUMN IF NOT EXISTS enrollment_id UUID;

ALTER TABLE evidence_external_sessions ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_attendance ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_service_access ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_modules ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_course_completion ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_milestones ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_assignments ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_resource_delivery ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_communication ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_custom_events ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_pulse_checkins ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);
ALTER TABLE evidence_payment_confirmation ADD COLUMN IF NOT EXISTS connector_event_id UUID REFERENCES external_evidence_events(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_external_sessions_connector_event ON evidence_external_sessions(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_attendance_connector_event ON evidence_attendance(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_service_access_connector_event ON evidence_service_access(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_modules_connector_event ON evidence_modules(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_course_connector_event ON evidence_course_completion(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_milestones_connector_event ON evidence_milestones(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_assignments_connector_event ON evidence_assignments(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_resources_connector_event ON evidence_resource_delivery(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_communication_connector_event ON evidence_communication(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_custom_connector_event ON evidence_custom_events(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_pulse_connector_event ON evidence_pulse_checkins(connector_event_id) WHERE connector_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_payment_confirmation_connector_event ON evidence_payment_confirmation(connector_event_id) WHERE connector_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_evidence_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  event_id UUID REFERENCES external_evidence_events(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  source_url TEXT,
  original_filename TEXT,
  storage_path TEXT,
  content_type TEXT,
  byte_size BIGINT,
  sha256 TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'validated', 'rejected')),
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_external_evidence_attachments_event
  ON external_evidence_attachments(event_id, validation_status);

CREATE TABLE IF NOT EXISTS evidence_connection_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES evidence_connections(id) ON DELETE SET NULL,
  location_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_connection_audit_tenant
  ON evidence_connection_audit_logs(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_connection_rate_limits (
  connection_id UUID PRIMARY KEY REFERENCES evidence_connections(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE evidence_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_connection_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_resource_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_subject_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_evidence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_evidence_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_connection_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_connection_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ensure_evidence_subject_for_enrollment()
RETURNS TRIGGER AS $$
DECLARE
  resolved_merchant_id UUID;
BEGIN
  resolved_merchant_id := NEW.merchant_id;
  IF resolved_merchant_id IS NULL THEN
    SELECT id INTO resolved_merchant_id FROM merchants WHERE location_id = NEW.location_id LIMIT 1;
  END IF;

  IF resolved_merchant_id IS NOT NULL
     AND NEW.contact_id IS NOT NULL THEN
    INSERT INTO evidence_subjects (
      merchant_id, location_id, enrollment_id, contact_id, offer_id, normalized_email
    ) VALUES (
      resolved_merchant_id, NEW.location_id, NEW.id, NEW.contact_id, NEW.offer_id, lower(trim(NEW.email))
    )
    ON CONFLICT (enrollment_id) DO UPDATE SET
      contact_id = EXCLUDED.contact_id,
      offer_id = EXCLUDED.offer_id,
      normalized_email = EXCLUDED.normalized_email,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enrollments_evidence_subject ON enrollments;
CREATE TRIGGER enrollments_evidence_subject
  AFTER INSERT OR UPDATE OF contact_id, offer_id, email, merchant_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION ensure_evidence_subject_for_enrollment();

INSERT INTO evidence_subjects (
  merchant_id, location_id, enrollment_id, contact_id, offer_id, normalized_email
)
SELECT
  COALESCE(e.merchant_id, m.id), e.location_id, e.id, e.contact_id, e.offer_id, lower(trim(e.email))
FROM enrollments e
JOIN merchants m ON m.location_id = e.location_id
WHERE COALESCE(e.merchant_id, m.id) IS NOT NULL
  AND e.contact_id IS NOT NULL
ON CONFLICT (enrollment_id) DO UPDATE SET
  contact_id = EXCLUDED.contact_id,
  offer_id = EXCLUDED.offer_id,
  normalized_email = EXCLUDED.normalized_email,
  updated_at = now();

CREATE OR REPLACE FUNCTION consume_evidence_connection_rate_limit(
  p_connection_id UUID,
  p_limit INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  bucket TIMESTAMPTZ := date_trunc('minute', now());
  current_count INTEGER;
BEGIN
  INSERT INTO evidence_connection_rate_limits(connection_id, window_start, request_count)
  VALUES (p_connection_id, bucket, 1)
  ON CONFLICT (connection_id)
  DO UPDATE SET
    window_start = bucket,
    request_count = CASE
      WHEN evidence_connection_rate_limits.window_start = bucket
        THEN evidence_connection_rate_limits.request_count + 1
      ELSE 1
    END
  RETURNING request_count INTO current_count;

  RETURN current_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION claim_external_evidence_events(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF external_evidence_events AS $$
BEGIN
  RETURN QUERY
  UPDATE external_evidence_events event
  SET
    status = 'resolving',
    attempts = event.attempts + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  WHERE event.id IN (
    SELECT candidate.id
    FROM external_evidence_events candidate
    WHERE candidate.status IN ('received', 'verified', 'retrying')
      AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= now())
      AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= now())
    ORDER BY candidate.received_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING event.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION consume_evidence_connection_rate_limit(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_external_evidence_events(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_evidence_connection_rate_limit(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_external_evidence_events(INTEGER, TEXT, INTEGER) TO service_role;

DROP TRIGGER IF EXISTS evidence_connections_updated_at ON evidence_connections;
CREATE TRIGGER evidence_connections_updated_at
  BEFORE UPDATE ON evidence_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS evidence_resource_mappings_updated_at ON evidence_resource_mappings;
CREATE TRIGGER evidence_resource_mappings_updated_at
  BEFORE UPDATE ON evidence_resource_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS evidence_subjects_updated_at ON evidence_subjects;
CREATE TRIGGER evidence_subjects_updated_at
  BEFORE UPDATE ON evidence_subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
