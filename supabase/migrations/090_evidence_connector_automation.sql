-- Migration 090: operator-managed evidence connector automation and exact enrollment binding.

DO $$
BEGIN
  IF to_regclass('public.evidence_connections') IS NULL
     OR to_regclass('public.evidence_resource_mappings') IS NULL
     OR to_regclass('public.evidence_subject_identities') IS NULL
     OR to_regclass('public.evidence_subjects') IS NULL
     OR to_regclass('public.enrollments') IS NULL THEN
    RAISE EXCEPTION 'Migration 090 preflight failed: migration 089 connector tables are missing';
  END IF;
END $$;

ALTER TABLE evidence_connections
  ADD COLUMN IF NOT EXISTS setup_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS setup_mode TEXT NOT NULL DEFAULT 'operator_managed',
  ADD COLUMN IF NOT EXISTS identity_strategy TEXT NOT NULL DEFAULT 'external_enrollment',
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS configured_by TEXT;

ALTER TABLE evidence_connections
  DROP CONSTRAINT IF EXISTS evidence_connections_setup_status_check;
ALTER TABLE evidence_connections
  ADD CONSTRAINT evidence_connections_setup_status_check
  CHECK (setup_status IN ('draft', 'testing', 'active', 'needs_attention', 'disabled'));

ALTER TABLE evidence_connections
  DROP CONSTRAINT IF EXISTS evidence_connections_setup_mode_check;
ALTER TABLE evidence_connections
  ADD CONSTRAINT evidence_connections_setup_mode_check
  CHECK (setup_mode IN ('operator_managed', 'developer_api', 'native_adapter'));

ALTER TABLE evidence_connections
  DROP CONSTRAINT IF EXISTS evidence_connections_identity_strategy_check;
ALTER TABLE evidence_connections
  ADD CONSTRAINT evidence_connections_identity_strategy_check
  CHECK (identity_strategy IN ('enrollment_context', 'external_enrollment', 'external_contact_resource', 'email_resource_bootstrap'));

UPDATE evidence_connections
SET
  setup_status = CASE
    WHEN connection_type = 'legacy_external' THEN 'active'
    ELSE 'testing'
  END,
  setup_mode = 'operator_managed',
  identity_strategy = CASE
    WHEN connection_type = 'canonical_api' THEN 'enrollment_context'
    ELSE 'external_enrollment'
  END,
  activated_at = CASE
    WHEN connection_type = 'legacy_external' THEN COALESCE(activated_at, created_at)
    ELSE activated_at
  END
WHERE setup_status = 'draft';

ALTER TABLE evidence_resource_mappings
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS proposed_match_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE evidence_resource_mappings
  DROP CONSTRAINT IF EXISTS evidence_resource_mappings_approval_status_check;
ALTER TABLE evidence_resource_mappings
  ADD CONSTRAINT evidence_resource_mappings_approval_status_check
  CHECK (approval_status IN ('proposed', 'approved', 'rejected'));

UPDATE evidence_resource_mappings
SET
  approval_status = 'approved',
  proposed_match_confidence = COALESCE(proposed_match_confidence, 1),
  approved_by = COALESCE(approved_by, 'migration_090'),
  approved_at = COALESCE(approved_at, created_at)
WHERE approval_status = 'proposed';

CREATE TABLE IF NOT EXISTS evidence_enrollment_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  external_contact_id TEXT NOT NULL,
  external_enrollment_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  external_resource_id TEXT NOT NULL,
  offer_id UUID NOT NULL REFERENCES offers_mirror(id) ON DELETE CASCADE,
  checkout_mode TEXT NOT NULL CHECK (checkout_mode IN ('full_enrollment', 'quick_checkout')),
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'attached', 'bound', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ,
  bound_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  binding_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, request_id),
  UNIQUE (connection_id, external_enrollment_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_enrollment_contexts_expiry
  ON evidence_enrollment_contexts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_evidence_enrollment_contexts_enrollment
  ON evidence_enrollment_contexts(location_id, enrollment_id)
  WHERE enrollment_id IS NOT NULL;

ALTER TABLE evidence_subject_identities
  ADD COLUMN IF NOT EXISTS binding_method TEXT,
  ADD COLUMN IF NOT EXISTS source_context_id UUID REFERENCES evidence_enrollment_contexts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE evidence_enrollment_contexts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS evidence_enrollment_contexts_updated_at ON evidence_enrollment_contexts;
CREATE TRIGGER evidence_enrollment_contexts_updated_at
  BEFORE UPDATE ON evidence_enrollment_contexts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION claim_evidence_enrollment_context(
  p_token_hash TEXT,
  p_offer_id UUID,
  p_email TEXT DEFAULT NULL,
  p_device_evidence JSONB DEFAULT NULL
)
RETURNS TABLE (
  context_id UUID,
  enrollment_id UUID,
  location_id TEXT,
  merchant_id UUID,
  offer_id UUID,
  context_status TEXT
) AS $$
DECLARE
  context_row evidence_enrollment_contexts%ROWTYPE;
  connection_row evidence_connections%ROWTYPE;
  enrollment_row enrollments%ROWTYPE;
BEGIN
  SELECT * INTO context_row
  FROM evidence_enrollment_contexts
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence enrollment context is invalid';
  END IF;

  IF context_row.offer_id <> p_offer_id THEN
    RAISE EXCEPTION 'Evidence enrollment context does not match this offer';
  END IF;

  IF context_row.status IN ('bound', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'Evidence enrollment context is no longer active';
  END IF;

  IF context_row.expires_at <= now() THEN
    UPDATE evidence_enrollment_contexts
    SET status = 'expired', token_encrypted = NULL
    WHERE id = context_row.id;
    RAISE EXCEPTION 'Evidence enrollment context has expired';
  END IF;

  SELECT * INTO connection_row
  FROM evidence_connections
  WHERE id = context_row.connection_id;

  IF NOT FOUND
     OR connection_row.location_id <> context_row.location_id
     OR connection_row.status <> 'active'
     OR connection_row.setup_status <> 'active' THEN
    RAISE EXCEPTION 'Evidence connection is not active';
  END IF;

  IF context_row.enrollment_id IS NULL THEN
    INSERT INTO enrollments (
      location_id,
      merchant_id,
      offer_id,
      email,
      status,
      device_evidence
    ) VALUES (
      context_row.location_id,
      context_row.merchant_id,
      context_row.offer_id,
      NULLIF(lower(trim(p_email)), ''),
      'device_captured',
      p_device_evidence
    )
    RETURNING * INTO enrollment_row;

    UPDATE evidence_enrollment_contexts
    SET
      enrollment_id = enrollment_row.id,
      status = 'attached',
      attached_at = now(),
      binding_error = NULL
    WHERE id = context_row.id
    RETURNING * INTO context_row;
  ELSE
    SELECT * INTO enrollment_row
    FROM enrollments
    WHERE id = context_row.enrollment_id
      AND location_id = context_row.location_id
      AND offer_id = context_row.offer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evidence enrollment context enrollment is invalid';
    END IF;

    UPDATE enrollments
    SET
      email = COALESCE(NULLIF(lower(trim(p_email)), ''), email),
      device_evidence = COALESCE(p_device_evidence, device_evidence)
    WHERE id = enrollment_row.id;
  END IF;

  RETURN QUERY SELECT
    context_row.id,
    context_row.enrollment_id,
    context_row.location_id,
    context_row.merchant_id,
    context_row.offer_id,
    context_row.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION bind_evidence_context_for_subject()
RETURNS TRIGGER AS $$
DECLARE
  context_row evidence_enrollment_contexts%ROWTYPE;
  conflicting_subject UUID;
BEGIN
  FOR context_row IN
    SELECT *
    FROM evidence_enrollment_contexts
    WHERE enrollment_id = NEW.enrollment_id
      AND location_id = NEW.location_id
      AND status = 'attached'
    FOR UPDATE
  LOOP
    SELECT subject_id INTO conflicting_subject
    FROM evidence_subject_identities
    WHERE connection_id = context_row.connection_id
      AND external_enrollment_id = context_row.external_enrollment_id
      AND subject_id <> NEW.id
    LIMIT 1;

    IF conflicting_subject IS NOT NULL THEN
      UPDATE evidence_enrollment_contexts
      SET
        status = 'revoked',
        revoked_at = now(),
        token_encrypted = NULL,
        binding_error = 'External enrollment identity is already bound to another enrollment'
      WHERE id = context_row.id;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM evidence_subject_identities
      WHERE connection_id = context_row.connection_id
        AND subject_id = NEW.id
        AND external_contact_id = context_row.external_contact_id
    ) THEN
      INSERT INTO evidence_subject_identities (
        connection_id, subject_id, location_id, external_contact_id,
        binding_method, source_context_id, verification_metadata
      ) VALUES (
        context_row.connection_id, NEW.id, NEW.location_id, context_row.external_contact_id,
        'enrollment_context', context_row.id,
        jsonb_build_object('resource_type', context_row.resource_type, 'external_resource_id', context_row.external_resource_id)
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM evidence_subject_identities
      WHERE connection_id = context_row.connection_id
        AND external_enrollment_id = context_row.external_enrollment_id
    ) THEN
      INSERT INTO evidence_subject_identities (
        connection_id, subject_id, location_id, external_enrollment_id,
        binding_method, source_context_id, verification_metadata
      ) VALUES (
        context_row.connection_id, NEW.id, NEW.location_id, context_row.external_enrollment_id,
        'enrollment_context', context_row.id,
        jsonb_build_object('resource_type', context_row.resource_type, 'external_resource_id', context_row.external_resource_id)
      );
    END IF;

    UPDATE evidence_enrollment_contexts
    SET
      status = 'bound',
      bound_at = now(),
      token_encrypted = NULL,
      binding_error = NULL
    WHERE id = context_row.id;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS evidence_subject_bind_context ON evidence_subjects;
CREATE TRIGGER evidence_subject_bind_context
  AFTER INSERT OR UPDATE OF contact_id, offer_id ON evidence_subjects
  FOR EACH ROW EXECUTE FUNCTION bind_evidence_context_for_subject();

CREATE OR REPLACE FUNCTION expire_evidence_enrollment_contexts()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE evidence_enrollment_contexts
  SET status = 'expired', token_encrypted = NULL
  WHERE status IN ('pending', 'attached')
    AND expires_at <= now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_evidence_enrollment_context(TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION bind_evidence_context_for_subject() FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_evidence_enrollment_contexts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evidence_enrollment_context(TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION expire_evidence_enrollment_contexts() TO service_role;

NOTIFY pgrst, 'reload schema';
