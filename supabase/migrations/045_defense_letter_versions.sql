-- 045_defense_letter_versions.sql — Defense Module Rebuild (sub-phase A)
--
-- Append-only history of every AI-generated and merchant-edited letter version
-- per defense packet. Latest version is shown by default (mirrored to
-- defense_packets.defense_letter_text for fast read). On Mark Submitted, the
-- version that was current is flagged is_submitted_version=true and locked.

CREATE TABLE IF NOT EXISTS defense_letter_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defense_packet_id     UUID NOT NULL REFERENCES defense_packets(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL,
  letter_text           TEXT NOT NULL,
  generated_at          TIMESTAMPTZ DEFAULT now(),
  generated_by          TEXT CHECK (generated_by IN ('ai', 'manual_edit')),
  model_used            TEXT,
  prompt_tokens_used    INTEGER,
  response_tokens_used  INTEGER,
  is_submitted_version  BOOLEAN DEFAULT false,
  notes                 TEXT,
  UNIQUE (defense_packet_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_defense_letter_versions_packet
  ON defense_letter_versions (defense_packet_id, version_number DESC);

ALTER TABLE defense_letter_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON defense_letter_versions
  FOR ALL USING (true) WITH CHECK (true);
