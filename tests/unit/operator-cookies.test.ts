import express from 'express';
import request from 'supertest';
import {
  OPERATOR_CSRF_COOKIE,
  OPERATOR_PENDING_COOKIE,
  OPERATOR_SESSION_COOKIE,
  clearOperatorSessionCookies,
  parseCookies,
  setOperatorPendingCookie,
  setOperatorSessionCookies,
} from '../../src/utils/operator-cookies';

function cookieApp() {
  const app = express();
  app.get('/pending', (_req, res) => {
    setOperatorPendingCookie(res, 'pending-token', 600);
    res.status(204).send();
  });
  app.get('/session', (_req, res) => {
    setOperatorSessionCookies(res, {
      sessionToken: 'session-token',
      csrfToken: 'csrf-token',
      maxAgeSeconds: 3600,
    });
    res.status(204).send();
  });
  app.get('/clear', (_req, res) => {
    clearOperatorSessionCookies(res);
    res.status(204).send();
  });
  app.get('/parse', (req, res) => res.json(parseCookies(req)));
  return app;
}

function expectHostCookie(cookie: string): void {
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).not.toMatch(/Domain=/i);
}

function setCookies(response: any): string[] {
  const value = response.headers['set-cookie'];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

describe('operator host-only cookies', () => {
  it('makes the pending and session credentials host-only and HttpOnly', async () => {
    const pending = await request(cookieApp()).get('/pending');
    const pendingCookie = setCookies(pending)[0];
    expect(pendingCookie).toContain(`${OPERATOR_PENDING_COOKIE}=pending-token`);
    expect(pendingCookie).toContain('HttpOnly');
    expectHostCookie(pendingCookie);

    const session = await request(cookieApp()).get('/session');
    const cookies = setCookies(session);
    const sessionCookie = cookies.find((cookie: string) => cookie.startsWith(`${OPERATOR_SESSION_COOKIE}=`));
    const csrfCookie = cookies.find((cookie: string) => cookie.startsWith(`${OPERATOR_CSRF_COOKIE}=`));
    if (!sessionCookie || !csrfCookie) throw new Error('Expected both operator session cookies');
    expect(sessionCookie).toContain('HttpOnly');
    expect(csrfCookie).not.toContain('HttpOnly');
    expectHostCookie(sessionCookie);
    expectHostCookie(csrfCookie);
  });

  it('expires both session cookies with the same host-only boundary', async () => {
    const response = await request(cookieApp()).get('/clear');
    const cookies = setCookies(response);
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain('Max-Age=0');
      expectHostCookie(cookie);
    }
  });

  it('parses encoded cookie values without allowing malformed values to break the request', async () => {
    const response = await request(cookieApp())
      .get('/parse')
      .set('Cookie', 'plain=hello%20world; malformed=%E0%A4%A');
    expect(response.body).toEqual({ plain: 'hello world', malformed: '%E0%A4%A' });
  });
});
