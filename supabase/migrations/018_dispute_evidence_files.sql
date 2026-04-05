-- 018_dispute_evidence_files.sql — Phase A: Stripe file objects linked to disputes

CREATE TABLE IF NOT EXISTS dispute_evidence_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_event_id    UUID NOT NULL REFERENCES dispute_events(id) ON DELETE CASCADE,
  merchant_id         UUID NOT NULL REFERENCES merchants(id),

  stripe_file_id      TEXT NOT NULL,
  file_purpose        TEXT DEFAULT 'dispute_evidence',
  file_type           TEXT,
  description         TEXT,

  uploaded_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_evidence_files_dispute ON dispute_evidence_files(dispute_event_id);

ALTER TABLE dispute_evidence_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON dispute_evidence_files
  FOR ALL USING (true) WITH CHECK (true);
