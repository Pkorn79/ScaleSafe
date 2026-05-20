import crypto from 'crypto';
import { config } from '../config';

export type PublicActionType = 'payment_update' | 'subscription_cancel' | 'milestone_signoff';

export interface PublicActionTokenPayload {
  action: PublicActionType;
  locationId: string;
  contactId: string;
  enrollmentId?: string;
  milestoneNumber?: number;
  exp: number;
}

export interface CreatePublicActionTokenInput {
  action: PublicActionType;
  locationId: string;
  contactId: string;
  enrollmentId?: string;
  milestoneNumber?: number;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

function getSecret(): string {
  return process.env.PUBLIC_ACTION_TOKEN_SECRET || config.ghl.ssoKey;
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payloadPart: string): string {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payloadPart)
    .digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createPublicActionToken(input: CreatePublicActionTokenInput): string {
  const payload: PublicActionTokenPayload = {
    action: input.action,
    locationId: input.locationId,
    contactId: input.contactId,
    exp: Math.floor(Date.now() / 1000) + (input.ttlSeconds || DEFAULT_TTL_SECONDS),
  };

  if (input.milestoneNumber !== undefined) {
    payload.milestoneNumber = input.milestoneNumber;
  }
  if (input.enrollmentId) {
    payload.enrollmentId = input.enrollmentId;
  }

  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart)}`;
}

export function verifyPublicActionToken(token: string, expectedAction?: PublicActionType): PublicActionTokenPayload {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    throw new Error('Invalid action token');
  }

  if (!signaturesMatch(signaturePart, sign(payloadPart))) {
    throw new Error('Invalid action token');
  }

  const payload = JSON.parse(decodeBase64Url(payloadPart)) as PublicActionTokenPayload;
  if (expectedAction && payload.action !== expectedAction) {
    throw new Error('Action token cannot be used for this request');
  }

  if (!payload.locationId || !payload.contactId || !payload.exp) {
    throw new Error('Invalid action token');
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Action token has expired');
  }

  return payload;
}

export function legacyPublicActionLinksAllowed(): boolean {
  return process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS === 'true'
    || (process.env.NODE_ENV || config.nodeEnv) !== 'production';
}
