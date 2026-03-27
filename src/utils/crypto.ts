import crypto from 'crypto';

/**
 * Decrypt GHL SSO payload.
 * GHL uses CryptoJS-compatible AES-256-CBC encryption:
 *   Base64 → "Salted__" (8 bytes) + salt (8 bytes) + ciphertext
 * Key and IV are derived from passphrase + salt using OpenSSL's EVP_BytesToKey (MD5-based).
 */
export function decryptSsoPayload(encrypted: string, ssoKey: string): Record<string, string> {
  const raw = Buffer.from(encrypted, 'base64');

  // CryptoJS format: first 8 bytes = "Salted__", next 8 bytes = salt, rest = ciphertext
  const salted = raw.subarray(0, 8).toString('utf-8');
  if (salted !== 'Salted__') {
    throw new Error('Invalid SSO payload: missing Salted__ prefix');
  }

  const salt = raw.subarray(8, 16);
  const ciphertext = raw.subarray(16);

  // Derive key (32 bytes) and IV (16 bytes) using EVP_BytesToKey with MD5
  const { key, iv } = evpBytesToKey(ssoKey, salt, 32, 16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return JSON.parse(decrypted.toString('utf-8'));
}

/**
 * OpenSSL EVP_BytesToKey key derivation (MD5-based).
 * Used by CryptoJS for password-based encryption.
 */
function evpBytesToKey(
  passphrase: string,
  salt: Buffer,
  keyLen: number,
  ivLen: number,
): { key: Buffer; iv: Buffer } {
  const totalLen = keyLen + ivLen;
  const parts: Buffer[] = [];
  let lastHash = Buffer.alloc(0);

  while (Buffer.concat(parts).length < totalLen) {
    const input = Buffer.concat([lastHash, Buffer.from(passphrase, 'utf-8'), salt]);
    lastHash = crypto.createHash('md5').update(input).digest();
    parts.push(lastHash);
  }

  const derived = Buffer.concat(parts);
  return {
    key: derived.subarray(0, keyLen),
    iv: derived.subarray(keyLen, keyLen + ivLen),
  };
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
