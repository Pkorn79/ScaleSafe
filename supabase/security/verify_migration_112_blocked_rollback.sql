\set ON_ERROR_STOP on

-- Run only after migration 112 intentionally fails against the isolated
-- blocker fixture. It proves the migration did not leave partial DDL behind.
DO $$
BEGIN
  IF scalesafe_schema_version() <> 111 THEN
    RAISE EXCEPTION 'Blocked migration 112 did not preserve schema version 111';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('enrollments', 'payment_events', 'payment_methods')
      AND column_name = 'processor_config_id'
  ) THEN
    RAISE EXCEPTION 'Blocked migration 112 left partial processor binding columns';
  END IF;

  IF to_regprocedure(
    'public.record_recurring_payment(uuid,text,text,text,numeric,date,text,text,text,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Blocked migration 112 removed the schema-111 recurring payment RPC';
  END IF;

  IF to_regprocedure(
    'public.record_recurring_payment(uuid,text,text,text,numeric,uuid,date,text,text,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked migration 112 left the schema-112 recurring payment RPC';
  END IF;
END;
$$;

SELECT 'MIGRATION_112_BLOCKED_ROLLBACK_PASSED' AS result;
