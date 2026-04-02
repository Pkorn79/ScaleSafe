-- 014_merchant_custom_value_ids.sql
-- Store per-merchant GHL custom value IDs discovered during provisioning.
-- Maps canonical keys (BUSINESS_NAME, SUPPORT_EMAIL, etc.) to GHL custom value IDs.
-- Each merchant gets different IDs from GHL — this replaces hardcoded PMG-specific IDs.

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS custom_value_ids JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN merchants.custom_value_ids IS 'Maps canonical keys to GHL custom value IDs for this location. Populated during provisioning.';
