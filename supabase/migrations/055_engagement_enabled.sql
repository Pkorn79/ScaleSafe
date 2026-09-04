-- 055: Master toggle for engagement-status tracking.
-- engagement_enabled: when false, the app skips all writes to ss_engagement_status
-- so the SS - Client Re-Engage and SS - Re-Engagement Outreach workflows never fire.
-- Defaults to true to preserve current PMG/beta behavior on deploy.

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS engagement_enabled BOOLEAN DEFAULT true;

-- Persist Marketplace trigger delivery attempts for workflow debugging.
-- This originally shipped as a second migration numbered 055. Keep both
-- idempotent changes in one historical migration so a clean Supabase replay
-- has exactly one migration version.
CREATE TABLE IF NOT EXISTS trigger_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  subscription_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  http_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trigger_delivery_logs_location_key_created
  ON trigger_delivery_logs (location_id, trigger_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trigger_delivery_logs_status_created
  ON trigger_delivery_logs (status, created_at DESC);

ALTER TABLE trigger_delivery_logs ENABLE ROW LEVEL SECURITY;
