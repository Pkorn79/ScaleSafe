-- 078_dispute_events_whop_processor.sql
-- Batch D (bug hunt 2026-05-29): allow Whop disputes in dispute_events.
--
-- #28 routes Whop dispute.created events into dispute_events (instead of an invalid 'chargeback'
-- payment_events row). The processor CHECK from migration 044 only permits 'stripe'/'nmi', so a
-- Whop row would default to 'stripe' and pollute Stripe dispute analytics. Extend the CHECK.

ALTER TABLE dispute_events DROP CONSTRAINT IF EXISTS dispute_events_processor_check;
ALTER TABLE dispute_events
  ADD CONSTRAINT dispute_events_processor_check CHECK (processor IN ('stripe', 'nmi', 'whop'));

NOTIFY pgrst, 'reload schema';
