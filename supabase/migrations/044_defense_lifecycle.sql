-- 044_defense_lifecycle.sql — Defense Module Rebuild (Phase 3 sub-phase A)
--
-- Adds the merchant-action lifecycle to defense_packets (orthogonal to the
-- existing AI pipeline `status` column), a foreign key linking packets to
-- their dispute_events row, and an addressee field. Widens the
-- defense_outcomes.outcome CHECK to include 'withdrawn'. Relaxes
-- dispute_events.stripe_dispute_id NOT NULL so NMI rows (no Stripe ID) can
-- insert. Adds a `processor` discriminator on dispute_events.

-- ── defense_packets: lifecycle + linkage + addressee ───────────────────────
ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT
    DEFAULT 'pending_submission'
    CHECK (lifecycle_status IN ('pending_submission', 'submitted', 'won', 'lost', 'withdrawn'));

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS dispute_event_id UUID REFERENCES dispute_events(id);

ALTER TABLE defense_packets
  ADD COLUMN IF NOT EXISTS addressee TEXT;

CREATE INDEX IF NOT EXISTS idx_defense_packets_lifecycle
  ON defense_packets (lifecycle_status, response_deadline);

CREATE INDEX IF NOT EXISTS idx_defense_packets_dispute_event
  ON defense_packets (dispute_event_id);

-- ── defense_outcomes: add 'withdrawn' to the outcome CHECK ─────────────────
ALTER TABLE defense_outcomes
  DROP CONSTRAINT IF EXISTS defense_outcomes_outcome_check;

ALTER TABLE defense_outcomes
  ADD CONSTRAINT defense_outcomes_outcome_check
  CHECK (outcome IN ('won', 'lost', 'pending', 'expired', 'withdrawn'));

-- ── dispute_events: relax stripe_dispute_id, add processor discriminator ───
ALTER TABLE dispute_events
  ALTER COLUMN stripe_dispute_id DROP NOT NULL;

ALTER TABLE dispute_events
  ADD COLUMN IF NOT EXISTS processor TEXT
    NOT NULL DEFAULT 'stripe'
    CHECK (processor IN ('stripe', 'nmi'));

CREATE INDEX IF NOT EXISTS idx_dispute_events_processor_status
  ON dispute_events (processor, status);
