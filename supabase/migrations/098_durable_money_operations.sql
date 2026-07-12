-- 098_durable_money_operations.sql
-- Durable claims around processor calls. A provider-accepted or ambiguous operation
-- must be reconciled; it must never be executed again merely because a local write failed.

-- Migration 046 removed public USING(true) policies from the original tables,
-- but several later migrations accidentally recreated that policy shape. Lock
-- every post-046 table back to service_role before adding new durable tables.
-- The live database has had historical schema drift, so skip a table that is
-- legitimately absent instead of aborting the entire safety migration.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ghl_activity_events',
    'ghl_appointment_mappings',
    'evidence_appointments',
    'evidence_invoices',
    'ghl_activity_match_rules',
    'ghl_activity_enrollment_links',
    'dual_pricing_controls',
    'offer_checkout_addons',
    'hq_admin_audit_logs',
    'payment_refund_claims',
    'evidence_scheduling_events'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access', table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'Service role full access',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS money_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'checkout_charge',
    'checkout_ach_intent',
    'manual_sale_charge',
    'manual_sale_ach_intent',
    'query_url_charge',
    'query_url_subscription',
    'dunning_retry',
    'subscription_resume',
    'refund'
  )),
  operation_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  request_payload JSONB,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (
    'processing',
    'provider_accepted',
    'recorded',
    'failed',
    'unknown'
  )),
  provider_called BOOLEAN NOT NULL DEFAULT false,
  processor_type TEXT,
  processor_reference TEXT,
  response_payload JSONB,
  reconciliation_payload JSONB,
  error_message TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_started_at TIMESTAMPTZ,
  provider_accepted_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  reconciliation_lease_owner TEXT,
  reconciliation_lease_expires_at TIMESTAMPTZ,
  reconciliation_next_attempt_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT money_operations_location_type_key_unique
    UNIQUE (location_id, operation_type, operation_key)
);

ALTER TABLE money_operations
  ADD COLUMN IF NOT EXISTS request_payload JSONB,
  ADD COLUMN IF NOT EXISTS reconciliation_payload JSONB,
  ADD COLUMN IF NOT EXISTS provider_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE money_operations
  DROP CONSTRAINT IF EXISTS money_operations_operation_type_check;
ALTER TABLE money_operations
  ADD CONSTRAINT money_operations_operation_type_check CHECK (operation_type IN (
    'checkout_charge',
    'checkout_ach_intent',
    'manual_sale_charge',
    'manual_sale_ach_intent',
    'query_url_charge',
    'query_url_subscription',
    'dunning_retry',
    'subscription_resume',
    'refund'
  ));

CREATE INDEX IF NOT EXISTS idx_money_operations_reconciliation
  ON money_operations (status, reconciliation_next_attempt_at, reconciliation_lease_expires_at, updated_at)
  WHERE status IN ('processing', 'provider_accepted', 'unknown');

CREATE INDEX IF NOT EXISTS idx_money_operations_processor_reference
  ON money_operations (location_id, processor_type, processor_reference)
  WHERE processor_reference IS NOT NULL;

DROP TRIGGER IF EXISTS money_operations_updated_at ON money_operations;
CREATE TRIGGER money_operations_updated_at
  BEFORE UPDATE ON money_operations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE money_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON money_operations;
CREATE POLICY "Service role full access" ON money_operations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION claim_money_reconciliation_operations(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF money_operations AS $$
BEGIN
  RETURN QUERY
  UPDATE money_operations operation
  SET
    reconciliation_attempts = operation.reconciliation_attempts + 1,
    reconciliation_lease_owner = p_worker_id,
    reconciliation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  WHERE operation.id IN (
    SELECT candidate.id
    FROM money_operations candidate
    WHERE candidate.status = 'provider_accepted'
      AND candidate.provider_accepted_at <= now() - interval '30 seconds'
      AND candidate.reconciliation_attempts < 10
      AND (candidate.reconciliation_next_attempt_at IS NULL OR candidate.reconciliation_next_attempt_at <= now())
      AND (candidate.reconciliation_lease_expires_at IS NULL OR candidate.reconciliation_lease_expires_at <= now())
    ORDER BY candidate.provider_accepted_at ASC NULLS LAST, candidate.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 50))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING operation.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_money_reconciliation_operations(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_money_reconciliation_operations(INTEGER, TEXT, INTEGER) TO service_role;

-- Reclaim worker rows whose process died after setting status=resolving. The
-- original function checked lease expiry but excluded resolving rows, so they
-- could remain stuck forever after a Railway restart.
CREATE OR REPLACE FUNCTION claim_external_evidence_events(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF external_evidence_events AS $$
BEGIN
  RETURN QUERY
  UPDATE external_evidence_events event
  SET
    status = 'resolving',
    attempts = event.attempts + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  WHERE event.id IN (
    SELECT candidate.id
    FROM external_evidence_events candidate
    WHERE (
        candidate.status IN ('received', 'verified', 'retrying')
        OR (candidate.status = 'resolving' AND candidate.lease_expires_at <= now())
      )
      AND (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= now())
      AND (candidate.lease_expires_at IS NULL OR candidate.lease_expires_at <= now())
    ORDER BY candidate.received_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING event.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_external_evidence_events(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_external_evidence_events(INTEGER, TEXT, INTEGER) TO service_role;

-- Refund claims remain authoritative after the processor accepts a refund. The
-- prior schema made only "processing" exclusive, so a successful processor call
-- followed by a failed payment_events insert allowed a second claim.
ALTER TABLE payment_refund_claims
  DROP CONSTRAINT IF EXISTS payment_refund_claims_status_check;

ALTER TABLE payment_refund_claims
  ADD CONSTRAINT payment_refund_claims_status_check
  CHECK (status IN (
    'processing',
    'provider_accepted',
    'recorded',
    'succeeded',
    'failed',
    'unknown'
  ));

ALTER TABLE payment_refund_claims
  ADD COLUMN IF NOT EXISTS refund_payment_event_id UUID REFERENCES payment_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS provider_called BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_next_attempt_at TIMESTAMPTZ;

DROP INDEX IF EXISTS uq_payment_refund_claims_active;
CREATE UNIQUE INDEX uq_payment_refund_claims_active
  ON payment_refund_claims (location_id, original_payment_event_id)
  WHERE status IN ('processing', 'provider_accepted', 'unknown');

-- HighLevel's refund callback has no distinct refund-attempt ID. Persist the
-- normalized request fingerprint so a retried callback replays its claim after
-- the active-claim window has closed instead of issuing the same refund again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refund_claims_query_request
  ON payment_refund_claims (location_id, request_fingerprint)
  WHERE claimed_by = 'query_url' AND request_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_refund_claims_reconciliation
  ON payment_refund_claims (status, reconciliation_next_attempt_at, reconciliation_lease_expires_at, updated_at)
  WHERE status IN ('processing', 'provider_accepted', 'unknown');

CREATE OR REPLACE FUNCTION claim_refund_reconciliation_claims(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF payment_refund_claims AS $$
BEGIN
  RETURN QUERY
  UPDATE payment_refund_claims claim
  SET
    reconciliation_attempts = claim.reconciliation_attempts + 1,
    reconciliation_lease_owner = p_worker_id,
    reconciliation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  WHERE claim.id IN (
    SELECT candidate.id
    FROM payment_refund_claims candidate
    WHERE candidate.status = 'provider_accepted'
      AND candidate.provider_accepted_at <= now() - interval '30 seconds'
      AND candidate.reconciliation_attempts < 10
      AND (candidate.reconciliation_next_attempt_at IS NULL OR candidate.reconciliation_next_attempt_at <= now())
      AND (candidate.reconciliation_lease_expires_at IS NULL OR candidate.reconciliation_lease_expires_at <= now())
    ORDER BY candidate.provider_accepted_at ASC NULLS LAST, candidate.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 50))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING claim.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_refund_reconciliation_claims(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_refund_reconciliation_claims(INTEGER, TEXT, INTEGER) TO service_role;

-- Defense submission claims prevent concurrent or ambiguous Stripe evidence
-- submissions from being repeated. A provider-accepted claim can be finalized
-- locally by the reconciliation worker without calling Stripe again.
CREATE TABLE IF NOT EXISTS defense_submission_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  defense_packet_id UUID NOT NULL REFERENCES defense_packets(id) ON DELETE CASCADE,
  dispute_event_id UUID REFERENCES dispute_events(id) ON DELETE SET NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (
    'processing',
    'provider_accepted',
    'submitted',
    'failed',
    'unknown'
  )),
  provider_called BOOLEAN NOT NULL DEFAULT false,
  provider_reference TEXT,
  error_message TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_started_at TIMESTAMPTZ,
  provider_accepted_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT defense_submission_claims_packet_unique UNIQUE (defense_packet_id)
);

ALTER TABLE defense_submission_claims
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_defense_submission_claims_reconciliation
  ON defense_submission_claims (status, updated_at)
  WHERE status IN ('provider_accepted', 'unknown');

DROP TRIGGER IF EXISTS defense_submission_claims_updated_at ON defense_submission_claims;
CREATE TRIGGER defense_submission_claims_updated_at
  BEFORE UPDATE ON defense_submission_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE defense_submission_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON defense_submission_claims;
CREATE POLICY "Service role full access" ON defense_submission_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Defense compilation is queued in Postgres and leased by a worker. This keeps
-- a Railway restart from leaving a packet permanently stuck in processing.
ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS compilation_input JSONB,
  ADD COLUMN IF NOT EXISTS compilation_category TEXT,
  ADD COLUMN IF NOT EXISTS compilation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compilation_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS compilation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compilation_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compilation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS compilation_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_defense_packets_compilation_queue
  ON defense_packets (status, compilation_next_attempt_at, compilation_lease_expires_at, created_at)
  WHERE compilation_input IS NOT NULL
    AND status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION claim_defense_compilations(
  p_limit INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF defense_packets AS $$
BEGIN
  RETURN QUERY
  UPDATE defense_packets packet
  SET
    status = 'processing',
    compilation_attempts = packet.compilation_attempts + 1,
    compilation_lease_owner = p_worker_id,
    compilation_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  WHERE packet.id IN (
    SELECT candidate.id
    FROM defense_packets candidate
    WHERE candidate.compilation_input IS NOT NULL
      AND candidate.compilation_completed_at IS NULL
      AND candidate.lifecycle_status = 'pending_submission'
      AND candidate.compilation_attempts < 3
      AND (
        candidate.status = 'pending'
        OR (
          candidate.status = 'processing'
          AND candidate.compilation_lease_expires_at IS NOT NULL
          AND candidate.compilation_lease_expires_at <= now()
        )
      )
      AND (candidate.compilation_next_attempt_at IS NULL OR candidate.compilation_next_attempt_at <= now())
      AND (candidate.compilation_lease_expires_at IS NULL OR candidate.compilation_lease_expires_at <= now())
    ORDER BY candidate.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING packet.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_defense_compilations(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_defense_compilations(INTEGER, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 98;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
