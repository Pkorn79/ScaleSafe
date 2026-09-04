import {
  projectOperatorHealthCheck,
  projectOperatorIncident,
} from '../../src/utils/operator-projections';

describe('operator response projections', () => {
  it('replaces provider-controlled health text and drops raw diagnostics', () => {
    const projected = projectOperatorHealthCheck({
      id: '11111111-1111-4111-8111-111111111111',
      scope_type: 'platform',
      scope_id: 'platform',
      location_id: null,
      check_key: 'platform.snapshot.freshness',
      state: 'unhealthy',
      severity: 'critical',
      failure_class: 'SNAPSHOT_STALE',
      summary: '<img src=x onerror=alert(1)> secret provider message',
      metrics: { token: 'must-not-leak' },
      metadata: { api_key: 'must-not-leak' },
      last_observed_at: '2026-09-03T12:00:00.000Z',
      state_changed_at: '2026-09-03T12:00:00.000Z',
      contract_version: 'command-center-health-v1.2',
    }, false);

    expect(projected).toEqual(expect.objectContaining({
      check_key: 'platform.snapshot.freshness',
      summary: 'Platform Snapshot Freshness reported unhealthy.',
    }));
    expect(JSON.stringify(projected)).not.toContain('secret provider message');
    expect(JSON.stringify(projected)).not.toContain('must-not-leak');
  });

  it('replaces incident titles and summaries with deterministic safe text', () => {
    const projected = projectOperatorIncident({
      id: '22222222-2222-4222-8222-222222222222',
      scope_type: 'platform',
      scope_id: 'platform',
      location_id: null,
      check_key: 'platform.workers.aggregate',
      failure_class: 'WORKERS_DEGRADED',
      severity: 'warning',
      status: 'open',
      title: '<script>provider title</script>',
      summary: 'raw provider diagnostics',
      occurrence_count: 2,
      first_seen_at: '2026-09-03T12:00:00.000Z',
      last_seen_at: '2026-09-03T12:05:00.000Z',
      runbook_key: 'RUNBOOK-WORKERS',
    }, false);

    expect(projected).toEqual(expect.objectContaining({
      title: 'Platform Workers Aggregate',
      summary: 'Platform Workers Aggregate is open. Failure class: WORKERS_DEGRADED.',
    }));
    expect(JSON.stringify(projected)).not.toContain('provider title');
    expect(JSON.stringify(projected)).not.toContain('raw provider diagnostics');
  });

  it('drops merchant-scoped records unless the caller is explicitly authorized', () => {
    const row = {
      id: '33333333-3333-4333-8333-333333333333',
      scope_type: 'merchant',
      scope_id: 'merchant-1',
      location_id: 'loc-1',
      check_key: 'merchant.processor.status',
      state: 'degraded',
    };

    expect(projectOperatorHealthCheck(row, false)).toBeNull();
    expect(projectOperatorHealthCheck(row, true)).toEqual(expect.objectContaining({ location_id: 'loc-1' }));
  });
});
