const mockRpc = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ rpc: (...args: any[]) => mockRpc(...args) }),
}));

import { schemaReadinessService } from '../../src/services/schema-readiness.service';

beforeEach(() => jest.clearAllMocks());

test('accepts migration 099 as deployment-ready', async () => {
  mockRpc.mockResolvedValue({ data: 99, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({ ready: true, version: 99 });
  await expect(schemaReadinessService.assertReady()).resolves.toBeUndefined();
});

test('blocks startup when migration 099 has not been applied', async () => {
  mockRpc.mockResolvedValue({ data: 98, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 98,
    error: 'Schema version 98 is below required version 99',
  });
});

test('blocks startup when the migration version RPC is unavailable', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

  await expect(schemaReadinessService.assertReady()).rejects.toThrow(/database is not deployment-ready/i);
});
