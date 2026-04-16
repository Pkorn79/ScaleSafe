-- 047_defense_transaction_link.sql — Link defense packets to the specific disputed transaction
--
-- Problem: the defense compile form collects contactId but not WHICH transaction
-- is being disputed. For clients with multiple charges, evidence scoping pulls
-- everything and the AI letter cites irrelevant evidence.
--
-- Fix: add payment_event_id + enrollment_id FKs to defense_packets. The compile
-- form now offers a transaction selector dropdown; the selected transaction
-- resolves both columns. Evidence queries scope by enrollment when available.

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS payment_event_id UUID REFERENCES payment_events(id);

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES enrollments(id);

CREATE INDEX IF NOT EXISTS idx_defense_packets_payment_event
  ON defense_packets (payment_event_id);

CREATE INDEX IF NOT EXISTS idx_defense_packets_enrollment
  ON defense_packets (enrollment_id);
