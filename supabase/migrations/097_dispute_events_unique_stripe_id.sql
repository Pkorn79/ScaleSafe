-- 097_dispute_events_unique_stripe_id.sql
--
-- The Stripe webhook upserts disputes with ON CONFLICT (stripe_dispute_id),
-- which requires a UNIQUE constraint — but migration 017 only created a plain
-- index, so every Stripe dispute webhook failed with "no unique or exclusion
-- constraint matching the ON CONFLICT specification" (found in the first live
-- Stripe dispute E2E, 2026-07-11; earlier dispute testing was NMI-rail and
-- never exercised this write).
--
-- NULL stripe_dispute_id rows (NMI/manual disputes) are unaffected — Postgres
-- allows any number of NULLs under a UNIQUE constraint.
--
-- NOTE: applied manually in production on 2026-07-11; the guard makes this
-- file safe to run there again.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispute_events_stripe_dispute_id_key'
  ) THEN
    ALTER TABLE dispute_events
      ADD CONSTRAINT dispute_events_stripe_dispute_id_key UNIQUE (stripe_dispute_id);
  END IF;
END $$;
