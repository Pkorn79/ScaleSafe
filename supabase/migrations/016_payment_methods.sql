-- 016_payment_methods.sql — Phase A: Stored card references
--
-- Links GHL contact to NMI Customer Vault ID or Stripe PaymentMethod.
-- No raw card data stored — only display-safe info (last four, brand, expiry).

CREATE TABLE IF NOT EXISTS payment_methods (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id               UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id               TEXT NOT NULL,
  contact_id                TEXT NOT NULL,
  processor_type            TEXT NOT NULL CHECK (processor_type IN ('nmi', 'stripe')),

  -- NMI Customer Vault
  nmi_customer_vault_id     TEXT,

  -- Stripe
  stripe_customer_id        TEXT,
  stripe_payment_method_id  TEXT,

  -- Display info (safe to store)
  card_last_four            TEXT,
  card_brand                TEXT,
  card_exp_month            INTEGER,
  card_exp_year             INTEGER,

  is_default                BOOLEAN DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payment_methods_contact ON payment_methods(location_id, contact_id);

CREATE TRIGGER payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON payment_methods
  FOR ALL USING (true) WITH CHECK (true);
