-- 102_marketplace_entitlements.sql
-- Persist HighLevel-managed app billing and keep the conditional WholePay
-- merchant price under ScaleSafe HQ control.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS marketplace_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_plan_key TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_billing_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS marketplace_plan_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketplace_billing_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wholepay_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wholepay_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS wholepay_approval_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wholepay_merchant_reference TEXT;

-- Every installation that existed before Marketplace billing was enabled is
-- intentionally grandfathered. New rows default to unknown and fail closed
-- until HighLevel supplies a recognized plan ID.
UPDATE merchants
SET marketplace_plan_key = 'legacy'
WHERE marketplace_plan_key IS NULL;

ALTER TABLE merchants
  ALTER COLUMN marketplace_plan_key SET DEFAULT 'unknown',
  ALTER COLUMN marketplace_plan_key SET NOT NULL;

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_marketplace_plan_key_check;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_marketplace_plan_key_check
  CHECK (marketplace_plan_key IN ('legacy', 'standard', 'wholepay', 'unknown'));

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_marketplace_billing_status_check;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_marketplace_billing_status_check
  CHECK (marketplace_billing_status IN ('unknown', 'pending', 'complete', 'failed'));

CREATE INDEX IF NOT EXISTS idx_merchants_marketplace_plan
  ON merchants (marketplace_plan_key, marketplace_billing_status);

CREATE TABLE IF NOT EXISTS marketplace_entitlement_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  location_id TEXT NOT NULL,
  previous_plan_id TEXT,
  new_plan_id TEXT,
  billing_status TEXT,
  payload_sha256 TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_entitlement_events_location
  ON marketplace_entitlement_events (location_id, received_at DESC);

ALTER TABLE marketplace_entitlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_entitlement_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON marketplace_entitlement_events;
CREATE POLICY "Service role full access" ON marketplace_entitlement_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE marketplace_entitlement_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE marketplace_entitlement_events TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 102;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
