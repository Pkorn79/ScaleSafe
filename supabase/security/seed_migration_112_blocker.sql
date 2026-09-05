\set ON_ERROR_STOP on

-- Isolated certification fixture only. This file is not a migration and must
-- never be run against a hosted project.
DO $$
BEGIN
  IF scalesafe_schema_version() <> 111 THEN
    RAISE EXCEPTION 'Migration 112 blocker fixture requires schema version 111';
  END IF;
END;
$$;

INSERT INTO public.merchants (id, location_id, business_name)
VALUES (
  '11210000-0000-4000-8000-000000000001',
  'migration-112-blocker-location',
  'Migration 112 Blocker Fixture'
);

INSERT INTO public.enrollments (
  id,
  location_id,
  contact_id,
  merchant_id,
  processor_type,
  processor_subscription_id,
  payment_type,
  status,
  payments_made
)
VALUES (
  '11210000-0000-4000-8000-000000000101',
  'migration-112-blocker-location',
  'migration-112-blocker-contact',
  '11210000-0000-4000-8000-000000000001',
  NULL,
  'migration-112-orphaned-subscription',
  'subscription',
  'delinquent',
  0
);

SELECT 'MIGRATION_112_BLOCKER_FIXTURE_READY' AS result;
