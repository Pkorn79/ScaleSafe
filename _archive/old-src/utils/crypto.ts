/**
 * crypto.ts — Cryptographic Utilities
 *
 * Provides two critical security functions:
 * 1. HMAC-SHA256 verification for accept.blue webhook signatures
 * 2. SSO data decryption for GHL embedded pages
 *
 * The SSO decryption logic comes from the GHL Marketplace App Template.
 * The HMAC verification follows accept.blue's webhook security spec.
 */

import { createHmac, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Verifies an accept.blue webhook signature.
 * Compares the X-Signature header against an HMAC-SHA256 of the raw request body.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyAcceptBlueSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const computed = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(computed, 'utf-8'),
      Buffer.from(signature, 'utf-8')
    );
  } catch {
    // Buffers of different lengths throw — means they don't match
    return false;
  }
}

/**
 * Decrypts SSO data from GHL.
 * When a merchant views a custom page embedded in GHL, GHL encrypts session data
 * (userId, locationId, companyId, etc.) with the app's SSO key. This function
 * decrypts it using AES-256-CBC with a key derived via EVP_BytesToKey (OpenSSL-style).
 *
 * Ported directly from the GHL Marketplace App Template's ghl.ts.
 */
export function decryptSSOData(encryptedKey: string, ssoKey: string): Record<string, unknown> {
  const blockSize = 16;
  const keySize = 32;
  const ivSize = 16;
  const saltSize = 8;

  const rawEncryptedData = Buffer.from(encryptedKey, 'base64');
  const salt = rawEncryptedData.subarray(saltSize, blockSize);
  const cipherText = rawEncryptedData.subarray(blockSize);

  // EVP_BytesToKey-style key derivation (OpenSSL compatible)
  let result = Buffer.alloc(0, 0);
  while (result.length < keySize + ivSize) {
    const hasher = createHash('md5');
    result = Buffer.concat([
      result,
      hasher
        .update(
          Buffer.concat([
            result.subarray(-ivSize),
            Buffer.from(ssoKey, 'utf-8'),
            salt,
          ])
        )
        .digest(),
    ]);
  }

  const decipher = createDecipheriv(
    'aes-256-cbc',
    result.subarray(0, keySize),
    result.subarray(keySize, keySize + ivSize)
  );

  const decrypted = decipher.update(cipherText);
  const finalDecrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(finalDecrypted.toString());
}
