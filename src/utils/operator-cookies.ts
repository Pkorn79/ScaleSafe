import { Request, Response } from 'express';

export const OPERATOR_SESSION_COOKIE = '__Host-scalesafe_ops';
export const OPERATOR_PENDING_COOKIE = '__Host-scalesafe_ops_pending';
export const OPERATOR_CSRF_COOKIE = '__Host-scalesafe_ops_csrf';

export function parseCookies(req: Request): Record<string, string> {
  const output: Record<string, string> = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key || !value) continue;
    try {
      output[key] = decodeURIComponent(value);
    } catch {
      output[key] = value;
    }
  }
  return output;
}

function serializeCookie(name: string, value: string, options: {
  maxAgeSeconds: number;
  httpOnly: boolean;
}): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    'Secure',
    options.httpOnly ? 'HttpOnly' : '',
    'SameSite=Strict',
  ].filter(Boolean).join('; ');
}

function appendSetCookie(res: Response, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const values = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...values, cookie]);
}

export function setOperatorPendingCookie(res: Response, token: string, maxAgeSeconds: number): void {
  appendSetCookie(res, serializeCookie(OPERATOR_PENDING_COOKIE, token, { maxAgeSeconds, httpOnly: true }));
}

export function setOperatorSessionCookies(res: Response, input: {
  sessionToken: string;
  csrfToken: string;
  maxAgeSeconds: number;
}): void {
  appendSetCookie(res, serializeCookie(OPERATOR_SESSION_COOKIE, input.sessionToken, {
    maxAgeSeconds: input.maxAgeSeconds,
    httpOnly: true,
  }));
  appendSetCookie(res, serializeCookie(OPERATOR_CSRF_COOKIE, input.csrfToken, {
    maxAgeSeconds: input.maxAgeSeconds,
    httpOnly: false,
  }));
}

export function clearOperatorPendingCookie(res: Response): void {
  appendSetCookie(res, serializeCookie(OPERATOR_PENDING_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }));
}

export function clearOperatorSessionCookies(res: Response): void {
  appendSetCookie(res, serializeCookie(OPERATOR_SESSION_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }));
  appendSetCookie(res, serializeCookie(OPERATOR_CSRF_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false }));
}
