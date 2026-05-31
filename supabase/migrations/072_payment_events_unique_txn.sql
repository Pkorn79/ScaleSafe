-- 072_payment_events_unique_txn.sql
-- Batch A (bug hunt 2026-05-29): primary dedupe for recurring payment webhooks.
--
-- A partial UNIQUE index on (location_id, processor, processor_transaction_id) is the
-- authoritative idempotency guard for recurring payment ledger rows. Rows with a NULL or
-- empty processor_transaction_id are excluded (those paths must synthesize a stable id).
--
-- PRE-CHECK (run before applying — resolve any duplicates manually; do NOT auto-delete,
-- payment_events rows feed the ledger and chargeback evidence):
--   SELECT location_id, processor, processor_transaction_id, count(*) AS n,
--          array_agg(id ORDER BY created_at) AS event_ids
--   FROM payment_events
--   WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> ''
--   GROUP BY location_id, processor, processor_transaction_id
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_location_processor_txn
  ON payment_events (location_id, processor, processor_transaction_id)
  WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> '';

NOTIFY pgrst, 'reload schema';
