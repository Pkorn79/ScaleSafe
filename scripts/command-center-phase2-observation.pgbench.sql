SELECT *
FROM record_health_observation(
  'platform',
  'phase2-concurrency-' || :run_id::text,
  NULL,
  NULL,
  'security.dangerous_flag_posture',
  'unhealthy',
  'critical',
  'CONCURRENT_OBSERVATION_TEST',
  'Concurrent isolated observation test.',
  jsonb_build_object('test_run_id', :run_id::text),
  clock_timestamp()
);
