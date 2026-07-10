import crypto from 'crypto';

const SENSITIVE_KEY = /(authorization|password|passwd|secret|token|api[_-]?key|card|pan|cvv|cvc|bank|routing|account[_-]?number)/i;
const MAX_DEPTH = 8;
const MAX_STRING = 4000;

export function generateConnectorSecret(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashConnectorSecret(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashPayload(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function connectorKeyPrefix(secret: string): string {
  return secret.slice(0, Math.min(secret.length, 16));
}

export function redactConnectorPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let output = value;
    if (/^https?:\/\//i.test(output)) {
      try {
        const url = new URL(output);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        output = url.toString();
      } catch { /* leave malformed non-URL strings for normal truncation */ }
    }
    return output.length > MAX_STRING ? `${output.slice(0, MAX_STRING)}...[truncated]` : output;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactConnectorPayload(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactConnectorPayload(item, depth + 1);
  }
  return output;
}

export function verifyHmacSignature(params: {
  secret: string;
  signatureHeader: string;
  rawBody: Buffer;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const values = Object.fromEntries(
    params.signatureHeader.split(',').map((part) => part.trim().split('=', 2) as [string, string]),
  );
  const timestamp = Number(values.t);
  const signature = values.v1 || '';
  if (!Number.isFinite(timestamp) || !signature) return false;

  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > (params.toleranceSeconds ?? 300)) return false;

  const expected = crypto
    .createHmac('sha256', params.secret)
    .update(`${timestamp}.`)
    .update(params.rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
}
