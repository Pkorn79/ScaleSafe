-- 020_efw_events.sql — Phase A: Stripe Early Fraud Warning records

CREATE TABLE IF NOT EXISTS efw_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id               UUID NOT NULL REFERENCES merchants(id),
  location_id               TEXT NOT NULL,

  stripe_efw_id             TEXT NOT NULL,
  stripe_charge_id          TEXT,
  stripe_payment_intent_id  TEXT,

  fraud_type                TEXT,
  amount                    NUMERIC(10,2),

  -- Response
  action_taken              TEXT CHECK (action_taken IN ('pending', 'refunded', 'held', 'ignored')),
  action_taken_at           TIMESTAMPTZ,
  auto_action               BOOLEAN DEFAULT false,

  -- Context
  evidence_score            INTEGER,
  dispute_rate_at_time      NUMERIC(6,4),

  raw_efw_object            JSONB,
  created_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_efw_events_merchant ON efw_events(merchant_id);

ALTER TABLE efw_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON efw_events
  FOR ALL USING (true) WITH CHECK (true);
