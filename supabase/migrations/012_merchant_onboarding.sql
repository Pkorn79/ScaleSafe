-- 012_merchant_onboarding.sql
-- Add onboarding fields to merchants table.

-- Onboarding complete flag — checked by offer configurator before allowing offer creation
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;

-- T&C clause toggles — stores which of the 9 standard clauses are enabled
-- Example: {"purchase_summary": true, "cardholder_auth": true, "program_scope": false, ...}
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS tc_clause_toggles JSONB DEFAULT '{}'::jsonb;
