/**
 * FanBasis config controller (Phase F1) — mirrors whop-config.controller. Verifies each handler
 * resolves the tenant, delegates to the service, and forwards errors to next().
 */

const mockSvc = {
  getPublic: jest.fn(),
  upsert: jest.fn(),
  testConnection: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('../../src/services/fanbasis-config.service', () => ({ fanbasisConfigService: mockSvc }));

let mockLocationId: string | null = 'loc-1';
jest.mock('../../src/middleware/tenantContext', () => ({ resolveLocationId: () => mockLocationId }));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { fanbasisConfigController } from '../../src/controllers/fanbasis-config.controller';
import { ValidationError } from '../../src/utils/errors';

function mockRes() {
  const r: any = {};
  r.json = jest.fn(() => r);
  r.status = jest.fn(() => r);
  return r;
}
const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationId = 'loc-1';
});

describe('fanbasisConfigController', () => {
  it('get returns the public config for the tenant', async () => {
    mockSvc.getPublic.mockResolvedValue({ connected: false });
    const res = mockRes();
    await fanbasisConfigController.get({} as any, res, next);
    expect(mockSvc.getPublic).toHaveBeenCalledWith('loc-1');
    expect(res.json).toHaveBeenCalledWith({ connected: false });
  });

  it('save delegates the body fields to upsert', async () => {
    mockSvc.upsert.mockResolvedValue({ creatorHandle: 'me', environment: 'sandbox' });
    const res = mockRes();
    await fanbasisConfigController.save(
      { body: { creatorHandle: 'me', apiKey: 'k', webhookSecret: 'w', environment: 'sandbox' } } as any,
      res, next,
    );
    expect(mockSvc.upsert).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      creatorHandle: 'me', apiKey: 'k', webhookSecret: 'w', environment: 'sandbox',
    }));
  });

  it('test delegates to testConnection', async () => {
    mockSvc.testConnection.mockResolvedValue({ connected: true });
    const res = mockRes();
    await fanbasisConfigController.test({} as any, res, next);
    expect(mockSvc.testConnection).toHaveBeenCalledWith('loc-1');
    expect(res.json).toHaveBeenCalledWith({ connected: true });
  });

  it('disconnect removes the config and returns success', async () => {
    mockSvc.disconnect.mockResolvedValue(undefined);
    const res = mockRes();
    await fanbasisConfigController.disconnect({} as any, res, next);
    expect(mockSvc.disconnect).toHaveBeenCalledWith('loc-1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a ValidationError to next when locationId is missing', async () => {
    mockLocationId = null;
    const res = mockRes();
    await fanbasisConfigController.get({} as any, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
