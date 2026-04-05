-- 025_risk_audit_results.sql — Phase S1: Risk audit scores per merchant

CREATE TABLE IF NOT EXISTS risk_audit_results (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                 UUID NOT NULL REFERENCES merchants(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  audit_period_start          TIMESTAMPTZ NOT NULL,
  audit_period_end            TIMESTAMPTZ NOT NULL,
  total_charges               INTEGER NOT NULL DEFAULT 0,
  total_disputes              INTEGER NOT NULL DEFAULT 0,
  total_efws                  INTEGER NOT NULL DEFAULT 0,
  total_dispute_amount_cents  BIGINT NOT NULL DEFAULT 0,
  disputes_won                INTEGER NOT NULL DEFAULT 0,
  disputes_lost               INTEGER NOT NULL DEFAULT 0,
  disputes_pending            INTEGER NOT NULL DEFAULT 0,
  reason_code_breakdown       JSONB NOT NULL DEFAULT '{}',
  avg_transaction_cents       BIGINT NOT NULL DEFAULT 0,
  repeat_customer_count       INTEGER NOT NULL DEFAULT 0,
  unique_customer_count       INTEGER NOT NULL DEFAULT 0,
  sampled_transactions        JSONB NOT NULL DEFAULT '[]',

  score_dispute_rate          INTEGER NOT NULL DEFAULT 0,
  score_evidence_readiness    INTEGER NOT NULL DEFAULT 0,
  score_descriptor_quality    INTEGER NOT NULL DEFAULT 0,
  score_repeat_client_rate    INTEGER NOT NULL DEFAULT 0,
  score_radar_data_quality    INTEGER NOT NULL DEFAULT 0,
  overall_risk_level          TEXT NOT NULL DEFAULT 'unknown'
    CHECK (overall_risk_level IN ('low', 'moderate', 'elevated', 'high', 'critical', 'unknown')),

  module_recommendations      JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_risk_audit_merchant ON risk_audit_results(merchant_id);
CREATE INDEX idx_risk_audit_created ON risk_audit_results(created_at DESC);

ALTER TABLE risk_audit_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON risk_audit_results
  FOR ALL USING (true) WITH CHECK (true);
