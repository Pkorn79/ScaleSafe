-- 024_provider_api_keys.sql — Phase D: ScaleSafe provider API keys per merchant
--
-- These keys are sent to GHL during Custom Payment Provider config.
-- GHL sends them back on every queryUrl call so we can identify the merchant.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS provider_api_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS provider_publishable_key TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_merchants_provider_api_key ON merchants(provider_api_key);
