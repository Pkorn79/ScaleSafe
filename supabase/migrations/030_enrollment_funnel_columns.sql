-- 030_enrollment_funnel_columns.sql — Phase I: Enrollment Funnel
--
-- Adds columns needed for the 4-page enrollment funnel:
-- device evidence capture (Page 1), consent forensics (Page 3).

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS device_evidence JSONB;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS digital_signature TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS clauses_accepted JSONB;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS scroll_depth INTEGER;

-- Index for widget lookups (device-capture + consent by email + offer)
CREATE INDEX IF NOT EXISTS idx_enrollments_email_offer ON enrollments (email, offer_id);
