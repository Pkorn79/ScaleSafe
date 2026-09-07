import { operatorAuthJs } from '../../src/operator-auth-page';

describe('operator authentication page', () => {
  it('uses the Supabase MFA QR data URI without wrapping it in a second data URI', () => {
    expect(operatorAuthJs).toContain("document.getElementById('qr').src = setup.qrCode;");
    expect(operatorAuthJs).not.toContain("encodeURIComponent(setup.qrCode)");
  });
});
