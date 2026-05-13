-- Phase 5 recovery: NMI recurring diagnostics and saved-card cleanup.
-- This migration stores only sanitized NMI postback metadata and display-safe
-- card references. It does not store raw card data or full NMI payloads.

CREATE TABLE IF NOT EXISTS nmi_silent_post_logs (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                   UUID REFERENCES merchants(id) ON DELETE SET NULL,
  location_id                   TEXT,
  enrollment_id                 UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  processor_subscription_id      TEXT,
  transaction_id                TEXT,
  amount                        NUMERIC,
  response_code                 TEXT,
  response_text                 TEXT,
  matched                       BOOLEAN DEFAULT false,
  duplicate                     BOOLEAN DEFAULT false,
  verification_status           TEXT DEFAULT 'pending',
  action                        TEXT NOT NULL DEFAULT 'received',
  error_message                 TEXT,
  raw_keys                      TEXT[] DEFAULT '{}',
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_location_created
  ON nmi_silent_post_logs(location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_subscription
  ON nmi_silent_post_logs(processor_subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_transaction
  ON nmi_silent_post_logs(transaction_id);

DROP TRIGGER IF EXISTS nmi_silent_post_logs_updated_at ON nmi_silent_post_logs;
CREATE TRIGGER nmi_silent_post_logs_updated_at
  BEFORE UPDATE ON nmi_silent_post_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE nmi_silent_post_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_methods_contact_active
  ON payment_methods(location_id, contact_id, processor_type, is_default, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_methods_stripe_pm
  ON payment_methods(location_id, contact_id, stripe_payment_method_id)
  WHERE stripe_payment_method_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_methods_nmi_vault
  ON payment_methods(location_id, contact_id, nmi_customer_vault_id)
  WHERE nmi_customer_vault_id IS NOT NULL;
