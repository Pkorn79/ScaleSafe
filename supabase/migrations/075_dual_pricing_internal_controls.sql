-- 075_dual_pricing_internal_controls.sql
-- Internal ScaleSafe-owned dual-pricing controls.
--
-- Merchants can opt eligible offers into dual pricing, but they cannot edit the
-- customer-facing card uplift or processor deduction math. The deduction percent
-- is generated from the visible uplift:
--
--   deduction = uplift / (100 + uplift) * 100
--
-- Example: 3.0000% visible card uplift -> 2.912621% deduction from gross card volume.

CREATE TABLE IF NOT EXISTS dual_pricing_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active BOOLEAN NOT NULL DEFAULT true,
  card_uplift_percent NUMERIC(7,4) NOT NULL CHECK (card_uplift_percent >= 0 AND card_uplift_percent <= 10),
  processor_deduction_percent NUMERIC(9,6)
    GENERATED ALWAYS AS ((card_uplift_percent / (100 + card_uplift_percent)) * 100) STORED,
  enabled_processors TEXT[] NOT NULL DEFAULT ARRAY['stripe','nmi']::TEXT[],
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  internal_notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dual_pricing_controls_active_effective
  ON dual_pricing_controls (active, effective_at DESC);

ALTER TABLE dual_pricing_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON dual_pricing_controls;
CREATE POLICY "Service role full access" ON dual_pricing_controls
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO dual_pricing_controls (card_uplift_percent, enabled_processors, internal_notes, created_by)
SELECT 3.0000, ARRAY['stripe','nmi']::TEXT[], 'Default beta dual-pricing spread. Merchant UI cannot edit.', 'migration_075'
WHERE NOT EXISTS (SELECT 1 FROM dual_pricing_controls);

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS dual_pricing_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ach_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dual_pricing_control_id UUID REFERENCES dual_pricing_controls(id),
  ADD COLUMN IF NOT EXISTS ach_access_policy TEXT DEFAULT 'after_settlement'
    CHECK (ach_access_policy IN ('after_settlement', 'after_submission'));

CREATE INDEX IF NOT EXISTS idx_offers_mirror_dual_pricing
  ON offers_mirror (location_id, dual_pricing_enabled, ach_enabled)
  WHERE dual_pricing_enabled = true OR ach_enabled = true;

NOTIFY pgrst, 'reload schema';
