-- Additive hotfix. Requires the existing 108 health infrastructure; do not rerun 107-112.
-- No payment records, schedules, subscriptions, or communication settings are changed.
BEGIN;
INSERT INTO public.health_check_definitions (
  check_key, contract_version, scope_type, category, cadence_seconds,
  timeout_seconds, stale_after_seconds, incident_after_seconds,
  consecutive_failure_threshold, recovery_dwell_seconds, default_severity,
  confirmation_seconds, suppressible, config
) VALUES (
  'merchant.recurring_setup', 'recurring-setup-v1', 'merchant', 'billing', 3600,
  NULL, 7200, 1, 1, 600, 'urgent', 3600, false, '{}'::jsonb
) ON CONFLICT (check_key) DO NOTHING;
COMMIT;
