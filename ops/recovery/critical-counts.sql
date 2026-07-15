SELECT jsonb_build_object(
  'schema_version', scalesafe_schema_version(),
  'captured_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'tables', jsonb_build_object(
    'merchants', (SELECT count(*) FROM public.merchants),
    'enrollments', (SELECT count(*) FROM public.enrollments),
    'payment_events', (SELECT count(*) FROM public.payment_events),
    'enrollment_packets', (SELECT count(*) FROM public.enrollment_packets),
    'defense_packets', (SELECT count(*) FROM public.defense_packets),
    'evidence_consent', (SELECT count(*) FROM public.evidence_consent),
    'evidence_milestones', (SELECT count(*) FROM public.evidence_milestones),
    'trigger_delivery_logs', (SELECT count(*) FROM public.trigger_delivery_logs),
    'external_evidence_events', (SELECT count(*) FROM public.external_evidence_events),
    'storage_buckets', (SELECT count(*) FROM storage.buckets),
    'storage_objects', (SELECT count(*) FROM storage.objects)
  )
);
