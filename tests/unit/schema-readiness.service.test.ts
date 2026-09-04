const mockRpc = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ rpc: (...args: any[]) => mockRpc(...args) }),
}));

import { schemaReadinessService } from '../../src/services/schema-readiness.service';
import { config } from '../../src/config';

beforeEach(() => {
  jest.clearAllMocks();
  (config.guardian as any).enabled = false;
  (config.operator as any).enabled = false;
  (config.operator as any).authEnabled = false;
  (config.operator as any).healthEnabled = false;
});

test('accepts migration 106 as deployment-ready', async () => {
  mockRpc.mockResolvedValue({ data: 106, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({ ready: true, version: 106 });
  await expect(schemaReadinessService.assertReady()).resolves.toBeUndefined();
});

test('blocks startup when migration 106 has not been applied', async () => {
  mockRpc.mockResolvedValue({ data: 105, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 105,
    error: 'Schema version 105 is below required version 106',
  });
});

test('requires migration 107 when operator authentication is enabled', async () => {
  (config.operator as any).authEnabled = true;
  mockRpc.mockResolvedValue({ data: 106, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 106,
    error: 'Schema version 106 is below required version 107',
  });
});

test('requires migration 110 when the operator dashboard is enabled', async () => {
  (config.operator as any).enabled = true;
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  mockRpc.mockResolvedValue({ data: 109, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 109,
    error: 'Schema version 109 is below required version 110',
  });
  expect(schemaReadinessService.requiredVersion()).toBe(110);
});

test('blocks startup when the migration version RPC is unavailable', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

  await expect(schemaReadinessService.assertReady()).rejects.toThrow(/database is not deployment-ready/i);
});

test('requires migration 109 when Guardian ingestion is enabled', async () => {
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  (config.guardian as any).enabled = true;
  mockRpc.mockResolvedValue({ data: 108, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 108,
    error: 'Schema version 108 is below required version 109',
  });

  mockRpc.mockResolvedValue({ data: 109, error: null });
  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: true,
    version: 109,
  });
  expect(schemaReadinessService.requiredVersion()).toBe(109);
});

test('reports migration 108 as the running health schema when only health monitoring is enabled', () => {
  (config.operator as any).healthEnabled = true;

  expect(schemaReadinessService.requiredVersion()).toBe(108);
});
