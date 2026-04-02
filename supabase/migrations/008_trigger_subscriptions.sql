-- 008_trigger_subscriptions.sql — Phase 1: GHL custom trigger subscription tracking
--
-- Stores which GHL workflows are listening for which ScaleSafe triggers
-- at each merchant location. GHL sends subscribe/unsubscribe lifecycle events
-- and we POST event payloads to the subscription URLs when triggers fire.

CREATE TABLE IF NOT EXISTS trigger_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       TEXT NOT NULL,
  trigger_key       TEXT NOT NULL,
  subscription_url  TEXT NOT NULL,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trigger_subs_location_key
  ON trigger_subscriptions (location_id, trigger_key);

CREATE UNIQUE INDEX idx_trigger_subs_unique
  ON trigger_subscriptions (location_id, trigger_key, subscription_url);

CREATE TRIGGER trigger_subscriptions_updated_at
  BEFORE UPDATE ON trigger_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE trigger_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON trigger_subscriptions
  FOR ALL USING (true) WITH CHECK (true);
