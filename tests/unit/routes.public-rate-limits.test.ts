/**
 * The two public, unauthenticated surfaces that were mounted with NO rate
 * limiter: the payment-update widget API (card-testing surface via saveCard)
 * and the evidence connector intake API (unmetered DB load pre-auth).
 * Exercises the REAL routes/index wiring.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: () => { throw new Error('no db access in this test'); } }),
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}));

import express from 'express';
import request from 'supertest';
import routes from '../../src/routes';

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use(routes);
// swallow route errors so limiter behavior is what we observe
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err?.statusCode || 500).json({ error: err?.code || 'ERR' });
});

describe('public surface rate limits', () => {
  it('throttles the public payment-update surface per client', async () => {
    let last: any;
    for (let i = 0; i < 101; i++) {
      last = await request(app).get('/api/payment-update/rate-limit-probe');
    }
    expect(last.status).toBe(429);
  });

  it('throttles the public evidence intake API per client', async () => {
    let last: any;
    for (let i = 0; i < 501; i++) {
      last = await request(app).post('/api/v1/evidence/events').send({});
    }
    expect(last.status).toBe(429);
  });
});
