-- 021_stripe_radar_lists.sql — Phase A: Stripe Radar Value Lists per merchant

CREATE TABLE IF NOT EXISTS stripe_radar_lists (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           UUID NOT NULL REFERENCES merchants(id),
  location_id           TEXT NOT NULL,

  list_alias            TEXT NOT NULL,
  stripe_value_list_id  TEXT NOT NULL,
  item_type             TEXT NOT NULL,
  item_count            INTEGER DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  UNIQUE(merchant_id, list_alias)
);

CREATE TRIGGER stripe_radar_lists_updated_at
  BEFORE UPDATE ON stripe_radar_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stripe_radar_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON stripe_radar_lists
  FOR ALL USING (true) WITH CHECK (true);
