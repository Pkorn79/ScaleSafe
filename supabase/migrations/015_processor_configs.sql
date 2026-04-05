-- 015_processor_configs.sql — Phase A: Processor credential storage
--
-- Stores NMI credentials (encrypted) and Stripe Connect tokens per merchant.
-- Supports multiple NMI configs (multi-MID routing).
-- Stripe: one config per merchant via Stripe Connect OAuth.

CREATE TABLE IF NOT EXISTS processor_configs (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id                   TEXT NOT NULL,
  processor_type                TEXT NOT NULL CHECK (processor_type IN ('nmi', 'stripe')),
  label                         TEXT,

  -- NMI fields (security_key encrypted at app layer)
  nmi_security_key_encrypted    TEXT,
  nmi_tokenization_key          TEXT,
  nmi_processor_id              TEXT,

  -- Stripe Connect fields
  stripe_user_id                TEXT,
  stripe_access_token_encrypted TEXT,
  stripe_refresh_token_encrypted TEXT,
  stripe_publishable_key        TEXT,
  stripe_token_expires_at       TIMESTAMPTZ,
  stripe_webhook_endpoint_id    TEXT,

  is_active                     BOOLEAN DEFAULT true,
  is_default                    BOOLEAN DEFAULT false,
  last_verified_at              TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now(),

  UNIQUE(merchant_id, processor_type, nmi_processor_id)
);

CREATE INDEX idx_processor_configs_merchant ON processor_configs(merchant_id);
CREATE INDEX idx_processor_configs_location ON processor_configs(location_id);

CREATE TRIGGER processor_configs_updated_at
  BEFORE UPDATE ON processor_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE processor_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON processor_configs
  FOR ALL USING (true) WITH CHECK (true);
