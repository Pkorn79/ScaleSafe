-- 001_merchants.sql — Merchant table + accept.blue customer map
--
-- The merchants table stores everything about each installed merchant:
-- GHL OAuth tokens, accept.blue credentials, business info, module toggles,
-- and incentive program config. location_id is the primary lookup key.
--
-- The ab_customer_map table links accept.blue customer IDs to GHL contacts
-- so that recurring payment webhooks can be traced back to the right merchant.

CREATE TABLE IF NOT EXISTS merchants (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL UNIQUE,
  company_id              TEXT,

  -- GHL OAuth tokens
  ghl_access_token        TEXT NOT NULL DEFAULT '',
  ghl_refresh_token       TEXT NOT NULL DEFAULT '',
  ghl_token_expires_at    TIMESTAMPTZ,
  ghl_scopes              TEXT,

  -- accept.blue credentials (cached from GHL Custom Values)
  ab_api_key              TEXT,
  ab_tokenization_key     TEXT,
  ab_webhook_secret       TEXT,

  -- Business info (from onboarding funnel + GHL Custom Values)
  business_name           TEXT,
  dba_name                TEXT,
  support_email           TEXT,
  descriptor              TEXT,
  logo_url                TEXT,
  industry                TEXT,

  -- Evidence module toggles
  module_sessions         BOOLEAN DEFAULT true,
  module_milestones       BOOLEAN DEFAULT true,
  module_pulse            BOOLEAN DEFAULT true,
  module_payments         BOOLEAN DEFAULT true,
  module_course           BOOLEAN DEFAULT true,

  -- Incentive program
  incentive_enabled       BOOLEAN DEFAULT false,
  incentive_tier1_desc    TEXT,
  incentive_tier1_threshold INTEGER,
  incentive_tier2_desc    TEXT,
  incentive_tier2_threshold INTEGER,

  -- Status
  status                  TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'uninstalled')),
  installed_at            TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Row-level security: service role only (app handles tenant isolation in code)
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON merchants
  FOR ALL USING (true) WITH CHECK (true);


-- AB Customer Map: links accept.blue customer_id to GHL contact
CREATE TABLE IF NOT EXISTS ab_customer_map (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ab_customer_id          TEXT NOT NULL UNIQUE,
  contact_id              TEXT NOT NULL,
  location_id             TEXT NOT NULL,
  offer_id                TEXT,
  program_name            TEXT,
  payment_type            TEXT,
  installment_amount      DECIMAL(10,2),
  installment_frequency   TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_map_location ON ab_customer_map (location_id);
CREATE INDEX idx_customer_map_contact ON ab_customer_map (location_id, contact_id);

ALTER TABLE ab_customer_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ab_customer_map
  FOR ALL USING (true) WITH CHECK (true);
