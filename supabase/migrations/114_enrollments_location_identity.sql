-- 114_enrollments_location_identity.sql
-- Additive identity correction. Apply only this file; NEVER replay 107-112.
-- No business-name backfill, approval changes, billing changes, or credential writes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.merchants
  ADD COLUMN ghl_location_name TEXT,
  ADD COLUMN ghl_location_name_source TEXT,
  ADD COLUMN ghl_location_name_verified_at TIMESTAMPTZ,
  ADD COLUMN ghl_location_name_checked_at TIMESTAMPTZ,
  ADD COLUMN ghl_location_name_error TEXT,
  ADD COLUMN ghl_location_name_refresh_id UUID,
  ADD COLUMN ghl_identity_authorized BOOLEAN GENERATED ALWAYS AS (
    COALESCE(
      status = 'active'
      AND COALESCE(NULLIF(ghl_access_token_encrypted, ''), NULLIF(ghl_access_token, '')) IS NOT NULL
      AND COALESCE(NULLIF(ghl_refresh_token_encrypted, ''), NULLIF(ghl_refresh_token, '')) IS NOT NULL
      AND ghl_scopes ~ '(^|[[:space:]])locations[.]readonly($|[[:space:]])'
      AND (NULLIF(config->>'ghl_token_company_id', '') IS NULL OR config->>'ghl_token_company_id' = company_id)
      AND (
        (config->>'ghl_token_scope' = 'location' AND config->>'ghl_token_location_id' = location_id)
        OR (config->>'ghl_token_scope' = 'company' AND NULLIF(company_id, '') IS NOT NULL
          AND config->>'ghl_token_company_id' = company_id)
      ), false)
  ) STORED,
  ADD CONSTRAINT merchants_location_identity_proof CHECK (
    (ghl_location_name IS NULL AND ghl_location_name_source IS NULL AND ghl_location_name_verified_at IS NULL)
    OR (ghl_location_name IS NOT NULL AND ghl_location_name_source IS NOT NULL
      AND length(btrim(ghl_location_name)) BETWEEN 1 AND 500
      AND ghl_location_name_source = 'ghl_location_api' AND ghl_location_name_verified_at IS NOT NULL)
  ),
  ADD CONSTRAINT merchants_location_identity_error CHECK (
    ghl_location_name_error IS NULL OR ghl_location_name_error IN (
      'authorization_incomplete', 'provider_unavailable', 'identity_mismatch', 'invalid_response'
    )
  );

COMMENT ON COLUMN public.merchants.ghl_location_name IS
  'Verified exact GET /locations/:locationId location.name; never business/agency name.';
COMMENT ON COLUMN public.merchants.ghl_identity_authorized IS
  'Sanitized credential-presence, scope and tenant-binding check; not proof of provider availability or provisioning.';
CREATE INDEX idx_merchants_ghl_location_name_prefix
  ON public.merchants (lower(ghl_location_name) text_pattern_ops);

CREATE OR REPLACE FUNCTION list_operator_merchants_page(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_query TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_plan TEXT DEFAULT NULL,
  p_processor TEXT DEFAULT NULL,
  p_installation TEXT DEFAULT NULL,
  p_reseller TEXT DEFAULT NULL,
  p_incident_severity TEXT DEFAULT NULL,
  p_component TEXT DEFAULT NULL,
  p_component_state TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_query TEXT := NULLIF(lower(btrim(COALESCE(p_query, ''))), '');
  v_query_pattern TEXT;
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 100000
     OR length(COALESCE(v_query, '')) > 100
     OR (p_state IS NOT NULL AND p_state NOT IN (
       'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
     ))
     OR (p_processor IS NOT NULL AND p_processor NOT IN ('stripe', 'nmi', 'whop'))
     OR (p_installation IS NOT NULL AND p_installation NOT IN (
       'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
     ))
     OR (p_plan IS NOT NULL AND p_plan NOT IN (
       'legacy', 'test', 'standard', 'wholepay', 'unknown'
     ))
     OR (
       p_reseller IS NOT NULL
       AND p_reseller <> 'unassigned'
       AND p_reseller !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     )
     OR (p_incident_severity IS NOT NULL AND p_incident_severity NOT IN (
       'critical', 'urgent', 'warning', 'info'
     ))
     OR (p_component IS NOT NULL AND p_component NOT IN (
       'processor', 'workflow', 'evidence', 'defense', 'billing'
     ))
     OR (p_component_state IS NOT NULL AND p_component_state NOT IN (
       'healthy', 'degraded', 'unhealthy', 'unknown', 'not_applicable'
     ))
     OR ((p_component IS NULL) <> (p_component_state IS NULL)) THEN
    RAISE EXCEPTION 'Invalid operator merchant page request';
  END IF;
  v_query_pattern := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  WITH processor_rows AS (
    SELECT config.location_id, config.merchant_id, config.processor_type::TEXT AS processor_type
    FROM processor_configs config
    WHERE config.is_active = true
    UNION ALL
    SELECT config.location_id, config.merchant_id, 'whop'::TEXT
    FROM whop_configs config
    WHERE config.status = 'connected'
  ),
  processors AS (
    SELECT
      location_id,
      merchant_id,
      array_agg(DISTINCT processor_type ORDER BY processor_type) AS processor_types
    FROM processor_rows
    GROUP BY location_id, merchant_id
  ),
  filtered AS MATERIALIZED (
    SELECT
      merchant.location_id,
      merchant.id AS merchant_id,
      CASE WHEN merchant.ghl_identity_authorized AND merchant.ghl_location_name_source = 'ghl_location_api'
        AND merchant.ghl_location_name_verified_at IS NOT NULL
        AND merchant.ghl_location_name_error IS DISTINCT FROM 'authorization_incomplete'
        THEN COALESCE(merchant.ghl_location_name, merchant.location_id)
        ELSE merchant.location_id END AS merchant_name,
      merchant.business_name,
      merchant.ghl_location_name,
      merchant.ghl_location_name_source,
      merchant.ghl_location_name_verified_at,
      merchant.ghl_location_name_checked_at,
      merchant.ghl_location_name_error,
      merchant.ghl_identity_authorized,
      merchant.status AS merchant_status,
      merchant.installed_at,
      merchant.snapshot_status,
      merchant.marketplace_plan_key,
      merchant.marketplace_billing_status,
      COALESCE(rollup.overall_state, 'unknown') AS overall_state,
      rollup.highest_incident_severity,
      COALESCE(rollup.installation_state, 'unknown') AS installation_state,
      COALESCE(rollup.processor_state, 'unknown') AS processor_state,
      COALESCE(rollup.workflow_state, 'unknown') AS workflow_state,
      COALESCE(rollup.evidence_state, 'unknown') AS evidence_state,
      COALESCE(rollup.defense_state, 'unknown') AS defense_state,
      COALESCE(rollup.billing_state, 'unknown') AS billing_state,
      COALESCE(rollup.open_critical_count, 0) AS open_critical_count,
      COALESCE(rollup.open_urgent_count, 0) AS open_urgent_count,
      COALESCE(rollup.open_warning_count, 0) AS open_warning_count,
      COALESCE(rollup.needs_attention_count, 0) AS needs_attention_count,
      (
        rollup.location_id IS NULL
        OR COALESCE(rollup.needs_attention_count, 0) > 0
        OR COALESCE(rollup.overall_state, 'unknown') NOT IN ('healthy', 'not_applicable')
      ) AS requires_attention,
      rollup.last_observed_at,
      COALESCE(rollup.last_reconciled_at, merchant.updated_at, merchant.installed_at) AS last_reconciled_at,
      COALESCE(processors.processor_types, ARRAY[]::TEXT[]) AS processor_types,
      reseller.id AS reseller_organization_id,
      reseller.name AS reseller_name
    FROM merchants merchant
    LEFT JOIN merchant_health_rollups rollup ON rollup.merchant_id = merchant.id AND rollup.location_id = merchant.location_id
    LEFT JOIN processors
      ON processors.location_id = merchant.location_id
     AND processors.merchant_id = merchant.id
    LEFT JOIN reseller_merchant_assignments assignment
      ON assignment.location_id = merchant.location_id
     AND assignment.status = 'active'
    LEFT JOIN operator_organizations reseller
      ON reseller.id = assignment.reseller_organization_id
     AND reseller.organization_type = 'reseller'
    WHERE (
      v_query IS NULL
      OR lower(merchant.location_id) = v_query
      OR lower(merchant.business_name) LIKE v_query_pattern ESCAPE '\'
      OR (
        merchant.ghl_location_name_source = 'ghl_location_api'
        AND merchant.ghl_location_name_verified_at IS NOT NULL
        AND lower(merchant.ghl_location_name) LIKE v_query_pattern ESCAPE '\'
      )
    )
      AND (p_state IS NULL OR COALESCE(rollup.overall_state, 'unknown') = p_state)
      AND (p_plan IS NULL OR merchant.marketplace_plan_key = p_plan)
      AND (p_processor IS NULL OR p_processor = ANY(
        COALESCE(processors.processor_types, ARRAY[]::TEXT[])
      ))
      AND (p_installation IS NULL OR COALESCE(rollup.installation_state, 'unknown') = p_installation)
      AND CASE
        WHEN p_reseller IS NULL THEN true
        WHEN p_reseller = 'unassigned' THEN reseller.id IS NULL
        ELSE reseller.id = p_reseller::UUID
      END
      AND (
        p_incident_severity IS NULL
        OR rollup.highest_incident_severity = p_incident_severity
      )
      AND (
        p_component IS NULL
        OR CASE p_component
          WHEN 'processor' THEN COALESCE(rollup.processor_state, 'unknown')
          WHEN 'workflow' THEN COALESCE(rollup.workflow_state, 'unknown')
          WHEN 'evidence' THEN COALESCE(rollup.evidence_state, 'unknown')
          WHEN 'defense' THEN COALESCE(rollup.defense_state, 'unknown')
          WHEN 'billing' THEN COALESCE(rollup.billing_state, 'unknown')
        END = p_component_state
      )
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY requires_attention DESC, needs_attention_count DESC, last_reconciled_at DESC NULLS LAST, location_id ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY
        page.requires_attention DESC,
        page.needs_attention_count DESC,
        page.last_reconciled_at DESC NULLS LAST,
        page.location_id ASC
      )
      FROM page
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'limit', p_limit,
    'offset', p_offset
  )
  INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_operator_merchants_page(integer,integer,text,text,text,text,text,text,text,text,text) TO service_role;
-- Preserve the existing table's RLS/policies/grants. No new table or public API is exposed.
NOTIFY pgrst, 'reload schema';
COMMIT;
