-- 080_checkout_addons.sql
-- Offer-level one-time checkout add-ons for order bumps and pre-payment upsells.

CREATE TABLE IF NOT EXISTS offer_checkout_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  offer_id UUID NOT NULL REFERENCES offers_mirror(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('order_bump', 'pre_payment_upsell')),
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_checkout_addons_offer
  ON offer_checkout_addons (offer_id, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_offer_checkout_addons_location
  ON offer_checkout_addons (location_id, offer_id);

DROP TRIGGER IF EXISTS offer_checkout_addons_updated_at ON offer_checkout_addons;
CREATE TRIGGER offer_checkout_addons_updated_at
  BEFORE UPDATE ON offer_checkout_addons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE offer_checkout_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON offer_checkout_addons;
CREATE POLICY "Service role full access" ON offer_checkout_addons
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS selected_checkout_items JSONB DEFAULT '[]'::jsonb;

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS line_items JSONB DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
