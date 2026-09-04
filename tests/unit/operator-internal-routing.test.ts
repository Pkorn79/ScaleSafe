import request from 'supertest';
import { createApp } from '../../src/app';
import { config } from '../../src/config';

jest.mock('../../src/clients/supabase.client', () => ({
  setSupabaseRequestObserver: jest.fn(),
  getSupabase: () => ({
    from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }),
    rpc: async () => ({ data: 110, error: null }),
  }),
}));

describe('operator internal routing boundary', () => {
  beforeEach(() => {
    (config.operator as any).enabled = false;
    (config.operator as any).authEnabled = false;
    (config.operator as any).host = 'ops.scalesafe.app';
  });

  it.each([false, true])('keeps the operator root closed until auth is enabled (center=%s)', async (enabled) => {
    (config.operator as any).enabled = enabled;
    const response = await request(createApp()).get('/').set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each(['get', 'head'] as const)('redirects an enabled operator root to login for %s', async (method) => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;
    const response = await request(createApp())[method]('/').set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/internal/operator/login');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each(['/offers', '/index.html', '/api/health', '/api/enrollment/config', '/widgets/checkout.html', '/internal/operator-other'])('does not serve merchant paths on the operator host: %s', async (path) => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;
    const response = await request(createApp()).get(path).set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Not found' });
  });

  it('does not treat a forwarded operator host as the trusted host', async () => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;
    const response = await request(createApp())
      .get('/internal/operator/login')
      .set('Host', 'dashboard.scalesafe.app')
      .set('X-Forwarded-Host', 'ops.scalesafe.app');
    expect(response.status).toBe(404);
  });

  it('leaves the merchant health endpoint reachable on its own host', async () => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;
    const response = await request(createApp()).get('/health').set('Host', 'dashboard.scalesafe.app');
    expect(response.status).toBe(200);
  });

  it('does not redirect an operator root mutation request', async () => {
    (config.operator as any).enabled = true;
    (config.operator as any).authEnabled = true;
    const response = await request(createApp()).post('/').set('Host', 'ops.scalesafe.app');
    expect(response.status).toBe(404);
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
