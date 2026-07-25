const mockRunCompilation = jest.fn().mockResolvedValue(undefined);
const mockRegenerateLetter = jest.fn().mockResolvedValue(undefined);
const mockReconcileAccepted = jest.fn().mockResolvedValue(undefined);
const mockRpc = jest.fn();
const mockUpdate = jest.fn();
const mockMarkMerchantHealthDirty = jest.fn().mockResolvedValue(undefined);
const mockRecordWorkerHeartbeat = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/defense.service', () => ({
  defenseService: {
    runCompilation: (...args: any[]) => mockRunCompilation(...args),
    regenerateLetter: (...args: any[]) => mockRegenerateLetter(...args),
  },
}));

jest.mock('../../src/services/defense-submission.service', () => ({
  defenseSubmissionService: { reconcileAccepted: (...args: any[]) => mockReconcileAccepted(...args) },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    rpc: (...args: any[]) => mockRpc(...args),
    from: () => ({
      update: (value: any) => {
        mockUpdate(value);
        const builder: any = {};
        builder.eq = () => builder;
        builder.then = (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return builder;
      },
    }),
  }),
}));

jest.mock('../../src/config', () => ({
  config: {
    nodeEnv: 'test',
    operator: { healthEnabled: true },
  },
}));

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  commandCenterHealthRepository: {
    markMerchantHealthDirty: (...args: unknown[]) => mockMarkMerchantHealthDirty(...args),
    recordWorkerHeartbeat: (...args: unknown[]) => mockRecordWorkerHeartbeat(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { defenseCompilationWorker } from '../../src/services/defense-compilation-worker';

beforeEach(() => {
  jest.clearAllMocks();
  mockRunCompilation.mockResolvedValue(undefined);
  mockRegenerateLetter.mockResolvedValue(undefined);
  mockReconcileAccepted.mockResolvedValue(undefined);
  mockMarkMerchantHealthDirty.mockResolvedValue(undefined);
  mockRecordWorkerHeartbeat.mockResolvedValue(undefined);
});

afterAll(() => defenseCompilationWorker.stop());

test('a claimed packet runs once and clears its durable lease', async () => {
  const input = {
    locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1',
    disputeAmount: 500, disputeDate: '2026-07-01', deadline: '2026-07-20',
  };
  mockRpc.mockResolvedValue({
    data: [{
      id: 'def_1', location_id: 'loc_1', compilation_input: input,
      compilation_category: 'services_not_provided', compilation_attempts: 1,
    }],
    error: null,
  });

  await defenseCompilationWorker.runOnce();

  expect(mockRunCompilation).toHaveBeenCalledWith('def_1', input, 'services_not_provided');
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    compilation_completed_at: expect.any(String),
    compilation_lease_owner: null,
  }));
  expect(mockReconcileAccepted).toHaveBeenCalledWith(20);
});

test('a transient compilation failure releases the lease for a later retry', async () => {
  mockRunCompilation.mockRejectedValue(new Error('temporary storage outage'));
  mockRpc.mockResolvedValue({
    data: [{
      id: 'def_2', location_id: 'loc_1', compilation_input: {
        locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1',
        disputeAmount: 500, disputeDate: '2026-07-01', deadline: '2026-07-20',
      },
      compilation_category: 'services_not_provided', compilation_attempts: 1,
    }],
    error: null,
  });

  await defenseCompilationWorker.runOnce();

  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    status: 'pending',
    compilation_lease_owner: null,
    compilation_next_attempt_at: expect.any(String),
  }));
});

test('a regeneration job targets exactly one letter version', async () => {
  mockRpc.mockResolvedValue({
    data: [{
      id: 'def_regen',
      location_id: 'loc_1',
      compilation_input: { operation: 'regenerate', targetVersion: 4 },
      compilation_category: '__regenerate__',
      compilation_attempts: 1,
    }],
    error: null,
  });

  await defenseCompilationWorker.runOnce();

  expect(mockRegenerateLetter).toHaveBeenCalledWith('def_regen', 'loc_1', 4);
  expect(mockRunCompilation).not.toHaveBeenCalled();
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    compilation_completed_at: expect.any(String),
  }));
});

test('finishes defense compilation when health tables reject both writes', async () => {
  const input = {
    locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1',
    disputeAmount: 500, disputeDate: '2026-07-01', deadline: '2026-07-20',
  };
  mockRpc.mockResolvedValue({
    data: [{
      id: 'def_health_fault',
      location_id: 'loc_1',
      compilation_input: input,
      compilation_category: 'services_not_provided',
      compilation_attempts: 1,
    }],
    error: null,
  });
  mockMarkMerchantHealthDirty.mockRejectedValueOnce(
    new Error('health dirty table unavailable'),
  );
  mockRecordWorkerHeartbeat.mockRejectedValueOnce(
    new Error('health heartbeat table unavailable'),
  );

  await expect(defenseCompilationWorker.runOnce()).resolves.toBeUndefined();
  await new Promise((resolve) => setImmediate(resolve));

  expect(mockRunCompilation).toHaveBeenCalledWith(
    'def_health_fault',
    input,
    'services_not_provided',
  );
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    compilation_completed_at: expect.any(String),
    compilation_lease_owner: null,
  }));
});
