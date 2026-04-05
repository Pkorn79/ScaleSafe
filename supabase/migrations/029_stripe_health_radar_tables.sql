-- Phase S4: Account Health Snapshots and Stripe Radar Lists tables

-- Account health snapshots — daily computation of merchant Stripe account health
CREATE TABLE IF NOT EXISTS account_health_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_days INTEGER DEFAULT 30,
  total_charges INTEGER DEFAULT 0,
  total_disputes INTEGER DEFAULT 0,
  total_efws INTEGER DEFAULT 0,
  dispute_rate NUMERIC(7,6) DEFAULT 0,
  efw_rate NUMERIC(7,6) DEFAULT 0,
  disputes_won INTEGER DEFAULT 0,
  disputes_lost INTEGER DEFAULT 0,
  disputes_pending INTEGER DEFAULT 0,
  recovery_rate NUMERIC(5,4) DEFAULT 0,
  financial_exposure_cents BIGINT DEFAULT 0,
  avg_evidence_score INTEGER DEFAULT 0,
  reason_code_breakdown JSONB DEFAULT '{}',
  risk_level TEXT DEFAULT 'unknown',
  vamp_status TEXT DEFAULT 'safe',
  mc_status TEXT DEFAULT 'safe',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_health_snapshots_merchant ON account_health_snapshots(merchant_id);
CREATE INDEX idx_health_snapshots_location ON account_health_snapshots(location_id);
CREATE INDEX idx_health_snapshots_computed ON account_health_snapshots(computed_at DESC);

-- Stripe Radar Value Lists — tracked per merchant
CREATE TABLE IF NOT EXISTS stripe_radar_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,
  list_alias TEXT NOT NULL,
  stripe_value_list_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_radar_lists_merchant ON stripe_radar_lists(merchant_id);
CREATE INDEX idx_radar_lists_location ON stripe_radar_lists(location_id);
CREATE UNIQUE INDEX idx_radar_lists_merchant_alias ON stripe_radar_lists(merchant_id, list_alias);

-- Add stripe_connected and stripe_user_id columns to merchants if not present
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS stripe_user_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_legal_name TEXT;

-- Enable RLS
ALTER TABLE account_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_radar_lists ENABLE ROW LEVEL SECURITY;
