import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import {
  GuardianExactPath,
  GUARDIAN_MAX_SEQUENCE,
  GUARDIAN_PROTOCOL_VERSION,
  GUARDIAN_REQUEST_HEADERS,
} from '../constants/guardian-checks';
import { config } from '../config';
import { guardianRepository } from '../repositories/guardian.repository';
import {
  GuardianAuthentication,
  GuardianErrorCode,
  GuardianRequestError,
} from '../types/guardian';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyGuardianSignatureMaterial(input: {
  method: string;
  exactPath: string;
  timestampSeconds: string;
  sequence: string;
  suppliedBodySha256: string;
  suppliedSignature: string;
  rawBody: Buffer;
  rawPublicKey: Buffer;
}): boolean {
  if (
    input.rawPublicKey.length !== 32
    || !SHA256_PATTERN.test(input.suppliedBodySha256)
    || !SIGNATURE_PATTERN.test(input.suppliedSignature)
  ) {
    return false;
  }
  const calculatedBodyHash = crypto
    .createHash('sha256')
    .update(input.rawBody)
    .digest('hex');
  if (
    input.suppliedBodySha256.length !== calculatedBodyHash.length
    || !crypto.timingSafeEqual(
      Buffer.from(input.suppliedBodySha256, 'ascii'),
      Buffer.from(calculatedBodyHash, 'ascii'),
    )
  ) {
    return false;
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(input.suppliedSignature, 'base64url');
  } catch {
    return false;
  }
  if (
    signature.length !== 64
    || signature.toString('base64url') !== input.suppliedSignature
  ) {
    return false;
  }

  const signingInput = [
    'v1',
    input.method,
    input.exactPath,
    input.timestampSeconds,
    input.sequence,
    calculatedBodyHash,
  ].join('\n');
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, input.rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

function singleHeader(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function rawHostname(req: Request): string {
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

function authFailure(): never {
  throw new GuardianRequestError(401, 'AUTHENTICATION_FAILED');
}

export function sendGuardianError(
  res: Response,
  statusCode: number,
  errorCode: GuardianErrorCode,
  requestId = crypto.randomUUID(),
): void {
  res.status(statusCode).json({
    protocol_version: GUARDIAN_PROTOCOL_VERSION,
    error_code: errorCode,
    request_id: requestId,
    server_time: new Date().toISOString(),
  });
}

export function guardianFeatureAndHost(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!config.guardian.enabled || rawHostname(req) !== config.guardian.host) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    return;
  }

  res.locals.guardianRequestId = crypto.randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}

export function rejectGuardianQueryString(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.originalUrl.includes('?')) {
    sendGuardianError(
      res,
      404,
      'NOT_FOUND',
      res.locals.guardianRequestId,
    );
    return;
  }
  next();
}

export async function authenticateGuardianRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const protocol = singleHeader(req, GUARDIAN_REQUEST_HEADERS.protocol);
    const keyId = singleHeader(req, GUARDIAN_REQUEST_HEADERS.keyId);
    const timestamp = singleHeader(req, GUARDIAN_REQUEST_HEADERS.timestamp);
    const sequence = singleHeader(req, GUARDIAN_REQUEST_HEADERS.sequence);
    const suppliedBodyHash = singleHeader(req, GUARDIAN_REQUEST_HEADERS.bodySha256);
    const suppliedSignature = singleHeader(req, GUARDIAN_REQUEST_HEADERS.signature);

    if (
      protocol !== String(GUARDIAN_PROTOCOL_VERSION)
      || !keyId
      || !UUID_PATTERN.test(keyId)
      || !timestamp
      || !/^[0-9]{1,10}$/.test(timestamp)
      || !sequence
      || !/^[1-9][0-9]{0,18}$/.test(sequence)
      || !suppliedBodyHash
      || !SHA256_PATTERN.test(suppliedBodyHash)
      || !suppliedSignature
      || !SIGNATURE_PATTERN.test(suppliedSignature)
    ) {
      authFailure();
    }

    const sequenceValue = BigInt(sequence);
    if (sequenceValue > GUARDIAN_MAX_SEQUENCE) authFailure();

    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds)
        > config.guardian.timestampToleranceSeconds
    ) {
      authFailure();
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (rawBody.length > config.guardian.maxBodyBytes) {
      throw new GuardianRequestError(413, 'PAYLOAD_TOO_LARGE');
    }
    const calculatedBodyHash = crypto
      .createHash('sha256')
      .update(rawBody)
      .digest('hex');
    if (
      suppliedBodyHash.length !== calculatedBodyHash.length
      || !crypto.timingSafeEqual(
        Buffer.from(suppliedBodyHash, 'ascii'),
        Buffer.from(calculatedBodyHash, 'ascii'),
      )
    ) {
      authFailure();
    }

    const credential = await guardianRepository.getCredentialByKeyId(keyId);
    const now = Date.now();
    if (
      !credential
      || !['active', 'overlap'].includes(credential.status)
      || new Date(credential.validFrom).getTime() > now
      || (
        credential.validUntil !== null
        && new Date(credential.validUntil).getTime() <= now
      )
    ) {
      authFailure();
    }

    const exactPath = req.originalUrl as GuardianExactPath;
    const method = req.method.toUpperCase();
    if (
      method !== 'GET'
      && method !== 'POST'
    ) {
      throw new GuardianRequestError(404, 'NOT_FOUND');
    }
    if (!verifyGuardianSignatureMaterial({
      method,
      exactPath,
      timestampSeconds: timestamp,
      sequence,
      suppliedBodySha256: suppliedBodyHash,
      suppliedSignature,
      rawBody,
      rawPublicKey: credential.publicKey,
    })) {
      authFailure();
    }

    res.locals.guardianAuthentication = {
      credential,
      exactPath,
      method,
      timestampSeconds: timestamp,
      sequence,
      bodySha256: calculatedBodyHash,
      rawBody,
    } satisfies GuardianAuthentication;
    next();
  } catch (error) {
    next(error);
  }
}
