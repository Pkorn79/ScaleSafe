-- Phase 1: separate billing completion from program completion.

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS processor_type TEXT;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS billing_completed_at TIMESTAMPTZ;

ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_processor_type_check;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_processor_type_check
  CHECK (
    processor_type IS NULL
    OR processor_type IN ('nmi', 'stripe', 'ghl')
  );

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS auto_complete_on_duration_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_enrollments_processor_type
  ON enrollments(location_id, processor_type)
  WHERE processor_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_billing_completed_at
  ON enrollments(location_id, billing_completed_at)
  WHERE billing_completed_at IS NOT NULL;

UPDATE enrollments
SET processor_type = 'stripe'
WHERE processor_type IS NULL
  AND processor_subscription_id LIKE 'sub_%';

UPDATE enrollments
SET processor_type = 'nmi'
WHERE processor_type IS NULL
  AND processor_subscription_id IS NOT NULL
  AND processor_subscription_id NOT LIKE 'sub_%';
