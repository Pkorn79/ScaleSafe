-- 079_dual_pricing_location_controls.sql
-- Merchant/location-scoped dual-pricing controls.
--
-- The original dual_pricing_controls row remains as a global fallback. New
-- rows with location_id set override the fallback for that merchant only.

ALTER TABLE dual_pricing_controls
  ADD COLUMN IF NOT EXISTS location_id TEXT,
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id),
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_dual_pricing_controls_location_active_effective
  ON dual_pricing_controls (location_id, active, effective_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dual_pricing_controls_active_location
  ON dual_pricing_controls (location_id)
  WHERE active = true AND location_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
