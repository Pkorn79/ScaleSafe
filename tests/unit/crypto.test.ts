import { sha256, verifyHmacSignature, decryptSsoPayload } from '../../src/utils/crypto';
import crypto from 'crypto';

describe('Crypto Utilities', () => {
  test('sha256 produces consistent hex output', () => {
    const hash = sha256('hello world');
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    // Same input = same output
    expect(sha256('hello world')).toBe(hash);
  });

  test('sha256 produces different output for different input', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });

  test('verifyHmacSignature validates correct signature', () => {
    const secret = 'test-secret';
    const payload = '{"test": true}';
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
  });

  test('verifyHmacSignature rejects wrong signature', () => {
    const secret = 'test-secret';
    const payload = '{"test": true}';
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');

    expect(verifyHmacSignature(payload, wrongSig, secret)).toBe(false);
  });
});

describe('SSO Decryption (CryptoJS-compatible)', () => {
  /**
   * Helper: encrypt a JSON payload in CryptoJS-compatible AES-256-CBC format.
   * Produces: base64("Salted__" + salt + ciphertext) with EVP_BytesToKey derivation.
   */
  function encryptCryptoJS(plaintext: string, passphrase: string): string {
    const salt = crypto.randomBytes(8);

    // EVP_BytesToKey (MD5-based) — derive 32-byte key + 16-byte IV
    const totalLen = 48;
    const parts: Buffer[] = [];
    let lastHash = Buffer.alloc(0);
    while (Buffer.concat(parts).length < totalLen) {
      const input = Buffer.concat([lastHash, Buffer.from(passphrase, 'utf-8'), salt]);
      lastHash = crypto.createHash('md5').update(input).digest();
      parts.push(lastHash);
    }
    const derived = Buffer.concat(parts);
    const key = derived.subarray(0, 32);
    const iv = derived.subarray(32, 48);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);

    // CryptoJS format: "Salted__" + salt + ciphertext
    const result = Buffer.concat([Buffer.from('Salted__', 'utf-8'), salt, encrypted]);
    return result.toString('base64');
  }

  test('decrypts CryptoJS-compatible SSO payload', () => {
    const passphrase = 'my-test-sso-secret-key-1234567890';
    const payload = { userId: 'user_1', companyId: 'comp_1', activeLocation: 'loc_1', email: 'test@example.com', role: 'admin' };
    const encrypted = encryptCryptoJS(JSON.stringify(payload), passphrase);

    const result = decryptSsoPayload(encrypted, passphrase);
    expect(result.userId).toBe('user_1');
    expect(result.companyId).toBe('comp_1');
    expect(result.activeLocation).toBe('loc_1');
    expect(result.email).toBe('test@example.com');
  });

  test('throws on invalid payload (no Salted__ prefix)', () => {
    const garbage = Buffer.from('not-valid-at-all').toString('base64');
    expect(() => decryptSsoPayload(garbage, 'key')).toThrow('Invalid SSO payload');
  });

  test('throws on wrong passphrase', () => {
    const passphrase = 'correct-passphrase-1234567890!!xx';
    const encrypted = encryptCryptoJS('{"test": true}', passphrase);
    expect(() => decryptSsoPayload(encrypted, 'wrong-passphrase-1234567890!!xx')).toThrow();
  });
});
