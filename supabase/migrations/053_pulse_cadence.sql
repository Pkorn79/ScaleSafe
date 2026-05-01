-- 053: App-owned pulse cadence for beta snapshot.

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS pulse_cadence_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS pulse_frequency_days INTEGER DEFAULT 30;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS pulse_cadence_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pulse_frequency_days INTEGER,
  ADD COLUMN IF NOT EXISTS next_pulse_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_pulse_sent_at TIMESTAMPTZ;

ALTER TABLE evidence_pulse_checkins
  ADD COLUMN IF NOT EXISTS enrollment_id UUID;

CREATE INDEX IF NOT EXISTS idx_enrollments_pulse_due
  ON enrollments (next_pulse_due_at)
  WHERE pulse_cadence_enabled = true
    AND next_pulse_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ev_pulse_enrollment
  ON evidence_pulse_checkins (enrollment_id);
