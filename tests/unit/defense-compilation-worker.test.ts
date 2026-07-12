const mockRunCompilation = jest.fn().mockResolvedValue(undefined);
const mockReconcileAccepted = jest.fn().mockResolvedValue(undefined);
const mockRpc = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../src/services/defense.service', () => ({
  defenseService: { runCompilation: (...args: any[]) => mockRunCompilation(...args) },
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

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { defenseCompilationWorker } from '../../src/services/defense-compilation-worker';

beforeEach(() => {
  jest.clearAllMocks();
  mockRunCompilation.mockResolvedValue(undefined);
  mockReconcileAccepted.mockResolvedValue(undefined);
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
