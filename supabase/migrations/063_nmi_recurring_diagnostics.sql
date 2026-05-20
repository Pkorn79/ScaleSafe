-- 063: Strengthen NMI recurring diagnostics.
-- Adds a direct link from an NMI diagnostic row to the ScaleSafe payment_event
-- created from that post/history sync. This makes it possible to distinguish:
-- received but unmatched, verified but not recorded, imported, duplicate, and failed.

ALTER TABLE nmi_silent_post_logs
  ADD COLUMN IF NOT EXISTS payment_event_id UUID REFERENCES payment_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nmi_silent_post_logs_payment_event
  ON nmi_silent_post_logs(payment_event_id)
  WHERE payment_event_id IS NOT NULL;
