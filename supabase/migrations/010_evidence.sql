-- 010_evidence.sql — Phase 2: Unified evidence table with JSONB data
--
-- All evidence types stored in one table. The evidence_type field determines
-- how to interpret the data JSONB blob. New evidence types (bumps, external
-- payments, imported history) can be added without schema migrations.

CREATE TABLE IF NOT EXISTS evidence (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       TEXT NOT NULL,
  contact_id        TEXT NOT NULL,
  enrollment_id     UUID REFERENCES enrollments(id),
  merchant_id       UUID REFERENCES merchants(id),

  evidence_type     TEXT NOT NULL,

  data              JSONB NOT NULL DEFAULT '{}'::jsonb,

  ip_address        TEXT,
  device_info       TEXT,
  browser_info      TEXT,

  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_evidence_enrollment ON evidence (enrollment_id);
CREATE INDEX idx_evidence_location ON evidence (location_id);
CREATE INDEX idx_evidence_contact ON evidence (contact_id);
CREATE INDEX idx_evidence_type ON evidence (evidence_type);

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence
  FOR ALL USING (true) WITH CHECK (true);
