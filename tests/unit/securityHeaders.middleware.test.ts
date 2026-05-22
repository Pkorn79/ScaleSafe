import express from 'express';
import request from 'supertest';
import { securityHeaders } from '../../src/middleware/securityHeaders';

describe('securityHeaders', () => {
  it('sets baseline browser security headers', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders);
    app.get('/ok', (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/ok');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});
