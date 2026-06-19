-- 081_fanbasis_checkout_channel.sql
-- FanBasis "Model B" checkout channel — Phase F1 foundation. Modeled on 071.
-- ADDITIVE ONLY: a new table + new nullable columns + indexes. No ALTER/DROP of any
-- existing constraint. Does NOT touch payment_events/enrollments processor CHECKs or
-- checkout_type CHECKs (deferred to F2), ProcessorInterface, processor_configs,
-- payment_methods, or merchants.default_processor/processor_override.

-- 1) Per-merchant FanBasis credentials (parallel to whop_configs; NOT processor_configs)
CREATE TABLE IF NOT EXISTS fanbasis_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  creator_handle TEXT,
  creator_id TEXT,
  api_key_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('production', 'sandbox')),
  status TEXT NOT NULL DEFAULT 'connected',
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (merchant_id, location_id)
);

ALTER TABLE fanbasis_configs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fanbasis_configs_location ON fanbasis_configs(location_id);
CREATE INDEX IF NOT EXISTS idx_fanbasis_configs_merchant ON fanbasis_configs(merchant_id);

-- 2) Offer-level FanBasis attribution (additive columns; product/session reused per OFFER in F2)
ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS fanbasis_product_id TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_payment_link TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_last_synced_at TIMESTAMPTZ;

-- 3) Enrollment-level FanBasis rail attribution (additive columns; written in F2)
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS fanbasis_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS fanbasis_reconciliation_status TEXT;

-- 4) Indexes for FanBasis lookups
CREATE INDEX IF NOT EXISTS idx_offers_mirror_fanbasis_product
  ON offers_mirror(fanbasis_product_id) WHERE fanbasis_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_fanbasis_checkout_session
  ON enrollments(fanbasis_checkout_session_id) WHERE fanbasis_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_fanbasis_payment
  ON enrollments(fanbasis_payment_id) WHERE fanbasis_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_fanbasis_subscription
  ON enrollments(fanbasis_subscription_id) WHERE fanbasis_subscription_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
