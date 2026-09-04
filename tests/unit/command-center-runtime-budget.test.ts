import fs from 'fs';
import path from 'path';

const runtime = fs.readFileSync(
  path.join(process.cwd(), 'src', 'services', 'command-center-runtime.service.ts'),
  'utf8',
);
const soakChecker = fs.readFileSync(
  path.join(process.cwd(), 'scripts', 'check-command-center-phase2-soak.sh'),
  'utf8',
);

describe('command center runtime resource budget', () => {
  it('uses one durable five-minute health reconciliation job', () => {
    expect(runtime).toContain("jobKey: 'job.command_center_health_reconcile'");
    expect(runtime).not.toContain("jobKey: 'job.command_center_global_evaluation'");
    expect(runtime).not.toContain("jobKey: 'job.merchant_health_reconcile'");

    const healthJobOccurrences = runtime.match(
      /jobKey: 'job\.command_center_health_reconcile'/g,
    ) || [];
    expect(healthJobOccurrences).toHaveLength(1);
  });

  it('keeps global and dirty-merchant evaluation inside that job', () => {
    expect(runtime).toContain('evaluateGlobalHealth');
    expect(runtime).toContain('reconcileDirtyMerchantHealth');
    expect(runtime).toContain('globalChecksEvaluated');
    expect(runtime).toContain('merchantsReconciled');
  });

  it('runs the daily full sweep through resumable 1,000-merchant batches', () => {
    expect(runtime).toContain('reconcileMerchantHealthSweepBatch');
    expect(runtime).toContain('limit: 1000');
    expect(runtime).toContain('batchCount < 100');
    expect(runtime).not.toContain('reconcileAllMerchantHealth');
  });

  it('does not probe completed long-cadence windows every five minutes', () => {
    expect(runtime.match(/retryProbeMs: 15 \* MINUTE_MS/g)).toHaveLength(2);
    expect(runtime.match(/retryProbeMs: HOUR_MS/g)).toHaveLength(4);
  });

  it('fails the soak for active incidents, nonhealthy checks, or provider egress', () => {
    expect(soakChecker).toContain('(( OPEN_INCIDENTS == 0 ))');
    expect(soakChecker).toContain('(( NONHEALTHY_CURRENT == 0 ))');
    expect(soakChecker).toContain('(( PROVIDER_REQUESTS == 0 ))');
    expect(soakChecker).not.toContain('"provider_requests": {"actual": 0');
  });
});
