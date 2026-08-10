-- Add the no-cost Marketplace review/beta plan to the entitlement boundary.

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_marketplace_plan_key_check;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_marketplace_plan_key_check
  CHECK (marketplace_plan_key IN ('legacy', 'test', 'standard', 'wholepay', 'unknown'));

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 103;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
