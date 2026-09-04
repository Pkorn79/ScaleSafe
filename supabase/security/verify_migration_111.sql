\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF scalesafe_schema_version() <> 111 THEN
    RAISE EXCEPTION 'Expected ScaleSafe schema version 111';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.efw_events'::regclass
      AND conname = 'efw_events_merchant_stripe_efw_id_key'
      AND pg_get_constraintdef(oid) = 'UNIQUE (merchant_id, stripe_efw_id)'
  ) THEN
    RAISE EXCEPTION 'Tenant-scoped EFW uniqueness constraint is missing';
  END IF;
END;
$$;

INSERT INTO public.merchants (id, location_id, business_name)
VALUES ('11111111-1111-4111-8111-111111111111', 'migration-111-location', 'Migration 111 Test');

INSERT INTO public.efw_events (
  merchant_id,
  location_id,
  stripe_efw_id,
  fraud_type
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'migration-111-location',
  'issfr_migration_111',
  'first'
);

INSERT INTO public.efw_events (
  merchant_id,
  location_id,
  stripe_efw_id,
  fraud_type
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'migration-111-location',
  'issfr_migration_111',
  'updated'
)
ON CONFLICT (merchant_id, stripe_efw_id)
DO UPDATE SET fraud_type = EXCLUDED.fraud_type;

DO $$
DECLARE
  v_count INTEGER;
  v_fraud_type TEXT;
  v_duplicate_blocked BOOLEAN := false;
BEGIN
  SELECT count(*), max(fraud_type)
  INTO v_count, v_fraud_type
  FROM public.efw_events
  WHERE merchant_id = '11111111-1111-4111-8111-111111111111'
    AND stripe_efw_id = 'issfr_migration_111';

  IF v_count <> 1 OR v_fraud_type <> 'updated' THEN
    RAISE EXCEPTION 'EFW upsert did not remain one tenant-scoped row';
  END IF;

  BEGIN
    INSERT INTO public.efw_events (
      merchant_id,
      location_id,
      stripe_efw_id,
      fraud_type
    )
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'migration-111-location',
      'issfr_migration_111',
      'duplicate'
    );
  EXCEPTION
    WHEN unique_violation THEN
      v_duplicate_blocked := true;
  END;

  IF NOT v_duplicate_blocked THEN
    RAISE EXCEPTION 'Raw duplicate EFW insert was not blocked';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'MIGRATION 111 EFW INTEGRITY PASSED' AS result;
