const mockJobOptions: any[] = [];
const mockJobStart = jest.fn();
const mockJobStop = jest.fn();
const mockEvaluateGlobalHealth = jest.fn();
const mockReconcileDirtyMerchantHealth = jest.fn();
const mockReconcileAllMerchantHealth = jest.fn();
const mockRunRetention = jest.fn();
const mockRecordDatabaseCanary = jest.fn();
const mockRunProvisioningRecovery = jest.fn();

jest.mock('../../src/services/durable-scheduled-job.service', () => ({
  DurableScheduledJob: jest.fn().mockImplementation((options: any) => {
    mockJobOptions.push(options);
    return {
      start: mockJobStart,
      stop: mockJobStop,
    };
  }),
}));

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  commandCenterHealthRepository: {
    evaluateGlobalHealth: mockEvaluateGlobalHealth,
    reconcileDirtyMerchantHealth: mockReconcileDirtyMerchantHealth,
    reconcileAllMerchantHealth: mockReconcileAllMerchantHealth,
    runRetention: mockRunRetention,
  },
}));

jest.mock('../../src/services/application-metrics.service', () => ({
  applicationMetricsService: {
    start: jest.fn(),
    stop: jest.fn(),
    recordDatabaseCanary: mockRecordDatabaseCanary,
  },
}));

jest.mock('../../src/services/command-center-health.service', () => ({
  commandCenterHealthService: {
    productionSafetyPosture: jest.fn(() => ({
      runtimeEnvironment: 'production',
      dangerousFlags: [],
    })),
  },
}));

jest.mock('../../src/jobs/daily-health-check', () => ({
  runDailyHealthCheck: jest.fn(),
}));
jest.mock('../../src/jobs/payment-reminder-check', () => ({
  runPaymentReminderCheck: jest.fn(),
}));
jest.mock('../../src/jobs/pif-completion-check', () => ({
  runPifCompletionCheck: jest.fn(),
}));
jest.mock('../../src/jobs/provisioning-recovery', () => ({
  runProvisioningRecovery: (...args: unknown[]) => mockRunProvisioningRecovery(...args),
}));
jest.mock('../../src/jobs/pulse-cadence-check', () => ({
  runPulseCadenceCheck: jest.fn(),
}));

import '../../src/services/command-center-runtime.service';

describe('command center consolidated health reconciliation job', () => {
  const healthJob = mockJobOptions.find(
    (options) => options.jobKey === 'job.command_center_health_reconcile',
  );
  const provisioningJob = mockJobOptions.find(
    (options) => options.jobKey === 'job.provisioning_recovery',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunProvisioningRecovery.mockResolvedValue({
      inspected: 1,
      started: 1,
      failed: 0,
      waitingForOauth: 0,
    });
  });

  it('registers exactly one five-minute health reconciliation job', () => {
    expect(healthJob).toBeDefined();
    expect(healthJob.cadenceMs).toBe(5 * 60_000);
    expect(healthJob.initialDelayMs).toBe(30_000);
    expect(
      mockJobOptions.filter(
        (options) => options.jobKey === 'job.command_center_health_reconcile',
      ),
    ).toHaveLength(1);
  });

  it('runs global evaluation and dirty-merchant reconciliation in one lease', async () => {
    mockEvaluateGlobalHealth.mockResolvedValue({
      evaluatedCount: 32,
      databaseSchemaVersion: 104,
    });
    mockReconcileDirtyMerchantHealth.mockResolvedValue(3);

    await expect(healthJob.task()).resolves.toEqual({
      processedCount: 35,
      summary: {
        databaseSchemaVersion: 104,
        globalChecksEvaluated: 32,
        merchantsReconciled: 3,
      },
    });
    expect(mockEvaluateGlobalHealth).toHaveBeenCalledTimes(1);
    expect(mockReconcileDirtyMerchantHealth).toHaveBeenCalledWith(
      200,
      expect.stringMatching(/^merchant_health_/),
    );
    expect(mockRecordDatabaseCanary).toHaveBeenCalledWith(
      expect.any(Number),
      false,
    );
  });

  it('does not reconcile merchants after global evaluation fails', async () => {
    mockEvaluateGlobalHealth.mockRejectedValue(new Error('database unavailable'));

    await expect(healthJob.task()).rejects.toThrow('database unavailable');
    expect(mockReconcileDirtyMerchantHealth).not.toHaveBeenCalled();
    expect(mockRecordDatabaseCanary).toHaveBeenCalledWith(
      expect.any(Number),
      true,
    );
  });

  it('keeps provisioning execution independent from a failed health evaluation', async () => {
    mockEvaluateGlobalHealth.mockRejectedValue(new Error('health engine unavailable'));

    await expect(healthJob.task()).rejects.toThrow('health engine unavailable');
    await expect(provisioningJob.task()).resolves.toEqual({
      processedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      summary: {
        started: 1,
        waitingForOauth: 0,
      },
    });
    expect(mockRunProvisioningRecovery).toHaveBeenCalledTimes(1);
  });
});
