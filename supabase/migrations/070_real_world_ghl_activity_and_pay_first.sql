-- 070_real_world_ghl_activity_and_pay_first.sql
-- Real-world GHL activity matching and pay-first enrollment support.

ALTER TABLE ghl_activity_events
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS source_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS match_confidence TEXT,
  ADD COLUMN IF NOT EXISTS linked_enrollment_ids UUID[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS linked_offer_ids UUID[] DEFAULT '{}'::uuid[];

CREATE TABLE IF NOT EXISTS ghl_activity_match_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_value TEXT NOT NULL,
  offer_id UUID,
  staff_user_id TEXT,
  title_keyword TEXT,
  pipeline_id TEXT,
  pipeline_stage_id TEXT,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_match_rules_location
  ON ghl_activity_match_rules(location_id, is_active, rule_type);

CREATE INDEX IF NOT EXISTS idx_ghl_match_rules_lookup
  ON ghl_activity_match_rules(location_id, rule_type, source_key, source_value)
  WHERE is_active = true;

ALTER TABLE ghl_activity_match_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ghl_activity_match_rules
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ghl_activity_enrollment_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  activity_event_id UUID NOT NULL REFERENCES ghl_activity_events(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL,
  offer_id UUID,
  link_reason TEXT,
  linked_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_activity_enrollment_link_unique
  ON ghl_activity_enrollment_links(activity_event_id, enrollment_id);

CREATE INDEX IF NOT EXISTS idx_ghl_activity_enrollment_links_location
  ON ghl_activity_enrollment_links(location_id, enrollment_id, created_at DESC);

ALTER TABLE ghl_activity_enrollment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ghl_activity_enrollment_links
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS external_payment_source TEXT,
  ADD COLUMN IF NOT EXISTS external_payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS external_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS recorded_by TEXT,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_events_external_reference
  ON payment_events(location_id, external_payment_source, external_payment_reference)
  WHERE external_payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_paid_pending
  ON enrollments(location_id, status, created_at DESC)
  WHERE status = 'paid_pending_enrollment';

NOTIFY pgrst, 'reload schema';
