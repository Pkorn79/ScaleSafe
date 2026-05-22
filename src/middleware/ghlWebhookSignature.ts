import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const GHL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const LEGACY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function getPayload(req: Request): Buffer {
  return (req as any).rawBody instanceof Buffer
    ? (req as any).rawBody
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
}

export function verifyGhlWebhookRequest(req: Request): { ok: boolean; reason?: string; algorithm?: string } {
  const payload = getPayload(req);
  const ghlSignature = req.headers['x-ghl-signature']?.toString();
  const legacySignature = req.headers['x-wh-signature']?.toString();

  if (ghlSignature && ghlSignature !== 'N/A') {
    try {
      const ok = crypto.verify(null, payload, GHL_PUBLIC_KEY, Buffer.from(ghlSignature, 'base64'));
      return { ok, reason: ok ? undefined : 'GHL signature verification failed', algorithm: 'ed25519' };
    } catch (err: any) {
      return { ok: false, reason: err.message, algorithm: 'ed25519' };
    }
  }

  if (legacySignature && legacySignature !== 'N/A') {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(payload);
      const ok = verifier.verify(LEGACY_PUBLIC_KEY, legacySignature, 'base64');
      return { ok, reason: ok ? undefined : 'Legacy signature verification failed', algorithm: 'rsa-sha256' };
    } catch (err: any) {
      return { ok: false, reason: err.message, algorithm: 'rsa-sha256' };
    }
  }

  return { ok: false, reason: 'Missing GHL webhook signature' };
}

export function requireGhlWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const allowUnsigned = process.env.ALLOW_UNSIGNED_GHL_WEBHOOKS === 'true';
  const result = verifyGhlWebhookRequest(req);

  if (!result.ok && allowUnsigned && result.reason === 'Missing GHL webhook signature') {
    logger.warn({ path: req.path }, 'Allowing unsigned GHL webhook with explicit override');
    next();
    return;
  }

  if (!result.ok) {
    logger.warn({ path: req.path, reason: result.reason, algorithm: result.algorithm }, 'Rejected GHL webhook signature');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
}
