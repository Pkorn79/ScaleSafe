import { getSupabase } from '../clients/supabase.client';
import {
  HealthObservationInput,
  WorkerHeartbeatInput,
} from '../types/command-center-health.types';

let commandCenterRequestObserver: (() => void) | null = null;

export function setCommandCenterRequestObserver(observer: (() => void) | null): void {
  commandCenterRequestObserver = observer;
}

function observeCommandCenterRequest(): void {
  try {
    commandCenterRequestObserver?.();
  } catch {
    // Resource accounting must never affect a database request.
  }
}

async function executeCommandCenterRequest<T>(
  request: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await request();
  } finally {
    observeCommandCenterRequest();
  }
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) || null;
  return (data as T | null) || null;
}

export interface TimePageCursor {
  at: string;
  id: string;
}

export interface MerchantHealthPageCursor {
  needsAttentionCount: number;
  lastReconciledAt: string;
  locationId: string;
}

export const commandCenterHealthRepository = {
  async recordWorkerHeartbeat(input: WorkerHeartbeatInput): Promise<void> {
    const { error } = await executeCommandCenterRequest(() => getSupabase().rpc('record_service_heartbeat', {
      p_worker_key: input.workerKey,
      p_instance_id: input.instanceId,
      p_state: input.state,
      p_started_at: input.startedAt,
      p_completed_at: input.completedAt,
      p_duration_ms: input.durationMs,
      p_work_count: input.workCount,
      p_error_class: input.errorClass || null,
      p_error_message: input.errorMessage || null,
    }));
    if (error) throw error;
  },

  async recordObservation(input: HealthObservationInput): Promise<void> {
    const { error } = await executeCommandCenterRequest(() => getSupabase().rpc('record_health_observation', {
      p_scope_type: input.scopeType,
      p_scope_id: input.scopeId,
      p_location_id: input.locationId || null,
      p_merchant_id: input.merchantId || null,
      p_check_key: input.checkKey,
      p_state: input.state,
      p_severity: input.severity || null,
      p_failure_class: input.failureClass || null,
      p_summary: input.summary,
      p_metrics: input.metrics || {},
      p_observed_at: input.observedAt || new Date().toISOString(),
    }));
    if (error) throw error;
  },

  async evaluateGlobalHealth(input: {
    requiredSchemaVersion: number;
    maxSupportedSchemaVersion: number;
    runtimeEnvironment: string;
    dangerousFlags: string[];
  }): Promise<{
    evaluatedCount: number;
    databaseSchemaVersion: number;
  }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc('evaluate_command_center_global_health', {
      p_required_schema_version: input.requiredSchemaVersion,
      p_max_supported_schema_version: input.maxSupportedSchemaVersion,
      p_runtime_environment: input.runtimeEnvironment,
      p_dangerous_flags: input.dangerousFlags,
    }));
    if (error) throw error;
    const row = firstRow<any>(data);
    return {
      evaluatedCount: Number(row?.evaluated_count || 0),
      databaseSchemaVersion: Number(row?.database_schema_version || 0),
    };
  },

  async getPlatformOverviewPage(input: {
    limit: number;
    checksCursor?: TimePageCursor | null;
    incidentsCursor?: TimePageCursor | null;
    merchantsCursor?: MerchantHealthPageCursor | null;
  }): Promise<{
    checks: any[];
    incidents: any[];
    merchants: any[];
    next: {
      checks: Record<string, unknown> | null;
      incidents: Record<string, unknown> | null;
      merchants: Record<string, unknown> | null;
    };
  }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'get_command_center_platform_overview',
      {
        p_limit: Math.max(1, Math.min(input.limit, 200)),
        p_health_before: input.checksCursor?.at || null,
        p_health_before_id: input.checksCursor?.id || null,
        p_incident_before: input.incidentsCursor?.at || null,
        p_incident_before_id: input.incidentsCursor?.id || null,
        p_merchant_attention_before:
          input.merchantsCursor?.needsAttentionCount ?? null,
        p_merchant_reconciled_before:
          input.merchantsCursor?.lastReconciledAt || null,
        p_merchant_location_after:
          input.merchantsCursor?.locationId || null,
      },
    ));
    if (error) throw error;
    const page = firstRow<any>(data) || {};
    return {
      checks: Array.isArray(page.checks) ? page.checks : [],
      incidents: Array.isArray(page.incidents) ? page.incidents : [],
      merchants: Array.isArray(page.merchants) ? page.merchants : [],
      next: {
        checks: page.next?.checks || null,
        incidents: page.next?.incidents || null,
        merchants: page.next?.merchants || null,
      },
    };
  },

  async listIncidentsPage(input: {
    limit: number;
    includeResolved: boolean;
    cursor?: TimePageCursor | null;
  }): Promise<{
    incidents: any[];
    next: Record<string, unknown> | null;
  }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'list_command_center_incidents_page',
      {
        p_limit: Math.max(1, Math.min(input.limit, 200)),
        p_include_resolved: input.includeResolved,
        p_before: input.cursor?.at || null,
        p_before_id: input.cursor?.id || null,
      },
    ));
    if (error) throw error;
    const page = firstRow<any>(data) || {};
    return {
      incidents: Array.isArray(page.incidents) ? page.incidents : [],
      next: page.next || null,
    };
  },

  async getIncidentById(incidentId: string): Promise<any | null> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase()
      .from('platform_incidents')
      .select('id, scope_type, scope_id, location_id, check_key, failure_class, severity, status, occurrence_count, first_seen_at, last_seen_at, recovery_candidate_at, acknowledged_at, suppressed_until, resolved_at, parent_incident_id, suppressible, runbook_key')
      .eq('id', incidentId)
      .maybeSingle());
    if (error) throw error;
    return data || null;
  },

  async listOperatorMerchantsPage(input: {
    limit: number;
    offset: number;
    query?: string | null;
    state?: string | null;
    plan?: string | null;
    processor?: string | null;
    installation?: string | null;
    reseller?: string | null;
    incidentSeverity?: string | null;
    component?: string | null;
    componentState?: string | null;
  }): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'list_operator_merchants_page',
      {
        p_limit: Math.max(1, Math.min(input.limit, 200)),
        p_offset: Math.max(0, input.offset),
        p_query: input.query || null,
        p_state: input.state || null,
        p_plan: input.plan || null,
        p_processor: input.processor || null,
        p_installation: input.installation || null,
        p_reseller: input.reseller || null,
        p_incident_severity: input.incidentSeverity || null,
        p_component: input.component || null,
        p_component_state: input.componentState || null,
      },
    ));
    if (error) throw error;
    const page = firstRow<any>(data) || {};
    return {
      items: Array.isArray(page.items) ? page.items : [],
      total: Number(page.total || 0),
      limit: Number(page.limit || input.limit),
      offset: Number(page.offset || input.offset),
    };
  },

  async getOperatorPlatformSummary(includeMerchantAttention: boolean): Promise<any> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'get_operator_platform_summary',
      { p_include_merchant_attention: includeMerchantAttention },
    ));
    if (error) throw error;
    return firstRow<any>(data) || data || {};
  },

  async getOperatorMerchantDetail(locationId: string): Promise<any | null> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'get_operator_merchant_detail',
      { p_location_id: locationId },
    ));
    if (error) throw error;
    return firstRow<any>(data);
  },

  async listOperatorResellersPage(input: {
    limit: number;
    offset: number;
  }): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'list_operator_resellers_page',
      {
        p_limit: Math.max(1, Math.min(input.limit, 200)),
        p_offset: Math.max(0, input.offset),
      },
    ));
    if (error) throw error;
    const page = firstRow<any>(data) || {};
    return {
      items: Array.isArray(page.items) ? page.items : [],
      total: Number(page.total || 0),
      limit: Number(page.limit || input.limit),
      offset: Number(page.offset || input.offset),
    };
  },

  async acknowledgeIncident(input: {
    incidentId: string;
    operatorUserId: string;
    summary: string;
  }): Promise<any> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc('acknowledge_platform_incident', {
      p_incident_id: input.incidentId,
      p_actor_operator_user_id: input.operatorUserId,
      p_summary: input.summary,
    }));
    if (error) throw error;
    return data;
  },

  async suppressIncident(input: {
    incidentId: string;
    operatorUserId: string;
    reason: string;
    until: string;
  }): Promise<any> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc('suppress_platform_incident', {
      p_incident_id: input.incidentId,
      p_actor_operator_user_id: input.operatorUserId,
      p_reason: input.reason,
      p_until: input.until,
    }));
    if (error) throw error;
    return data;
  },

  async writeApplicationMetricBucket(input: {
    instanceId: string;
    bucketStartedAt: string;
    bucketEndedAt: string;
    requestCount: number;
    clientErrorCount: number;
    serverErrorCount: number;
    supabaseRequestCount: number;
    commandCenterSupabaseRequestCount: number;
    providerRequestCount: number;
    databaseTimeoutCount: number;
    databaseCanaryLatencyMs: number | null;
    databaseCanaryFailed: boolean;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    latencyMaxMs: number | null;
    routeGroups: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await executeCommandCenterRequest(() => getSupabase()
      .from('application_metric_buckets')
      .upsert({
        instance_id: input.instanceId,
        bucket_started_at: input.bucketStartedAt,
        bucket_ended_at: input.bucketEndedAt,
        request_count: input.requestCount,
        client_error_count: input.clientErrorCount,
        server_error_count: input.serverErrorCount,
        supabase_request_count: input.supabaseRequestCount,
        command_center_supabase_request_count: input.commandCenterSupabaseRequestCount,
        provider_request_count: input.providerRequestCount,
        database_timeout_count: input.databaseTimeoutCount,
        database_canary_latency_ms: input.databaseCanaryLatencyMs,
        database_canary_failed: input.databaseCanaryFailed,
        latency_p50_ms: input.latencyP50Ms,
        latency_p95_ms: input.latencyP95Ms,
        latency_max_ms: input.latencyMaxMs,
        route_groups: input.routeGroups,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'instance_id,bucket_started_at' }));
    if (error) throw error;
  },

  async runDatabaseCanary(): Promise<void> {
    const { error } = await executeCommandCenterRequest(
      () => getSupabase().rpc('command_center_database_canary'),
    );
    if (error) throw error;
  },

  async reconcileDirtyMerchantHealth(limit: number, workerId: string): Promise<number> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc('reconcile_command_center_dirty_health', {
      p_limit: Math.max(1, Math.min(limit, 500)),
      p_worker_id: workerId,
    }));
    if (error) throw error;
    return Number(data || 0);
  },

  async reconcileMerchantHealthSweepBatch(input: {
    runId: string;
    workerId: string;
    limit?: number;
  }): Promise<{
    processedInBatch: number;
    totalProcessed: number;
    nextCursor: string | null;
    complete: boolean;
  }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc(
      'reconcile_command_center_full_sweep_batch',
      {
        p_run_id: input.runId,
        p_worker_id: input.workerId,
        p_limit: Math.max(1, Math.min(input.limit || 1000, 1000)),
      },
    ));
    if (error) throw error;
    const row = firstRow<any>(data);
    return {
      processedInBatch: Number(row?.processed_in_batch || 0),
      totalProcessed: Number(row?.total_processed || 0),
      nextCursor: row?.next_cursor ? String(row.next_cursor) : null,
      complete: row?.complete === true,
    };
  },

  async runRetention(batchSize = 5000): Promise<{
    metricBucketsDeleted: number;
    jobRunsDeleted: number;
    observationsDeleted: number;
    incidentsDeleted: number;
  }> {
    const { data, error } = await executeCommandCenterRequest(() => getSupabase().rpc('run_command_center_retention', {
      p_batch_size: Math.max(100, Math.min(batchSize, 10_000)),
    }));
    if (error) throw error;
    const row = firstRow<any>(data);
    return {
      metricBucketsDeleted: Number(row?.metric_buckets_deleted || 0),
      jobRunsDeleted: Number(row?.job_runs_deleted || 0),
      observationsDeleted: Number(row?.observations_deleted || 0),
      incidentsDeleted: Number(row?.incidents_deleted || 0),
    };
  },

  async markMerchantHealthDirty(locationId: string, reason: string): Promise<void> {
    const { error } = await executeCommandCenterRequest(() => getSupabase().rpc('mark_health_dirty', {
      p_location_id: locationId,
      p_reason: reason,
    }));
    if (error) throw error;
  },
};
