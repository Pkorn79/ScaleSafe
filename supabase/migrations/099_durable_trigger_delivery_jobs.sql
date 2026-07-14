-- 099_durable_trigger_delivery_jobs.sql
-- Decouple merchant actions from GHL workflow latency without losing delivery truth.

CREATE TABLE IF NOT EXISTS trigger_delivery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  contact_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_field_updates JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  trigger_result JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_trigger_delivery_jobs_claim
  ON trigger_delivery_jobs (status, available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_trigger_delivery_jobs_location_created
  ON trigger_delivery_jobs (location_id, created_at DESC);

ALTER TABLE trigger_delivery_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON trigger_delivery_jobs;
CREATE POLICY "Service role full access" ON trigger_delivery_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE trigger_delivery_jobs FROM anon, authenticated;
GRANT ALL ON TABLE trigger_delivery_jobs TO service_role;

-- A lease that expires after processing began is deliberately marked unknown,
-- not made pending again. The worker may have reached GHL before it stopped,
-- and replaying that event could send a duplicate customer message.
CREATE OR REPLACE FUNCTION claim_trigger_delivery_jobs(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF trigger_delivery_jobs AS $$
BEGIN
  UPDATE trigger_delivery_jobs
  SET
    status = 'unknown',
    error_message = COALESCE(
      error_message,
      'Delivery lease expired after processing began; manual review is required before replay.'
    ),
    lease_owner = NULL,
    lease_expires_at = NULL,
    completed_at = now(),
    updated_at = now()
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= now();

  RETURN QUERY
  UPDATE trigger_delivery_jobs job
  SET
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = COALESCE(job.started_at, now()),
    updated_at = now()
  WHERE job.id IN (
    SELECT candidate.id
    FROM trigger_delivery_jobs candidate
    WHERE candidate.status = 'pending'
      AND candidate.attempt_count < candidate.max_attempts
      AND candidate.available_at <= now()
    ORDER BY candidate.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING job.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_trigger_delivery_jobs(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_trigger_delivery_jobs(INTEGER, TEXT, INTEGER) TO service_role;

-- Reuse the migration-098 defense queue for regeneration. The row lock and
-- target version make repeated browser requests return one durable job.
CREATE OR REPLACE FUNCTION queue_defense_regeneration(
  p_defense_id UUID,
  p_location_id TEXT
)
RETURNS TABLE (
  defense_id UUID,
  target_version INTEGER,
  job_status TEXT,
  created BOOLEAN
) AS $$
DECLARE
  packet defense_packets%ROWTYPE;
  next_version INTEGER;
BEGIN
  SELECT *
  INTO packet
  FROM defense_packets
  WHERE id = p_defense_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Defense packet not found';
  END IF;

  IF packet.lifecycle_status IS DISTINCT FROM 'pending_submission' THEN
    RAISE EXCEPTION 'Cannot regenerate a letter after submission';
  END IF;

  IF packet.status IN ('pending', 'processing') THEN
    IF packet.compilation_input->>'operation' = 'regenerate' THEN
      RETURN QUERY SELECT
        packet.id,
        (packet.compilation_input->>'targetVersion')::INTEGER,
        packet.status,
        false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Defense packet is already compiling';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM defense_letter_versions
  WHERE defense_packet_id = packet.id;

  UPDATE defense_packets
  SET
    status = 'pending',
    error_message = NULL,
    compilation_input = jsonb_build_object(
      'operation', 'regenerate',
      'targetVersion', next_version
    ),
    compilation_category = '__regenerate__',
    compilation_attempts = 0,
    compilation_lease_owner = NULL,
    compilation_lease_expires_at = NULL,
    compilation_next_attempt_at = NULL,
    compilation_last_error = NULL,
    compilation_completed_at = NULL,
    updated_at = now()
  WHERE id = packet.id;

  RETURN QUERY SELECT packet.id, next_version, 'pending'::TEXT, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION queue_defense_regeneration(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_defense_regeneration(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 99;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;
