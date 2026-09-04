-- 111_stripe_efw_integrity.sql
-- Give Stripe Early Fraud Warning upserts a tenant-scoped conflict boundary.

DO $$
BEGIN
  IF scalesafe_schema_version() <> 110 THEN
    RAISE EXCEPTION 'Migration 111 requires ScaleSafe schema version 110';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.efw_events'::regclass
      AND conname = 'efw_events_merchant_stripe_efw_id_key'
  ) THEN
    ALTER TABLE public.efw_events
      ADD CONSTRAINT efw_events_merchant_stripe_efw_id_key
      UNIQUE (merchant_id, stripe_efw_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 111;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
