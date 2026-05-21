-- 065_nmi_webhook_events.sql
-- Adds official NMI JSON webhook configuration and event diagnostics.

ALTER TABLE processor_configs
  ADD COLUMN IF NOT EXISTS nmi_webhook_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS nmi_webhook_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS nmi_webhook_status TEXT DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS nmi_webhook_events TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS nmi_webhook_callback_url TEXT,
  ADD COLUMN IF NOT EXISTS nmi_webhook_last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nmi_webhook_last_error TEXT;

ALTER TABLE nmi_silent_post_logs
  ADD COLUMN IF NOT EXISTS webhook_kind TEXT DEFAULT 'silent_post',
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS signature_verified BOOLEAN,
  ADD COLUMN IF NOT EXISTS nmi_merchant_id TEXT,
  ADD COLUMN IF NOT EXISTS nmi_processor_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_event_id
  ON nmi_silent_post_logs(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_event_type
  ON nmi_silent_post_logs(event_type, created_at DESC);

NOTIFY pgrst, 'reload schema';
