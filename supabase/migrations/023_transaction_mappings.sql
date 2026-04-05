-- 023_transaction_mappings.sql — Phase D: GHL ↔ Processor transaction ID mapping
--
-- Maps GHL transaction/subscription IDs to NMI/Stripe IDs.
-- Essential for queryUrl verify, refund, and subscription operations.

CREATE TABLE IF NOT EXISTS transaction_mappings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                 UUID NOT NULL REFERENCES merchants(id),
  location_id                 TEXT NOT NULL,

  -- GHL references
  ghl_transaction_id          TEXT,
  ghl_subscription_id         TEXT,
  ghl_order_id                TEXT,

  -- Processor references
  processor_transaction_id    TEXT,
  processor_subscription_id   TEXT,
  processor_charge_id         TEXT,

  processor_type              TEXT NOT NULL CHECK (processor_type IN ('nmi', 'stripe')),
  contact_id                  TEXT,

  created_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tx_map_ghl_tx ON transaction_mappings(ghl_transaction_id);
CREATE INDEX idx_tx_map_charge ON transaction_mappings(processor_charge_id);
CREATE INDEX idx_tx_map_ghl_sub ON transaction_mappings(ghl_subscription_id);
CREATE INDEX idx_tx_map_processor_tx ON transaction_mappings(processor_transaction_id);

ALTER TABLE transaction_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON transaction_mappings
  FOR ALL USING (true) WITH CHECK (true);
