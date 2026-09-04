-- 110_command_center_operator_views.sql
-- Read-only, sanitized projections for the owner-facing Command Center.

DO $$
BEGIN
  IF scalesafe_schema_version() <> 109 THEN
    RAISE EXCEPTION 'Migration 110 requires ScaleSafe schema version 109';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_merchant_health_rollups_name_prefix
  ON merchant_health_rollups (lower(merchant_name) text_pattern_ops);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_health_rollups_merchant
  ON merchant_health_rollups (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchants_business_name_prefix
  ON merchants (lower(business_name) text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_merchants_location_id_lower
  ON merchants (lower(location_id));

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
      COALESCE(NULLIF(merchant.business_name, ''), rollup.merchant_name, merchant.location_id) AS merchant_name,
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
    LEFT JOIN merchant_health_rollups rollup ON rollup.merchant_id = merchant.id
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
        NULLIF(merchant.business_name, '') IS NULL
        AND lower(rollup.merchant_name) LIKE v_query_pattern ESCAPE '\'
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

CREATE OR REPLACE FUNCTION get_operator_platform_summary(
  p_include_merchant_attention BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH merchant_states AS MATERIALIZED (
    SELECT
      merchant.location_id,
      merchant.id AS merchant_id,
      COALESCE(NULLIF(merchant.business_name, ''), rollup.merchant_name, merchant.location_id) AS merchant_name,
      COALESCE(rollup.overall_state, 'unknown') AS overall_state,
      rollup.highest_incident_severity,
      COALESCE(rollup.installation_state, 'unknown') AS installation_state,
      COALESCE(rollup.processor_state, 'unknown') AS processor_state,
      COALESCE(rollup.workflow_state, 'unknown') AS workflow_state,
      COALESCE(rollup.evidence_state, 'unknown') AS evidence_state,
      COALESCE(rollup.defense_state, 'unknown') AS defense_state,
      COALESCE(rollup.billing_state, 'unknown') AS billing_state,
      COALESCE(rollup.needs_attention_count, 0) AS needs_attention_count,
      rollup.last_observed_at,
      COALESCE(rollup.last_reconciled_at, merchant.updated_at, merchant.installed_at) AS last_reconciled_at,
      (
        rollup.location_id IS NULL
        OR COALESCE(rollup.needs_attention_count, 0) > 0
        OR COALESCE(rollup.overall_state, 'unknown') NOT IN ('healthy', 'not_applicable')
      ) AS requires_attention
    FROM merchants merchant
    LEFT JOIN merchant_health_rollups rollup ON rollup.merchant_id = merchant.id
  ),
  health_totals AS (
    SELECT
      count(*) AS health_checks_total,
      count(*) FILTER (WHERE state = 'unhealthy') AS health_unhealthy_count,
      count(*) FILTER (WHERE state = 'unknown') AS health_unknown_count,
      CASE
        WHEN count(*) = 0 THEN 'unknown'
        WHEN count(*) FILTER (WHERE state = 'unhealthy') > 0 THEN 'unhealthy'
        WHEN count(*) FILTER (WHERE state = 'unknown') > 0 THEN 'unknown'
        WHEN count(*) FILTER (WHERE state = 'degraded') > 0 THEN 'degraded'
        ELSE 'healthy'
      END AS platform_state
    FROM health_current
    WHERE state <> 'not_applicable'
  ),
  incident_totals AS (
    SELECT
      count(*) AS active_incident_count,
      count(*) FILTER (WHERE severity = 'critical') AS active_critical_count
    FROM platform_incidents
    WHERE status <> 'resolved'
  ),
  merchant_totals AS (
    SELECT
      count(*) AS merchant_count,
      count(*) FILTER (WHERE requires_attention) AS merchant_attention_count,
      count(*) FILTER (WHERE last_observed_at IS NOT NULL) AS merchant_rollup_count
    FROM merchant_states
  )
  SELECT jsonb_build_object(
    'platform_state', health_totals.platform_state,
    'health_checks_total', health_totals.health_checks_total,
    'health_unhealthy_count', health_totals.health_unhealthy_count,
    'health_unknown_count', health_totals.health_unknown_count,
    'active_incident_count', incident_totals.active_incident_count,
    'active_critical_count', incident_totals.active_critical_count,
    'merchant_count', merchant_totals.merchant_count,
    'merchant_attention_count', merchant_totals.merchant_attention_count,
    'merchant_rollup_count', merchant_totals.merchant_rollup_count,
    'merchant_attention', CASE WHEN p_include_merchant_attention THEN COALESCE((
      SELECT jsonb_agg(to_jsonb(attention) ORDER BY
        attention.requires_attention DESC,
        attention.needs_attention_count DESC,
        attention.last_reconciled_at DESC NULLS LAST,
        attention.location_id ASC
      )
      FROM (
        SELECT *
        FROM merchant_states
        WHERE requires_attention
        ORDER BY requires_attention DESC, needs_attention_count DESC, last_reconciled_at DESC NULLS LAST, location_id ASC
        LIMIT 8
      ) attention
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  )
  INTO v_result
  FROM health_totals, incident_totals, merchant_totals;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_operator_merchant_detail(p_location_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_location_id IS NULL OR length(btrim(p_location_id)) < 1
     OR length(p_location_id) > 100 THEN
    RAISE EXCEPTION 'Invalid operator merchant detail request';
  END IF;

  SELECT jsonb_build_object(
    'merchant', jsonb_build_object(
      'location_id', merchant.location_id,
      'merchant_id', merchant.id,
      'business_name', COALESCE(NULLIF(merchant.business_name, ''), merchant.location_id),
      'status', merchant.status,
      'installed_at', merchant.installed_at,
      'snapshot_status', merchant.snapshot_status,
      'onboarding_complete', merchant.onboarding_complete,
      'marketplace_plan_key', merchant.marketplace_plan_key,
      'marketplace_billing_status', merchant.marketplace_billing_status,
      'marketplace_plan_updated_at', merchant.marketplace_plan_updated_at,
      'marketplace_billing_updated_at', merchant.marketplace_billing_updated_at
    ),
    'health', CASE WHEN rollup.location_id IS NULL THEN NULL ELSE to_jsonb(rollup) END,
    'processors', COALESCE((
      SELECT jsonb_agg(processor ORDER BY processor->>'type')
      FROM (
        SELECT jsonb_build_object(
          'type', config.processor_type,
          'status', CASE WHEN config.is_active THEN 'connected' ELSE 'disabled' END,
          'is_default', config.is_default,
          'mode', CASE
            WHEN config.processor_type = 'stripe' AND config.stripe_livemode = true THEN 'live'
            WHEN config.processor_type = 'stripe' AND config.stripe_livemode = false THEN 'test'
            ELSE NULL
          END,
          'last_verified_at', config.last_verified_at
        ) AS processor
        FROM processor_configs config
        WHERE config.location_id = merchant.location_id
          AND config.merchant_id = merchant.id
        UNION ALL
        SELECT jsonb_build_object(
          'type', 'whop',
          'status', config.status,
          'is_default', false,
          'mode', config.environment,
          'last_verified_at', config.last_verified_at
        )
        FROM whop_configs config
        WHERE config.location_id = merchant.location_id
          AND config.merchant_id = merchant.id
      ) sanitized_processors
    ), '[]'::jsonb),
    'connectors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', connection.id,
        'provider_key', connection.provider_key,
        'connection_type', connection.connection_type,
        'setup_status', connection.setup_status,
        'health_status', connection.health_status,
        'last_event_at', connection.last_event_at,
        'last_success_at', connection.last_success_at,
        'last_error_at', connection.last_error_at
      ) ORDER BY COALESCE(connection.provider_key, connection.connection_type), connection.id)
      FROM evidence_connections connection
      WHERE connection.location_id = merchant.location_id
        AND connection.merchant_id = merchant.id
    ), '[]'::jsonb),
    'incidents', COALESCE((
      SELECT jsonb_agg(to_jsonb(incident_page) ORDER BY incident_page.last_seen_at DESC)
      FROM (
        SELECT
          incident.id,
          incident.check_key,
          incident.severity,
          incident.status,
          incident.occurrence_count,
          incident.first_seen_at,
          incident.last_seen_at,
          incident.runbook_key
        FROM platform_incidents incident
        WHERE incident.location_id = merchant.location_id
        ORDER BY incident.last_seen_at DESC
        LIMIT 20
      ) incident_page
    ), '[]'::jsonb),
    'reseller', (
      SELECT jsonb_build_object(
        'organization_id', organization.id,
        'name', organization.name,
        'status', organization.status,
        'effective_at', assignment.effective_at
      )
      FROM reseller_merchant_assignments assignment
      JOIN operator_organizations organization
        ON organization.id = assignment.reseller_organization_id
      WHERE assignment.location_id = merchant.location_id
        AND assignment.status = 'active'
      LIMIT 1
    )
  )
  INTO v_result
  FROM merchants merchant
  LEFT JOIN merchant_health_rollups rollup
    ON rollup.location_id = merchant.location_id
   AND rollup.merchant_id = merchant.id
  WHERE merchant.location_id = p_location_id
  LIMIT 1;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION list_operator_resellers_page(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR p_offset IS NULL OR p_offset < 0 OR p_offset > 100000 THEN
    RAISE EXCEPTION 'Invalid operator reseller page request';
  END IF;

  WITH staff_counts AS MATERIALIZED (
    SELECT membership.organization_id, count(*) AS active_staff_count
    FROM operator_memberships membership
    WHERE membership.status = 'active'
    GROUP BY membership.organization_id
  ),
  merchant_counts AS MATERIALIZED (
    SELECT assignment.reseller_organization_id, count(DISTINCT assignment.location_id) AS active_merchant_count
    FROM reseller_merchant_assignments assignment
    WHERE assignment.status = 'active'
    GROUP BY assignment.reseller_organization_id
  ),
  reseller_rows AS MATERIALIZED (
    SELECT
      organization.id,
      organization.name,
      organization.status,
      organization.created_at,
      COALESCE(staff_counts.active_staff_count, 0) AS active_staff_count,
      COALESCE(merchant_counts.active_merchant_count, 0) AS active_merchant_count
    FROM operator_organizations organization
    LEFT JOIN staff_counts ON staff_counts.organization_id = organization.id
    LEFT JOIN merchant_counts ON merchant_counts.reseller_organization_id = organization.id
    WHERE organization.organization_type = 'reseller'
  ),
  page AS (
    SELECT *
    FROM reseller_rows
    ORDER BY name ASC, id ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY page.name ASC, page.id ASC)
      FROM page
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM reseller_rows),
    'limit', p_limit,
    'offset', p_offset
  )
  INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION list_operator_merchants_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_operator_platform_summary(BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_operator_merchant_detail(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION list_operator_resellers_page(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION list_operator_merchants_page(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION get_operator_platform_summary(BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION get_operator_merchant_detail(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION list_operator_resellers_page(INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION scalesafe_schema_version()
RETURNS INTEGER AS $$
  SELECT 110;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION scalesafe_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scalesafe_schema_version() TO service_role;

NOTIFY pgrst, 'reload schema';
