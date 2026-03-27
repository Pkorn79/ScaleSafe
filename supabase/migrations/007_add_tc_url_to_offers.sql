-- 007_add_tc_url_to_offers.sql
-- Add T&C URL field for merchants who provide their own terms document.

ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS tc_url TEXT;
