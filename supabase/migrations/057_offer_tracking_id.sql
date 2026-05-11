-- 057: Optional merchant-facing offer tracking ID for reporting.

ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS tracking_id TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_tracking_id
  ON offers_mirror(location_id, tracking_id)
  WHERE tracking_id IS NOT NULL
    AND tracking_id <> '';
