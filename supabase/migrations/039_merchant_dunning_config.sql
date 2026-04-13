-- 039: Add dunning configuration columns to merchants table.
-- dunning_enabled: master toggle for automatic retry
-- dunning_max_retries: how many times to retry before escalation

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dunning_enabled BOOLEAN DEFAULT true;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dunning_max_retries INTEGER DEFAULT 3;
