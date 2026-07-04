-- ============================================================
-- Migration 084: Add 'needs_review' to defense_packets.status
-- ============================================================
-- A defense packet must not be presented as a finished, ready-to-submit
-- defense when either:
--   1. The AI draft was unavailable after retries and a deterministic
--      structured fallback letter was generated, OR
--   2. The disputed transaction could not be tied to a specific program
--      (contact-only scope), so the evidence is contact-wide and unverified.
--
-- These packets are now marked 'needs_review' instead of 'complete', and the
-- ss_defense_ready workflow trigger is NOT fired for them. This adds the new
-- value to the existing status CHECK constraint.
-- ============================================================

ALTER TABLE defense_packets
  DROP CONSTRAINT IF EXISTS defense_packets_status_check;

ALTER TABLE defense_packets
  ADD CONSTRAINT defense_packets_status_check
  CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'needs_review'));
