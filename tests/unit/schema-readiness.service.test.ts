const mockRpc = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ rpc: (...args: any[]) => mockRpc(...args) }),
}));

import { schemaReadinessService } from '../../src/services/schema-readiness.service';

beforeEach(() => jest.clearAllMocks());

test('accepts migration 103 as deployment-ready', async () => {
  mockRpc.mockResolvedValue({ data: 103, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({ ready: true, version: 103 });
  await expect(schemaReadinessService.assertReady()).resolves.toBeUndefined();
});

test('blocks startup when migration 103 has not been applied', async () => {
  mockRpc.mockResolvedValue({ data: 102, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 102,
    error: 'Schema version 102 is below required version 103',
  });
});

test('blocks startup when the migration version RPC is unavailable', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

  await expect(schemaReadinessService.assertReady()).rejects.toThrow(/database is not deployment-ready/i);
});
