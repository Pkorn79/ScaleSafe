const rpc = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ rpc }),
}));

import {
  commandCenterHealthRepository,
  setCommandCenterRequestObserver,
} from '../../src/repositories/command-center-health.repository';

describe('commandCenterHealthRepository', () => {
  beforeEach(() => {
    rpc.mockReset();
    setCommandCenterRequestObserver(null);
  });

  afterAll(() => {
    setCommandCenterRequestObserver(null);
  });

  it('passes code, runtime, and unsafe flag posture through one evaluator call', async () => {
    rpc.mockResolvedValue({
      data: [{ evaluated_count: 32, database_schema_version: 104 }],
      error: null,
    });

    await expect(commandCenterHealthRepository.evaluateGlobalHealth({
      codeSchemaVersion: 104,
      runtimeEnvironment: 'production',
      dangerousFlags: ['ALLOW_UNSIGNED_GHL_WEBHOOKS'],
    })).resolves.toEqual({
      evaluatedCount: 32,
      databaseSchemaVersion: 104,
    });

    expect(rpc).toHaveBeenCalledWith('evaluate_command_center_global_health', {
      p_code_schema_version: 104,
      p_runtime_environment: 'production',
      p_dangerous_flags: ['ALLOW_UNSIGNED_GHL_WEBHOOKS'],
    });
  });

  it('counts one Command Center request even when Supabase rejects it', async () => {
    const observer = jest.fn();
    setCommandCenterRequestObserver(observer);
    rpc.mockResolvedValue({
      data: null,
      error: new Error('database unavailable'),
    });

    await expect(commandCenterHealthRepository.evaluateGlobalHealth({
      codeSchemaVersion: 104,
      runtimeEnvironment: 'production',
      dangerousFlags: [],
    })).rejects.toThrow('database unavailable');

    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('bounds retention batches and normalizes returned counts', async () => {
    rpc.mockResolvedValue({
      data: [{
        metric_buckets_deleted: 2,
        job_runs_deleted: 3,
        observations_deleted: 4,
        incidents_deleted: 5,
      }],
      error: null,
    });

    await expect(commandCenterHealthRepository.runRetention(50_000)).resolves.toEqual({
      metricBucketsDeleted: 2,
      jobRunsDeleted: 3,
      observationsDeleted: 4,
      incidentsDeleted: 5,
    });

    expect(rpc).toHaveBeenCalledWith('run_command_center_retention', {
      p_batch_size: 10_000,
    });
  });

  it('loads the platform overview through one bounded paginated RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        checks: [{ id: 'check-1' }],
        incidents: [{ id: 'incident-1' }],
        merchants: [{ location_id: 'loc-1' }],
        next: {
          checks: { lastObservedAt: '2026-07-23T00:00:00Z', id: 'check-1' },
          incidents: null,
          merchants: null,
        },
      },
      error: null,
    });

    await expect(commandCenterHealthRepository.getPlatformOverviewPage({
      limit: 500,
      checksCursor: {
        at: '2026-07-23T01:00:00Z',
        id: '11111111-1111-4111-8111-111111111111',
      },
    })).resolves.toEqual(expect.objectContaining({
      checks: [{ id: 'check-1' }],
      incidents: [{ id: 'incident-1' }],
      merchants: [{ location_id: 'loc-1' }],
    }));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_command_center_platform_overview', {
      p_limit: 200,
      p_health_before: '2026-07-23T01:00:00Z',
      p_health_before_id: '11111111-1111-4111-8111-111111111111',
      p_incident_before: null,
      p_incident_before_id: null,
      p_merchant_attention_before: null,
      p_merchant_reconciled_before: null,
      p_merchant_location_after: null,
    });
  });

  it('loads incident history through a stable cursor RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        incidents: [{ id: 'incident-2' }],
        next: null,
      },
      error: null,
    });

    await expect(commandCenterHealthRepository.listIncidentsPage({
      limit: 50,
      includeResolved: true,
      cursor: {
        at: '2026-07-22T23:00:00Z',
        id: '22222222-2222-4222-8222-222222222222',
      },
    })).resolves.toEqual({
      incidents: [{ id: 'incident-2' }],
      next: null,
    });

    expect(rpc).toHaveBeenCalledWith('list_command_center_incidents_page', {
      p_limit: 50,
      p_include_resolved: true,
      p_before: '2026-07-22T23:00:00Z',
      p_before_id: '22222222-2222-4222-8222-222222222222',
    });
  });
});
