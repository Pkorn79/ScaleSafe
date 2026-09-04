\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_rpc_count INTEGER;
BEGIN
  IF scalesafe_schema_version() <> 112 THEN
    RAISE EXCEPTION 'Expected ScaleSafe schema version 112';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_attribute
    WHERE attrelid IN (
      'public.enrollments'::regclass,
      'public.payment_events'::regclass,
      'public.payment_methods'::regclass
    )
      AND attname = 'processor_config_id'
      AND NOT attisdropped
      AND atttypid = 'uuid'::regtype
      AND NOT attnotnull
  ) <> 3 THEN
    RAISE EXCEPTION 'Processor configuration binding columns are not nullable UUIDs';
  END IF;

  IF (
    SELECT count(*)
    FROM (
      VALUES
        ('public.enrollments'::regclass, 'enrollments_processor_config_id_fkey'),
        ('public.payment_events'::regclass, 'payment_events_processor_config_id_fkey'),
        ('public.payment_methods'::regclass, 'payment_methods_processor_config_id_fkey')
    ) AS expected(conrelid, conname)
    JOIN pg_constraint AS constraint_row
      ON constraint_row.conrelid = expected.conrelid
     AND constraint_row.conname = expected.conname
    WHERE constraint_row.confrelid = 'public.processor_configs'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'n'
      AND constraint_row.convalidated
  ) <> 3 THEN
    RAISE EXCEPTION 'Processor configuration foreign keys are missing, invalid, or do not use ON DELETE SET NULL';
  END IF;

  IF (
    SELECT count(*)
    FROM (
      VALUES
        ('public.enrollments'::regclass, 'idx_enrollments_processor_config_id'),
        ('public.payment_events'::regclass, 'idx_payment_events_processor_config_id'),
        ('public.payment_methods'::regclass, 'idx_payment_methods_processor_config_id')
    ) AS expected(table_oid, index_name)
    JOIN pg_index AS index_row ON index_row.indrelid = expected.table_oid
    JOIN pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
     AND index_class.relname = expected.index_name
    WHERE index_row.indnkeyatts = 1
      AND pg_get_indexdef(index_row.indexrelid, 1, true) = 'processor_config_id'
      AND index_row.indpred IS NOT NULL
  ) <> 3 THEN
    RAISE EXCEPTION 'Processor configuration supporting indexes are missing or malformed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS i
    JOIN pg_class AS index_class ON index_class.oid = i.indexrelid
    WHERE i.indrelid = 'public.payment_events'::regclass
      AND index_class.relname = 'uq_payment_events_location_processor_txn'
      AND i.indisunique
      AND i.indnkeyatts = 4
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'location_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'processor'
      AND pg_get_indexdef(i.indexrelid, 3, true) =
        'COALESCE(processor_config_id, ''00000000-0000-0000-0000-000000000000''::uuid)'
      AND pg_get_indexdef(i.indexrelid, 4, true) = 'processor_transaction_id'
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Processor-scoped transaction dedupe index is missing or malformed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.processor_configs'::regclass
      AND conname = 'processor_configs_id_not_zero_check'
      AND contype = 'c'
      AND convalidated
      AND position(
        '00000000-0000-0000-0000-000000000000'
        IN pg_get_constraintdef(oid)
      ) > 0
      AND position('id <> ' IN pg_get_constraintdef(oid)) > 0
  ) THEN
    RAISE EXCEPTION 'Reserved processor configuration ID constraint is missing or malformed';
  END IF;

  SELECT count(*)
  INTO v_rpc_count
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'record_recurring_payment';

  IF v_rpc_count <> 1
    OR to_regprocedure(
      'public.record_recurring_payment(uuid,text,text,text,numeric,uuid,date,text,text,text,jsonb)'
    ) IS NULL
    OR to_regprocedure(
      'public.record_recurring_payment(uuid,text,text,text,numeric,date,text,text,text,jsonb)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'record_recurring_payment is missing or has an ambiguous legacy overload';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'record_recurring_payment'
      AND proc.pronargdefaults = 6
      AND proc.proargnames[6] = 'p_processor_config_id'
  ) THEN
    RAISE EXCEPTION 'record_recurring_payment processor configuration argument/default is incorrect';
  END IF;
END;
$$;

-- Every deterministically resolvable pre-migration NMI enrollment must now be
-- bound. Ambiguous and unmatched rows are intentionally allowed to stay NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.enrollments AS e
    LEFT JOIN public.offers_mirror AS o
      ON o.id = e.offer_id
     AND o.location_id = e.location_id
    JOIN LATERAL (
      SELECT count(*) AS candidate_count
      FROM public.processor_configs AS c
      WHERE c.merchant_id = e.merchant_id
        AND c.location_id = e.location_id
        AND c.processor_type = 'nmi'
        AND (
          (
            NULLIF(BTRIM(o.nmi_processor_id), '') IS NOT NULL
            AND c.nmi_processor_id = BTRIM(o.nmi_processor_id)
          )
          OR NULLIF(BTRIM(o.nmi_processor_id), '') IS NULL
        )
    ) AS candidates ON true
    WHERE e.processor_type = 'nmi'
      AND e.processor_config_id IS NULL
      AND candidates.candidate_count = 1
  ) THEN
    RAISE EXCEPTION 'A deterministically resolvable NMI enrollment was not backfilled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_events AS pe
    JOIN public.enrollments AS e ON e.id = pe.enrollment_id
    WHERE pe.processor = 'nmi'
      AND pe.processor_config_id IS NULL
      AND e.processor_config_id IS NOT NULL
      AND pe.location_id = e.location_id
      AND (pe.merchant_id IS NULL OR pe.merchant_id = e.merchant_id)
  ) THEN
    RAISE EXCEPTION 'An eligible NMI payment event was not backfilled from its enrollment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_methods AS pm
    JOIN LATERAL (
      SELECT count(*) AS candidate_count
      FROM public.processor_configs AS c
      WHERE c.merchant_id = pm.merchant_id
        AND c.location_id = pm.location_id
        AND c.processor_type = pm.processor_type
    ) AS candidates ON true
    WHERE pm.processor_config_id IS NULL
      AND candidates.candidate_count = 1
  ) THEN
    RAISE EXCEPTION 'A deterministically resolvable payment method was not backfilled';
  END IF;
END;
$$;

INSERT INTO public.merchants (id, location_id, business_name)
VALUES (
  '11200000-0000-4000-8000-000000000001',
  'migration-112-location',
  'Migration 112 Test'
);

INSERT INTO public.processor_configs (
  id,
  merchant_id,
  location_id,
  processor_type,
  label,
  nmi_processor_id
)
VALUES
  (
    '11200000-0000-4000-8000-000000000011',
    '11200000-0000-4000-8000-000000000001',
    'migration-112-location',
    'nmi',
    'Migration 112 MID A',
    'migration-112-mid-a'
  ),
  (
    '11200000-0000-4000-8000-000000000012',
    '11200000-0000-4000-8000-000000000001',
    'migration-112-location',
    'nmi',
    'Migration 112 MID B',
    'migration-112-mid-b'
  ),
  (
    '11200000-0000-4000-8000-000000000013',
    '11200000-0000-4000-8000-000000000001',
    'migration-112-location',
    'nmi',
    'Migration 112 delete proof',
    'migration-112-mid-delete'
  );

INSERT INTO public.enrollments (
  id,
  location_id,
  contact_id,
  merchant_id,
  processor_type,
  payment_type,
  payments_made
)
VALUES
  (
    '11200000-0000-4000-8000-000000000101',
    'migration-112-location',
    'migration-112-contact-a',
    '11200000-0000-4000-8000-000000000001',
    'nmi',
    'subscription',
    0
  ),
  (
    '11200000-0000-4000-8000-000000000102',
    'migration-112-location',
    'migration-112-contact-b',
    '11200000-0000-4000-8000-000000000001',
    'nmi',
    'subscription',
    0
  ),
  (
    '11200000-0000-4000-8000-000000000103',
    'migration-112-location',
    'migration-112-contact-null-a',
    '11200000-0000-4000-8000-000000000001',
    'nmi',
    'subscription',
    0
  ),
  (
    '11200000-0000-4000-8000-000000000104',
    'migration-112-location',
    'migration-112-contact-null-b',
    '11200000-0000-4000-8000-000000000001',
    'nmi',
    'subscription',
    0
  ),
  (
    '11200000-0000-4000-8000-000000000105',
    'migration-112-location',
    'migration-112-contact-delete',
    '11200000-0000-4000-8000-000000000001',
    'nmi',
    'subscription',
    0
  );

SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000101',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-shared-transaction',
  p_amount := 1.00,
  p_processor_config_id := '11200000-0000-4000-8000-000000000011',
  p_next_billing_date := CURRENT_DATE + 30
);

SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000102',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-shared-transaction',
  p_amount := 1.00,
  p_processor_config_id := '11200000-0000-4000-8000-000000000012',
  p_next_billing_date := CURRENT_DATE + 30
);

-- A repeat for the same configuration is one identity and must not advance.
SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000101',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-shared-transaction',
  p_amount := 1.00,
  p_processor_config_id := '11200000-0000-4000-8000-000000000011',
  p_next_billing_date := CURRENT_DATE + 30
);

DO $$
DECLARE
  v_event_count INTEGER;
  v_bound_count INTEGER;
  v_payment_total INTEGER;
  v_mismatch_blocked BOOLEAN := false;
BEGIN
  SELECT count(*), count(DISTINCT processor_config_id)
  INTO v_event_count, v_bound_count
  FROM public.payment_events
  WHERE location_id = 'migration-112-location'
    AND processor = 'nmi'
    AND processor_transaction_id = 'migration-112-shared-transaction';

  IF v_event_count <> 2 OR v_bound_count <> 2 THEN
    RAISE EXCEPTION 'Processor-scoped transaction identities collided';
  END IF;

  SELECT sum(payments_made)
  INTO v_payment_total
  FROM public.enrollments
  WHERE id IN (
    '11200000-0000-4000-8000-000000000101',
    '11200000-0000-4000-8000-000000000102'
  );

  IF v_payment_total <> 2 THEN
    RAISE EXCEPTION 'Config-scoped duplicate delivery advanced an enrollment twice';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.enrollments AS e
    JOIN public.payment_events AS pe ON pe.enrollment_id = e.id
    WHERE e.id = '11200000-0000-4000-8000-000000000101'
      AND e.processor_config_id = '11200000-0000-4000-8000-000000000011'
      AND pe.processor_config_id = e.processor_config_id
  ) THEN
    RAISE EXCEPTION 'RPC processor configuration binding was not persisted';
  END IF;

  BEGIN
    PERFORM * FROM public.record_recurring_payment(
      p_enrollment_id := '11200000-0000-4000-8000-000000000101',
      p_location_id := 'migration-112-location',
      p_processor := 'nmi',
      p_transaction_id := 'migration-112-mismatch',
      p_amount := 1.00,
      p_processor_config_id := '11200000-0000-4000-8000-000000000012'
    );
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%does not match immutable enrollment binding%' THEN
        v_mismatch_blocked := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT v_mismatch_blocked THEN
    RAISE EXCEPTION 'Immutable enrollment binding accepted a different configuration';
  END IF;
END;
$$;

SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000103',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-null-identity',
  p_amount := 1.00
);

SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000104',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-null-identity',
  p_amount := 1.00
);

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.payment_events
    WHERE location_id = 'migration-112-location'
      AND processor = 'nmi'
      AND processor_config_id IS NULL
      AND processor_transaction_id = 'migration-112-null-identity'
  ) <> 1 THEN
    RAISE EXCEPTION 'NULL processor configuration did not remain one identity';
  END IF;
END;
$$;

SELECT * FROM public.record_recurring_payment(
  p_enrollment_id := '11200000-0000-4000-8000-000000000105',
  p_location_id := 'migration-112-location',
  p_processor := 'nmi',
  p_transaction_id := 'migration-112-delete-proof',
  p_amount := 1.00,
  p_processor_config_id := '11200000-0000-4000-8000-000000000013'
);

INSERT INTO public.payment_methods (
  id,
  merchant_id,
  location_id,
  contact_id,
  processor_type,
  processor_config_id,
  nmi_customer_vault_id
)
VALUES (
  '11200000-0000-4000-8000-000000000201',
  '11200000-0000-4000-8000-000000000001',
  'migration-112-location',
  'migration-112-contact-delete',
  'nmi',
  '11200000-0000-4000-8000-000000000013',
  'migration-112-vault-delete'
);

DELETE FROM public.processor_configs
WHERE id = '11200000-0000-4000-8000-000000000013';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.enrollments
    WHERE id = '11200000-0000-4000-8000-000000000105'
      AND processor_config_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE enrollment_id = '11200000-0000-4000-8000-000000000105'
      AND processor_config_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.payment_methods
    WHERE id = '11200000-0000-4000-8000-000000000201'
      AND processor_config_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ON DELETE SET NULL behavior failed';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'MIGRATION 112 IMMUTABLE PROCESSOR CONFIG BINDING PASSED' AS result;
