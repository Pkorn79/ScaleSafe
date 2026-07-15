-- 101_offer_internal_names.sql
-- Separate merchant-only offer labels from customer-facing program names and
-- freeze the public name used by each enrollment.

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS internal_name TEXT;

UPDATE offers_mirror
SET internal_name = offer_name
WHERE internal_name IS NULL OR BTRIM(internal_name) = '';

CREATE OR REPLACE FUNCTION normalize_offer_internal_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.internal_name IS NULL OR BTRIM(NEW.internal_name) = '' THEN
    NEW.internal_name := NEW.offer_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_normalize_offer_internal_name ON offers_mirror;
CREATE TRIGGER trg_normalize_offer_internal_name
BEFORE INSERT OR UPDATE ON offers_mirror
FOR EACH ROW
EXECUTE FUNCTION normalize_offer_internal_name();

ALTER TABLE offers_mirror
  ALTER COLUMN internal_name SET NOT NULL;

COMMENT ON COLUMN offers_mirror.internal_name IS
  'Merchant-only operational label. Never expose this value in customer-facing checkout, messages, processor descriptions, consent records, or defense evidence.';

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS program_name_snapshot TEXT;

UPDATE enrollments AS enrollment
SET program_name_snapshot = offer.offer_name
FROM offers_mirror AS offer
WHERE enrollment.offer_id = offer.id
  AND enrollment.location_id = offer.location_id
  AND (enrollment.program_name_snapshot IS NULL OR BTRIM(enrollment.program_name_snapshot) = '');

CREATE OR REPLACE FUNCTION set_enrollment_program_name_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  resolved_program_name TEXT;
BEGIN
  IF NEW.offer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
    OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.program_name_snapshot IS NULL
    OR BTRIM(NEW.program_name_snapshot) = ''
  THEN
    SELECT offer_name
    INTO resolved_program_name
    FROM offers_mirror
    WHERE id = NEW.offer_id
      AND location_id = NEW.location_id;

    IF resolved_program_name IS NOT NULL THEN
      NEW.program_name_snapshot := resolved_program_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_set_enrollment_program_name_snapshot ON enrollments;
CREATE TRIGGER trg_set_enrollment_program_name_snapshot
BEFORE INSERT OR UPDATE ON enrollments
FOR EACH ROW
EXECUTE FUNCTION set_enrollment_program_name_snapshot();

COMMENT ON COLUMN enrollments.program_name_snapshot IS
  'Customer-facing program name frozen when the enrollment is created. Enrollment-specific messages, evidence, packets, and defense output should prefer this value over the current offer name.';

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 101;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
