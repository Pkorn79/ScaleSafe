-- 009_enrollments.sql — Phase 2: Enrollment records
--
-- Tracks client enrollment lifecycle: pending → consent_captured → enrolled → active →
-- at_risk → cancelled OR completed.
-- Future phases add bump columns (Phase 5) and migration source (Phase 9).

CREATE TABLE IF NOT EXISTS enrollments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id               TEXT NOT NULL,
  contact_id                TEXT NOT NULL,
  offer_id                  UUID REFERENCES offers_mirror(id),
  merchant_id               UUID REFERENCES merchants(id),

  status                    TEXT NOT NULL DEFAULT 'pending',

  -- Consent data (captured on Page 3)
  consent_token             TEXT UNIQUE,
  consent_captured_at       TIMESTAMPTZ,
  consent_ip                TEXT,
  consent_device            TEXT,
  consent_browser           TEXT,
  tc_version_hash           TEXT,

  -- Payment data (populated by payment webhook)
  payment_amount            DECIMAL(10,2),
  payment_type              TEXT,
  payment_transaction_id    TEXT,
  payments_made             INTEGER DEFAULT 0,
  payments_total            INTEGER,

  -- Pipeline tracking
  pipeline_opportunity_id   TEXT,
  current_milestone         INTEGER DEFAULT 0,

  -- Defense
  defense_readiness_score   INTEGER DEFAULT 0,
  risk_score                INTEGER DEFAULT 0,

  -- Timestamps
  enrolled_at               TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_enrollments_location ON enrollments (location_id);
CREATE INDEX idx_enrollments_contact ON enrollments (contact_id);
CREATE INDEX idx_enrollments_offer ON enrollments (offer_id);
CREATE INDEX idx_enrollments_consent_token ON enrollments (consent_token);
CREATE INDEX idx_enrollments_status ON enrollments (location_id, status);

CREATE TRIGGER enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrollments
  FOR ALL USING (true) WITH CHECK (true);
