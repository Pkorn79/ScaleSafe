-- 042_evidence_timeline_perf.sql — composite index for filtered timeline queries
--
-- The client profile's Evidence tab supports filtering by type + date range +
-- pagination. Without a composite index, (location_id, contact_id, created_at)
-- queries on the unified `evidence` table scan more rows than necessary as the
-- table grows beyond a few hundred rows per merchant.
--
-- Safe to run multiple times (IF NOT EXISTS). Existing single-column indexes
-- from migration 010 remain useful for other query paths.

CREATE INDEX IF NOT EXISTS idx_evidence_location_contact_created
  ON evidence (location_id, contact_id, created_at DESC);

-- Optional filter-by-type speedup (compound w/ contact scope)
CREATE INDEX IF NOT EXISTS idx_evidence_location_contact_type
  ON evidence (location_id, contact_id, evidence_type);
