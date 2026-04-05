-- 031_light_checkout_mode.sql — Phase J: Light Checkout Mode
--
-- Adds checkout mode toggle to offers_mirror.
-- full_enrollment = 4-page funnel (default), quick_checkout = compact single page.

ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS checkout_mode TEXT DEFAULT 'full_enrollment';
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS quick_checkout_consent_text TEXT;
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS quick_checkout_show_description BOOLEAN DEFAULT true;
ALTER TABLE offers_mirror ADD COLUMN IF NOT EXISTS quick_checkout_show_refund_policy BOOLEAN DEFAULT true;
