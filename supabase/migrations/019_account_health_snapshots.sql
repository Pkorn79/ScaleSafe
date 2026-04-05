-- 019_account_health_snapshots.sql — Phase A: Daily account health metrics

CREATE TABLE IF NOT EXISTS account_health_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id               UUID NOT NULL REFERENCES merchants(id),
  location_id               TEXT NOT NULL,
  processor                 TEXT NOT NULL CHECK (processor IN ('stripe', 'nmi')),

  -- Dispute rates
  dispute_rate_visa         NUMERIC(6,4),
  dispute_rate_mastercard   NUMERIC(6,4),
  dispute_rate_overall      NUMERIC(6,4),

  -- Counts (rolling 30 days)
  transaction_count         INTEGER,
  dispute_count             INTEGER,
  efw_count                 INTEGER,

  -- Rates
  efw_rate                  NUMERIC(6,4),
  recovery_rate             NUMERIC(6,4),
  evidence_completeness     NUMERIC(5,2),

  -- Financial
  financial_exposure        NUMERIC(12,2),

  -- Thresholds
  visa_alert_level          TEXT CHECK (visa_alert_level IN ('healthy', 'warning', 'early_warning', 'program')),
  mastercard_alert_level    TEXT CHECK (mastercard_alert_level IN ('healthy', 'warning', 'program')),

  -- WholePay upgrade trigger
  upgrade_prompt_eligible   BOOLEAN DEFAULT false,

  snapshot_date             DATE NOT NULL,
  created_at                TIMESTAMPTZ DEFAULT now(),

  UNIQUE(merchant_id, processor, snapshot_date)
);

CREATE INDEX idx_health_snapshots_merchant ON account_health_snapshots(merchant_id, snapshot_date);

ALTER TABLE account_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON account_health_snapshots
  FOR ALL USING (true) WITH CHECK (true);
