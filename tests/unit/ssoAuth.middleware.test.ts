import express from 'express';
import request from 'supertest';

const mockDecryptSsoPayload = jest.fn();
const mockFindByLocationId = jest.fn();

jest.mock('../../src/utils/crypto', () => ({
  decryptSsoPayload: mockDecryptSsoPayload,
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
  },
}));

jest.mock('../../src/config', () => ({
  config: {
    ghl: { ssoKey: 'test-key' },
    nodeEnv: 'production',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { ssoAuth } from '../../src/middleware/ssoAuth';
import { requireTenant } from '../../src/middleware/tenantContext';

function app() {
  const server = express();
  server.get('/protected', ssoAuth, requireTenant, (req, res) => {
    res.json((req as any).tenantContext);
  });
  server.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.code, message: err.message });
  });
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ssoAuth agency location selection', () => {
  it('accepts x-location-id only when it belongs to the authenticated agency', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp_1',
      userId: 'user_1',
    });
    mockFindByLocationId.mockResolvedValue({
      location_id: 'loc_1',
      company_id: 'comp_1',
    });

    const res = await request(app())
      .get('/protected')
      .set('x-sso-payload', 'encrypted')
      .set('x-location-id', 'loc_1');

    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc_1');
    expect(mockFindByLocationId).toHaveBeenCalledWith('loc_1');
  });

  it('rejects x-location-id for a different agency', async () => {
    mockDecryptSsoPayload.mockReturnValue({
      companyId: 'comp_1',
      userId: 'user_1',
    });
    mockFindByLocationId.mockResolvedValue({
      location_id: 'loc_2',
      company_id: 'comp_2',
    });

    const res = await request(app())
      .get('/protected')
      .set('x-sso-payload', 'encrypted')
      .set('x-location-id', 'loc_2');

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not available/i);
  });
});
