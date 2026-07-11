-- 092_integration_catalog_and_access_gating.sql
-- Provider catalog, tenant-scoped authorizations, external commerce truth,
-- per-offer access policy, and entitlement reconciliation.

DO $$
BEGIN
  IF to_regclass('public.evidence_connections') IS NULL
     OR to_regclass('public.evidence_resource_mappings') IS NULL
     OR to_regclass('public.offers_mirror') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'Migration 092 preflight failed: migrations 089 and 090 must be applied first';
  END IF;
END $$;

ALTER TABLE evidence_connections
  ADD COLUMN IF NOT EXISTS provider_key TEXT,
  ADD COLUMN IF NOT EXISTS auth_mode TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS external_account_name TEXT,
  ADD COLUMN IF NOT EXISTS provider_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE evidence_connections
  DROP CONSTRAINT IF EXISTS evidence_connections_connection_type_check;
ALTER TABLE evidence_connections
  ADD CONSTRAINT evidence_connections_connection_type_check
  CHECK (connection_type IN ('canonical_api', 'raw_webhook', 'legacy_external', 'provider_adapter'));

ALTER TABLE evidence_connections
  DROP CONSTRAINT IF EXISTS evidence_connections_auth_mode_check;
ALTER TABLE evidence_connections
  ADD CONSTRAINT evidence_connections_auth_mode_check
  CHECK (auth_mode IS NULL OR auth_mode IN ('native', 'oauth2', 'api_key', 'signed_webhook', 'guided_webhook', 'zapier'));

CREATE INDEX IF NOT EXISTS idx_evidence_connections_provider
  ON evidence_connections(location_id, provider_key, setup_status)
  WHERE provider_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS evidence_provider_releases (
  provider_key TEXT PRIMARY KEY,
  release_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (release_status IN ('native', 'available', 'beta', 'guided', 'planned', 'discovery', 'disabled')),
  wave INTEGER NOT NULL DEFAULT 0 CHECK (wave BETWEEN 0 AND 99),
  enabled_by_default BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_provider_location_releases (
  provider_key TEXT NOT NULL REFERENCES evidence_provider_releases(provider_key) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_key, location_id)
);

CREATE TABLE IF NOT EXISTS evidence_provider_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('oauth2', 'api_key', 'signed_webhook', 'guided_webhook', 'zapier')),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  api_secret_encrypted TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  external_account_id TEXT,
  external_account_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_provider_authorizations_tenant
  ON evidence_provider_authorizations(location_id, provider_key, status);

CREATE TABLE IF NOT EXISTS evidence_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE,
  location_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  requested_by TEXT,
  redirect_path TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_oauth_states_expiry
  ON evidence_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS external_commerce_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('purchase_paid', 'subscription_created', 'payment_succeeded', 'payment_failed', 'subscription_cancelled', 'full_refund', 'partial_refund', 'dunning_exhausted')),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'resolved', 'applied', 'duplicate', 'quarantined', 'rejected')),
  enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  contact_id TEXT,
  offer_id UUID REFERENCES offers_mirror(id) ON DELETE SET NULL,
  external_customer_id TEXT,
  external_enrollment_id TEXT,
  external_resource_id TEXT,
  external_transaction_id TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency TEXT,
  payload_hash TEXT NOT NULL,
  sanitized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_method TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_external_commerce_events_tenant
  ON external_commerce_events(location_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_commerce_events_enrollment
  ON external_commerce_events(location_id, enrollment_id, occurred_at DESC)
  WHERE enrollment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS offer_evidence_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  offer_id UUID NOT NULL REFERENCES offers_mirror(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES evidence_connections(id) ON DELETE SET NULL,
  provider_key TEXT NOT NULL,
  external_resource_type TEXT,
  external_resource_id TEXT,
  external_resource_name TEXT,
  access_mode TEXT NOT NULL DEFAULT 'evidence_only'
    CHECK (access_mode IN ('evidence_only', 'scalesafe_checkout_managed_access', 'scalesafe_consent_provider_checkout', 'provider_checkout_import')),
  grace_period_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_period_days BETWEEN 0 AND 90),
  revoke_on_cancellation BOOLEAN NOT NULL DEFAULT false,
  revoke_on_full_refund BOOLEAN NOT NULL DEFAULT false,
  revoke_on_dunning_exhausted BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  configured_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, provider_key, external_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_evidence_integrations_tenant
  ON offer_evidence_integrations(location_id, offer_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_evidence_integrations_primary
  ON offer_evidence_integrations(offer_id)
  WHERE is_primary = true AND active = true;

CREATE TABLE IF NOT EXISTS external_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES offers_mirror(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES offer_evidence_integrations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES evidence_connections(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  external_user_id TEXT,
  external_resource_id TEXT NOT NULL,
  desired_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (desired_state IN ('pending', 'active', 'grace', 'revoked')),
  actual_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (actual_state IN ('unknown', 'pending', 'active', 'grace', 'revoked', 'error')),
  state_reason TEXT,
  source_commerce_event_id UUID REFERENCES external_commerce_events(id) ON DELETE SET NULL,
  grace_expires_at TIMESTAMPTZ,
  last_sync_attempt_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, enrollment_id, external_resource_id)
);

CREATE INDEX IF NOT EXISTS idx_external_entitlements_worker
  ON external_entitlements(actual_state, next_sync_at, last_sync_attempt_at);
CREATE INDEX IF NOT EXISTS idx_external_entitlements_tenant
  ON external_entitlements(location_id, enrollment_id, provider_key);

CREATE OR REPLACE FUNCTION save_primary_offer_evidence_integration(
  p_location_id TEXT,
  p_offer_id UUID,
  p_connection_id UUID,
  p_provider_key TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_resource_name TEXT,
  p_access_mode TEXT,
  p_grace_period_days INTEGER,
  p_revoke_on_cancellation BOOLEAN,
  p_revoke_on_full_refund BOOLEAN,
  p_revoke_on_dunning_exhausted BOOLEAN,
  p_configured_by TEXT
)
RETURNS offer_evidence_integrations AS $$
DECLARE
  saved offer_evidence_integrations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM offers_mirror
    WHERE id = p_offer_id AND location_id = p_location_id
  ) THEN
    RAISE EXCEPTION 'Offer does not belong to this location';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM evidence_connections
    WHERE id = p_connection_id
      AND location_id = p_location_id
      AND provider_key = p_provider_key
      AND status = 'active'
      AND setup_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Evidence connection is not active for this location';
  END IF;

  UPDATE offer_evidence_integrations
  SET active = false, is_primary = false, updated_at = now()
  WHERE offer_id = p_offer_id AND is_primary = true AND active = true;

  INSERT INTO offer_evidence_integrations (
    location_id, offer_id, connection_id, provider_key,
    external_resource_type, external_resource_id, external_resource_name,
    access_mode, grace_period_days, revoke_on_cancellation,
    revoke_on_full_refund, revoke_on_dunning_exhausted,
    is_primary, active, configured_by
  ) VALUES (
    p_location_id, p_offer_id, p_connection_id, p_provider_key,
    p_resource_type, p_resource_id, p_resource_name,
    p_access_mode, GREATEST(0, LEAST(p_grace_period_days, 90)),
    p_revoke_on_cancellation, p_revoke_on_full_refund,
    p_revoke_on_dunning_exhausted, true, true, p_configured_by
  )
  RETURNING * INTO saved;

  RETURN saved;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION clear_primary_offer_evidence_integration(
  p_location_id TEXT,
  p_offer_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  changed INTEGER;
BEGIN
  UPDATE offer_evidence_integrations
  SET active = false, is_primary = false, updated_at = now()
  WHERE location_id = p_location_id
    AND offer_id = p_offer_id
    AND is_primary = true
    AND active = true;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE evidence_provider_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_provider_location_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_provider_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_commerce_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_evidence_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION save_primary_offer_evidence_integration(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_primary_offer_evidence_integration(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_primary_offer_evidence_integration(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION clear_primary_offer_evidence_integration(TEXT, UUID) TO service_role;

DROP TRIGGER IF EXISTS evidence_provider_authorizations_updated_at ON evidence_provider_authorizations;
CREATE TRIGGER evidence_provider_authorizations_updated_at
  BEFORE UPDATE ON evidence_provider_authorizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS external_commerce_events_updated_at ON external_commerce_events;
CREATE TRIGGER external_commerce_events_updated_at
  BEFORE UPDATE ON external_commerce_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS offer_evidence_integrations_updated_at ON offer_evidence_integrations;
CREATE TRIGGER offer_evidence_integrations_updated_at
  BEFORE UPDATE ON offer_evidence_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS external_entitlements_updated_at ON external_entitlements;
CREATE TRIGGER external_entitlements_updated_at
  BEFORE UPDATE ON external_entitlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO evidence_provider_releases (provider_key, release_status, wave, enabled_by_default, updated_by) VALUES
  ('ghl_native', 'native', 0, true, 'migration_092'),
  ('custom_api', 'available', 0, true, 'migration_092'),
  ('raw_webhook', 'guided', 0, true, 'migration_092'),
  ('zoom', 'planned', 1, false, 'migration_092'),
  ('kajabi', 'planned', 1, false, 'migration_092'),
  ('teachable', 'planned', 1, false, 'migration_092'),
  ('thinkific', 'planned', 1, false, 'migration_092'),
  ('clickup', 'planned', 1, false, 'migration_092'),
  ('asana', 'planned', 2, false, 'migration_092'),
  ('monday', 'planned', 2, false, 'migration_092'),
  ('teamwork', 'planned', 2, false, 'migration_092'),
  ('notion', 'planned', 2, false, 'migration_092'),
  ('copilot', 'planned', 2, false, 'migration_092'),
  ('manyrequests', 'planned', 2, false, 'migration_092'),
  ('suitedash', 'planned', 2, false, 'migration_092'),
  ('basecamp', 'planned', 2, false, 'migration_092'),
  ('trello', 'planned', 2, false, 'migration_092'),
  ('circle', 'planned', 3, false, 'migration_092'),
  ('mighty_networks', 'planned', 3, false, 'migration_092'),
  ('learnworlds', 'planned', 3, false, 'migration_092'),
  ('google_meet', 'planned', 3, false, 'migration_092'),
  ('calendly', 'planned', 3, false, 'migration_092'),
  ('learndash', 'planned', 3, false, 'migration_092'),
  ('memberpress', 'planned', 3, false, 'migration_092'),
  ('skool', 'guided', 3, false, 'migration_092'),
  ('podia', 'guided', 3, false, 'migration_092'),
  ('slack', 'planned', 4, false, 'migration_092'),
  ('microsoft_teams', 'planned', 4, false, 'migration_092'),
  ('google_drive', 'planned', 4, false, 'migration_092'),
  ('dropbox', 'planned', 4, false, 'migration_092'),
  ('box', 'planned', 4, false, 'migration_092'),
  ('zendesk', 'planned', 4, false, 'migration_092'),
  ('intercom', 'planned', 4, false, 'migration_092'),
  ('help_scout', 'planned', 4, false, 'migration_092'),
  ('loom', 'planned', 4, false, 'migration_092'),
  ('vimeo', 'planned', 4, false, 'migration_092'),
  ('wistia', 'planned', 4, false, 'migration_092'),
  ('docusign', 'planned', 4, false, 'migration_092'),
  ('pandadoc', 'planned', 4, false, 'migration_092'),
  ('thrivecart', 'planned', 5, false, 'migration_092'),
  ('samcart', 'planned', 5, false, 'migration_092'),
  ('clickfunnels', 'planned', 5, false, 'migration_092'),
  ('kartra', 'planned', 5, false, 'migration_092'),
  ('systeme', 'planned', 5, false, 'migration_092'),
  ('woocommerce_memberships', 'planned', 5, false, 'migration_092'),
  ('stripe_hosted', 'planned', 5, false, 'migration_092'),
  ('agencyanalytics', 'planned', 6, false, 'migration_092'),
  ('google_analytics', 'planned', 6, false, 'migration_092'),
  ('google_search_console', 'planned', 6, false, 'migration_092'),
  ('meta_ads', 'planned', 6, false, 'migration_092'),
  ('google_ads', 'planned', 6, false, 'migration_092'),
  ('callrail', 'planned', 6, false, 'migration_092'),
  ('whatconverts', 'planned', 6, false, 'migration_092'),
  ('hubspot', 'planned', 6, false, 'migration_092'),
  ('activecampaign', 'planned', 6, false, 'migration_092'),
  ('keap', 'planned', 6, false, 'migration_092'),
  ('spp', 'discovery', 7, false, 'migration_092'),
  ('dubsado', 'discovery', 7, false, 'migration_092'),
  ('honeybook', 'discovery', 7, false, 'migration_092'),
  ('productive', 'discovery', 7, false, 'migration_092'),
  ('accelo', 'discovery', 7, false, 'migration_092'),
  ('client_hub', 'discovery', 7, false, 'migration_092'),
  ('vendasta', 'discovery', 7, false, 'migration_092'),
  ('goproposal', 'discovery', 7, false, 'migration_092'),
  ('practice', 'discovery', 7, false, 'migration_092'),
  ('coachaccountable', 'discovery', 7, false, 'migration_092')
ON CONFLICT (provider_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
