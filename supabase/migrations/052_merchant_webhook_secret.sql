-- Per-merchant shared secret for GHL workflow Custom Webhook actions.
-- Enforced by application middleware after rollout; nullable during migration.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_webhook_secret
  ON merchants (webhook_secret)
  WHERE webhook_secret IS NOT NULL;
