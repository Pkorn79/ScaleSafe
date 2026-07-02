-- 083_payment_refund_claims.sql
-- Launch security batch: atomically claim refund attempts before calling a processor.

CREATE TABLE IF NOT EXISTS payment_refund_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  original_payment_event_id UUID NOT NULL REFERENCES payment_events(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'succeeded', 'failed')),
  processor TEXT,
  processor_refund_id TEXT,
  error_message TEXT,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refund_claims_active
  ON payment_refund_claims (location_id, original_payment_event_id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_payment_refund_claims_original
  ON payment_refund_claims (location_id, original_payment_event_id, created_at DESC);

DROP TRIGGER IF EXISTS payment_refund_claims_updated_at ON payment_refund_claims;
CREATE TRIGGER payment_refund_claims_updated_at
  BEFORE UPDATE ON payment_refund_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE payment_refund_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON payment_refund_claims;
CREATE POLICY "Service role full access" ON payment_refund_claims
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
