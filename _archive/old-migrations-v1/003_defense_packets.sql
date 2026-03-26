-- 003_defense_packets.sql — Defense compilation tracking
--
-- Each row tracks one chargeback defense compilation from trigger to PDF.
-- Status flow: pending → processing → complete (or failed).
-- Evidence is snapshot-frozen at compilation time for legal defensibility.

CREATE TABLE IF NOT EXISTS defense_packets (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id             TEXT NOT NULL,
  contact_id              TEXT NOT NULL,

  -- Status
  status                  TEXT DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  triggered_by            TEXT DEFAULT 'manual',
  triggered_at            TIMESTAMPTZ DEFAULT now(),
  completed_at            TIMESTAMPTZ,

  -- Chargeback details
  chargeback_reason_code  TEXT,
  chargeback_amount       DECIMAL(10,2),
  chargeback_date         DATE,

  -- Evidence (frozen at compilation time)
  evidence_snapshot       JSONB,
  evidence_count          INTEGER,

  -- AI output
  defense_letter_text     TEXT,
  prompt_tokens_used      INTEGER,
  response_tokens_used    INTEGER,

  -- PDF
  pdf_storage_path        TEXT,
  pdf_url                 TEXT,

  -- Error tracking
  error_message           TEXT,
  retry_count             INTEGER DEFAULT 0,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_defense_contact ON defense_packets (location_id, contact_id);
CREATE INDEX idx_defense_status ON defense_packets (status);

CREATE TRIGGER defense_packets_updated_at
  BEFORE UPDATE ON defense_packets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE defense_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON defense_packets
  FOR ALL USING (true) WITH CHECK (true);
