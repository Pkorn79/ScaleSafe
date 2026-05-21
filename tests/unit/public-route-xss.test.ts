import fs from 'fs';
import path from 'path';

describe('public route XSS hardening', () => {
  it('does not use string-built innerHTML in public checkout/action pages', () => {
    const checkout = fs.readFileSync(path.join(__dirname, '../../src/routes/checkout.routes.ts'), 'utf8');
    const paymentUpdate = fs.readFileSync(path.join(__dirname, '../../src/routes/payment-update.routes.ts'), 'utf8');

    expect(checkout).not.toContain('.innerHTML');
    expect(paymentUpdate).not.toContain('.innerHTML');
    expect(checkout).toContain("link.rel = 'noopener noreferrer'");
    expect(paymentUpdate).toContain('function setLabeledText');
  });
});
