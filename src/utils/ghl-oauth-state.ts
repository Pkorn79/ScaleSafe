import crypto from 'crypto';
import { config } from '../config';
import { ValidationError } from './errors';

const STATE_MAX_AGE_MS = 60 * 60 * 1000;

interface GhlOAuthStatePayload {
  issuedAt: number;
  nonce: string;
  source: 'scalesafe';
}

function getSecret(): string {
  return config.publicActionTokenSecret || process.env.PUBLIC_ACTION_TOKEN_SECRET || config.processorEncryptionKey;
}

function sign(payloadPart: string): string {
  const secret = getSecret();
  if (!secret) {
    throw new ValidationError('OAuth state signing secret is not configured');
  }
  return crypto.createHmac('sha256', secret).update(payloadPart).digest('base64url');
}

function signatureMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createGhlOAuthState(): string {
  const payload: GhlOAuthStatePayload = {
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
    source: 'scalesafe',
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadPart}.${sign(payloadPart)}`;
}

export function verifyGhlOAuthState(state: string): void {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ValidationError('Invalid OAuth state');
  }

  const [payloadPart, signaturePart] = parts;
  const expectedSignature = sign(payloadPart);
  if (!signatureMatches(signaturePart, expectedSignature)) {
    throw new ValidationError('Invalid OAuth state signature');
  }

  let payload: Partial<GhlOAuthStatePayload>;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Invalid OAuth state payload');
  }

  if (payload.source !== 'scalesafe' || typeof payload.issuedAt !== 'number') {
    throw new ValidationError('Invalid OAuth state payload');
  }

  if (Date.now() - payload.issuedAt > STATE_MAX_AGE_MS) {
    throw new ValidationError('Expired OAuth state');
  }
}
