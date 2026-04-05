-- 017_dispute_events.sql — Phase A: Stripe dispute lifecycle tracking

CREATE TABLE IF NOT EXISTS dispute_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id               UUID NOT NULL REFERENCES merchants(id),
  location_id               TEXT NOT NULL,
  contact_id                TEXT,
  payment_event_id          UUID REFERENCES payment_events(id),

  -- Stripe dispute identifiers
  stripe_dispute_id         TEXT NOT NULL,
  stripe_charge_id          TEXT,
  stripe_payment_intent_id  TEXT,

  -- Dispute details
  reason                    TEXT,
  status                    TEXT NOT NULL CHECK (status IN (
    'needs_response', 'under_review', 'won', 'lost', 'warning_closed', 'charge_refunded'
  )),
  amount                    NUMERIC(10,2) NOT NULL,
  currency                  TEXT DEFAULT 'usd',

  -- Triage
  triage_score              INTEGER,
  triage_recommendation     TEXT CHECK (triage_recommendation IN ('fight', 'review', 'accept')),

  -- Evidence
  evidence_submitted        BOOLEAN DEFAULT false,
  evidence_submitted_at     TIMESTAMPTZ,
  evidence_auto_submitted   BOOLEAN DEFAULT false,

  -- Deadlines
  evidence_due_by           TIMESTAMPTZ,
  alert_t7_sent             BOOLEAN DEFAULT false,
  alert_t3_sent             BOOLEAN DEFAULT false,
  alert_t1_sent             BOOLEAN DEFAULT false,

  -- Outcome
  outcome                   TEXT,
  outcome_at                TIMESTAMPTZ,
  net_financial_impact      NUMERIC(10,2),

  -- Network info
  card_network              TEXT,
  is_ce30_eligible          BOOLEAN DEFAULT false,

  raw_dispute_object        JSONB,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dispute_events_merchant ON dispute_events(merchant_id);
CREATE INDEX idx_dispute_events_stripe ON dispute_events(stripe_dispute_id);
CREATE INDEX idx_dispute_events_status ON dispute_events(status);

CREATE TRIGGER dispute_events_updated_at
  BEFORE UPDATE ON dispute_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE dispute_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON dispute_events
  FOR ALL USING (true) WITH CHECK (true);
