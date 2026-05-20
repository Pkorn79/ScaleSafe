-- 062_subscription_change_action_expansion.sql
--
-- Phase 2 evidence audit fix: subscription evidence should use stable action
-- values that match app write paths. Existing schema allowed pause/resume/cancel
-- but not completion, while older code attempted past-tense values that could
-- fail the CHECK constraint.

ALTER TABLE evidence_subscription_changes
  DROP CONSTRAINT IF EXISTS evidence_subscription_changes_action_check;

ALTER TABLE evidence_subscription_changes
  ADD CONSTRAINT evidence_subscription_changes_action_check
  CHECK (action IN ('pause', 'resume', 'cancel', 'card_update', 'plan_change', 'complete'));
