import { sha256, verifyHmacSignature } from '../../src/utils/crypto';
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
