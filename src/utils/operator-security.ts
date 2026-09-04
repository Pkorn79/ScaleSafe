import crypto from 'crypto';
import { Request } from 'express';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SENSITIVE_KEY = /(authorization|password|secret|token|api[_-]?key|card|pan|cvv|cvc|bank|routing|account[_-]?number)/i;

function encryptionKey(): Buffer {
  const value = config.operator.tokenEncryptionKey;
  if (!value) throw new Error('Operator auth token encryption is not configured');
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) {
    throw new Error('OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes');
  }
  return decoded;
}

export function encryptOperatorCredential(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptOperatorCredential(ciphertext: string): string {
  const value = Buffer.from(ciphertext, 'base64');
  if (value.length <= IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('Invalid encrypted operator credential');
  const iv = value.subarray(0, IV_LENGTH);
  const authTag = value.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = value.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

export function randomOperatorToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashOperatorValue(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeOperatorValueEqual(expectedHash: string, value: string): boolean {
  if (!expectedHash || !value) return false;
  const actual = hashOperatorValue(value);
  const left = Buffer.from(expectedHash, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeOperatorEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase().slice(0, 320);
}

export function operatorIpHash(req: Request): string {
  return hashOperatorValue(req.ip || req.socket.remoteAddress || 'unknown');
}

export function operatorUserAgent(req: Request): string {
  return String(req.headers['user-agent'] || '').slice(0, 500);
}

export function sanitizeOperatorMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeOperatorMetadata(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 100);

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeOperatorMetadata(item, depth + 1);
  }
  return output;
}
