-- 026_stripe_evidence_vault.sql — Phase S1: Evidence metadata per transaction

CREATE TABLE IF NOT EXISTS stripe_evidence_vault (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                 UUID NOT NULL REFERENCES merchants(id),

  stripe_payment_intent_id    TEXT NOT NULL,
  stripe_charge_id            TEXT,
  stripe_customer_id          TEXT,

  offer_id                    UUID REFERENCES offers_mirror(id),
  enrollment_packet_id        UUID REFERENCES enrollment_packets(id),

  customer_name               TEXT,
  customer_email              TEXT,
  customer_ip                 TEXT,
  customer_billing_address    JSONB,
  offer_title                 TEXT,
  offer_description           TEXT,
  terms_accepted              BOOLEAN DEFAULT false,
  terms_accepted_at           TIMESTAMPTZ,
  contract_signed             BOOLEAN DEFAULT false,
  contract_file_id            TEXT,
  terms_file_id               TEXT,
  session_file_ids            TEXT[] DEFAULT '{}',
  communication_file_id       TEXT,
  refund_policy_text          TEXT,
  service_delivery_model      TEXT,
  service_start_date          DATE,

  ce30_eligible               BOOLEAN DEFAULT false,
  ce30_fields_complete        BOOLEAN DEFAULT false,
  metadata_written            BOOLEAN DEFAULT false,
  evidence_score              INTEGER NOT NULL DEFAULT 0,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(stripe_payment_intent_id)
);

CREATE INDEX idx_evidence_vault_merchant ON stripe_evidence_vault(merchant_id);
CREATE INDEX idx_evidence_vault_pi ON stripe_evidence_vault(stripe_payment_intent_id);
CREATE INDEX idx_evidence_vault_charge ON stripe_evidence_vault(stripe_charge_id);
CREATE INDEX idx_evidence_vault_customer ON stripe_evidence_vault(stripe_customer_id);
CREATE INDEX idx_evidence_vault_offer ON stripe_evidence_vault(offer_id);

CREATE TRIGGER stripe_evidence_vault_updated_at
  BEFORE UPDATE ON stripe_evidence_vault
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stripe_evidence_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON stripe_evidence_vault
  FOR ALL USING (true) WITH CHECK (true);
