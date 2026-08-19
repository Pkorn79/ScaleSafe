-- Gate no-cost Marketplace access by exact GHL location and bind each Stripe
-- connection to the platform mode in which it was authorized.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS test_access_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_access_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS test_access_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_access_note TEXT;

-- Preserve Marketplace review and previously approved beta installations.
-- New test-plan installations remain locked until ScaleSafe HQ approves the
-- exact location.
UPDATE merchants
SET
  test_access_approved_at = COALESCE(
    test_access_approved_at,
    marketplace_plan_updated_at,
    installed_at,
    now()
  ),
  test_access_approved_by = COALESCE(
    NULLIF(test_access_approved_by, ''),
    'migration:106-grandfathered'
  )
WHERE marketplace_plan_key = 'test'
  AND test_access_approved_at IS NULL;

ALTER TABLE processor_configs
  ADD COLUMN IF NOT EXISTS stripe_livemode BOOLEAN;

-- Production was certified as test-mode before this migration. Existing
-- Stripe connections are therefore recorded as test and must be reconnected
-- after the platform switches to live mode.
UPDATE processor_configs
SET stripe_livemode = false
WHERE processor_type = 'stripe'
  AND stripe_livemode IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchants_test_access
  ON merchants (marketplace_plan_key, test_access_approved_at, test_access_revoked_at);

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 106;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
