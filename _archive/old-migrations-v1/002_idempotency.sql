-- 002_idempotency.sql — Webhook idempotency tracking
--
-- Prevents double-processing of webhook events. accept.blue retries failed
-- deliveries, and network issues can cause duplicates. Each event is tracked
-- by (event_id, source). If the combination exists, the event is skipped.
--
-- Auto-cleanup: rows older than 90 days can be purged via scheduled job.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id        TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'acceptblue',
  location_id     TEXT NOT NULL,
  processed_at    TIMESTAMPTZ DEFAULT now(),
  result          JSONB,

  CONSTRAINT idempotency_keys_event_source_unique UNIQUE (event_id, source)
);

CREATE INDEX idx_idempotency_processed_at ON idempotency_keys (processed_at);
CREATE INDEX idx_idempotency_location ON idempotency_keys (location_id);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON idempotency_keys
  FOR ALL USING (true) WITH CHECK (true);
