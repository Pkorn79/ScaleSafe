-- 107_operator_identity_and_authorization.sql
-- Phase 1 foundation for the isolated ScaleSafe operator command center.
-- Browser access remains backend-only; PUBLIC, anon, and authenticated roles
-- receive no table or function access from this migration.

DO $$
BEGIN
  IF scalesafe_schema_version() <> 106 THEN
    RAISE EXCEPTION 'Migration 107 requires ScaleSafe schema version 106';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS operator_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_type TEXT NOT NULL CHECK (organization_type IN ('platform', 'reseller')),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  external_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_organizations_single_platform
  ON operator_organizations (organization_type)
  WHERE organization_type = 'platform';

CREATE TABLE IF NOT EXISTS operator_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'disabled')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND position('@' IN email_normalized) > 1
    AND length(email_normalized) <= 320
  )
);

CREATE TABLE IF NOT EXISTS operator_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES operator_organizations(id) ON DELETE RESTRICT,
  operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN (
    'platform_owner',
    'platform_ops',
    'platform_support',
    'security_auditor',
    'reseller_owner',
    'reseller_operator',
    'reseller_viewer'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  invited_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status <> 'active' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_memberships_one_active_org
  ON operator_memberships (operator_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_operator_memberships_org_status
  ON operator_memberships (organization_id, status, role);

CREATE TABLE IF NOT EXISTS reseller_merchant_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_organization_id UUID NOT NULL REFERENCES operator_organizations(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL CHECK (length(btrim(location_id)) BETWEEN 1 AND 100),
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  relationship_type TEXT NOT NULL DEFAULT 'primary' CHECK (relationship_type = 'primary'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  assigned_by_operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  ended_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND ended_at IS NULL AND ended_by_operator_user_id IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL AND ended_by_operator_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_assignments_one_active_primary
  ON reseller_merchant_assignments (location_id)
  WHERE status = 'active' AND relationship_type = 'primary';

CREATE INDEX IF NOT EXISTS idx_reseller_assignments_org_active
  ON reseller_merchant_assignments (reseller_organization_id, location_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS operator_support_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL CHECK (length(btrim(location_id)) BETWEEN 1 AND 100),
  permission_bundle TEXT NOT NULL CHECK (permission_bundle IN ('merchant_support_read')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  requested_by_operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  approved_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  revoked_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at),
  CHECK (
    approved_by_operator_user_id IS NULL
    OR approved_by_operator_user_id <> requested_by_operator_user_id
  ),
  CHECK (
    (status = 'pending' AND approved_by_operator_user_id IS NULL AND approved_at IS NULL AND revoked_at IS NULL)
    OR (status = 'active' AND approved_by_operator_user_id IS NOT NULL AND approved_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_by_operator_user_id IS NOT NULL AND revoked_at IS NOT NULL)
    OR (status = 'expired')
  )
);

CREATE INDEX IF NOT EXISTS idx_operator_support_grants_live
  ON operator_support_grants (grantee_operator_user_id, location_id, status, expires_at);

CREATE TABLE IF NOT EXISTS operator_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES operator_organizations(id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK (role IN (
    'platform_owner',
    'platform_ops',
    'platform_support',
    'security_auditor',
    'reseller_owner',
    'reseller_operator',
    'reseller_viewer'
  )),
  invite_token_hash CHAR(64) NOT NULL UNIQUE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN (
    'provisioning', 'pending', 'accepting', 'accepted', 'revoked', 'expired', 'failed'
  )),
  invited_by_operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  accepted_operator_user_id UUID REFERENCES operator_users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  acceptance_started_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND position('@' IN email_normalized) > 1
    AND length(email_normalized) <= 320
  ),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_invitations_one_pending_email
  ON operator_invitations (organization_id, email_normalized)
  WHERE status IN ('provisioning', 'pending', 'accepting');

CREATE INDEX IF NOT EXISTS idx_operator_invitations_status_expiry
  ON operator_invitations (status, expires_at);

CREATE TABLE IF NOT EXISTS operator_auth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_token_hash CHAR(64) NOT NULL UNIQUE,
  operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  mfa_factor_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('mfa_enrollment', 'mfa_required', 'verified', 'expired', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_address_hash CHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (state IN ('mfa_enrollment', 'mfa_required') AND consumed_at IS NULL)
    OR (state IN ('verified', 'expired', 'failed'))
  )
);

CREATE INDEX IF NOT EXISTS idx_operator_auth_attempts_expiry
  ON operator_auth_attempts (state, expires_at);

CREATE TABLE IF NOT EXISTS operator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token_hash CHAR(64) NOT NULL,
  operator_user_id UUID NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES operator_organizations(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES operator_memberships(id) ON DELETE RESTRICT,
  auth_assurance TEXT NOT NULL CHECK (auth_assurance = 'aal2'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_operator_user_id UUID REFERENCES operator_users(id) ON DELETE RESTRICT,
  revocation_reason TEXT,
  ip_address_hash CHAR(64),
  user_agent TEXT,
  CHECK (idle_expires_at > created_at),
  CHECK (absolute_expires_at >= idle_expires_at)
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_live
  ON operator_sessions (operator_user_id, idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS operator_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  request_id TEXT,
  actor_operator_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  actor_organization_id UUID REFERENCES operator_organizations(id) ON DELETE SET NULL,
  actor_role TEXT,
  actor_session_id UUID REFERENCES operator_sessions(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 160),
  result TEXT NOT NULL CHECK (result IN ('intent', 'allowed', 'denied', 'succeeded', 'failed')),
  target_location_id TEXT,
  target_type TEXT,
  target_id TEXT,
  ip_address_hash CHAR(64),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_events_actor_time
  ON operator_audit_events (actor_operator_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_audit_events_location_time
  ON operator_audit_events (target_location_id, occurred_at DESC)
  WHERE target_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operator_audit_events_correlation
  ON operator_audit_events (correlation_id, occurred_at);

CREATE TABLE IF NOT EXISTS operator_rate_limit_buckets (
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('login_account', 'login_ip', 'invite_token', 'invite_ip')),
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_type, key_hash)
);

INSERT INTO operator_organizations (
  id,
  organization_type,
  name,
  status,
  external_reference
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'platform',
  'ScaleSafe / WholePay',
  'active',
  'scalesafe-platform'
)
ON CONFLICT (external_reference) DO UPDATE
SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = now();

CREATE OR REPLACE FUNCTION validate_operator_membership()
RETURNS TRIGGER AS $$
DECLARE
  v_org_type TEXT;
  v_org_status TEXT;
  v_user_status TEXT;
BEGIN
  SELECT organization_type, status
  INTO v_org_type, v_org_status
  FROM operator_organizations
  WHERE id = NEW.organization_id;

  SELECT status
  INTO v_user_status
  FROM operator_users
  WHERE id = NEW.operator_user_id;

  IF v_org_type IS NULL OR v_user_status IS NULL THEN
    RAISE EXCEPTION 'Operator membership references an unknown organization or user';
  END IF;

  IF NEW.status = 'active' AND (v_org_status <> 'active' OR v_user_status <> 'active') THEN
    RAISE EXCEPTION 'Active membership requires an active organization and operator user';
  END IF;

  IF v_org_type = 'platform' AND NEW.role NOT IN (
    'platform_owner', 'platform_ops', 'platform_support', 'security_auditor'
  ) THEN
    RAISE EXCEPTION 'Role % is not valid for a platform organization', NEW.role;
  END IF;

  IF v_org_type = 'reseller' AND NEW.role NOT IN (
    'reseller_owner', 'reseller_operator', 'reseller_viewer'
  ) THEN
    RAISE EXCEPTION 'Role % is not valid for a reseller organization', NEW.role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS operator_memberships_validate ON operator_memberships;
CREATE TRIGGER operator_memberships_validate
  BEFORE INSERT OR UPDATE ON operator_memberships
  FOR EACH ROW EXECUTE FUNCTION validate_operator_membership();

CREATE OR REPLACE FUNCTION operator_user_has_active_role(
  p_operator_user_id UUID,
  p_roles TEXT[]
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM operator_memberships membership
    JOIN operator_users operator_user ON operator_user.id = membership.operator_user_id
    JOIN operator_organizations organization ON organization.id = membership.organization_id
    WHERE membership.operator_user_id = p_operator_user_id
      AND membership.status = 'active'
      AND membership.role = ANY(p_roles)
      AND operator_user.status = 'active'
      AND organization.status = 'active'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION validate_operator_invitation()
RETURNS TRIGGER AS $$
DECLARE
  v_org_type TEXT;
  v_org_status TEXT;
  v_inviter_org UUID;
  v_inviter_role TEXT;
BEGIN
  SELECT organization_type, status
  INTO v_org_type, v_org_status
  FROM operator_organizations
  WHERE id = NEW.organization_id;

  SELECT membership.organization_id, membership.role
  INTO v_inviter_org, v_inviter_role
  FROM operator_memberships membership
  JOIN operator_users operator_user ON operator_user.id = membership.operator_user_id
  JOIN operator_organizations organization ON organization.id = membership.organization_id
  WHERE membership.operator_user_id = NEW.invited_by_operator_user_id
    AND membership.status = 'active'
    AND operator_user.status = 'active'
    AND organization.status = 'active';

  IF v_org_type IS NULL OR v_org_status <> 'active' THEN
    RAISE EXCEPTION 'Invitation target organization is not active';
  END IF;

  IF v_org_type = 'platform' THEN
    IF v_inviter_role <> 'platform_owner' OR v_inviter_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'Only a platform owner may invite platform operators';
    END IF;
    IF NEW.role NOT IN ('platform_owner', 'platform_ops', 'platform_support', 'security_auditor') THEN
      RAISE EXCEPTION 'Invalid platform invitation role';
    END IF;
  ELSE
    IF NOT (
      v_inviter_role = 'platform_owner'
      OR (v_inviter_role = 'reseller_owner' AND v_inviter_org = NEW.organization_id)
    ) THEN
      RAISE EXCEPTION 'Inviter cannot administer this reseller organization';
    END IF;
    IF NEW.role NOT IN ('reseller_owner', 'reseller_operator', 'reseller_viewer') THEN
      RAISE EXCEPTION 'Invalid reseller invitation role';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS operator_invitations_validate ON operator_invitations;
CREATE TRIGGER operator_invitations_validate
  BEFORE INSERT OR UPDATE ON operator_invitations
  FOR EACH ROW EXECUTE FUNCTION validate_operator_invitation();

CREATE OR REPLACE FUNCTION validate_reseller_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_org_type TEXT;
  v_org_status TEXT;
  v_merchant_location TEXT;
BEGIN
  SELECT organization_type, status
  INTO v_org_type, v_org_status
  FROM operator_organizations
  WHERE id = NEW.reseller_organization_id;

  IF v_org_type <> 'reseller' OR v_org_status <> 'active' THEN
    RAISE EXCEPTION 'Assignment requires an active reseller organization';
  END IF;

  IF NOT operator_user_has_active_role(
    CASE WHEN TG_OP = 'INSERT' THEN NEW.assigned_by_operator_user_id ELSE COALESCE(NEW.ended_by_operator_user_id, NEW.assigned_by_operator_user_id) END,
    ARRAY['platform_owner']
  ) THEN
    RAISE EXCEPTION 'Assignment changes require an active platform owner';
  END IF;

  IF NEW.merchant_id IS NOT NULL THEN
    SELECT location_id INTO v_merchant_location FROM merchants WHERE id = NEW.merchant_id;
    IF v_merchant_location IS NULL OR v_merchant_location <> NEW.location_id THEN
      RAISE EXCEPTION 'Assignment merchant does not match location_id';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS reseller_assignments_validate ON reseller_merchant_assignments;
CREATE TRIGGER reseller_assignments_validate
  BEFORE INSERT OR UPDATE ON reseller_merchant_assignments
  FOR EACH ROW EXECUTE FUNCTION validate_reseller_assignment();

CREATE OR REPLACE FUNCTION validate_operator_support_grant()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT operator_user_has_active_role(
    NEW.grantee_operator_user_id,
    ARRAY['platform_support']
  ) THEN
    RAISE EXCEPTION 'Support grants are limited to active platform support users';
  END IF;

  IF NOT operator_user_has_active_role(
    NEW.requested_by_operator_user_id,
    ARRAY['platform_owner', 'platform_ops']
  ) THEN
    RAISE EXCEPTION 'Support grant requester is not authorized';
  END IF;

  IF NEW.approved_by_operator_user_id IS NOT NULL AND NOT operator_user_has_active_role(
    NEW.approved_by_operator_user_id,
    ARRAY['platform_owner']
  ) THEN
    RAISE EXCEPTION 'Support grant approver must be an active platform owner';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM merchants WHERE location_id = NEW.location_id) THEN
    RAISE EXCEPTION 'Support grant location does not exist';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS operator_support_grants_validate ON operator_support_grants;
CREATE TRIGGER operator_support_grants_validate
  BEFORE INSERT OR UPDATE ON operator_support_grants
  FOR EACH ROW EXECUTE FUNCTION validate_operator_support_grant();

CREATE OR REPLACE FUNCTION prevent_operator_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'operator_audit_events is append-only';
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS operator_audit_events_immutable ON operator_audit_events;
CREATE TRIGGER operator_audit_events_immutable
  BEFORE UPDATE OR DELETE ON operator_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_operator_audit_mutation();

CREATE OR REPLACE FUNCTION consume_operator_rate_limit(
  p_bucket_type TEXT,
  p_key_hash TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_bucket operator_rate_limit_buckets%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_bucket_type NOT IN ('login_account', 'login_ip', 'invite_token', 'invite_ip')
     OR p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_max_requests < 1
     OR p_window_seconds < 1
     OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid operator rate limit request';
  END IF;

  INSERT INTO operator_rate_limit_buckets (
    bucket_type, key_hash, window_started_at, request_count, updated_at
  ) VALUES (
    p_bucket_type, p_key_hash, v_now, 0, v_now
  )
  ON CONFLICT (bucket_type, key_hash) DO NOTHING;

  SELECT * INTO v_bucket
  FROM operator_rate_limit_buckets
  WHERE bucket_type = p_bucket_type AND key_hash = p_key_hash
  FOR UPDATE;

  IF v_bucket.blocked_until IS NOT NULL AND v_bucket.blocked_until > v_now THEN
    RETURN false;
  END IF;

  IF v_bucket.window_started_at + make_interval(secs => p_window_seconds) <= v_now THEN
    UPDATE operator_rate_limit_buckets
    SET
      window_started_at = v_now,
      request_count = 1,
      blocked_until = NULL,
      updated_at = v_now
    WHERE bucket_type = p_bucket_type AND key_hash = p_key_hash;
    RETURN true;
  END IF;

  UPDATE operator_rate_limit_buckets
  SET
    request_count = request_count + 1,
    blocked_until = CASE
      WHEN request_count + 1 > p_max_requests
      THEN v_bucket.window_started_at + make_interval(secs => p_window_seconds)
      ELSE NULL
    END,
    updated_at = v_now
  WHERE bucket_type = p_bucket_type AND key_hash = p_key_hash
  RETURNING * INTO v_bucket;

  RETURN v_bucket.request_count <= p_max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION record_operator_auth_attempt_failure(
  p_attempt_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE operator_auth_attempts
  SET
    attempt_count = attempt_count + 1,
    state = CASE WHEN attempt_count + 1 >= 6 THEN 'failed' ELSE state END,
    consumed_at = CASE WHEN attempt_count + 1 >= 6 THEN now() ELSE consumed_at END,
    access_token_encrypted = CASE WHEN attempt_count + 1 >= 6 THEN NULL ELSE access_token_encrypted END,
    refresh_token_encrypted = CASE WHEN attempt_count + 1 >= 6 THEN NULL ELSE refresh_token_encrypted END,
    updated_at = now()
  WHERE id = p_attempt_id
    AND state IN ('mfa_enrollment', 'mfa_required')
    AND consumed_at IS NULL
  RETURNING attempt_count INTO v_count;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION create_operator_reseller_organization(
  p_name TEXT,
  p_external_reference TEXT,
  p_actor_operator_user_id UUID,
  p_correlation_id UUID
)
RETURNS operator_organizations AS $$
DECLARE
  v_result operator_organizations%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(p_actor_operator_user_id, ARRAY['platform_owner']) THEN
    RAISE EXCEPTION 'Reseller creation requires an active platform owner';
  END IF;
  IF length(btrim(COALESCE(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Reseller organization name is required';
  END IF;

  INSERT INTO operator_organizations (
    organization_type,
    name,
    status,
    external_reference
  ) VALUES (
    'reseller',
    left(btrim(p_name), 200),
    'active',
    NULLIF(left(btrim(COALESCE(p_external_reference, '')), 200), '')
  )
  RETURNING * INTO v_result;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    action,
    result,
    target_type,
    target_id,
    metadata
  ) VALUES (
    p_correlation_id,
    p_actor_operator_user_id,
    'operator.organization.create',
    'succeeded',
    'operator_organization',
    v_result.id::text,
    jsonb_build_object('organization_type', 'reseller')
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION request_operator_support_grant(
  p_grantee_operator_user_id UUID,
  p_location_id TEXT,
  p_reason TEXT,
  p_starts_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ,
  p_requested_by_operator_user_id UUID,
  p_correlation_id UUID
)
RETURNS operator_support_grants AS $$
DECLARE
  v_result operator_support_grants%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(
    p_requested_by_operator_user_id,
    ARRAY['platform_owner', 'platform_ops']
  ) THEN
    RAISE EXCEPTION 'Support grant requester is not authorized';
  END IF;
  IF p_expires_at <= p_starts_at OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Support grant expiration is invalid';
  END IF;

  INSERT INTO operator_support_grants (
    grantee_operator_user_id,
    location_id,
    permission_bundle,
    reason,
    status,
    starts_at,
    expires_at,
    requested_by_operator_user_id
  ) VALUES (
    p_grantee_operator_user_id,
    p_location_id,
    'merchant_support_read',
    left(btrim(p_reason), 500),
    'pending',
    p_starts_at,
    p_expires_at,
    p_requested_by_operator_user_id
  )
  RETURNING * INTO v_result;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    action,
    result,
    target_location_id,
    target_type,
    target_id
  ) VALUES (
    p_correlation_id,
    p_requested_by_operator_user_id,
    'operator.support_grant.request',
    'succeeded',
    p_location_id,
    'operator_support_grant',
    v_result.id::text
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION approve_operator_support_grant(
  p_grant_id UUID,
  p_approver_operator_user_id UUID,
  p_correlation_id UUID
)
RETURNS operator_support_grants AS $$
DECLARE
  v_result operator_support_grants%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(p_approver_operator_user_id, ARRAY['platform_owner']) THEN
    RAISE EXCEPTION 'Support grant approver must be an active platform owner';
  END IF;

  UPDATE operator_support_grants
  SET
    status = 'active',
    approved_by_operator_user_id = p_approver_operator_user_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_grant_id
    AND status = 'pending'
    AND requested_by_operator_user_id <> p_approver_operator_user_id
    AND expires_at > now()
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RETURN v_result;
  END IF;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    action,
    result,
    target_location_id,
    target_type,
    target_id
  ) VALUES (
    p_correlation_id,
    p_approver_operator_user_id,
    'operator.support_grant.approve',
    'succeeded',
    v_result.location_id,
    'operator_support_grant',
    v_result.id::text
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION revoke_operator_support_grant(
  p_grant_id UUID,
  p_actor_operator_user_id UUID,
  p_correlation_id UUID
)
RETURNS operator_support_grants AS $$
DECLARE
  v_result operator_support_grants%ROWTYPE;
BEGIN
  IF NOT operator_user_has_active_role(p_actor_operator_user_id, ARRAY['platform_owner']) THEN
    RAISE EXCEPTION 'Support grant revocation requires an active platform owner';
  END IF;

  UPDATE operator_support_grants
  SET
    status = 'revoked',
    revoked_by_operator_user_id = p_actor_operator_user_id,
    revoked_at = now(),
    updated_at = now()
  WHERE id = p_grant_id
    AND status IN ('pending', 'active')
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RETURN v_result;
  END IF;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    action,
    result,
    target_location_id,
    target_type,
    target_id
  ) VALUES (
    p_correlation_id,
    p_actor_operator_user_id,
    'operator.support_grant.revoke',
    'succeeded',
    v_result.location_id,
    'operator_support_grant',
    v_result.id::text
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION transfer_primary_reseller_assignment(
  p_location_id TEXT,
  p_reseller_organization_id UUID,
  p_actor_operator_user_id UUID,
  p_reason TEXT,
  p_correlation_id UUID
)
RETURNS reseller_merchant_assignments AS $$
DECLARE
  v_existing reseller_merchant_assignments%ROWTYPE;
  v_result reseller_merchant_assignments%ROWTYPE;
  v_merchant_id UUID;
BEGIN
  IF length(btrim(COALESCE(p_location_id, ''))) = 0
     OR length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Location and assignment reason are required';
  END IF;

  IF NOT operator_user_has_active_role(p_actor_operator_user_id, ARRAY['platform_owner']) THEN
    RAISE EXCEPTION 'Assignment transfer requires an active platform owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operator_organizations
    WHERE id = p_reseller_organization_id
      AND organization_type = 'reseller'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Target reseller organization is not active';
  END IF;

  SELECT id INTO v_merchant_id FROM merchants WHERE location_id = p_location_id;
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Merchant location does not exist';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('operator-assignment:' || p_location_id, 0));

  SELECT * INTO v_existing
  FROM reseller_merchant_assignments
  WHERE location_id = p_location_id
    AND relationship_type = 'primary'
    AND status = 'active'
  FOR UPDATE;

  IF v_existing.id IS NOT NULL
     AND v_existing.reseller_organization_id = p_reseller_organization_id THEN
    RETURN v_existing;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE reseller_merchant_assignments
    SET
      status = 'ended',
      ended_at = now(),
      ended_by_operator_user_id = p_actor_operator_user_id,
      updated_at = now()
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO reseller_merchant_assignments (
    reseller_organization_id,
    location_id,
    merchant_id,
    relationship_type,
    status,
    assigned_by_operator_user_id,
    reason
  ) VALUES (
    p_reseller_organization_id,
    p_location_id,
    v_merchant_id,
    'primary',
    'active',
    p_actor_operator_user_id,
    btrim(p_reason)
  )
  RETURNING * INTO v_result;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    action,
    result,
    target_location_id,
    target_type,
    target_id,
    metadata
  ) VALUES (
    p_correlation_id,
    p_actor_operator_user_id,
    'operator.assignment.transfer',
    'succeeded',
    p_location_id,
    'reseller_merchant_assignment',
    v_result.id::text,
    jsonb_build_object(
      'previous_reseller_organization_id', v_existing.reseller_organization_id,
      'reseller_organization_id', p_reseller_organization_id
    )
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION claim_operator_invitation(
  p_invite_token_hash TEXT,
  p_email_normalized TEXT
)
RETURNS operator_invitations AS $$
DECLARE
  v_invitation operator_invitations%ROWTYPE;
BEGIN
  UPDATE operator_invitations invitation
  SET
    status = 'accepting',
    acceptance_started_at = now(),
    attempt_count = invitation.attempt_count + 1,
    last_error = NULL,
    updated_at = now()
  WHERE invitation.invite_token_hash = p_invite_token_hash
    AND invitation.email_normalized = lower(btrim(p_email_normalized))
    AND invitation.status = 'pending'
    AND invitation.auth_user_id IS NOT NULL
    AND invitation.expires_at > now()
  RETURNING invitation.* INTO v_invitation;

  RETURN v_invitation;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION release_operator_invitation(
  p_invitation_id UUID,
  p_error TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE operator_invitations
  SET
    status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'pending' END,
    acceptance_started_at = NULL,
    last_error = left(COALESCE(p_error, 'Invitation acceptance failed'), 500),
    updated_at = now()
  WHERE id = p_invitation_id
    AND status = 'accepting';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION complete_operator_invitation(
  p_invitation_id UUID,
  p_auth_user_id UUID,
  p_email_normalized TEXT,
  p_display_name TEXT
)
RETURNS operator_users AS $$
DECLARE
  v_invitation operator_invitations%ROWTYPE;
  v_operator_user operator_users%ROWTYPE;
  v_existing_membership operator_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation
  FROM operator_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF v_invitation.id IS NULL
     OR v_invitation.status <> 'accepting'
     OR v_invitation.expires_at <= now()
     OR v_invitation.auth_user_id <> p_auth_user_id
     OR v_invitation.email_normalized <> lower(btrim(p_email_normalized)) THEN
    RAISE EXCEPTION 'Invitation is invalid, expired, or already used';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    WHERE auth_user.id = p_auth_user_id
      AND lower(auth_user.email) = v_invitation.email_normalized
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invitation authentication identity is not email-confirmed';
  END IF;

  INSERT INTO operator_users (
    auth_user_id,
    email_normalized,
    display_name,
    status
  ) VALUES (
    p_auth_user_id,
    v_invitation.email_normalized,
    left(btrim(COALESCE(NULLIF(p_display_name, ''), v_invitation.display_name)), 200),
    'active'
  )
  ON CONFLICT (auth_user_id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    status = 'active',
    updated_at = now()
  WHERE operator_users.email_normalized = EXCLUDED.email_normalized
  RETURNING * INTO v_operator_user;

  IF v_operator_user.id IS NULL THEN
    RAISE EXCEPTION 'Authentication identity is already bound to a different operator email';
  END IF;

  SELECT * INTO v_existing_membership
  FROM operator_memberships
  WHERE operator_user_id = v_operator_user.id
    AND status = 'active';

  IF v_existing_membership.id IS NOT NULL AND (
    v_existing_membership.organization_id <> v_invitation.organization_id
    OR v_existing_membership.role <> v_invitation.role
  ) THEN
    RAISE EXCEPTION 'Operator already has a different active organization membership';
  END IF;

  IF v_existing_membership.id IS NULL THEN
    INSERT INTO operator_memberships (
      organization_id,
      operator_user_id,
      role,
      status,
      invited_by_operator_user_id
    ) VALUES (
      v_invitation.organization_id,
      v_operator_user.id,
      v_invitation.role,
      'active',
      v_invitation.invited_by_operator_user_id
    );
  END IF;

  UPDATE operator_invitations
  SET
    status = 'accepted',
    accepted_operator_user_id = v_operator_user.id,
    accepted_at = now(),
    updated_at = now()
  WHERE id = v_invitation.id;

  INSERT INTO operator_audit_events (
    actor_operator_user_id,
    action,
    result,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_operator_user.id,
    'operator.invitation.accept',
    'succeeded',
    'operator_invitation',
    v_invitation.id::text,
    jsonb_build_object(
      'organization_id', v_invitation.organization_id,
      'role', v_invitation.role
    )
  );

  RETURN v_operator_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION complete_operator_auth_attempt(
  p_attempt_token_hash TEXT,
  p_session_token_hash TEXT,
  p_csrf_token_hash TEXT,
  p_idle_expires_at TIMESTAMPTZ,
  p_absolute_expires_at TIMESTAMPTZ,
  p_ip_address_hash TEXT,
  p_user_agent TEXT
)
RETURNS operator_sessions AS $$
DECLARE
  v_attempt operator_auth_attempts%ROWTYPE;
  v_user operator_users%ROWTYPE;
  v_membership operator_memberships%ROWTYPE;
  v_organization operator_organizations%ROWTYPE;
  v_session operator_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM operator_auth_attempts
  WHERE attempt_token_hash = p_attempt_token_hash
  FOR UPDATE;

  IF v_attempt.id IS NULL
     OR v_attempt.state NOT IN ('mfa_enrollment', 'mfa_required')
     OR v_attempt.consumed_at IS NOT NULL
     OR v_attempt.expires_at <= now() THEN
    RAISE EXCEPTION 'Operator authentication attempt is invalid or expired';
  END IF;

  IF p_session_token_hash !~ '^[0-9a-f]{64}$'
     OR p_csrf_token_hash !~ '^[0-9a-f]{64}$'
     OR p_idle_expires_at <= now()
     OR p_absolute_expires_at < p_idle_expires_at THEN
    RAISE EXCEPTION 'Invalid operator session parameters';
  END IF;

  SELECT * INTO v_user
  FROM operator_users
  WHERE id = v_attempt.operator_user_id
    AND auth_user_id = v_attempt.auth_user_id
    AND email_normalized = v_attempt.email_normalized
    AND status = 'active';

  SELECT * INTO v_membership
  FROM operator_memberships
  WHERE operator_user_id = v_attempt.operator_user_id
    AND status = 'active';

  SELECT * INTO v_organization
  FROM operator_organizations
  WHERE id = v_membership.organization_id
    AND status = 'active';

  IF v_user.id IS NULL OR v_membership.id IS NULL OR v_organization.id IS NULL THEN
    RAISE EXCEPTION 'Operator identity is no longer active';
  END IF;

  INSERT INTO operator_sessions (
    session_token_hash,
    csrf_token_hash,
    operator_user_id,
    organization_id,
    membership_id,
    auth_assurance,
    idle_expires_at,
    absolute_expires_at,
    ip_address_hash,
    user_agent
  ) VALUES (
    p_session_token_hash,
    p_csrf_token_hash,
    v_user.id,
    v_organization.id,
    v_membership.id,
    'aal2',
    p_idle_expires_at,
    p_absolute_expires_at,
    NULLIF(p_ip_address_hash, ''),
    left(COALESCE(p_user_agent, ''), 500)
  )
  RETURNING * INTO v_session;

  UPDATE operator_auth_attempts
  SET
    state = 'verified',
    consumed_at = now(),
    access_token_encrypted = NULL,
    refresh_token_encrypted = NULL,
    updated_at = now()
  WHERE id = v_attempt.id;

  UPDATE operator_users
  SET last_login_at = now(), updated_at = now()
  WHERE id = v_user.id;

  INSERT INTO operator_audit_events (
    actor_operator_user_id,
    actor_organization_id,
    actor_role,
    actor_session_id,
    action,
    result,
    target_type,
    target_id,
    ip_address_hash,
    user_agent
  ) VALUES (
    v_user.id,
    v_organization.id,
    v_membership.role,
    v_session.id,
    'operator.auth.login',
    'succeeded',
    'operator_session',
    v_session.id::text,
    NULLIF(p_ip_address_hash, ''),
    left(COALESCE(p_user_agent, ''), 500)
  );

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION revoke_current_operator_session(
  p_session_id UUID,
  p_actor_operator_user_id UUID,
  p_reason TEXT,
  p_correlation_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_session operator_sessions%ROWTYPE;
  v_membership operator_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM operator_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_session.operator_user_id <> p_actor_operator_user_id THEN
    RETURN false;
  END IF;

  IF v_session.revoked_at IS NULL THEN
    UPDATE operator_sessions
    SET
      revoked_at = now(),
      revoked_by_operator_user_id = p_actor_operator_user_id,
      revocation_reason = left(COALESCE(NULLIF(btrim(p_reason), ''), 'logout'), 500)
    WHERE id = v_session.id;
  END IF;

  SELECT * INTO v_membership
  FROM operator_memberships
  WHERE id = v_session.membership_id;

  INSERT INTO operator_audit_events (
    correlation_id,
    actor_operator_user_id,
    actor_organization_id,
    actor_role,
    actor_session_id,
    action,
    result,
    target_type,
    target_id
  ) VALUES (
    p_correlation_id,
    p_actor_operator_user_id,
    v_session.organization_id,
    v_membership.role,
    v_session.id,
    'operator.auth.logout',
    'succeeded',
    'operator_session',
    v_session.id::text
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION bootstrap_platform_owner(
  p_auth_user_id UUID,
  p_email_normalized TEXT,
  p_display_name TEXT
)
RETURNS operator_users AS $$
DECLARE
  v_platform_org_id UUID;
  v_operator_user operator_users%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('scalesafe-platform-owner-bootstrap', 0));

  IF EXISTS (
    SELECT 1
    FROM operator_memberships
    WHERE role = 'platform_owner' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A platform owner already exists';
  END IF;

  SELECT id INTO v_platform_org_id
  FROM operator_organizations
  WHERE organization_type = 'platform' AND status = 'active';

  IF v_platform_org_id IS NULL THEN
    RAISE EXCEPTION 'Active platform organization is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users auth_user
    WHERE auth_user.id = p_auth_user_id
      AND lower(auth_user.email) = lower(btrim(p_email_normalized))
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Bootstrap authentication identity is not email-confirmed';
  END IF;

  INSERT INTO operator_users (
    auth_user_id,
    email_normalized,
    display_name,
    status
  ) VALUES (
    p_auth_user_id,
    lower(btrim(p_email_normalized)),
    left(btrim(p_display_name), 200),
    'active'
  )
  RETURNING * INTO v_operator_user;

  INSERT INTO operator_memberships (
    organization_id,
    operator_user_id,
    role,
    status
  ) VALUES (
    v_platform_org_id,
    v_operator_user.id,
    'platform_owner',
    'active'
  );

  INSERT INTO operator_audit_events (
    actor_operator_user_id,
    actor_organization_id,
    actor_role,
    action,
    result,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_operator_user.id,
    v_platform_org_id,
    'platform_owner',
    'operator.bootstrap.platform_owner',
    'succeeded',
    'operator_user',
    v_operator_user.id::text,
    jsonb_build_object('bootstrap', true)
  );

  RETURN v_operator_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'operator_organizations',
    'operator_users',
    'operator_memberships',
    'reseller_merchant_assignments',
    'operator_support_grants',
    'operator_invitations',
    'operator_auth_attempts',
    'operator_sessions',
    'operator_audit_events',
    'operator_rate_limit_buckets'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access',
      v_table
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION validate_operator_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION operator_user_has_active_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION validate_operator_invitation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION validate_reseller_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION validate_operator_support_grant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_operator_audit_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION consume_operator_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_operator_auth_attempt_failure(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_operator_reseller_organization(TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION request_operator_support_grant(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION approve_operator_support_grant(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION revoke_operator_support_grant(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION transfer_primary_reseller_assignment(TEXT, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_operator_invitation(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_operator_invitation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_operator_invitation(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_operator_auth_attempt(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION revoke_current_operator_session(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bootstrap_platform_owner(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION operator_user_has_active_role(UUID, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION consume_operator_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION record_operator_auth_attempt_failure(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_operator_reseller_organization(TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION request_operator_support_grant(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION approve_operator_support_grant(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_operator_support_grant(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION transfer_primary_reseller_assignment(TEXT, UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_operator_invitation(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION release_operator_invitation(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_operator_invitation(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_operator_auth_attempt(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_current_operator_session(UUID, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION bootstrap_platform_owner(UUID, TEXT, TEXT) TO service_role;

DROP TRIGGER IF EXISTS operator_organizations_updated_at ON operator_organizations;
CREATE TRIGGER operator_organizations_updated_at
  BEFORE UPDATE ON operator_organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS operator_users_updated_at ON operator_users;
CREATE TRIGGER operator_users_updated_at
  BEFORE UPDATE ON operator_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS operator_memberships_updated_at ON operator_memberships;
CREATE TRIGGER operator_memberships_updated_at
  BEFORE UPDATE ON operator_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS reseller_merchant_assignments_updated_at ON reseller_merchant_assignments;
CREATE TRIGGER reseller_merchant_assignments_updated_at
  BEFORE UPDATE ON reseller_merchant_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS operator_support_grants_updated_at ON operator_support_grants;
CREATE TRIGGER operator_support_grants_updated_at
  BEFORE UPDATE ON operator_support_grants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS operator_invitations_updated_at ON operator_invitations;
CREATE TRIGGER operator_invitations_updated_at
  BEFORE UPDATE ON operator_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS operator_auth_attempts_updated_at ON operator_auth_attempts;
CREATE TRIGGER operator_auth_attempts_updated_at
  BEFORE UPDATE ON operator_auth_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 107;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
