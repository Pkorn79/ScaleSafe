import fs from 'fs';
import path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('evidence enrollment context propagation', () => {
  it('passes the opaque context through funnel widgets and quick checkout processor calls', () => {
    const bridge = source('src/widgets/paid-enrollment-bridge.js');
    const device = source('src/widgets/device-capture/index.html');
    const consent = source('src/widgets/consent-capture/index.html');
    const checkout = source('src/routes/checkout.routes.ts');

    expect(bridge).toContain("'evidenceContextToken'");
    expect(device).toContain('evidenceContextToken: evidenceContextToken');
    expect(consent).toContain('evidenceContextToken: evidenceContextToken');
    expect(checkout.match(/evidenceContextToken: evidenceContextToken/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps QMS outside the connector context contract', () => {
    const qms = source('src/services/pay-first-enrollment.service.ts');
    expect(qms).not.toContain('evidenceContextToken');
  });
});
