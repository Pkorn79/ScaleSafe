SELECT id
FROM claim_scheduled_job_run(
  'job.health_retention',
  to_timestamp(:window_start_epoch),
  to_timestamp(:window_end_epoch),
  'phase2-worker-' || :client_id::text,
  120,
  3
);
