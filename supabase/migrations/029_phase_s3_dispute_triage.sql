-- 028_phase_s3_dispute_triage.sql — Phase S3: Dispute Triage + Evidence Assembly + EFW Management

-- ─── dispute_events: additional columns for triage, evidence assembly, outcome tracking ───

ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS recommendation_reason TEXT;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS evidence_gaps TEXT[] DEFAULT '{}';
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS evidence_score INTEGER DEFAULT 0;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS alert_t7_at TIMESTAMPTZ;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS alert_t3_at TIMESTAMPTZ;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS alert_t1_at TIMESTAMPTZ;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS evidence_submitted_mode TEXT; -- 'auto' or 'manual'
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS rdr_resolved BOOLEAN DEFAULT FALSE;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS ethoca_resolved BOOLEAN DEFAULT FALSE;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS funds_withdrawn BOOLEAN DEFAULT FALSE;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS funds_withdrawn_amount_cents BIGINT;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS funds_reinstated BOOLEAN DEFAULT FALSE;
ALTER TABLE dispute_events ADD COLUMN IF NOT EXISTS funds_reinstated_amount_cents BIGINT;

-- ─── efw_events: additional columns for triage recommendations ───

ALTER TABLE efw_events ADD COLUMN IF NOT EXISTS recommendation TEXT;
ALTER TABLE efw_events ADD COLUMN IF NOT EXISTS recommendation_reason TEXT;
ALTER TABLE efw_events ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ;
ALTER TABLE efw_events ADD COLUMN IF NOT EXISTS responded BOOLEAN DEFAULT FALSE;
ALTER TABLE efw_events ADD COLUMN IF NOT EXISTS response_action TEXT; -- 'refunded' or 'held'

-- ─── merchants: auto-submit toggle ───

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dispute_auto_submit BOOLEAN DEFAULT FALSE;
