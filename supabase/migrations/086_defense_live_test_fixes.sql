-- 086_defense_live_test_fixes.sql -- Fixes from the 2026-07-06 live defense packet test
-- (docs/DEFENSE_PACKET_LIVE_TEST_FABLE_HANDOFF_2026-07-06.md, packet a2d357fa)
--
-- 1. The live DB is missing evidence_milestones.enrollment_id (migration 048 was
--    never fully applied there), which made the defense milestone query fail and
--    silently drop all milestone evidence. Re-apply ALL of 048's columns
--    idempotently, then backfill enrollment_id from raw_payload for legacy rows.
-- 2. defense_letter_versions.generated_by rejected 'system', so fallback letters
--    were never versioned. Widen the CHECK.
-- 3. Add defense_packets.internal_debug so the true AI-provider failure reason and
--    model attempts are preserved for debugging while error_message stays
--    merchant-facing.

-- 1a. Re-apply migration 048 columns (idempotent)

ALTER TABLE evidence_consent
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

ALTER TABLE evidence_enrollment_payment
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

ALTER TABLE evidence_milestones
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

ALTER TABLE evidence_signoffs
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

ALTER TABLE evidence_cancellation
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

-- 1b. Backfill enrollment_id from raw_payload where it holds a valid UUID.
-- Legacy webhook writes stored the enrollment id only inside raw_payload
-- (enrollment_id and/or enrollmentId keys). Only copy valid UUID values.
--
-- NOTE (live schema drift, verified 2026-07-06): the live DB has raw_payload on
-- evidence_milestones, evidence_signoffs, and evidence_cancellation ONLY.
-- evidence_consent and evidence_enrollment_payment lack the column live, so they
-- are deliberately excluded from the backfill (there is nothing to copy from).

UPDATE evidence_milestones
SET enrollment_id = COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')::uuid
WHERE enrollment_id IS NULL
  AND COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')
    ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';

UPDATE evidence_signoffs
SET enrollment_id = COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')::uuid
WHERE enrollment_id IS NULL
  AND COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')
    ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';

UPDATE evidence_cancellation
SET enrollment_id = COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')::uuid
WHERE enrollment_id IS NULL
  AND COALESCE(
      raw_payload->>'enrollment_id',
      raw_payload->>'enrollmentId')
    ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';

-- 1c. Align evidence_consent and evidence_enrollment_payment with the code's
-- write paths (live schema drift, verified 2026-07-06: those two live tables were
-- created from a different schema than 003 -- consent_date/signature_url and
-- card_brand/transaction_id instead of consent_timestamp/tc_hash and
-- ghl_transaction_id/payment_timestamp). Every consent and enrollment-payment
-- evidence INSERT was failing live, and the defense exhibit SELECTs on these
-- tables failed too. Columns are added nullable (write paths always supply
-- values); the extra live columns are left in place.

ALTER TABLE evidence_consent
  ADD COLUMN IF NOT EXISTS offer_id UUID,
  ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS browser TEXT,
  ADD COLUMN IF NOT EXISTS tc_hash TEXT,
  ADD COLUMN IF NOT EXISTS tc_version TEXT,
  ADD COLUMN IF NOT EXISTS consent_method TEXT DEFAULT 'checkbox',
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

ALTER TABLE evidence_enrollment_payment
  ADD COLUMN IF NOT EXISTS offer_id UUID,
  ADD COLUMN IF NOT EXISTS ghl_order_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS last_four TEXT,
  ADD COLUMN IF NOT EXISTS processor_ref TEXT,
  ADD COLUMN IF NOT EXISTS payment_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- Backfill the code-expected columns from the legacy live columns where present.

-- These source columns existed only in the drifted live schema. Guard each
-- backfill so a clean migration replay does not fail when the legacy column was
-- never present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evidence_consent'
      AND column_name = 'consent_date'
  ) THEN
    EXECUTE 'UPDATE evidence_consent
      SET consent_timestamp = consent_date
      WHERE consent_timestamp IS NULL AND consent_date IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evidence_enrollment_payment'
      AND column_name = 'payment_date'
  ) THEN
    EXECUTE 'UPDATE evidence_enrollment_payment
      SET payment_timestamp = payment_date
      WHERE payment_timestamp IS NULL AND payment_date IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evidence_enrollment_payment'
      AND column_name = 'transaction_id'
  ) THEN
    EXECUTE 'UPDATE evidence_enrollment_payment
      SET ghl_transaction_id = transaction_id
      WHERE ghl_transaction_id IS NULL AND transaction_id IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evidence_enrollment_payment'
      AND column_name = 'card_last_four'
  ) THEN
    EXECUTE 'UPDATE evidence_enrollment_payment
      SET last_four = card_last_four
      WHERE last_four IS NULL AND card_last_four IS NOT NULL';
  END IF;
END;
$$;

-- 2. Allow fallback ('system') letters in the version history

ALTER TABLE defense_letter_versions
  DROP CONSTRAINT IF EXISTS
    defense_letter_versions_generated_by_check;

ALTER TABLE defense_letter_versions
  ADD CONSTRAINT
    defense_letter_versions_generated_by_check
  CHECK (generated_by IN ('ai', 'manual_edit', 'system'));

-- 3. Internal debug payload (AI failure reason, model attempts, source errors).
-- Never shown to merchants; error_message remains the merchant-facing text.

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS internal_debug JSONB;
