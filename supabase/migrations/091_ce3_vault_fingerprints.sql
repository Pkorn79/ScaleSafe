-- 091_ce3_vault_fingerprints.sql — CE 3.0 capture hardening (MVP-4 Phase A)
--
-- Visa Compelling Evidence 3.0 matches the disputed transaction against prior
-- undisputed ones by identity elements. IP + email are already captured; these
-- columns add the two stronger signals:
--   card_fingerprint             — Stripe's stable per-card fingerprint
--                                  (payment_method_details.card.fingerprint).
--                                  Verifies "same payment method" across priors
--                                  and feeds the MVP-5 Radar block list.
--   customer_device_fingerprint  — client-side device fingerprint sent by the
--                                  checkout page (a CE 3.0 "main" element).

ALTER TABLE stripe_evidence_vault ADD COLUMN IF NOT EXISTS card_fingerprint TEXT;
ALTER TABLE stripe_evidence_vault ADD COLUMN IF NOT EXISTS customer_device_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_card_fingerprint
  ON stripe_evidence_vault (card_fingerprint);
