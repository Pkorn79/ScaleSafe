\set ON_ERROR_STOP on

-- Isolated certification cleanup only. Removes only the fixed UUIDs created by
-- seed_migration_112_blocker.sql.
DELETE FROM public.enrollments
WHERE id = '11210000-0000-4000-8000-000000000101';

DELETE FROM public.merchants
WHERE id = '11210000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.enrollments
    WHERE id = '11210000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = '11210000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Migration 112 blocker fixture cleanup was incomplete';
  END IF;
END;
$$;

SELECT 'MIGRATION_112_BLOCKER_FIXTURE_REMOVED' AS result;
