-- 095_activate_authorized_zoom_connections.sql
-- Migration 093 held authorized Zoom connections in testing until merchants
-- manually mapped meeting IDs. Zoom now resolves attendance automatically by
-- tenant, participant identity, enrollment eligibility, and offer context.

UPDATE evidence_connections AS connection
SET status = 'active',
    setup_status = 'active',
    health_status = 'healthy',
    activated_at = COALESCE(connection.activated_at, now()),
    last_error_message = NULL,
    updated_at = now()
WHERE connection.provider_key = 'zoom'
  AND connection.setup_status = 'testing'
  AND EXISTS (
    SELECT 1
    FROM evidence_provider_authorizations AS authorization
    WHERE authorization.connection_id = connection.id
      AND authorization.provider_key = 'zoom'
      AND authorization.status = 'active'
  );
