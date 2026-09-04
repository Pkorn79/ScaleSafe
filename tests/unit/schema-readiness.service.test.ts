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

test('accepts migration 111 as deployment-ready', async () => {
  mockRpc.mockResolvedValue({ data: 111, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({ ready: true, version: 111 });
  await expect(schemaReadinessService.assertReady()).resolves.toBeUndefined();
});

test('blocks startup when migration 111 has not been applied', async () => {
  mockRpc.mockResolvedValue({ data: 110, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 110,
    error: 'Schema version 110 is below required version 111',
  });
});

test('requires migration 107 when operator authentication is enabled', async () => {
  (config.operator as any).authEnabled = true;
  mockRpc.mockResolvedValue({ data: 110, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 110,
    error: 'Schema version 110 is below required version 111',
  });
});

test('requires the complete migration 111 release when the operator dashboard is enabled', async () => {
  (config.operator as any).enabled = true;
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  mockRpc.mockResolvedValue({ data: 110, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 110,
    error: 'Schema version 110 is below required version 111',
  });
  expect(schemaReadinessService.requiredVersion()).toBe(111);
});

test('blocks startup when the migration version RPC is unavailable', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

  await expect(schemaReadinessService.assertReady()).rejects.toThrow(/database is not deployment-ready/i);
});

test('requires the complete migration 111 release when Guardian ingestion is enabled', async () => {
  (config.operator as any).authEnabled = true;
  (config.operator as any).healthEnabled = true;
  (config.guardian as any).enabled = true;
  mockRpc.mockResolvedValue({ data: 110, error: null });

  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: false,
    version: 110,
    error: 'Schema version 110 is below required version 111',
  });

  mockRpc.mockResolvedValue({ data: 111, error: null });
  await expect(schemaReadinessService.check()).resolves.toEqual({
    ready: true,
    version: 111,
  });
  expect(schemaReadinessService.requiredVersion()).toBe(111);
});

test('keeps the core migration 111 requirement when only health monitoring is enabled', () => {
  (config.operator as any).healthEnabled = true;

  expect(schemaReadinessService.requiredVersion()).toBe(111);
});
