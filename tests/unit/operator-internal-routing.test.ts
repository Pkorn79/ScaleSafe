import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config';

describe('operator internal routing boundary', () => {
  beforeEach(() => {
    (config.operator as any).enabled = false;
    (config.operator as any).authEnabled = false;
  });

  it('keeps the operator login route unavailable while the feature flags are off', async () => {
    const response = await request(createApp())
      .get('/internal/operator/login')
      .set('Host', 'ops.scalesafe.app')
      .set('Accept', 'text/html');

    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Not found' });
  });

  it('never serves the merchant SPA for an unknown internal route', async () => {
    const response = await request(createApp())
      .get('/internal/not-a-real-route')
      .set('Host', 'dashboard.scalesafe.app')
      .set('Accept', 'text/html');

    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Not found' });
    expect(response.text).not.toMatch(/<!doctype html/i);
  });

  it('serves operator assets only on the exact host with restrictive headers', async () => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;

    const login = await request(createApp())
      .get('/internal/operator/login')
      .set('Host', 'ops.scalesafe.app');
    expect(login.status).toBe(200);
    expect(login.type).toMatch(/html/);
    expect(login.headers['cache-control']).toBe('no-store');
    expect(login.headers['referrer-policy']).toBe('no-referrer');
    expect(login.headers['x-frame-options']).toBe('DENY');
    expect(login.headers['content-security-policy']).toContain("default-src 'none'");

    const script = await request(createApp())
      .get('/internal/operator/assets/auth.js')
      .set('Host', 'ops.scalesafe.app');
    expect(script.status).toBe(200);
    expect(script.text).not.toContain('innerHTML');
  });
});
