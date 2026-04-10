-- 035: Add first_name and last_name columns to enrollments table.
-- Parsed from digital_signature at consent capture time.
-- Used for GHL contact upsert instead of email prefix.

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS last_name TEXT;
