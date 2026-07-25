import fs from 'fs';
import path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Command Center fault containment', () => {
  const observedBusinessPaths = [
    'src/services/evidence.service.ts',
    'src/services/money-operation.service.ts',
    'src/services/trigger-delivery-worker.ts',
    'src/services/evidence-connector-worker.ts',
    'src/services/money-reconciliation-worker.ts',
    'src/services/defense-compilation-worker.ts',
  ];

  it.each(observedBusinessPaths)(
    'never awaits monitoring writes in %s',
    (relativePath) => {
      expect(source(relativePath)).not.toMatch(
        /await\s+commandCenterHealthService\./,
      );
    },
  );

  it('keeps checkout and primary provisioning free of health-engine dependencies', () => {
    [
      'src/controllers/checkout.controller.ts',
      'src/services/checkout-cart.service.ts',
      'src/routes/checkout.routes.ts',
      'src/services/payment.service.ts',
      'src/services/payment-ledger.service.ts',
      'src/services/merchant.service.ts',
      'src/jobs/provisioning-recovery.ts',
    ].forEach((relativePath) => {
      const contents = source(relativePath);
      expect(contents).not.toContain('command-center-health.repository');
      expect(contents).not.toContain('commandCenterHealthRepository');
      expect(contents).not.toContain('platform_incidents');
      expect(contents).not.toContain('health_current');
    });
  });

  it('uses an operational scheduler repository rather than the health repository', () => {
    const scheduler = source('src/services/durable-scheduled-job.service.ts');
    const healthRepository = source(
      'src/repositories/command-center-health.repository.ts',
    );

    expect(scheduler).toContain('durableScheduledJobRepository');
    expect(scheduler).not.toContain('commandCenterHealthRepository');
    expect(healthRepository).not.toContain('claim_scheduled_job_run');
    expect(healthRepository).not.toContain('complete_scheduled_job_run');
  });
});
