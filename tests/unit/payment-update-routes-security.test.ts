import fs from 'fs';
import path from 'path';

describe('payment update public pages security', () => {
  it('does not log action-token URLs or config payloads to the browser console', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/routes/payment-update.routes.ts'),
      'utf8',
    );

    expect(source).not.toContain('RAW search');
    expect(source).not.toContain('RAW href');
    expect(source).not.toContain('Payment update config');
    expect(source).not.toMatch(/console\.log/);
  });
});
