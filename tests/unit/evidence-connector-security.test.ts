import crypto from 'crypto';
import {
  hashConnectorSecret,
  redactConnectorPayload,
  verifyHmacSignature,
} from '../../src/utils/evidence-connector-security';
import { safeRequestPath } from '../../src/middleware/requestLogger';

describe('evidence connector security', () => {
  it('redacts credentials and payment data recursively', () => {
    expect(redactConnectorPayload({
      user: { email: 'client@example.com', password: 'secret' },
      authorization: 'Bearer token',
      cardNumber: '4242424242424242',
    })).toEqual({
      user: { email: 'client@example.com', password: '[redacted]' },
      authorization: '[redacted]',
      cardNumber: '[redacted]',
    });
  });

  it('removes URL credentials and secret webhook paths from stored diagnostics', () => {
    expect(redactConnectorPayload({
      file: 'https://files.example.com/proof.pdf?token=private#fragment',
    })).toEqual({ file: 'https://files.example.com/proof.pdf' });
    expect(safeRequestPath('/webhooks/connectors/evc_public/ss_hook_private')).toBe(
      '/webhooks/connectors/evc_public/[redacted]',
    );
  });

  it('verifies HMAC signatures and rejects expired timestamps', () => {
    const secret = 'test-secret';
    const rawBody = Buffer.from('{"id":"evt_1"}');
    const now = Date.UTC(2026, 6, 10, 12, 0, 0);
    const timestamp = Math.floor(now / 1000);
    const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
    expect(verifyHmacSignature({ secret, rawBody, signatureHeader: `t=${timestamp},v1=${digest}`, now })).toBe(true);
    expect(verifyHmacSignature({ secret, rawBody, signatureHeader: `t=${timestamp - 1000},v1=${digest}`, now })).toBe(false);
    expect(hashConnectorSecret(secret)).toHaveLength(64);
  });
});
