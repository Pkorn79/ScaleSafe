-- 043_defense_packets_offer_id.sql — add offer_id to defense_packets
--
-- The Defense compile form (DefenseView.vue) collects an optional offerId so
-- the chargeback can be linked to the specific offer the customer purchased.
-- The repository previously tried to insert this column but it never existed
-- on the table — Postgres rejected the entire insert with "column does not
-- exist", which surfaced to merchants as "An unexpected error occurred".
--
-- Additive + idempotent. Safe to run on tables that already have data.

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS offer_id UUID;

CREATE INDEX IF NOT EXISTS idx_defense_offer ON defense_packets (offer_id);
