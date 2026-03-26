-- 001_core_tables.sql — Core application tables (v2.1)
--
-- merchants: one row per installed GHL sub-account
-- offers_mirror: Supabase mirror of GHL Products created by the app
-- enrollment_packets: post-enrollment PDF snapshots
-- payment_customer_map: processor-agnostic customer→contact mapping
-- idempotency_keys: webhook deduplication

-- ============================================================
-- UTILITY: auto-update updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- MERCHANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL UNIQUE,
  company_id              TEXT,

  -- GHL OAuth tokens
  ghl_access_token        TEXT NOT NULL DEFAULT '',
  ghl_refresh_token       TEXT NOT NULL DEFAULT '',
  ghl_token_expires_at    TIMESTAMPTZ,
  ghl_scopes              TEXT,

  -- Business info (from onboarding + GHL Custom Values)
  business_name           TEXT,
  dba_name                TEXT,
  support_email           TEXT,
  descriptor              TEXT,
  logo_url                TEXT,
  industry                TEXT,

  -- Merchant configuration (evidence toggles, thresholds, notification prefs)
  config                  JSONB DEFAULT '{}'::jsonb,

  -- Evidence module toggles (quick access — also in config JSONB)
  module_sessions         BOOLEAN DEFAULT true,
  module_milestones       BOOLEAN DEFAULT true,
  module_pulse            BOOLEAN DEFAULT true,
  module_payments         BOOLEAN DEFAULT true,
  module_course           BOOLEAN DEFAULT true,

  -- Snapshot install tracking
  snapshot_status         TEXT DEFAULT 'pending'
                          CHECK (snapshot_status IN ('pending', 'installing', 'installed', 'failed')),
  snapshot_attempts       INTEGER DEFAULT 0,
  snapshot_error          TEXT,

  -- Custom workflow trigger IDs (registered on install)
  trigger_ids             JSONB DEFAULT '{}'::jsonb,

  -- Status
  status                  TEXT DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'uninstalled')),
  installed_at            TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON merchants
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- OFFERS MIRROR
-- ============================================================
CREATE TABLE IF NOT EXISTS offers_mirror (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,

  -- GHL Product linkage
  ghl_product_id          TEXT,
  ghl_price_ids           JSONB DEFAULT '[]'::jsonb,
  ghl_custom_object_id    TEXT,

  -- Program details
  offer_name              TEXT NOT NULL,
  program_description     TEXT,
  delivery_method         TEXT,

  -- Pricing
  price                   DECIMAL(10,2),
  payment_type            TEXT CHECK (payment_type IN ('one_time', 'installments')),
  installment_amount      DECIMAL(10,2),
  installment_frequency   TEXT CHECK (installment_frequency IN ('weekly', 'bi_weekly', 'monthly')),
  num_payments            INTEGER,
  pif_price               DECIMAL(10,2),
  pif_discount_enabled    BOOLEAN DEFAULT false,

  -- T&C (11 clause slots: title + text pairs)
  compiled_tc_html        TEXT,
  clause_slot_1_title     TEXT, clause_slot_1_text   TEXT,
  clause_slot_2_title     TEXT, clause_slot_2_text   TEXT,
  clause_slot_3_title     TEXT, clause_slot_3_text   TEXT,
  clause_slot_4_title     TEXT, clause_slot_4_text   TEXT,
  clause_slot_5_title     TEXT, clause_slot_5_text   TEXT,
  clause_slot_6_title     TEXT, clause_slot_6_text   TEXT,
  clause_slot_7_title     TEXT, clause_slot_7_text   TEXT,
  clause_slot_8_title     TEXT, clause_slot_8_text   TEXT,
  clause_slot_9_title     TEXT, clause_slot_9_text   TEXT,
  clause_slot_10_title    TEXT, clause_slot_10_text  TEXT,
  clause_slot_11_title    TEXT, clause_slot_11_text  TEXT,

  -- Refund policy
  refund_window_text      TEXT,

  -- Milestones (up to 8)
  m1_name TEXT, m1_delivers TEXT, m1_client_does TEXT,
  m2_name TEXT, m2_delivers TEXT, m2_client_does TEXT,
  m3_name TEXT, m3_delivers TEXT, m3_client_does TEXT,
  m4_name TEXT, m4_delivers TEXT, m4_client_does TEXT,
  m5_name TEXT, m5_delivers TEXT, m5_client_does TEXT,
  m6_name TEXT, m6_delivers TEXT, m6_client_does TEXT,
  m7_name TEXT, m7_delivers TEXT, m7_client_does TEXT,
  m8_name TEXT, m8_delivers TEXT, m8_client_does TEXT,

  -- Admin
  redirect_slug           TEXT,
  price_display           TEXT,
  active                  BOOLEAN DEFAULT true,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_offers_location ON offers_mirror (location_id);
CREATE INDEX idx_offers_product ON offers_mirror (ghl_product_id);

CREATE TRIGGER offers_mirror_updated_at
  BEFORE UPDATE ON offers_mirror
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE offers_mirror ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON offers_mirror
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- ENROLLMENT PACKETS
-- ============================================================
CREATE TABLE IF NOT EXISTS enrollment_packets (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  offer_id                UUID REFERENCES offers_mirror(id),

  -- Consent forensics (frozen at enrollment time)
  consent_timestamp       TIMESTAMPTZ NOT NULL,
  consent_ip              TEXT,
  consent_device          TEXT,
  consent_browser         TEXT,
  tc_hash                 TEXT,
  tc_html_snapshot        TEXT,

  -- Payment confirmation
  ghl_order_id            TEXT,
  ghl_transaction_id      TEXT,
  payment_amount          DECIMAL(10,2),
  payment_method          TEXT,

  -- PDF
  pdf_storage_path        TEXT,
  pdf_url                 TEXT,

  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_enrollment_contact ON enrollment_packets (location_id, contact_id);
CREATE INDEX idx_enrollment_offer ON enrollment_packets (offer_id);

ALTER TABLE enrollment_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrollment_packets
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- PAYMENT CUSTOMER MAP (processor-agnostic)
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_customer_map (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  location_id             TEXT NOT NULL,
  offer_id                UUID REFERENCES offers_mirror(id),
  program_name            TEXT,
  payment_type            TEXT,
  processor               TEXT DEFAULT 'ghl',

  created_at              TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT payment_customer_map_unique UNIQUE (customer_id, processor)
);

CREATE INDEX idx_pcm_location ON payment_customer_map (location_id);
CREATE INDEX idx_pcm_contact ON payment_customer_map (location_id, contact_id);

ALTER TABLE payment_customer_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON payment_customer_map
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- IDEMPOTENCY KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id                TEXT NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'ghl',
  location_id             TEXT NOT NULL,
  processed_at            TIMESTAMPTZ DEFAULT now(),
  result                  JSONB,

  CONSTRAINT idempotency_keys_event_source_unique UNIQUE (event_id, source)
);

CREATE INDEX idx_idempotency_processed_at ON idempotency_keys (processed_at);
CREATE INDEX idx_idempotency_location ON idempotency_keys (location_id);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON idempotency_keys
  FOR ALL USING (true) WITH CHECK (true);
