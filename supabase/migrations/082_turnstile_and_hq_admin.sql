-- 082_turnstile_and_hq_admin.sql
-- Adds per-offer bot protection policy and read-only HQ admin audit logging.

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS bot_protection_policy TEXT NOT NULL DEFAULT 'default';

ALTER TABLE offers_mirror
  DROP CONSTRAINT IF EXISTS offers_mirror_bot_protection_policy_check;

ALTER TABLE offers_mirror
  ADD CONSTRAINT offers_mirror_bot_protection_policy_check
  CHECK (bot_protection_policy IN ('default', 'off', 'required'));

CREATE TABLE IF NOT EXISTS hq_admin_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  target_location_id TEXT,
  target_type TEXT,
  target_id TEXT,
  admin_label TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hq_admin_audit_logs_created
  ON hq_admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hq_admin_audit_logs_location_created
  ON hq_admin_audit_logs (target_location_id, created_at DESC);

ALTER TABLE hq_admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON hq_admin_audit_logs;
CREATE POLICY "Service role full access" ON hq_admin_audit_logs
  FOR ALL USING (true) WITH CHECK (true);
