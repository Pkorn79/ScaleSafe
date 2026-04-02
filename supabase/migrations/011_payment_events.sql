-- 011_payment_events.sql — Phase 2: Payment event tracking (processor-agnostic)
--
-- Logs every payment event (success, failure, refund) with processor column
-- from day one. Phase 8 adds 'stripe', 'samcart', 'generic' values.

CREATE TABLE IF NOT EXISTS payment_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id               TEXT NOT NULL,
  contact_id                TEXT NOT NULL,
  enrollment_id             UUID REFERENCES enrollments(id),

  event_type                TEXT NOT NULL,
  processor                 TEXT NOT NULL DEFAULT 'ghl',

  processor_transaction_id  TEXT,
  amount                    DECIMAL(10,2) NOT NULL,
  currency                  TEXT DEFAULT 'usd',

  payment_number            INTEGER,
  payments_remaining        INTEGER,

  failure_reason            TEXT,
  attempt_count             INTEGER DEFAULT 1,

  raw_webhook_payload       JSONB,

  created_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payment_events_enrollment ON payment_events (enrollment_id);
CREATE INDEX idx_payment_events_location ON payment_events (location_id);
CREATE INDEX idx_payment_events_processor_txn ON payment_events (processor, processor_transaction_id);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON payment_events
  FOR ALL USING (true) WITH CHECK (true);
