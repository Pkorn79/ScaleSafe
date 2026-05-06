-- 055: Master toggle for engagement-status tracking.
-- engagement_enabled: when false, the app skips all writes to ss_engagement_status
-- so the SS - Client Re-Engage and SS - Re-Engagement Outreach workflows never fire.
-- Defaults to true to preserve current PMG/beta behavior on deploy.

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS engagement_enabled BOOLEAN DEFAULT true;
