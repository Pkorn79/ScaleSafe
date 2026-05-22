import express from 'express';
import request from 'supertest';
import healthRoutes from '../../src/routes/health.routes';

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({ data: [], error: null })),
        })),
      })),
    })),
  })),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn(),
  },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: {
    calculateReadinessScore: jest.fn(),
  },
}));

function app() {
  const server = express();
  server.use(express.json());
  server.use(healthRoutes);
  return server;
}

describe('debug routes hardening', () => {
  const originalDebugToken = process.env.DEBUG_ADMIN_TOKEN;

  beforeEach(() => {
    process.env.DEBUG_ADMIN_TOKEN = 'debug-token';
  });

  afterAll(() => {
    if (originalDebugToken === undefined) {
      delete process.env.DEBUG_ADMIN_TOKEN;
    } else {
      process.env.DEBUG_ADMIN_TOKEN = originalDebugToken;
    }
  });

  it('does not allow the contact backfill mutation through GET', async () => {
    await request(app())
      .get('/api/debug/backfill-contacts/loc_1')
      .set('x-admin-debug-token', 'debug-token')
      .expect(404);
  });

  it('does not allow the PDF storage write test through GET', async () => {
    await request(app())
      .get('/api/debug/test-pdf-storage')
      .set('x-admin-debug-token', 'debug-token')
      .expect(404);
  });

  it('does not include stack traces in debug error responses', async () => {
    const response = await request(app())
      .get('/api/debug/clients-data/loc_1')
      .set('x-admin-debug-token', 'debug-token')
      .expect(500);

    expect(response.body.error).toEqual(expect.any(String));
    expect(response.body.stack).toBeUndefined();
  });

  it('rate limits debug routes', async () => {
    let rateLimited = false;

    for (let i = 0; i < 35; i += 1) {
      const response = await request(app())
        .get('/api/debug/clients-data/loc_1')
        .set('x-admin-debug-token', 'debug-token');

      if (response.status === 429) {
        rateLimited = true;
        expect(response.body).toEqual({ error: 'RATE_LIMITED', message: 'Too many requests' });
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });
});
