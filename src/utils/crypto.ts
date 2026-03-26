import crypto from 'crypto';

/**
 * Decrypt GHL SSO key payload.
 * GHL sends an encrypted string in the SSO handshake.
 * The app decrypts it with the SSO key to extract locationId, companyId, userId, email, role.
 */
export function decryptSsoPayload(encrypted: string, ssoKey: string): Record<string, string> {
  const algorithm = 'aes-256-cbc';
  // GHL uses the first 32 bytes of the key as the cipher key and first 16 as IV
  const keyBuffer = Buffer.from(ssoKey, 'utf-8');
  const key = keyBuffer.subarray(0, 32);
  const iv = keyBuffer.subarray(0, 16);

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf-8');
  decrypted += decipher.final('utf-8');

  return JSON.parse(decrypted);
}

/**
 * Verify HMAC-SHA256 signature on a webhook payload.
 * Used for verifying webhook authenticity from any source that signs with a shared secret.
 */
export function verifyHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

/**
 * Generate a SHA-256 hash of content (used for T&C version hashing).
 */
export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
