const recordWorkerHeartbeat = jest.fn().mockResolvedValue(undefined);
const recordObservation = jest.fn().mockResolvedValue(undefined);
const markMerchantHealthDirty = jest.fn().mockResolvedValue(undefined);
const warn = jest.fn();
const mockConfig = {
  nodeEnv: 'production',
  operator: { healthEnabled: true },
};

jest.mock('../../src/config', () => ({
  config: mockConfig,
}));

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  commandCenterHealthRepository: {
    recordWorkerHeartbeat: (...args: unknown[]) => recordWorkerHeartbeat(...args),
    recordObservation: (...args: unknown[]) => recordObservation(...args),
    markMerchantHealthDirty: (...args: unknown[]) => markMerchantHealthDirty(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => warn(...args),
  },
}));

import {
  classifyCommandCenterError,
  commandCenterHealthService,
} from '../../src/services/command-center-health.service';

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('commandCenterHealthService', () => {
  const unsafeFlagNames = [
    'ALLOW_DEV_LOCATION_AUTH',
    'ALLOW_UNSIGNED_GHL_WEBHOOKS',
    'ALLOW_UNSIGNED_STRIPE_STATE',
    'ALLOW_LEGACY_PUBLIC_ACTION_LINKS',
    'VITE_ENABLE_DAILY_TEST_BILLING',
  ];

  beforeEach(() => {
    recordWorkerHeartbeat.mockClear();
    recordWorkerHeartbeat.mockResolvedValue(undefined);
    recordObservation.mockClear();
    recordObservation.mockResolvedValue(undefined);
    markMerchantHealthDirty.mockClear();
    markMerchantHealthDirty.mockResolvedValue(undefined);
    warn.mockClear();
    mockConfig.operator.healthEnabled = true;
    unsafeFlagNames.forEach((name) => delete process.env[name]);
  });

  afterAll(() => {
    unsafeFlagNames.forEach((name) => delete process.env[name]);
  });

  it('records a healthy productive worker tick', async () => {
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.trigger_delivery',
      instanceId: 'trigger_test',
      startedAt: new Date('2026-07-23T12:00:00.000Z'),
      completedAt: new Date('2026-07-23T12:00:01.000Z'),
      workCount: 2,
    });
    await flushPromises();

    expect(recordWorkerHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      workerKey: 'worker.trigger_delivery',
      instanceId: 'trigger_test',
      state: 'healthy',
      durationMs: 1000,
      workCount: 2,
    }));
  });

  it('persists money heartbeats every minute while retaining five-minute throttles elsewhere', async () => {
    const record = (
      workerKey: 'worker.money_reconciliation' | 'worker.trigger_delivery',
      instanceId: string,
      completedAt: string,
    ) => commandCenterHealthService.recordWorkerTick({
      workerKey,
      instanceId,
      startedAt: new Date(new Date(completedAt).getTime() - 100),
      completedAt: new Date(completedAt),
      workCount: 0,
    });

    record('worker.money_reconciliation', 'money_cadence_test', '2026-07-23T12:00:00.000Z');
    record('worker.money_reconciliation', 'money_cadence_test', '2026-07-23T12:00:59.000Z');
    record('worker.money_reconciliation', 'money_cadence_test', '2026-07-23T12:01:00.000Z');
    record('worker.trigger_delivery', 'trigger_cadence_test', '2026-07-23T12:00:00.000Z');
    record('worker.trigger_delivery', 'trigger_cadence_test', '2026-07-23T12:01:00.000Z');
    record('worker.trigger_delivery', 'trigger_cadence_test', '2026-07-23T12:05:00.000Z');
    await flushPromises();

    expect(recordWorkerHeartbeat.mock.calls.map(([input]) => input.completedAt)).toEqual([
      '2026-07-23T12:00:00.000Z',
      '2026-07-23T12:01:00.000Z',
      '2026-07-23T12:00:00.000Z',
      '2026-07-23T12:05:00.000Z',
    ]);
  });

  it('records a timed-out state when a completed tick exceeds its contract', async () => {
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.external_evidence',
      instanceId: 'evidence_test',
      startedAt: new Date('2026-07-23T12:00:00.000Z'),
      completedAt: new Date('2026-07-23T12:01:16.000Z'),
      workCount: 1,
    });
    await flushPromises();

    expect(recordWorkerHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      state: 'timed_out',
      durationMs: 76_000,
    }));
  });

  it('stores an allowlisted error class and generic message', async () => {
    const error = Object.assign(new Error('socket included secret-value'), { code: 'ECONNRESET' });
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.money_reconciliation',
      instanceId: 'money_test',
      startedAt: new Date('2026-07-23T12:00:00.000Z'),
      completedAt: new Date('2026-07-23T12:00:02.000Z'),
      workCount: 0,
      error,
    });
    await flushPromises();

    expect(recordWorkerHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed',
      errorClass: 'DEPENDENCY_NETWORK_ERROR',
      errorMessage: 'A dependency request failed.',
    }));
    expect(JSON.stringify(recordWorkerHeartbeat.mock.calls)).not.toContain('secret-value');
  });

  it('classifies Supabase timeouts without copying the raw error', () => {
    const result = classifyCommandCenterError(
      Object.assign(new Error('Supabase request exceeded 10000ms: token=private'), {
        name: 'SupabaseRequestTimeoutError',
      }),
    );

    expect(result).toEqual({
      errorClass: 'SUPABASE_TIMEOUT',
      safeMessage: 'The database request timed out.',
    });
  });

  it('reports the approved production safety posture without exposing values', () => {
    process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS = 'true';
    process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS = 'false';
    process.env.VITE_ENABLE_DAILY_TEST_BILLING = 'true';

    expect(commandCenterHealthService.productionSafetyPosture()).toEqual({
      runtimeEnvironment: 'production',
      dangerousFlags: [
        'ALLOW_UNSIGNED_GHL_WEBHOOKS',
        'VITE_ENABLE_DAILY_TEST_BILLING',
      ],
    });
  });

  it('does not let a rejected health write fail the business caller', async () => {
    markMerchantHealthDirty.mockRejectedValueOnce(new Error('health table unavailable'));

    expect(() => {
      commandCenterHealthService.markMerchantDirty('location-1', 'payment_changed');
    }).not.toThrow();

    await flushPromises();
    expect(markMerchantHealthDirty).toHaveBeenCalledWith('location-1', 'payment_changed');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        checkKey: 'merchant:payment_changed',
      }),
      'Command Center health write failed without affecting business processing',
    );
  });

  it('performs no health writes while the Phase 2 feature flag is disabled', async () => {
    mockConfig.operator.healthEnabled = false;

    commandCenterHealthService.markMerchantDirty('location-1', 'payment_changed');
    commandCenterHealthService.recordObservationSafely({
      scopeType: 'merchant',
      scopeId: 'location-1',
      locationId: 'location-1',
      checkKey: 'merchant.billing',
      state: 'healthy',
      summary: 'No issue.',
    });
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.trigger_delivery',
      instanceId: 'disabled_test',
      startedAt: new Date('2026-07-23T12:00:00.000Z'),
      completedAt: new Date('2026-07-23T12:00:01.000Z'),
      workCount: 1,
    });
    await flushPromises();

    expect(markMerchantHealthDirty).not.toHaveBeenCalled();
    expect(recordObservation).not.toHaveBeenCalled();
    expect(recordWorkerHeartbeat).not.toHaveBeenCalled();
  });
});
