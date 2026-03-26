-- 002_defense_tables.sql — Defense compilation system (v2.1)
--
-- defense_packets: tracks each chargeback defense from trigger to PDF
-- reason_code_strategies: lookup table mapping reason codes to evidence priorities
-- defense_templates: proven letter templates per reason code category
-- defense_outcomes: win/loss tracking with financial metrics

-- ============================================================
-- DEFENSE PACKETS
-- ============================================================
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

  -- Chargeback details (from bank Notice of Dispute)
  chargeback_reason_code  TEXT,
  reason_code_category    TEXT,
  chargeback_amount       DECIMAL(10,2),
  chargeback_date         DATE,
  response_deadline       DATE,
  case_number             TEXT,
  arn                     TEXT,

  -- Evidence (frozen at compilation time)
  evidence_snapshot       JSONB,
  evidence_count          INTEGER,

  -- AI output
  defense_letter_text     TEXT,
  prompt_tokens_used      INTEGER,
  response_tokens_used    INTEGER,
  template_id             UUID,

  -- PDF bundle
  pdf_storage_path        TEXT,
  pdf_url                 TEXT,
  enrollment_packet_id    UUID,

  -- Error tracking
  error_message           TEXT,
  retry_count             INTEGER DEFAULT 0,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_defense_contact ON defense_packets (location_id, contact_id);
CREATE INDEX idx_defense_status ON defense_packets (status);
CREATE INDEX idx_defense_reason ON defense_packets (chargeback_reason_code);

CREATE TRIGGER defense_packets_updated_at
  BEFORE UPDATE ON defense_packets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE defense_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON defense_packets
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- REASON CODE STRATEGIES
-- ============================================================
CREATE TABLE IF NOT EXISTS reason_code_strategies (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reason_code             TEXT NOT NULL,
  network                 TEXT NOT NULL CHECK (network IN ('visa', 'mastercard', 'amex', 'discover')),
  category                TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  description             TEXT,

  -- Which evidence types matter most for this reason code (ordered by priority)
  evidence_priorities     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Defense strategy guidance for Claude API
  strategy_guidance       TEXT,

  -- Stats
  historical_win_rate     DECIMAL(5,2),

  template_id             UUID,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT reason_code_network_unique UNIQUE (reason_code, network)
);

CREATE TRIGGER reason_code_strategies_updated_at
  BEFORE UPDATE ON reason_code_strategies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE reason_code_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON reason_code_strategies
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- DEFENSE TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS defense_templates (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reason_code_category    TEXT NOT NULL,
  template_name           TEXT NOT NULL,
  template_text           TEXT NOT NULL,
  version                 INTEGER DEFAULT 1,
  active                  BOOLEAN DEFAULT true,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_templates_category ON defense_templates (reason_code_category, active);

CREATE TRIGGER defense_templates_updated_at
  BEFORE UPDATE ON defense_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE defense_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON defense_templates
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- DEFENSE OUTCOMES
-- ============================================================
CREATE TABLE IF NOT EXISTS defense_outcomes (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  defense_packet_id       UUID NOT NULL REFERENCES defense_packets(id),
  location_id             TEXT NOT NULL,

  outcome                 TEXT NOT NULL CHECK (outcome IN ('won', 'lost', 'pending', 'expired')),
  amount_recovered        DECIMAL(10,2),
  resolved_at             TIMESTAMPTZ,
  notes                   TEXT,

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_outcomes_packet ON defense_outcomes (defense_packet_id);
CREATE INDEX idx_outcomes_location ON defense_outcomes (location_id, outcome);

CREATE TRIGGER defense_outcomes_updated_at
  BEFORE UPDATE ON defense_outcomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE defense_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON defense_outcomes
  FOR ALL USING (true) WITH CHECK (true);
