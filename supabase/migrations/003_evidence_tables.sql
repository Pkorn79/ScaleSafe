-- 003_evidence_tables.sql — All 20 evidence tables (v2.1)
--
-- Every table has: id, location_id, contact_id, created_at, source
-- All tables are append-only for legal defensibility.
-- location_id on every table for merchant isolation.

-- ============================================================
-- 1. EVIDENCE: CONSENT (Enrollment T&C acceptance)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_consent (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  offer_id                UUID,
  source                  TEXT DEFAULT 'enrollment_funnel',

  consent_timestamp       TIMESTAMPTZ NOT NULL,
  ip_address              TEXT,
  device_fingerprint      TEXT,
  browser                 TEXT,
  user_agent              TEXT,
  tc_hash                 TEXT NOT NULL,
  tc_version              TEXT,
  consent_method          TEXT DEFAULT 'checkbox',

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_consent_contact ON evidence_consent (location_id, contact_id);

ALTER TABLE evidence_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_consent
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 2. EVIDENCE: ENROLLMENT PAYMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_enrollment_payment (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  offer_id                UUID,
  source                  TEXT DEFAULT 'ghl_webhook',

  ghl_order_id            TEXT,
  ghl_transaction_id      TEXT,
  amount                  DECIMAL(10,2),
  currency                TEXT DEFAULT 'USD',
  payment_method          TEXT,
  last_four               TEXT,
  processor_ref           TEXT,
  payment_timestamp       TIMESTAMPTZ,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_enroll_pay_contact ON evidence_enrollment_payment (location_id, contact_id);

ALTER TABLE evidence_enrollment_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_enrollment_payment
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 3. EVIDENCE: SESSIONS (Delivered sessions — SYS2-07)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_sessions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_form',

  session_date            DATE,
  session_type            TEXT,
  session_title           TEXT,
  duration_minutes        INTEGER,
  delivery_method         TEXT,
  topics_covered          TEXT,
  attendance_status       TEXT CHECK (attendance_status IN ('attended', 'no_show', 'cancelled', 'rescheduled')),
  facilitator             TEXT,
  no_show                 BOOLEAN DEFAULT false,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_sessions_contact ON evidence_sessions (location_id, contact_id);
CREATE INDEX idx_ev_sessions_date ON evidence_sessions (session_date);

ALTER TABLE evidence_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_sessions
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 4. EVIDENCE: MODULES (Module/course completion — SYS2-08)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_modules (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_form',

  module_name             TEXT,
  completion_date         DATE,
  completion_status       TEXT CHECK (completion_status IN ('started', 'in_progress', 'completed')),
  progress_pct            INTEGER,
  score                   TEXT,
  time_spent_minutes      INTEGER,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_modules_contact ON evidence_modules (location_id, contact_id);

ALTER TABLE evidence_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_modules
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 5. EVIDENCE: PULSE CHECK-INS (Client satisfaction — SYS2-09)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_pulse_checkins (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_form',

  checkin_date            DATE,
  sentiment_score         INTEGER CHECK (sentiment_score BETWEEN 1 AND 5),
  feedback_text           TEXT,
  follow_up_needed        BOOLEAN DEFAULT false,
  follow_up_action        TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_pulse_contact ON evidence_pulse_checkins (location_id, contact_id);

ALTER TABLE evidence_pulse_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_pulse_checkins
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 6. EVIDENCE: PAYMENT CONFIRMATION (Recurring payments)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_payment_confirmation (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_webhook',

  ghl_transaction_id      TEXT,
  amount                  DECIMAL(10,2),
  currency                TEXT DEFAULT 'USD',
  payment_date            TIMESTAMPTZ,
  payment_number          INTEGER,
  running_total           DECIMAL(10,2),
  payments_remaining      INTEGER,
  payment_method          TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_payconf_contact ON evidence_payment_confirmation (location_id, contact_id);

ALTER TABLE evidence_payment_confirmation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_payment_confirmation
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 7. EVIDENCE: FAILED PAYMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_failed_payment (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_webhook',

  amount                  DECIMAL(10,2),
  currency                TEXT DEFAULT 'USD',
  failure_date            TIMESTAMPTZ,
  decline_reason          TEXT,
  decline_code            TEXT,
  attempt_count           INTEGER DEFAULT 1,
  retry_scheduled         BOOLEAN DEFAULT false,
  retry_date              TIMESTAMPTZ,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_failpay_contact ON evidence_failed_payment (location_id, contact_id);

ALTER TABLE evidence_failed_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_failed_payment
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 8. EVIDENCE: ATTENDANCE (Session attendance/no-show — WF-01)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_attendance (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_workflow',

  session_date            DATE,
  status                  TEXT CHECK (status IN ('attended', 'no_show', 'late', 'cancelled')),
  followup_action         TEXT,
  followup_sent           BOOLEAN DEFAULT false,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_attendance_contact ON evidence_attendance (location_id, contact_id);

ALTER TABLE evidence_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_attendance
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 9. EVIDENCE: MILESTONES (Pipeline stage completion)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_milestones (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'pipeline',

  milestone_number        INTEGER,
  milestone_name          TEXT,
  completed_at            TIMESTAMPTZ,
  description             TEXT,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_milestones_contact ON evidence_milestones (location_id, contact_id);

ALTER TABLE evidence_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_milestones
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 10. EVIDENCE: SIGNOFFS (Client digital signature on milestones)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_signoffs (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'signoff_page',

  milestone_number        INTEGER,
  milestone_name          TEXT,
  work_summary            TEXT,
  signature_data          TEXT,
  ip_address              TEXT,
  device_fingerprint      TEXT,
  browser                 TEXT,
  signed_at               TIMESTAMPTZ NOT NULL,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_signoffs_contact ON evidence_signoffs (location_id, contact_id);

ALTER TABLE evidence_signoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_signoffs
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 11. EVIDENCE: SERVICE ACCESS (Third-party platform logins)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_service_access (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'external_webhook',

  platform                TEXT,
  event_type              TEXT,
  access_date             TIMESTAMPTZ,
  duration_seconds        INTEGER,
  ip_address              TEXT,
  device_fingerprint      TEXT,
  content_accessed        TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_access_contact ON evidence_service_access (location_id, contact_id);

ALTER TABLE evidence_service_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_service_access
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 12. EVIDENCE: EXTERNAL SESSIONS (Zoom, Calendly, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_external_sessions (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'external_webhook',

  platform                TEXT,
  session_date            TIMESTAMPTZ,
  duration_minutes        INTEGER,
  recording_url           TEXT,
  session_type            TEXT,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_extsess_contact ON evidence_external_sessions (location_id, contact_id);

ALTER TABLE evidence_external_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_external_sessions
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 13. EVIDENCE: COURSE COMPLETION
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_course_completion (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'external_webhook',

  platform                TEXT,
  course_name             TEXT,
  completed_at            TIMESTAMPTZ,
  certificate_url         TEXT,
  grade                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_course_contact ON evidence_course_completion (location_id, contact_id);

ALTER TABLE evidence_course_completion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_course_completion
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 14. EVIDENCE: ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_assignments (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'external_webhook',

  title                   TEXT,
  submitted_at            TIMESTAMPTZ,
  grade                   TEXT,
  feedback                TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_assign_contact ON evidence_assignments (location_id, contact_id);

ALTER TABLE evidence_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_assignments
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 15. EVIDENCE: COMMUNICATION LOG (P0 — Tier 1 evidence)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_communication (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_api',

  comm_type               TEXT CHECK (comm_type IN ('email', 'sms', 'call', 'voicemail', 'chat', 'other')),
  direction               TEXT CHECK (direction IN ('inbound', 'outbound')),
  comm_date               TIMESTAMPTZ,
  subject                 TEXT,
  summary                 TEXT,
  body_preview            TEXT,
  ghl_conversation_id     TEXT,
  ghl_message_id          TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_comm_contact ON evidence_communication (location_id, contact_id);
CREATE INDEX idx_ev_comm_date ON evidence_communication (comm_date);

ALTER TABLE evidence_communication ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_communication
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 16. EVIDENCE: RESOURCE DELIVERY
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_resource_delivery (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'app',

  resource_type           TEXT,
  title                   TEXT,
  delivered_at            TIMESTAMPTZ,
  access_confirmed        BOOLEAN DEFAULT false,
  delivery_method         TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_resource_contact ON evidence_resource_delivery (location_id, contact_id);

ALTER TABLE evidence_resource_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_resource_delivery
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 17. EVIDENCE: REFUND ACTIVITY
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_refund_activity (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_webhook',

  amount                  DECIMAL(10,2),
  currency                TEXT DEFAULT 'USD',
  refund_type             TEXT CHECK (refund_type IN ('full', 'partial')),
  reason                  TEXT,
  refund_date             TIMESTAMPTZ,
  initiated_by            TEXT,
  ghl_transaction_id      TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_refund_contact ON evidence_refund_activity (location_id, contact_id);

ALTER TABLE evidence_refund_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_refund_activity
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 18. EVIDENCE: CANCELLATION (SYS2-11)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_cancellation (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_form',

  cancellation_date       DATE,
  reason                  TEXT,
  refund_eligibility      TEXT,
  status_at_cancellation  TEXT,
  initiated_by            TEXT,
  notes                   TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_cancel_contact ON evidence_cancellation (location_id, contact_id);

ALTER TABLE evidence_cancellation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_cancellation
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 19. EVIDENCE: SUBSCRIPTION CHANGES
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_subscription_changes (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'ghl_webhook',

  action                  TEXT CHECK (action IN ('pause', 'resume', 'cancel', 'card_update', 'plan_change')),
  change_date             TIMESTAMPTZ,
  reason                  TEXT,
  initiated_by            TEXT,
  previous_status         TEXT,
  new_status              TEXT,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_subchange_contact ON evidence_subscription_changes (location_id, contact_id);

ALTER TABLE evidence_subscription_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_subscription_changes
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 20. EVIDENCE: CUSTOM EVENTS (Catch-all for merchant-defined events)
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_custom_events (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,
  source                  TEXT DEFAULT 'external_webhook',

  event_type              TEXT NOT NULL,
  event_timestamp         TIMESTAMPTZ,
  description             TEXT,
  metadata                JSONB DEFAULT '{}'::jsonb,

  contact_name            TEXT,
  contact_email           TEXT,

  raw_payload             JSONB,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ev_custom_contact ON evidence_custom_events (location_id, contact_id);
CREATE INDEX idx_ev_custom_type ON evidence_custom_events (event_type);

ALTER TABLE evidence_custom_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_custom_events
  FOR ALL USING (true) WITH CHECK (true);
