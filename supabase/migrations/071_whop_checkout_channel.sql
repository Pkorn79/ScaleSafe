CREATE TABLE IF NOT EXISTS whop_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT,
  environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'sandbox')),
  status TEXT NOT NULL DEFAULT 'connected',
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (merchant_id, location_id)
);

ALTER TABLE whop_configs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_whop_configs_location
  ON whop_configs(location_id);

CREATE INDEX IF NOT EXISTS idx_whop_configs_merchant
  ON whop_configs(merchant_id);

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS whop_product_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS whop_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS whop_last_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offers_mirror_checkout_type_check'
  ) THEN
    ALTER TABLE offers_mirror
      ADD CONSTRAINT offers_mirror_checkout_type_check
      CHECK (checkout_type IN ('direct', 'whop'));
  END IF;
END $$;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS whop_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_membership_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_setup_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS whop_checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS whop_reconciliation_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'enrollments_checkout_type_check'
  ) THEN
    ALTER TABLE enrollments
      ADD CONSTRAINT enrollments_checkout_type_check
      CHECK (checkout_type IN ('direct', 'whop'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_events_processor_check'
  ) THEN
    ALTER TABLE payment_events
      DROP CONSTRAINT payment_events_processor_check;
  END IF;

  ALTER TABLE payment_events
    ADD CONSTRAINT payment_events_processor_check
    CHECK (processor IN ('nmi', 'stripe', 'ghl', 'whop'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'enrollments_processor_type_check'
  ) THEN
    ALTER TABLE enrollments
      DROP CONSTRAINT enrollments_processor_type_check;
  END IF;

  ALTER TABLE enrollments
    ADD CONSTRAINT enrollments_processor_type_check
    CHECK (processor_type IN ('nmi', 'stripe', 'ghl', 'whop'));
END $$;

CREATE INDEX IF NOT EXISTS idx_offers_mirror_checkout_type
  ON offers_mirror(location_id, checkout_type);

CREATE INDEX IF NOT EXISTS idx_offers_mirror_whop_product
  ON offers_mirror(whop_product_id)
  WHERE whop_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_whop_checkout_session
  ON enrollments(whop_checkout_session_id)
  WHERE whop_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_whop_payment
  ON enrollments(whop_payment_id)
  WHERE whop_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_whop_membership
  ON enrollments(whop_membership_id)
  WHERE whop_membership_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
