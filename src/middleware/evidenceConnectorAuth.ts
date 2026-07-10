import { Request, Response, NextFunction } from 'express';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { decrypt } from '../utils/field-encryption';
import { hashConnectorSecret, verifyHmacSignature } from '../utils/evidence-connector-security';
import { logger } from '../utils/logger';

function bearer(req: Request): string {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function finishAuth(req: Request, res: Response, next: NextFunction, auth: any): Promise<void> {
  if (!auth.connection || auth.connection.status !== 'active') {
    res.status(401).json({ error: 'CONNECTOR_DISABLED', message: 'Evidence connection is disabled.' });
    return;
  }
  const allowed = await evidenceConnectorRepository.consumeRateLimit(auth.connection.id, auth.connection.rate_limit_per_minute);
  if (!allowed) {
    res.status(429).json({ error: 'CONNECTOR_RATE_LIMITED', message: 'Evidence connection rate limit exceeded.' });
    return;
  }
  req.evidenceConnector = auth;
  await evidenceConnectorRepository.touchCredential(auth.credential.id).catch(() => undefined);
  next();
}

export async function requireCanonicalEvidenceApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const secret = bearer(req);
    if (!secret) {
      res.status(401).json({ error: 'EVIDENCE_API_KEY_REQUIRED', message: 'Bearer API key required.' });
      return;
    }
    const match = await evidenceConnectorRepository.findCredentialByHash(hashConnectorSecret(secret));
    if (!match || match.credential.credential_type !== 'api_key' || match.connection.connection_type !== 'canonical_api') {
      res.status(401).json({ error: 'INVALID_EVIDENCE_API_KEY', message: 'Evidence API key is invalid.' });
      return;
    }
    await finishAuth(req, res, next, {
      ...match,
      authMethod: 'api_key',
      signatureVerified: false,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Canonical evidence API authentication failed');
    res.status(401).json({ error: 'EVIDENCE_AUTH_FAILED', message: 'Evidence API authentication failed.' });
  }
}

export async function requireRawEvidenceConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const publicId = String(req.params.connectionId || '').trim();
    const connection = await evidenceConnectorRepository.getConnectionByPublicId(publicId);
    if (!connection || connection.connection_type !== 'raw_webhook') {
      res.status(404).json({ error: 'EVIDENCE_CONNECTION_NOT_FOUND' });
      return;
    }

    const supplied = String(req.params.secret || bearer(req) || '').trim();
    if (supplied) {
      const match = await evidenceConnectorRepository.findCredentialByHash(hashConnectorSecret(supplied));
      if (!match || match.connection.id !== connection.id || !['api_key', 'url_secret'].includes(match.credential.credential_type)) {
        res.status(401).json({ error: 'INVALID_EVIDENCE_CREDENTIAL' });
        return;
      }
      await finishAuth(req, res, next, {
        ...match,
        authMethod: match.credential.credential_type,
        signatureVerified: false,
      });
      return;
    }

    const signature = String(req.headers['x-scalesafe-signature'] || '');
    if (!signature || !req.rawBody) {
      res.status(401).json({ error: 'EVIDENCE_SIGNATURE_REQUIRED' });
      return;
    }
    const credentials = await evidenceConnectorRepository.listActiveCredentials(connection.id, 'hmac');
    for (const credential of credentials) {
      if (!credential.secret_encrypted) continue;
      const valid = verifyHmacSignature({
        secret: decrypt(credential.secret_encrypted),
        signatureHeader: signature,
        rawBody: req.rawBody,
      });
      if (!valid) continue;
      await finishAuth(req, res, next, {
        connection,
        credential,
        authMethod: 'hmac',
        signatureVerified: true,
      });
      return;
    }
    res.status(401).json({ error: 'INVALID_EVIDENCE_SIGNATURE' });
  } catch (err: any) {
    logger.error({ err: err.message, connectionId: req.params.connectionId }, 'Raw evidence webhook authentication failed');
    res.status(401).json({ error: 'EVIDENCE_AUTH_FAILED' });
  }
}
