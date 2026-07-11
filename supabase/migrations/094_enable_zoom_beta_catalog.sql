-- 094_enable_zoom_beta_catalog.sql
-- Zoom's named OAuth adapter is implemented and its Marketplace app is ready
-- for local testing. Expose the Beta integration in every merchant catalog;
-- each location still authorizes and stores its own Zoom account separately.

INSERT INTO evidence_provider_releases (
  provider_key,
  release_status,
  wave,
  enabled_by_default,
  updated_by,
  updated_at
)
VALUES ('zoom', 'beta', 1, true, 'migration_094', now())
ON CONFLICT (provider_key) DO UPDATE SET
  release_status = EXCLUDED.release_status,
  wave = EXCLUDED.wave,
  enabled_by_default = EXCLUDED.enabled_by_default,
  updated_by = EXCLUDED.updated_by,
  updated_at = EXCLUDED.updated_at;

