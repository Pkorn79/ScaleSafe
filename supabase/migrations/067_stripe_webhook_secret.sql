-- 067_stripe_webhook_secret.sql
-- Store Stripe's per-endpoint webhook signing secret for each connected merchant.

ALTER TABLE processor_configs
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret_encrypted TEXT;

NOTIFY pgrst, 'reload schema';
