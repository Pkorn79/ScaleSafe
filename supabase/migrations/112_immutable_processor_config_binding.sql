-- 112_immutable_processor_config_binding.sql
-- Bind enrollments and their payment ledger rows to the processor configuration
-- that originated them. Existing ambiguous NMI records remain unbound.

DO $$
BEGIN
  IF scalesafe_schema_version() <> 111 THEN
    RAISE EXCEPTION 'Migration 112 requires ScaleSafe schema version 111';
  END IF;
END;
$$;

ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS processor_config_id UUID;

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS processor_config_id UUID;

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS processor_config_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.enrollments'::regclass
      AND attname = 'processor_config_id'
      AND NOT attisdropped
      AND (atttypid <> 'uuid'::regtype OR attnotnull)
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an incompatible enrollments.processor_config_id column';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.payment_events'::regclass
      AND attname = 'processor_config_id'
      AND NOT attisdropped
      AND (atttypid <> 'uuid'::regtype OR attnotnull)
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an incompatible payment_events.processor_config_id column';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.payment_methods'::regclass
      AND attname = 'processor_config_id'
      AND NOT attisdropped
      AND (atttypid <> 'uuid'::regtype OR attnotnull)
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an incompatible payment_methods.processor_config_id column';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollments'::regclass
      AND conname = 'enrollments_processor_config_id_fkey'
      AND (
        contype <> 'f'
        OR confrelid <> 'public.processor_configs'::regclass
        OR confdeltype <> 'n'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected enrollment processor configuration foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.enrollments'::regclass
      AND conname = 'enrollments_processor_config_id_fkey'
  ) THEN
    ALTER TABLE public.enrollments
      ADD CONSTRAINT enrollments_processor_config_id_fkey
      FOREIGN KEY (processor_config_id)
      REFERENCES public.processor_configs (id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_events'::regclass
      AND conname = 'payment_events_processor_config_id_fkey'
      AND (
        contype <> 'f'
        OR confrelid <> 'public.processor_configs'::regclass
        OR confdeltype <> 'n'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected payment event processor configuration foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_events'::regclass
      AND conname = 'payment_events_processor_config_id_fkey'
  ) THEN
    ALTER TABLE public.payment_events
      ADD CONSTRAINT payment_events_processor_config_id_fkey
      FOREIGN KEY (processor_config_id)
      REFERENCES public.processor_configs (id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_methods'::regclass
      AND conname = 'payment_methods_processor_config_id_fkey'
      AND (
        contype <> 'f'
        OR confrelid <> 'public.processor_configs'::regclass
        OR confdeltype <> 'n'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected payment method processor configuration foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payment_methods'::regclass
      AND conname = 'payment_methods_processor_config_id_fkey'
  ) THEN
    ALTER TABLE public.payment_methods
      ADD CONSTRAINT payment_methods_processor_config_id_fkey
      FOREIGN KEY (processor_config_id)
      REFERENCES public.processor_configs (id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.enrollments
  VALIDATE CONSTRAINT enrollments_processor_config_id_fkey;

ALTER TABLE public.payment_events
  VALIDATE CONSTRAINT payment_events_processor_config_id_fkey;

ALTER TABLE public.payment_methods
  VALIDATE CONSTRAINT payment_methods_processor_config_id_fkey;

CREATE INDEX IF NOT EXISTS idx_enrollments_processor_config_id
  ON public.enrollments (processor_config_id)
  WHERE processor_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_processor_config_id
  ON public.payment_events (processor_config_id)
  WHERE processor_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_methods_processor_config_id
  ON public.payment_methods (processor_config_id)
  WHERE processor_config_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.enrollments AS e
    JOIN public.processor_configs AS config ON config.id = e.processor_config_id
    WHERE config.merchant_id IS DISTINCT FROM e.merchant_id
      OR config.location_id IS DISTINCT FROM e.location_id
      OR config.processor_type IS DISTINCT FROM e.processor_type
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an invalid enrollment processor configuration binding';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_methods AS pm
    JOIN public.processor_configs AS config ON config.id = pm.processor_config_id
    WHERE config.merchant_id IS DISTINCT FROM pm.merchant_id
      OR config.location_id IS DISTINCT FROM pm.location_id
      OR config.processor_type IS DISTINCT FROM pm.processor_type
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an invalid payment method processor configuration binding';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_events AS pe
    JOIN public.processor_configs AS config ON config.id = pe.processor_config_id
    WHERE (
        pe.merchant_id IS NOT NULL
        AND config.merchant_id IS DISTINCT FROM pe.merchant_id
      )
      OR config.location_id IS DISTINCT FROM pe.location_id
      OR config.processor_type IS DISTINCT FROM pe.processor
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an invalid payment event processor configuration binding';
  END IF;
END;
$$;

-- Prefer an offer's explicit NMI processor ID. Only when the offer has no
-- explicit ID may a sole tenant/location NMI configuration be inferred.
WITH nmi_candidates AS (
  SELECT
    e.id AS enrollment_id,
    c.id AS processor_config_id,
    CASE
      WHEN NULLIF(BTRIM(o.nmi_processor_id), '') IS NOT NULL
        THEN 'explicit_offer_processor_id'
      ELSE 'single_tenant_nmi_config'
    END AS resolution_source,
    count(*) OVER (PARTITION BY e.id) AS candidate_count
  FROM public.enrollments AS e
  LEFT JOIN public.offers_mirror AS o
    ON o.id = e.offer_id
   AND o.location_id = e.location_id
  JOIN public.processor_configs AS c
    ON c.merchant_id = e.merchant_id
   AND c.location_id = e.location_id
   AND c.processor_type = 'nmi'
   AND (
     (
       NULLIF(BTRIM(o.nmi_processor_id), '') IS NOT NULL
       AND c.nmi_processor_id = BTRIM(o.nmi_processor_id)
     )
     OR NULLIF(BTRIM(o.nmi_processor_id), '') IS NULL
   )
  WHERE e.processor_config_id IS NULL
    AND e.processor_type = 'nmi'
), resolved_nmi_bindings AS (
  SELECT enrollment_id, processor_config_id, resolution_source
  FROM nmi_candidates
  WHERE candidate_count = 1
)
UPDATE public.enrollments AS e
SET processor_config_id = resolved.processor_config_id,
    updated_at = now()
FROM resolved_nmi_bindings AS resolved
WHERE e.id = resolved.enrollment_id
  AND e.processor_config_id IS NULL;

-- Stored payment methods are processor-specific. Bind only when exactly one
-- configuration exists for the same merchant, location, and processor.
WITH payment_method_candidates AS (
  SELECT
    pm.id AS payment_method_id,
    c.id AS processor_config_id,
    count(*) OVER (PARTITION BY pm.id) AS candidate_count
  FROM public.payment_methods AS pm
  JOIN public.processor_configs AS c
    ON c.merchant_id = pm.merchant_id
   AND c.location_id = pm.location_id
   AND c.processor_type = pm.processor_type
  WHERE pm.processor_config_id IS NULL
), resolved_payment_method_bindings AS (
  SELECT payment_method_id, processor_config_id
  FROM payment_method_candidates
  WHERE candidate_count = 1
)
UPDATE public.payment_methods AS pm
SET processor_config_id = resolved.processor_config_id,
    updated_at = now()
FROM resolved_payment_method_bindings AS resolved
WHERE pm.id = resolved.payment_method_id
  AND pm.processor_config_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_events AS pe
    JOIN public.enrollments AS e ON e.id = pe.enrollment_id
    WHERE pe.processor = 'nmi'
      AND e.processor_config_id IS NOT NULL
      AND (
        pe.location_id IS DISTINCT FROM e.location_id
        OR (
          pe.merchant_id IS NOT NULL
          AND pe.merchant_id IS DISTINCT FROM e.merchant_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Migration 112 found a cross-tenant NMI payment event enrollment link';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_events AS pe
    JOIN public.enrollments AS e ON e.id = pe.enrollment_id
    WHERE pe.processor = 'nmi'
      AND e.processor_config_id IS NOT NULL
      AND pe.processor_config_id IS NOT NULL
      AND pe.processor_config_id <> e.processor_config_id
  ) THEN
    RAISE EXCEPTION 'Migration 112 found a payment event processor binding collision';
  END IF;
END;
$$;

UPDATE public.payment_events AS pe
SET processor_config_id = e.processor_config_id
FROM public.enrollments AS e
WHERE pe.enrollment_id = e.id
  AND pe.processor = 'nmi'
  AND pe.processor_config_id IS NULL
  AND e.processor_config_id IS NOT NULL
  AND pe.location_id = e.location_id
  AND (pe.merchant_id IS NULL OR pe.merchant_id = e.merchant_id);

-- NULL is a valid compatibility identity during the staged application
-- rollout. Reserve the zero UUID exclusively as its index representation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.processor_configs
    WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
  ) THEN
    RAISE EXCEPTION 'Migration 112 found the reserved zero UUID in processor_configs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.processor_configs'::regclass
      AND conname = 'processor_configs_id_not_zero_check'
      AND (
        contype <> 'c'
        OR position(
          '00000000-0000-0000-0000-000000000000'
          IN pg_get_constraintdef(oid)
        ) = 0
        OR position('id <> ' IN pg_get_constraintdef(oid)) = 0
      )
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected reserved processor configuration ID constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.processor_configs'::regclass
      AND conname = 'processor_configs_id_not_zero_check'
  ) THEN
    ALTER TABLE public.processor_configs
      ADD CONSTRAINT processor_configs_id_not_zero_check
      CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
      NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE processor_transaction_id IS NOT NULL
      AND processor_transaction_id <> ''
    GROUP BY
      location_id,
      processor,
      COALESCE(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid),
      processor_transaction_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration 112 found duplicate processor-scoped transaction identities';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS i
    JOIN pg_class AS index_class ON index_class.oid = i.indexrelid
    WHERE i.indrelid = 'public.payment_events'::regclass
      AND index_class.relname = 'uq_payment_events_location_processor_txn'
      AND i.indisunique
      AND i.indnkeyatts = 3
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'location_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'processor'
      AND pg_get_indexdef(i.indexrelid, 3, true) = 'processor_transaction_id'
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected existing transaction dedupe index';
  END IF;
END;
$$;

ALTER TABLE public.processor_configs
  VALIDATE CONSTRAINT processor_configs_id_not_zero_check;

DROP INDEX public.uq_payment_events_location_processor_txn;

CREATE UNIQUE INDEX uq_payment_events_location_processor_txn
  ON public.payment_events (
    location_id,
    processor,
    COALESCE(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid),
    processor_transaction_id
  )
  WHERE processor_transaction_id IS NOT NULL
    AND processor_transaction_id <> '';

-- Adding an argument with CREATE OR REPLACE would retain the old function as
-- an overload. Require the expected old signature, reject drift, then replace
-- it so PostgREST exposes one unambiguous RPC.
DO $$
DECLARE
  v_function_count INTEGER;
BEGIN
  SELECT count(*)
  INTO v_function_count
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'record_recurring_payment';

  IF v_function_count <> 1
    OR to_regprocedure(
      'public.record_recurring_payment(uuid,text,text,text,numeric,date,text,text,text,jsonb)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'Migration 112 found an unexpected record_recurring_payment signature';
  END IF;
END;
$$;

DROP FUNCTION public.record_recurring_payment(uuid, text, text, text, numeric, date, text, text, text, jsonb);

CREATE FUNCTION public.record_recurring_payment(
  p_enrollment_id       uuid,
  p_location_id         text,
  p_processor           text,
  p_transaction_id      text,
  p_amount              numeric,
  p_processor_config_id uuid    DEFAULT NULL,
  p_next_billing_date   date    DEFAULT NULL,
  p_next_billing_source text    DEFAULT 'processor',
  p_interval            text    DEFAULT 'monthly',
  p_source              text    DEFAULT NULL,
  p_raw_payload         jsonb   DEFAULT NULL
)
RETURNS TABLE (
  is_duplicate          boolean,
  payment_event_id      uuid,
  payments_made         integer,
  payments_total        integer,
  is_final              boolean,
  billing_completed_at  timestamptz,
  next_billing_date     date,
  next_billing_source   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_enr                 public.enrollments%ROWTYPE;
  v_event_id            uuid;
  v_processor_config_id uuid;
  v_new_made            integer;
  v_is_finite           boolean;
  v_is_final            boolean := false;
  v_next                date;
  v_source              text;
  v_completed           timestamptz;
BEGIN
  IF p_transaction_id IS NULL OR p_transaction_id = '' THEN
    RAISE EXCEPTION 'record_recurring_payment requires a non-empty transaction id (enrollment %)',
      p_enrollment_id;
  END IF;

  SELECT *
  INTO v_enr
  FROM public.enrollments AS e
  WHERE e.id = p_enrollment_id
    AND e.location_id = p_location_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment % not found for location %', p_enrollment_id, p_location_id;
  END IF;

  IF p_processor_config_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.processor_configs AS config
      WHERE config.id = p_processor_config_id
        AND config.merchant_id = v_enr.merchant_id
        AND config.location_id = p_location_id
        AND config.processor_type = p_processor
    )
  THEN
    RAISE EXCEPTION 'processor configuration % does not belong to the enrollment tenant and processor',
      p_processor_config_id;
  END IF;

  IF v_enr.processor_config_id IS NOT NULL
    AND p_processor_config_id IS NOT NULL
    AND v_enr.processor_config_id <> p_processor_config_id
  THEN
    RAISE EXCEPTION 'processor configuration % does not match immutable enrollment binding %',
      p_processor_config_id,
      v_enr.processor_config_id;
  END IF;

  v_processor_config_id := COALESCE(v_enr.processor_config_id, p_processor_config_id);

  IF v_processor_config_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.processor_configs AS config
      WHERE config.id = v_processor_config_id
        AND config.merchant_id = v_enr.merchant_id
        AND config.location_id = p_location_id
        AND config.processor_type = p_processor
    )
  THEN
    RAISE EXCEPTION 'processor configuration % does not belong to the enrollment tenant and processor',
      v_processor_config_id;
  END IF;

  IF v_enr.processor_config_id IS NULL AND v_processor_config_id IS NOT NULL THEN
    UPDATE public.enrollments AS e
    SET processor_config_id = v_processor_config_id,
        updated_at = now()
    WHERE e.id = p_enrollment_id
      AND e.location_id = p_location_id;
    v_enr.processor_config_id := v_processor_config_id;
  END IF;

  v_is_finite := v_enr.payment_type <> 'subscription'
    AND v_enr.payments_total IS NOT NULL;

  INSERT INTO public.payment_events (
    merchant_id,
    location_id,
    contact_id,
    enrollment_id,
    event_type,
    processor,
    processor_config_id,
    processor_transaction_id,
    processor_subscription_id,
    amount,
    currency,
    payment_number,
    payments_total,
    source,
    is_recurring,
    raw_webhook_payload
  ) VALUES (
    v_enr.merchant_id,
    p_location_id,
    v_enr.contact_id,
    p_enrollment_id,
    'sale',
    p_processor,
    v_processor_config_id,
    p_transaction_id,
    v_enr.processor_subscription_id,
    p_amount,
    'usd',
    COALESCE(v_enr.payments_made, 0) + 1,
    CASE WHEN v_is_finite THEN v_enr.payments_total ELSE NULL END,
    p_source,
    true,
    p_raw_payload
  )
  ON CONFLICT (
    location_id,
    processor,
    (COALESCE(processor_config_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    processor_transaction_id
  )
    WHERE processor_transaction_id IS NOT NULL
      AND processor_transaction_id <> ''
  DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN QUERY
    SELECT
      true,
      NULL::uuid,
      v_enr.payments_made,
      v_enr.payments_total,
      false,
      v_enr.billing_completed_at,
      v_enr.next_billing_date,
      v_enr.next_billing_date_source;
    RETURN;
  END IF;

  v_new_made := COALESCE(v_enr.payments_made, 0) + 1;
  v_is_final := v_is_finite AND v_new_made >= v_enr.payments_total;

  IF v_is_final THEN
    v_next := NULL;
    v_source := 'complete';
    v_completed := now();
  ELSE
    v_completed := v_enr.billing_completed_at;
    IF p_next_billing_date IS NOT NULL THEN
      v_next := p_next_billing_date;
      v_source := COALESCE(p_next_billing_source, 'processor');
    ELSE
      v_next := (
        COALESCE(v_enr.next_billing_date, CURRENT_DATE)::timestamp
        + CASE lower(p_interval)
            WHEN 'daily' THEN interval '1 day'
            WHEN 'weekly' THEN interval '7 days'
            WHEN 'bi_weekly' THEN interval '14 days'
            WHEN 'biweekly' THEN interval '14 days'
            WHEN 'quarterly' THEN interval '3 months'
            WHEN 'annual' THEN interval '1 year'
            ELSE interval '1 month'
          END
      )::date;
      v_source := 'estimated';
    END IF;
  END IF;

  UPDATE public.enrollments AS e
  SET payments_made = v_new_made,
      next_billing_date = v_next,
      next_billing_date_source = v_source,
      billing_completed_at = v_completed,
      updated_at = now()
  WHERE e.id = p_enrollment_id
    AND e.location_id = p_location_id;

  RETURN QUERY
  SELECT
    false,
    v_event_id,
    v_new_made,
    v_enr.payments_total,
    v_is_final,
    v_completed,
    v_next,
    v_source;
END;
$$;

REVOKE ALL ON FUNCTION public.record_recurring_payment(
  uuid, text, text, text, numeric, uuid, date, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_recurring_payment(
  uuid, text, text, text, numeric, uuid, date, text, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 112;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
